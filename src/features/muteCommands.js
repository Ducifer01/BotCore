const { EmbedBuilder } = require('discord.js');
const { buildMuteLogEmbed, MUTE_COMMANDS, parseDurationToken, memberHasMutePermission, sanitizeReason } = require('../lib/mute');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { sendLogMessage, checkHierarchy } = require('../lib/moderation');

const PREFIX = '!';
const TEMP_MESSAGE_TTL = 10000;
const EMBED_TTL = 15000;
const PERMISSION_ERROR_COLOR = 0xed4245;

class CommandUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandUsageError';
  }
}

class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

function extractId(input) {
  if (!input) return null;
  const match = String(input).match(/\d{5,}/);
  return match ? match[0] : null;
}

async function handleMessage(message, ctx) {
  if (!message.guild || message.author.bot) return false;
  if (!ctx.isGuildAllowed(message.guildId)) return false;
  const content = (message.content || '').trim();
  if (!content.startsWith(PREFIX)) return false;
  const withoutPrefix = content.slice(PREFIX.length).trim();
  if (!withoutPrefix.length) return false;
  const [commandNameRaw, ...rawArgs] = withoutPrefix.split(/\s+/);
  const commandName = (commandNameRaw || '').toLowerCase();
  const handler = COMMAND_MAP[commandName];
  if (!handler) return false;

  await deleteCommandMessage(message);

  const prisma = ctx.getPrisma();
  await ensureGlobalConfig(prisma);
  let cfg = await getGlobalConfig(prisma);
  if (!cfg) {
    cfg = await prisma.globalConfig.create({ data: {} });
  }

  try {
    await handler({ message, args: rawArgs, prisma, cfg, posseId: ctx.POSSE_USER_ID });
  } catch (err) {
    await handleError(message.channel, err);
  }

  return true;
}

const COMMAND_MAP = {
  mutecall: handleMutecall,
  unmutecall: handleUnmutecall,
  mute: handleMute,
  unmute: handleUnmute,
};

async function handleMutecall({ message, args, prisma, cfg, posseId }) {
  await assertPermission(message.member, cfg, MUTE_COMMANDS.MUTE_CALL, posseId);
  if (!cfg.muteVoiceRoleId) {
    throw new CommandUsageError('Nenhum cargo de voz configurado. Por favor, contate o posse.');
  }
  if (args.length < 2) {
    throw new CommandUsageError('Uso: !mutecall @usuario 10m Motivo.');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário que será mutado.');
  }
  const durationToken = args.shift();
  const durationSeconds = parseDurationToken(durationToken);
  if (!durationSeconds) {
    throw new CommandUsageError('Informe um tempo válido (ex: 60s, 5m, 1h).');
  }
  const reason = sanitizeReason(args.join(' '));
  const member = await fetchGuildMember(message.guild, targetId);
  ensureHierarchy(message.member, member, message.guild.members.me);
  if (!member.voice?.channelId) {
    throw new CommandUsageError('O usuário precisa estar em um canal de voz.');
  }

  await upsertVoiceMute(prisma, {
    globalConfigId: cfg.id,
    guildId: message.guild.id,
    userId: member.id,
    moderatorId: message.author.id,
    reason,
    durationSeconds,
    commandChannelId: message.channel.id,
  });
  await member.voice.setMute(true, reason).catch(() => {
    throw new Error('Não consegui aplicar o mute de voz. Verifique minhas permissões.');
  });
  await applyRoleIfNeeded(member, cfg.muteVoiceRoleId, 'Mute de voz aplicado');

  const embed = buildMuteLogEmbed({
    scope: 'voice',
    action: 'apply',
    targetUser: member.user,
    moderatorUser: message.author,
    reason,
    durationSeconds,
    guild: message.guild,
  });
  await sendEphemeralEmbed(message.channel, embed);
  await sendLogMessage(message.guild, cfg.muteVoiceLogChannelId, embed);
}

