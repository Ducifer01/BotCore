const { getPrisma } = require('../db');
const { isGuildAllowed } = require('../config');
const { buildMuteExpirationEmbed } = require('../lib/mute');
const { sendLogMessage } = require('../lib/moderation');
const { EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const CHECK_INTERVAL_MS = 15000;
const RELEASE_DELAY_MS = 2000;
const EXPIRATION_EMBED_TTL = 5000;

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
  const muteChanged = Boolean((oldState?.serverMute ?? false) !== (newState?.serverMute ?? false));
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
    return;
  }

  // Log de mute/desmute manual (no dedo) quando não há registro de mute ativo
  if (muteChanged && cfg?.auditManualMuteLogChannelId) {
    const muted = Boolean(newState?.serverMute);
    await logManualVoiceMuteChange(guild, member, muted, cfg).catch(() => {});
  }

  if (joinedUnlockChannel) {
    if (newState.serverMute) {
      await newState.setMute(false, 'Canal de desbloqueio - mute manual liberado').catch(() => {});
    }
    if (cfg.muteVoiceRoleId && member.roles.cache.has(cfg.muteVoiceRoleId)) {
      await member.roles.remove(cfg.muteVoiceRoleId, 'Canal de desbloqueio - removendo cargo de mute voz').catch(() => {});
    }
  }
}

async function logManualVoiceMuteChange(guild, member, muted, cfg) {
  let actor = null;
  try {
    // Checar se o bot tem permissão para ver Audit Logs
    const me = guild.members?.me;
    if (!me || !me.permissions?.has(PermissionFlagsBits.ViewAuditLog)) {
      actor = null;
    } else {
      // Buscar mais entradas e ampliar janela temporal (30s)
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 20 }).catch(() => null);
      const entries = logs?.entries ? [...logs.entries.values()] : [];
      const now = Date.now();
      const recent = entries.find((entry) => {
        if (!entry || !entry.target || String(entry.target.id) !== String(member.id)) return false;
        const created = entry.createdTimestamp || 0;
        if (Math.abs(now - created) > 30000) return false;
        const changes = entry.changes || [];
        // verificar mudança relevante
        const relevant = changes.some((c) => {
          if (!c || !c.key) return false;
          // chaves possíveis reportadas pelo Discord para alterações de membro: 'mute', (algumas variantes no passado: 'deaf')
          if (c.key === 'mute') {
            // aceitar quando novo estado coincide com 'muted' ou transição esperada
            return (c.new === muted) || (c.old === !muted);
          }
          return false;
        });
        return Boolean(relevant);
      });
      actor = recent?.executor || null;
    }
  } catch (e) {
    actor = null;
  }

  const embed = new EmbedBuilder()
    .setTitle(muted ? 'Mute no dedo' : 'Desmute no dedo')
    .addFields(
      { name: 'membro:', value: `<@${member.id}>\nID: \`${member.id}\``, inline: true },
      { name: 'Moderador:', value: actor ? `<@${actor.id}>\nID: \`${actor.id}\`` : 'Desconhecido\nID: `N/A`', inline: true },
    )
    .setColor('#ff6600')
    .setTimestamp();

  await sendLogMessage(guild, cfg.auditManualMuteLogChannelId, embed);
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
  const expirationEmbed = buildMuteExpirationEmbed({
    scope: 'voice',
    targetUser: member.user,
    reason: entry.reason || 'Tempo expirado',
    guild,
  });
  await notifyMuteExpiration(client, entry.commandChannelId, expirationEmbed);
  if (cfg?.muteVoiceLogChannelId) {
    await sendLogMessage(guild, cfg.muteVoiceLogChannelId, expirationEmbed);
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
  const expirationEmbed = buildMuteExpirationEmbed({
    scope: 'chat',
    targetUser: member.user,
    reason: entry.reason || 'Tempo expirado',
    guild,
  });
  await notifyMuteExpiration(client, entry.commandChannelId, expirationEmbed);
  if (cfg?.muteChatLogChannelId) {
    await sendLogMessage(guild, cfg.muteChatLogChannelId, expirationEmbed);
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

async function notifyMuteExpiration(client, channelId, embed) {
  if (!channelId || !embed) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return;
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    const timeout = setTimeout(() => sent.delete().catch(() => {}), EXPIRATION_EMBED_TTL);
    if (typeof timeout.unref === 'function') timeout.unref();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { registerMuteFeature };
