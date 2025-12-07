const { getPrisma } = require('../db');
const { isGuildAllowed } = require('../config');
const { buildMuteLogEmbed } = require('../lib/mute');
const { sendLogMessage } = require('../lib/moderation');

const CHECK_INTERVAL_MS = 15000;
const RELEASE_DELAY_MS = 2000;

let sweepInterval;

function registerMuteFeature(client) {
  client.on('voiceStateUpdate', (oldState, newState) => handleVoiceStateUpdate(oldState, newState).catch((err) => console.error('[mute] voiceStateUpdate', err)));
  client.on('guildMemberUpdate', (oldMember, newMember) => handleGuildMemberUpdate(oldMember, newMember).catch((err) => console.error('[mute] guildMemberUpdate', err)));

  if (!sweepInterval) {
    sweepInterval = setInterval(() => processExpiredMutes(client).catch((err) => console.error('[mute] sweep', err)), CHECK_INTERVAL_MS);
    if (typeof sweepInterval.unref === 'function') sweepInterval.unref();
  }

  restoreActiveMutes(client).catch((err) => console.error('[mute] restore', err));
}

async function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  const guild = member?.guild;
  if (!guild || !isGuildAllowed(guild.id)) return;
  const prisma = getPrisma();
  const cfg = await prisma.globalConfig.findFirst();
  if (!cfg) return;
  const activeMute = await prisma.voiceMute.findFirst({ where: { guildId: guild.id, userId: member.id, endedAt: null } });
  const unlockChannelId = cfg.muteVoiceUnlockChannelId;
  const joinedUnlockChannel = Boolean(
    unlockChannelId
    && newState.channelId === unlockChannelId
    && oldState?.channelId !== unlockChannelId,
  );

  if (activeMute) {
    if (!newState.serverMute) {
      await newState.setMute(true, 'Mute de voz protegido').catch(() => {});
    }
    if (cfg.muteVoiceRoleId && !member.roles.cache.has(cfg.muteVoiceRoleId)) {
      await member.roles.add(cfg.muteVoiceRoleId, 'Reaplicando cargo de mute voz').catch(() => {});
    }
  } else {
    if (joinedUnlockChannel && newState.serverMute) {
      await newState.setMute(false, 'Canal de desbloqueio - mute manual liberado').catch(() => {});
    }
    if (cfg.muteVoiceRoleId && member.roles.cache.has(cfg.muteVoiceRoleId)) {
      // Remove cargos aplicados manualmente, independente do canal, já que não há registro no sistema
      await member.roles.remove(cfg.muteVoiceRoleId, 'Removendo cargo de mute voz sem registro').catch(() => {});
    }
  }
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  const guild = newMember.guild;
  if (!guild || !isGuildAllowed(guild.id)) return;
  const prisma = getPrisma();
  const cfg = await prisma.globalConfig.findFirst();
  if (!cfg) return;

  await enforceRoleState({
    prisma,
    cfg,
    guildId: guild.id,
    member: newMember,
    roleId: cfg.muteVoiceRoleId,
    table: 'voiceMute',
  });

  await enforceRoleState({
    prisma,
    cfg,
    guildId: guild.id,
    member: newMember,
    roleId: cfg.muteChatRoleId,
    table: 'chatMute',
  });
}

async function enforceRoleState({ prisma, cfg, guildId, member, roleId, table }) {
  if (!roleId) return;
  const hasRole = member.roles.cache.has(roleId);
  const active = await prisma[table].findFirst({ where: { guildId, userId: member.id, endedAt: null } });
  if (active && !hasRole) {
    await member.roles.add(roleId, 'Reaplicando cargo de mute protegido').catch(() => {});
    return;
  }
  if (!active && hasRole) {
    await member.roles.remove(roleId, 'Removendo cargo de mute sem registro').catch(() => {});
  }
}

