const { getPrisma } = require('../db');
const { ensureGlobalConfig, getGlobalConfig } = require('./globalConfig');
const { ChannelType, EmbedBuilder } = require('discord.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const FROZEN_CACHE_TTL_MS = 60_000;

const frozenCache = new Map(); // key: `${globalConfigId}:${guildId}:${userId}` -> { until: Date|null, at: number }

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(parseInt(String(value), 10) || 0);
}

function getTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function ensurePointsConfig(prisma = getPrisma()) {
  const globalConfig = await ensureGlobalConfig(prisma);
  let cfg = await prisma.pointsConfig.findUnique({ where: { globalConfigId: globalConfig.id } });
  if (!cfg) {
    cfg = await prisma.pointsConfig.create({
      data: {
        globalConfigId: globalConfig.id,
        enabled: false,
      },
    });
  }
  return cfg;
}

async function getPointsConfig(prisma = getPrisma()) {
  const cfg = await prisma.pointsConfig.findFirst({
    include: {
      participantRoles: true,
      ignoredRoles: true,
      ignoredUsers: true,
      chatChannels: true,
      leaderboardPanels: true,
    },
  });
  if (cfg) return cfg;
  return ensurePointsConfig(prisma);
}

function isSystemEnabled(cfg) {
  if (!cfg) return false;
  if (!cfg.enabled) return false;
  return true;
}

function isChatEnabled(cfg) {
  return isSystemEnabled(cfg) && toBigInt(cfg.pontosChat || 0n) !== 0n;
}

function isCallEnabled(cfg) {
  return isSystemEnabled(cfg) && toBigInt(cfg.pontosCall || 0n) !== 0n;
}

function isInvitesEnabled(cfg) {
  return isSystemEnabled(cfg) && toBigInt(cfg.pontosConvites || 0n) !== 0n;
}

function hashMessageContent(content) {
  if (!content) return '';
  return content.trim().toLowerCase();
}

function memberHasAnyRole(member, roleIds = []) {
  if (!member?.roles?.cache?.size || !roleIds?.length) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function clampBigIntFloorZero(value) {
  if (value < 0n) return 0n;
  return value;
}

async function ensureBalance(prisma, cfg, guildId, userId) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const balance = await prisma.pointsBalance.upsert({
    where: {
      globalConfigId_guildId_userId: { globalConfigId, guildId, userId },
    },
    update: {},
    create: { globalConfigId, guildId, userId },
    include: { chatActivity: true, voiceSession: true },
  });
  return balance;
}

function buildLogEmbed({ title, description }) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description).setTimestamp(new Date());
}

async function sendLog(client, channelId, payload) {
  if (!client || !channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  if (payload.embeds) {
    await channel.send(payload).catch(() => {});
  } else {
    const { title, description } = payload;
    if (!title && !description) return;
    await channel.send({ embeds: [buildLogEmbed({ title: title || 'Log', description: description || '' })] }).catch(() => {});
  }
}

function userEligible(cfg, member) {
  if (!cfg || !member) return false;
  if (member.user?.bot) return false;
  const ignoredUsers = cfg.ignoredUsers?.map((u) => u.userId) || [];
  if (ignoredUsers.includes(member.id)) return false;
  const ignoredRoles = cfg.ignoredRoles?.map((r) => r.roleId) || [];
  if (ignoredRoles.length && memberHasAnyRole(member, ignoredRoles)) return false;
  if (cfg.mode === 'SELECTIVE') {
    const participantRoles = cfg.participantRoles?.map((r) => r.roleId) || [];
    if (participantRoles.length && !memberHasAnyRole(member, participantRoles)) {
      return false;
    }
  }
  return true;
}

async function recordTransaction(prisma, cfg, { guildId, userId, amount, type, source = 'SYSTEM', reason, actorId, metadata }) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const delta = toBigInt(amount || 0n);
  const balance = await ensureBalance(prisma, cfg, guildId, userId);
  // Atualização atômica + clamp a zero para evitar perdas em concorrência
  await prisma.$executeRaw`UPDATE "PointsBalance" SET "points" = MAX(0, "points" + ${delta}) WHERE "id" = ${balance.id}`;
  const updated = await prisma.pointsBalance.findUnique({ where: { id: balance.id } });
  await prisma.pointsTransaction.create({
    data: {
      globalConfigId,
      guildId,
      userId,
      amount: delta,
      type: String(type || ''),
      source: String(source || 'SYSTEM'),
      reason,
      actorId,
      metadata: metadata == null ? null : String(metadata),
    },
  });
  return toBigInt(updated?.points || 0n);
}