async function handleUnmutecall({ message, args, prisma, cfg, posseId }) {
  await assertPermission(message.member, cfg, MUTE_COMMANDS.UNMUTE_CALL, posseId);
  if (!cfg.muteVoiceRoleId) {
    throw new CommandUsageError('Configure o cargo mutado voz no /menu antes de usar !unmutecall.');
  }
  if (args.length < 1) {
    throw new CommandUsageError('Uso: !unmutecall @usuario Motivo (opcional).');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário que será desmutado.');
  }
  const reason = sanitizeReason(args.join(' '));
  const member = await fetchGuildMember(message.guild, targetId);
  ensureHierarchy(message.member, member, message.guild.members.me);
  const mute = await prisma.voiceMute.findFirst({ where: { guildId: message.guild.id, userId: member.id, endedAt: null } });
  if (!mute) {
    throw new CommandUsageError('Este usuário não está registrado como mutado.');
  }
  await prisma.voiceMute.update({ where: { id: mute.id }, data: { endedAt: new Date(), reason } });
  await delay(2000);
  await member.voice.setMute(false, reason).catch(() => {});
  await removeRoleIfPresent(member, cfg.muteVoiceRoleId, 'Mute de voz removido');

  const embed = buildMuteLogEmbed({
    scope: 'voice',
    action: 'remove',
    targetUser: member.user,
    moderatorUser: message.author,
    reason,
    guild: message.guild,
  });
  await sendEphemeralEmbed(message.channel, embed);
  await sendLogMessage(message.guild, cfg.muteVoiceLogChannelId, embed);
}

async function handleMute({ message, args, prisma, cfg, posseId }) {
  await assertPermission(message.member, cfg, MUTE_COMMANDS.MUTE_CHAT, posseId);
  if (!cfg.muteChatRoleId) {
    throw new CommandUsageError('Configure o cargo mutado chat no /menu antes de usar !mute.');
  }
  if (args.length < 2) {
    throw new CommandUsageError('Uso: !mute @usuario 10m Motivo.');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário que será mutado.');
  }
  const durationToken = args.shift();
  const durationSeconds = parseDurationToken(durationToken);
  if (!durationSeconds) {
    throw new CommandUsageError('Informe um tempo válido (ex: 60s, 5m, 1h).');
  }
  const reason = sanitizeReason(args.join(' '));
  const member = await fetchGuildMember(message.guild, targetId);
  ensureHierarchy(message.member, member, message.guild.members.me);

  await upsertChatMute(prisma, {
    globalConfigId: cfg.id,
    guildId: message.guild.id,
    userId: member.id,
    moderatorId: message.author.id,
    reason,
    durationSeconds,
    commandChannelId: message.channel.id,
  });
  await applyRoleIfNeeded(member, cfg.muteChatRoleId, 'Mute de chat aplicado');

  const embed = buildMuteLogEmbed({
    scope: 'chat',
    action: 'apply',
    targetUser: member.user,
    moderatorUser: message.author,
    reason,
    durationSeconds,
    guild: message.guild,
  });
  await sendEphemeralEmbed(message.channel, embed);
  await sendLogMessage(message.guild, cfg.muteChatLogChannelId, embed);
}

async function handleUnmute({ message, args, prisma, cfg, posseId }) {
  await assertPermission(message.member, cfg, MUTE_COMMANDS.UNMUTE_CHAT, posseId);
  if (!cfg.muteChatRoleId) {
    throw new CommandUsageError('Configure o cargo mutado chat no /menu antes de usar !unmute.');
  }
  if (args.length < 1) {
    throw new CommandUsageError('Uso: !unmute @usuario Motivo (opcional).');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário que será desmutado.');
  }
  const reason = sanitizeReason(args.join(' '));
  const member = await fetchGuildMember(message.guild, targetId);
  ensureHierarchy(message.member, member, message.guild.members.me);
  const mute = await prisma.chatMute.findFirst({ where: { guildId: message.guild.id, userId: member.id, endedAt: null } });
  if (!mute) {
    throw new CommandUsageError('Este usuário não está registrado como mutado no chat.');
  }
  await prisma.chatMute.update({ where: { id: mute.id }, data: { endedAt: new Date(), reason } });
  await removeRoleIfPresent(member, cfg.muteChatRoleId, 'Mute de chat removido');

  const embed = buildMuteLogEmbed({
    scope: 'chat',
    action: 'remove',
    targetUser: member.user,
    moderatorUser: message.author,
    reason,
    guild: message.guild,
  });
  await sendEphemeralEmbed(message.channel, embed);
  await sendLogMessage(message.guild, cfg.muteChatLogChannelId, embed);
}