async function processExpiredMutes(client) {
  const prisma = getPrisma();
  const now = new Date();
  const [voiceExpired, chatExpired] = await Promise.all([
    prisma.voiceMute.findMany({ where: { endedAt: null, expiresAt: { not: null, lte: now } } }),
    prisma.chatMute.findMany({ where: { endedAt: null, expiresAt: { not: null, lte: now } } }),
  ]);

  const configMap = await loadConfigsFor([...voiceExpired, ...chatExpired]);

  for (const entry of voiceExpired) {
    await prisma.voiceMute.update({ where: { id: entry.id }, data: { endedAt: now } });
    await releaseVoiceMute(client, entry, configMap.get(entry.globalConfigId));
  }

  for (const entry of chatExpired) {
    await prisma.chatMute.update({ where: { id: entry.id }, data: { endedAt: now } });
    await releaseChatMute(client, entry, configMap.get(entry.globalConfigId));
  }
}

async function releaseVoiceMute(client, entry, cfg) {
  const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
  if (!guild || !isGuildAllowed(guild.id)) return;
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  if (!member) return;
  await delay(RELEASE_DELAY_MS);
  await member.voice?.setMute(false, 'Mute de voz expirado').catch(() => {});
  if (cfg?.muteVoiceRoleId && member.roles.cache.has(cfg.muteVoiceRoleId)) {
    await member.roles.remove(cfg.muteVoiceRoleId, 'Mute de voz expirado').catch(() => {});
  }
  if (cfg?.muteVoiceLogChannelId) {
    const embed = buildMuteLogEmbed({
      scope: 'voice',
      action: 'remove',
      targetUser: member.user,
      moderatorUser: client.user,
      reason: entry.reason || 'Tempo expirado',
      guild,
    });
    await sendLogMessage(guild, cfg.muteVoiceLogChannelId, embed);
  }
}

async function releaseChatMute(client, entry, cfg) {
  const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
  if (!guild || !isGuildAllowed(guild.id)) return;
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  if (!member) return;
  if (cfg?.muteChatRoleId && member.roles.cache.has(cfg.muteChatRoleId)) {
    await member.roles.remove(cfg.muteChatRoleId, 'Mute de chat expirado').catch(() => {});
  }
  if (cfg?.muteChatLogChannelId) {
    const embed = buildMuteLogEmbed({
      scope: 'chat',
      action: 'remove',
      targetUser: member.user,
      moderatorUser: client.user,
      reason: entry.reason || 'Tempo expirado',
      guild,
    });
    await sendLogMessage(guild, cfg.muteChatLogChannelId, embed);
  }
}

async function loadConfigsFor(entries) {
  const ids = [...new Set(entries.map((entry) => entry.globalConfigId).filter(Boolean))];
  if (!ids.length) return new Map();
  const prisma = getPrisma();
  const configs = await prisma.globalConfig.findMany({ where: { id: { in: ids } } });
  return new Map(configs.map((cfg) => [cfg.id, cfg]));
}

async function restoreActiveMutes(client) {
  const prisma = getPrisma();
  const [voiceMutes, chatMutes] = await Promise.all([
    prisma.voiceMute.findMany({ where: { endedAt: null } }),
    prisma.chatMute.findMany({ where: { endedAt: null } }),
  ]);
  const configMap = await loadConfigsFor([...voiceMutes, ...chatMutes]);

  for (const entry of voiceMutes) {
    const cfg = configMap.get(entry.globalConfigId);
    const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
    if (!guild || !isGuildAllowed(guild.id)) continue;
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;
    if (!member.voice?.serverMute) {
      await member.voice?.setMute(true, 'Reaplicando mute de voz persistente').catch(() => {});
    }
    if (cfg?.muteVoiceRoleId && !member.roles.cache.has(cfg.muteVoiceRoleId)) {
      await member.roles.add(cfg.muteVoiceRoleId, 'Reaplicando cargo de mute voz').catch(() => {});
    }
  }

  for (const entry of chatMutes) {
    const cfg = configMap.get(entry.globalConfigId);
    const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
    if (!guild || !isGuildAllowed(guild.id)) continue;
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;
    if (cfg?.muteChatRoleId && !member.roles.cache.has(cfg.muteChatRoleId)) {
      await member.roles.add(cfg.muteChatRoleId, 'Reaplicando cargo de mute chat').catch(() => {});
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { registerMuteFeature };