async function setFrozen(prisma, cfg, { guildId, userId, expiresAt, reason, moderatorId, commandChannelId }) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  await ensureBalance(prisma, cfg, guildId, userId);
  const punishment = await prisma.pointsPunishment.create({
    data: {
      globalConfigId,
      guildId,
      userId,
      moderatorId,
      reason,
      expiresAt,
      commandChannelId,
      active: true,
    },
  });
  await prisma.pointsBalance.update({
    where: { globalConfigId_guildId_userId: { globalConfigId, guildId, userId } },
    data: { frozenUntil: expiresAt || new Date(8640000000000000) },
  });
  frozenCache.delete(`${globalConfigId}:${guildId}:${userId}`);
  return punishment;
}

async function liftPunishment(prisma, cfg, { guildId, userId }) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  await prisma.pointsPunishment.updateMany({
    where: { globalConfigId, guildId, userId, active: true },
    data: { active: false, liftedAt: new Date() },
  });
  await prisma.pointsBalance.updateMany({
    where: { globalConfigId, guildId, userId },
    data: { frozenUntil: null },
  });
  frozenCache.delete(`${globalConfigId}:${guildId}:${userId}`);
}

async function isFrozen(prisma, cfg, guildId, userId) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const cacheKey = `${globalConfigId}:${guildId}:${userId}`;
  const nowTs = Date.now();
  const cached = frozenCache.get(cacheKey);
  if (cached && nowTs - cached.at < FROZEN_CACHE_TTL_MS) {
    return cached.until ? cached.until > new Date() : false;
  }

  const bal = await prisma.pointsBalance.findUnique({ where: { globalConfigId_guildId_userId: { globalConfigId, guildId, userId } } });
  if (!bal?.frozenUntil) {
    frozenCache.set(cacheKey, { until: null, at: nowTs });
    return false;
  }
  if (bal.frozenUntil && bal.frozenUntil > new Date()) {
    frozenCache.set(cacheKey, { until: bal.frozenUntil, at: nowTs });
    return true;
  }
  // expired: clear
  await prisma.pointsBalance.update({
    where: { globalConfigId_guildId_userId: { globalConfigId, guildId, userId } },
    data: { frozenUntil: null },
  }).catch(() => {});
  frozenCache.set(cacheKey, { until: null, at: nowTs });
  return false;
}