async function upsertVoiceMute(prisma, { globalConfigId, guildId, userId, moderatorId, reason, durationSeconds, commandChannelId }) {
  const expiresAt = durationSeconds ? new Date(Date.now() + durationSeconds * 1000) : null;
  const existing = await prisma.voiceMute.findFirst({ where: { guildId, userId, endedAt: null } });
  if (existing) {
    await prisma.voiceMute.update({
      where: { id: existing.id },
      data: { moderatorId, reason, durationSeconds, expiresAt, commandChannelId, endedAt: null },
    });
    return existing.id;
  }
  const created = await prisma.voiceMute.create({
    data: { globalConfigId, guildId, userId, moderatorId, reason, durationSeconds, expiresAt, commandChannelId },
  });
  return created.id;
}

async function upsertChatMute(prisma, { globalConfigId, guildId, userId, moderatorId, reason, durationSeconds, commandChannelId }) {
  const expiresAt = durationSeconds ? new Date(Date.now() + durationSeconds * 1000) : null;
  const existing = await prisma.chatMute.findFirst({ where: { guildId, userId, endedAt: null } });
  if (existing) {
    await prisma.chatMute.update({
      where: { id: existing.id },
      data: { moderatorId, reason, durationSeconds, expiresAt, commandChannelId, endedAt: null },
    });
    return existing.id;
  }
  const created = await prisma.chatMute.create({
    data: { globalConfigId, guildId, userId, moderatorId, reason, durationSeconds, expiresAt, commandChannelId },
  });
  return created.id;
}

async function assertPermission(member, cfg, commandType, posseId) {
  if (!memberHasMutePermission(member, cfg, commandType, posseId)) {
    throw new PermissionError('Você não tem permissão para usar este comando.');
  }
}

async function fetchGuildMember(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('Usuário precisa estar no servidor.');
  }
  return member;
}

async function deleteCommandMessage(message) {
  if (!message.deletable) return;
  await message.delete().catch(() => {});
}

async function handleError(channel, err) {
  if (err instanceof PermissionError) {
    const embed = new EmbedBuilder()
      .setTitle('Permissão insuficiente')
      .setDescription(err.message)
      .setColor(PERMISSION_ERROR_COLOR)
      .setTimestamp(new Date());
    await sendEphemeralEmbed(channel, embed);
    return;
  }
  const content = err instanceof CommandUsageError
    ? err.message
    : err?.message || 'Erro inesperado.';
  await sendTemporaryMessage(channel, content);
}

async function sendTemporaryMessage(channel, payload) {
  if (!channel || typeof channel.send !== 'function') return null;
  const data = typeof payload === 'string' ? { content: payload } : payload;
  const sent = await channel.send(data).catch(() => null);
  if (sent) {
    const timeout = setTimeout(() => sent.delete().catch(() => {}), TEMP_MESSAGE_TTL);
    if (typeof timeout.unref === 'function') timeout.unref();
  }
  return sent;
}

async function sendEphemeralEmbed(channel, embed) {
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    const timeout = setTimeout(() => sent.delete().catch(() => {}), EMBED_TTL);
    if (typeof timeout.unref === 'function') timeout.unref();
  }
  return sent;
}

async function applyRoleIfNeeded(member, roleId, reason) {
  if (!roleId) return;
  if (member.roles.cache.has(roleId)) return;
  await member.roles.add(roleId, reason).catch(() => {});
}

async function removeRoleIfPresent(member, roleId, reason) {
  if (!roleId) return;
  if (!member.roles.cache.has(roleId)) return;
  await member.roles.remove(roleId, reason).catch(() => {});
}

function ensureHierarchy(actorMember, targetMember, botMember) {
  const result = checkHierarchy(actorMember, targetMember, botMember);
  if (!result.ok) {
    throw new CommandUsageError(result.message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  handleMessage,
};
