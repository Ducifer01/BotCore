const {
  COMMAND_TYPES,
  ensureModerationConfig,
  memberHasPermission,
  checkHierarchy,
  buildLogEmbed,
  sendDmIfConfigured,
  sendLogMessage,
  parseDuration,
  formatDuration,
} = require('../lib/moderation');

const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

function ensureReason(reason) {
  return reason?.trim() || 'Não informado';
}

async function resolveTargetUser(guild, identifier) {
  if (!identifier) return null;
  try {
    if (typeof identifier === 'object' && identifier.id) {
      return identifier;
    }
    return await guild.client.users.fetch(String(identifier));
  } catch {
    return null;
  }
}

async function runBan({ guild, moderatorMember, targetUser, reason, prisma, posseId }) {
  const cfg = await ensureModerationConfig(prisma);
  if (!cfg.banEnabled) {
    throw new Error('O comando de ban está desativado no momento.');
  }
  if (!memberHasPermission(moderatorMember, cfg, COMMAND_TYPES.BAN, posseId)) {
    throw new Error('Você não tem permissão para usar esse comando.');
  }
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  const hierarchy = checkHierarchy(moderatorMember, targetMember, guild.members.me);
  if (!hierarchy.ok) {
    throw new Error(hierarchy.message);
  }
  const cleanReason = ensureReason(reason);
  const logEmbed = buildLogEmbed({
    type: COMMAND_TYPES.BAN,
    action: 'BAN',
    targetUser,
    moderatorUser: moderatorMember.user,
    reason: cleanReason,
    guild,
  });
  await sendDmIfConfigured(targetUser, logEmbed, cfg, COMMAND_TYPES.BAN);
  await guild.members.ban(targetUser.id, { reason: cleanReason }).catch((err) => {
    throw new Error(`Falha ao banir: ${err?.message || err}`);
  });
  const logSent = await sendLogMessage(guild, cfg.banLogChannelId, logEmbed);
  return {
    message: `${targetUser.tag || targetUser.username} banido com sucesso.`,
    logEmbed,
    logChannelId: cfg.banLogChannelId,
    logSent,
  };
}

async function runUnban({ guild, moderatorMember, targetUserId, reason, prisma, posseId }) {
  const cfg = await ensureModerationConfig(prisma);
  if (!cfg.banEnabled) {
    throw new Error('O comando de ban está desativado no momento.');
  }
  if (!memberHasPermission(moderatorMember, cfg, COMMAND_TYPES.BAN, posseId)) {
    throw new Error('Você não tem permissão para usar esse comando.');
  }
  const cleanReason = ensureReason(reason);
  const targetUser = await resolveTargetUser(guild, targetUserId) || { id: targetUserId, username: 'Usuário', tag: targetUserId };
  await guild.bans.remove(targetUserId, cleanReason).catch((err) => {
    throw new Error(`Falha ao remover ban: ${err?.message || err}`);
  });
  const logEmbed = buildLogEmbed({
    type: COMMAND_TYPES.BAN,
    action: 'UNBAN',
    targetUser,
    moderatorUser: moderatorMember.user,
    reason: cleanReason,
    guild,
  });
  const logSent = await sendLogMessage(guild, cfg.banLogChannelId, logEmbed);
  return {
    message: `Ban de ${targetUserId} removido.`,
    logEmbed,
    logChannelId: cfg.banLogChannelId,
    logSent,
  };
}

async function runCastigo({ guild, moderatorMember, targetMember, reason, durationInput, prisma, posseId }) {
  const cfg = await ensureModerationConfig(prisma);
  if (!cfg.castigoEnabled) {
    throw new Error('O comando de castigo está desativado no momento.');
  }
  if (!memberHasPermission(moderatorMember, cfg, COMMAND_TYPES.CASTIGO, posseId)) {
    throw new Error('Você não tem permissão para usar esse comando.');
  }
  if (!targetMember) {
    throw new Error('Não encontrei o membro alvo no servidor.');
  }
  const hierarchy = checkHierarchy(moderatorMember, targetMember, guild.members.me);
  if (!hierarchy.ok) {
    throw new Error(hierarchy.message);
  }
  const seconds = parseDuration(durationInput);
  if (!seconds || seconds <= 0) {
    throw new Error('Tempo inválido. Use formatos como 30s, 5m, 1h, 1d.');
  }
  if (seconds > MAX_TIMEOUT_SECONDS) {
    throw new Error('Tempo máximo permitido é 28 dias.');
  }
  const cleanReason = ensureReason(reason);
  const logEmbed = buildLogEmbed({
    type: COMMAND_TYPES.CASTIGO,
    action: 'APPLY',
    targetUser: targetMember.user,
    moderatorUser: moderatorMember.user,
    reason: cleanReason,
    guild,
    durationSeconds: seconds,
  });
  await sendDmIfConfigured(targetMember.user, logEmbed, cfg, COMMAND_TYPES.CASTIGO);
  await targetMember.timeout(seconds * 1000, cleanReason).catch((err) => {
    throw new Error(`Falha ao aplicar castigo: ${err?.message || err}`);
  });
  const logSent = await sendLogMessage(guild, cfg.castigoLogChannelId, logEmbed);
  return {
    message: `${targetMember.user.tag || targetMember.user.username} castigado por ${formatDuration(seconds)}.`,
    logEmbed,
    logChannelId: cfg.castigoLogChannelId,
    logSent,
  };
}

async function runRemoveCastigo({ guild, moderatorMember, targetMember, reason, prisma, posseId }) {
  const cfg = await ensureModerationConfig(prisma);
  if (!cfg.castigoEnabled) {
    throw new Error('O comando de castigo está desativado no momento.');
  }
  if (!memberHasPermission(moderatorMember, cfg, COMMAND_TYPES.CASTIGO, posseId)) {
    throw new Error('Você não tem permissão para usar esse comando.');
  }
  if (!targetMember) {
    throw new Error('Não encontrei o membro alvo no servidor.');
  }
  const hierarchy = checkHierarchy(moderatorMember, targetMember, guild.members.me);
  if (!hierarchy.ok) {
    throw new Error(hierarchy.message);
  }
  const cleanReason = ensureReason(reason);
  await targetMember.timeout(null, cleanReason).catch((err) => {
    throw new Error(`Falha ao remover castigo: ${err?.message || err}`);
  });
  const logEmbed = buildLogEmbed({
    type: COMMAND_TYPES.CASTIGO,
    action: 'REMOVE',
    targetUser: targetMember.user,
    moderatorUser: moderatorMember.user,
    reason: cleanReason,
    guild,
  });
  const logSent = await sendLogMessage(guild, cfg.castigoLogChannelId, logEmbed);
  return {
    message: `Castigo removido de ${targetMember.user.tag || targetMember.user.username}.`,
    logEmbed,
    logChannelId: cfg.castigoLogChannelId,
    logSent,
  };
}

module.exports = {
  runBan,
  runUnban,
  runCastigo,
  runRemoveCastigo,
  resolveTargetUser,
};