async function handleChatMessage({ message, prisma, cfg }) {
  if (!isChatEnabled(cfg)) return false;
  if (!message.guild || !message.member) return false;
  if (!userEligible(cfg, message.member)) return false;
  if (await isFrozen(prisma, cfg, message.guildId, message.author.id)) return false;
  const guildId = message.guildId;
  const userId = message.author.id;
  if (cfg.chatChannels?.length) {
    const allowed = cfg.chatChannels.some((c) => c.channelId === message.channelId);
    if (!allowed) return false;
  }
  const minChars = cfg.qtdCaracteresMin || 0;
  if ((message.content || '').trim().length < minChars) return false;
  const contentHash = hashMessageContent(message.content || '');

  const balance = await ensureBalance(prisma, cfg, guildId, userId);
  let activity = await prisma.pointsChatActivity.findUnique({ where: { globalConfigId_guildId_userId: { globalConfigId: cfg.globalConfigId || cfg.id, guildId, userId } } });
  if (!activity) {
    activity = await prisma.pointsChatActivity.create({
      data: {
        globalConfigId: cfg.globalConfigId || cfg.id,
        guildId,
        userId,
        lastMessageAt: null,
        lastMessageHash: null,
        dailyPoints: 0n,
        dailyDate: getTodayUTC(),
      },
    });
  }

  const now = new Date();
  if (activity.lastMessageHash && activity.lastMessageHash === contentHash) {
    return false;
  }
  const cooldownMinutes = cfg.cooldownChatMinutes ?? 0;
  if (activity.lastMessageAt) {
    const diffMinutes = (now.getTime() - new Date(activity.lastMessageAt).getTime()) / MINUTE_MS;
    if (diffMinutes < cooldownMinutes) {
      return false;
    }
  }

  let dailyPoints = toBigInt(activity.dailyPoints || 0n);
  const today = getTodayUTC();
  const sameDay = activity.dailyDate && new Date(activity.dailyDate).getTime() === today.getTime();
  if (!sameDay) {
    dailyPoints = 0n;
  }
  const limit = cfg.limitDailyChat ? toBigInt(cfg.limitDailyChat) : null;
  const award = toBigInt(cfg.pontosChat || 0n);
  if (limit !== null && dailyPoints + award > limit) {
    const canGive = limit - dailyPoints;
    if (canGive <= 0n) {
      return false;
    }
  await recordTransaction(prisma, cfg, { guildId, userId, amount: canGive, type: 'CHAT', source: 'SYSTEM', reason: 'Pontos de chat (limitado)' });
    await prisma.pointsChatActivity.update({
      where: { id: activity.id },
      data: { lastMessageAt: now, lastMessageHash: contentHash, dailyPoints: limit, dailyDate: today },
    });
    return true;
  }

  await recordTransaction(prisma, cfg, { guildId, userId, amount: award, type: 'CHAT', source: 'SYSTEM', reason: 'Pontos por chat' });
  await prisma.pointsChatActivity.update({
    where: { id: activity.id },
    data: {
      lastMessageAt: now,
      lastMessageHash: contentHash,
      dailyPoints: dailyPoints + award,
      dailyDate: today,
    },
  });
  return true;
}

async function tickVoice({ client, prisma, cfg }) {
  if (!client || !isCallEnabled(cfg)) return;
  const tempoCallMinutes = cfg.tempoCallMinutes || 5;
  const minUsers = cfg.minUserCall || 0;
  const awardPoints = toBigInt(cfg.pontosCall || 0n);
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const guilds = client.guilds.cache;
  for (const guild of guilds.values()) {
    const voiceChannels = guild.channels.cache.filter((ch) => ch.type === ChannelType.GuildVoice);
    for (const channel of voiceChannels.values()) {
      const members = [...channel.members.values()].filter((m) => !m.user.bot);
      if (!members.length) continue;
      const activeMembers = members.filter((m) => {
        if (!userEligible(cfg, m)) return false;
        if (m.voice?.selfMute || m.voice?.serverMute) return false;
        if (m.voice?.selfDeaf || m.voice?.serverDeaf) return false;
        return true;
      });
      const participantCount = activeMembers.length;
      if (participantCount < minUsers) continue;
      for (const member of activeMembers) {
        const guildId = guild.id;
        const userId = member.id;
        if (await isFrozen(prisma, cfg, guildId, userId)) continue;
        const balance = await ensureBalance(prisma, cfg, guildId, userId);
        let session = await prisma.pointsVoiceSession.findUnique({ where: { globalConfigId_guildId_userId: { globalConfigId, guildId, userId } } });
        if (!session) {
          session = await prisma.pointsVoiceSession.create({ data: { globalConfigId, guildId, userId, channelId: channel.id, startedAt: new Date(), accumulatedSeconds: 0, lastCheckedAt: new Date() } });
        }
        const newAccum = (session.accumulatedSeconds || 0) + 60;
        const blockSeconds = tempoCallMinutes * 60;
        const completedBlocks = Math.floor(newAccum / blockSeconds);
        const remainder = newAccum % blockSeconds;
        await prisma.pointsVoiceSession.update({ where: { id: session.id }, data: { channelId: channel.id, accumulatedSeconds: remainder, lastCheckedAt: new Date() } });
        if (completedBlocks > 0 && awardPoints !== 0n) {
          const totalAward = awardPoints * BigInt(completedBlocks);
          await recordTransaction(prisma, cfg, { guildId, userId, amount: totalAward, type: 'CALL', source: 'SYSTEM', reason: 'Pontos por call' });
        }
      }
    }
  }
}

async function handleVoiceLeave({ guildId, userId, prisma, cfg }) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  await prisma.pointsVoiceSession.deleteMany({ where: { globalConfigId, guildId, userId } }).catch(() => {});
}

async function handleInviteJoin({ guildId, inviterId, inviteeId, invitedAt, accountAgeDays, prisma, cfg }) {
  if (!isInvitesEnabled(cfg)) return;
  if (!inviterId || !inviteeId || inviterId === inviteeId) return;
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const idadeMin = cfg.idadeContaDias || 0;
  const antiReentry = cfg.inviteAntiReentryEnabled !== false;
  // Se já foi confirmado alguma vez, nunca paga novamente (anti-farm) quando habilitado
  const existing = await prisma.pointsInviteLedger.findUnique({ where: { guildId_inviteeId: { guildId, inviteeId } } });
  if (antiReentry && existing?.confirmedAt) {
    return; // já confirmou no passado, não gera pendência nem nova premiação
  }
  const tempoServerHours = cfg.tempoServerHours || 0;
  if (accountAgeDays !== undefined && accountAgeDays < idadeMin) {
    await prisma.pointsInviteLedger.upsert({
      where: { guildId_inviteeId: { guildId, inviteeId } },
      update: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'IDADE_MINIMA' },
      create: {
        globalConfigId,
        guildId,
        inviterId,
        inviteeId,
        invitedAt: invitedAt || new Date(),
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: 'IDADE_MINIMA',
      },
    });
    return;
  }

  // Aprovação instantânea se tempoServerHours <= 0
  if (tempoServerHours <= 0) {
    const amount = toBigInt(cfg.pontosConvites || 0n);
    const now = new Date();
    await prisma.pointsInviteLedger.upsert({
      where: { guildId_inviteeId: { guildId, inviteeId } },
      update: {
        inviterId,
        invitedAt: invitedAt || now,
        status: 'CONFIRMED',
        confirmedAt: now,
        revokedAt: null,
        revokedReason: null,
        pointsAwarded: amount,
      },
      create: {
        globalConfigId,
        guildId,
        inviterId,
        inviteeId,
        invitedAt: invitedAt || now,
        status: 'CONFIRMED',
        confirmedAt: now,
        pointsAwarded: amount,
      },
    });
    if (amount !== 0n) {
      await recordTransaction(prisma, cfg, { guildId, userId: inviterId, amount, type: 'INVITE', source: 'SYSTEM', reason: 'Convite válido' });
    }
    return;
  }

  await prisma.pointsInviteLedger.upsert({
    where: { guildId_inviteeId: { guildId, inviteeId } },
    update: {
      inviterId,
      invitedAt: invitedAt || new Date(),
      status: 'PENDING',
      revokedAt: null,
      revokedReason: null,
    },
    create: {
      globalConfigId,
      guildId,
      inviterId,
      inviteeId,
      invitedAt: invitedAt || new Date(),
      status: 'PENDING',
    },
  });
}

async function handleInviteLeave({ guildId, inviteeId, prisma, cfg }) {
  if (!isInvitesEnabled(cfg)) return;
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const entry = await prisma.pointsInviteLedger.findUnique({ where: { guildId_inviteeId: { guildId, inviteeId } } });
  if (!entry) return;
  const now = new Date();
  if (entry.status === 'PENDING') {
    await prisma.pointsInviteLedger.update({ where: { id: entry.id }, data: { status: 'REVOKED', revokedAt: now, revokedReason: 'SAIU_ANTES_CONFIRMACAO' } });
    return;
  }
  if (entry.status === 'CONFIRMED') {
    const diasConvite = cfg.diasConvite || 0;
    const confirmAt = entry.confirmedAt ? new Date(entry.confirmedAt) : null;
    if (confirmAt && (now.getTime() - confirmAt.getTime()) < diasConvite * DAY_MS) {
      const amount = toBigInt(entry.pointsAwarded || 0n);
      if (amount > 0n) {
        await recordTransaction(prisma, cfg, { guildId, userId: entry.inviterId, amount: -amount, type: 'INVITE_REVOKE', source: 'SYSTEM', reason: 'Convite invalidado por saída antes do prazo' });
      }
      await prisma.pointsInviteLedger.update({ where: { id: entry.id }, data: { status: 'REVOKED', revokedAt: now, revokedReason: 'SAIU_ANTES_PRAZO' } });
    }
  }
}

async function confirmPendingInvites({ prisma, cfg, client }) {
  if (!isInvitesEnabled(cfg)) return;
  const tempoServerHours = cfg.tempoServerHours || 24;
  const cutoff = new Date(Date.now() - tempoServerHours * MINUTE_MS * 60);
  const batchSize = 200;
  let lastId = 0;
  while (true) {
    const pendings = await prisma.pointsInviteLedger.findMany({
      where: { status: 'PENDING', invitedAt: { lte: cutoff }, globalConfigId: cfg.globalConfigId || cfg.id, id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!pendings.length) break;
    for (const entry of pendings) {
      lastId = entry.id;
      // Anti-farm: se já tem confirmedAt (algum fluxo anterior), não pagar de novo
      if (entry.confirmedAt) {
        await prisma.pointsInviteLedger.update({ where: { id: entry.id }, data: { status: 'CONFIRMED' } });
        continue;
      }
      const guild = client?.guilds?.cache?.get(entry.guildId);
      if (!guild) continue;
      const member = await guild.members.fetch(entry.inviteeId).catch(() => null);
      if (!member) {
        await prisma.pointsInviteLedger.update({ where: { id: entry.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'SAIU_ANTES_CONFIRMACAO' } });
        continue;
      }
      const amount = toBigInt(cfg.pontosConvites || 0n);
      await recordTransaction(prisma, cfg, { guildId: entry.guildId, userId: entry.inviterId, amount, type: 'INVITE', source: 'SYSTEM', reason: 'Convite válido' });
      await prisma.pointsInviteLedger.update({ where: { id: entry.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), pointsAwarded: amount } });
    }
  }
}

async function resetAllPoints(prisma, cfg, actorId) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const balances = await prisma.pointsBalance.findMany({ where: { globalConfigId } });
  for (const bal of balances) {
    const current = toBigInt(bal.points || 0n);
    if (current === 0n) continue;
    await recordTransaction(prisma, cfg, { guildId: bal.guildId, userId: bal.userId, amount: -current, type: 'RESET', source: 'ADMIN', reason: 'Reset geral', actorId });
  }
}

async function getTopBalances(prisma, cfg, guildId, limit = 20) {
  const globalConfigId = cfg.globalConfigId || cfg.id;
  const balances = await prisma.pointsBalance.findMany({ where: { globalConfigId, guildId }, orderBy: [{ points: 'desc' }, { createdAt: 'asc' }], take: limit });
  return balances;
}

module.exports = {
  ensurePointsConfig,
  getPointsConfig,
  isSystemEnabled,
  isChatEnabled,
  isCallEnabled,
  isInvitesEnabled,
  ensureBalance,
  recordTransaction,
  handleChatMessage,
  tickVoice,
  handleVoiceLeave,
  handleInviteJoin,
  handleInviteLeave,
  confirmPendingInvites,
  resetAllPoints,
  getTopBalances,
  setFrozen,
  liftPunishment,
  isFrozen,
  sendLog,
  userEligible,
  toBigInt,
};
