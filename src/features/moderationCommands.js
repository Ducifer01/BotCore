const { runBan, runUnban, runCastigo, runRemoveCastigo, resolveTargetUser } = require('../actions/moderationActions');
const { COMMAND_TYPES, ensureModerationConfig, memberHasPermission } = require('../lib/moderation');

const PREFIX = '!';
const TEMP_MESSAGE_TTL = 15000;
const LOG_PREVIEW_TTL = 20000;

class CommandUsageError extends Error {
  constructor(message, usageKey) {
    super(message);
    this.name = 'CommandUsageError';
    this.usageKey = usageKey;
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

async function deleteCommandMessage(message) {
  if (!message || !message.deletable) return;
  await message.delete().catch(() => {});
}

async function handleCommandError(message, err, commandName) {
  console.warn('[moderation prefix]', commandName, err?.message || err);
  const channel = message.channel;
  if (err instanceof PermissionError) {
    await sendTemporaryMessage(channel, { content: err.message });
    return;
  }
  if (err instanceof CommandUsageError) {
    await sendTemporaryMessage(channel, { content: err.message });
    return;
  }
  await sendTemporaryMessage(channel, { content: err?.message || 'Erro inesperado.' });
}

async function sendSuccessFeedback(channel, _confirmationMessage, logEmbed) {
  await sendLogPreview(channel, logEmbed);
}

async function sendLogPreview(channel, logEmbed) {
  const embedData = cloneEmbedData(logEmbed);
  if (!embedData) return;
  await sendTemporaryMessage(
    channel,
    {
      embeds: [embedData],
    },
    LOG_PREVIEW_TTL,
  );
}

function cloneEmbedData(embed) {
  if (!embed) return null;
  if (typeof embed.toJSON === 'function') {
    return embed.toJSON();
  }
  return embed;
}

async function assertCommandPermission(commandType, message, prisma, posseId) {
  const cfg = await ensureModerationConfig(prisma);
  const enabledField =
    commandType === COMMAND_TYPES.BAN ? 'banEnabled' : 'castigoEnabled';
  if (!cfg[enabledField]) {
    throw new PermissionError('Este comando está desativado no momento.');
  }
  if (!memberHasPermission(message.member, cfg, commandType, posseId)) {
    throw new PermissionError('Você não tem permissão para usar esse comando.');
  }
}

function extractDurationAndReason(args) {
  if (!Array.isArray(args) || !args.length) {
    return { durationToken: null, reasonText: '' };
  }
  let durationIndex = -1;
  for (let i = 0; i < args.length; i += 1) {
    if (isDurationToken(args[i])) {
      durationIndex = i;
      break;
    }
  }
  if (durationIndex === -1) {
    return { durationToken: null, reasonText: args.join(' ').trim() };
  }
  const durationToken = args[durationIndex];
  const reasonParts = args.filter((_, idx) => idx !== durationIndex);
  return { durationToken, reasonText: reasonParts.join(' ').trim() };
}

function isDurationToken(token) {
  if (!token) return false;
  return /^\d+(s|m|h|d|w)$/i.test(String(token).trim());
}

async function sendTemporaryMessage(channel, payload, ttl = TEMP_MESSAGE_TTL) {
  if (!channel || typeof channel.send !== 'function') return null;
  const body = typeof payload === 'string' ? { content: payload } : payload;
  const sent = await channel.send(body).catch(() => null);
  if (sent && ttl > 0) {
    const timeout = setTimeout(() => sent.delete().catch(() => {}), ttl);
    if (typeof timeout.unref === 'function') timeout.unref();
  }
  return sent;
}

const COMMAND_HANDLERS = {
  ban: handlePrefixBan,
  unban: handlePrefixUnban,
  castigo: handlePrefixCastigo,
  removercastigo: handlePrefixRemoveCastigo,
};

async function handleMessage(message, ctx) {
  if (!message.guild || message.author.bot) return false;
  if (!ctx.isGuildAllowed(message.guildId)) return false;
  const content = (message.content || '').trim();
  if (!content.startsWith(PREFIX)) return false;
  const prisma = ctx.getPrisma();
  const posseId = String(process.env.POSSE_USER_ID || '').trim();
  const withoutPrefix = content.slice(PREFIX.length).trim();
  if (!withoutPrefix) return false;
  const [commandNameRaw, ...rawArgs] = withoutPrefix.split(/\s+/);
  const commandName = (commandNameRaw || '').toLowerCase();
  const handler = COMMAND_HANDLERS[commandName];
  if (!handler) {
    await deleteCommandMessage(message);
    return true;
  }

  await deleteCommandMessage(message);

  try {
    await handler(message, rawArgs, prisma, posseId);
  } catch (err) {
    await handleCommandError(message, err, commandName);
  }

  return true;
}

async function handlePrefixBan(message, args, prisma, posseId) {
  await assertCommandPermission(COMMAND_TYPES.BAN, message, prisma, posseId);
  if (args.length < 1) {
    throw new CommandUsageError('Informe o usuário a ser banido. ex: !ban @usuario Quebrou regras.', 'ban');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário a ser banido. ex: !ban @usuario Quebrou regras.', 'ban');
  }
  const reason = args.join(' ');
  const targetUser = await resolveTargetUser(message.guild, targetId);
  if (!targetUser) {
    throw new Error('Usuário não encontrado.');
  }
  const result = await runBan({
    guild: message.guild,
    moderatorMember: message.member,
    targetUser,
    reason,
    prisma,
    posseId,
  });
  await sendSuccessFeedback(message.channel, result.message, result.logEmbed);
}

async function handlePrefixUnban(message, args, prisma, posseId) {
  await assertCommandPermission(COMMAND_TYPES.BAN, message, prisma, posseId);
  if (args.length < 1) {
    throw new CommandUsageError('informe o id do usuario e o motivo. ex: !unban 123456789 Resolvido.', 'unban');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('informe o id do usuario e o motivo. ex: !unban 123456789 Resolvido.', 'unban');
  }
  const reason = args.join(' ');
  const result = await runUnban({
    guild: message.guild,
    moderatorMember: message.member,
    targetUserId: targetId,
    reason,
    prisma,
    posseId,
  });
  await sendSuccessFeedback(message.channel, result.message, result.logEmbed);
}

async function handlePrefixCastigo(message, args, prisma, posseId) {
  await assertCommandPermission(COMMAND_TYPES.CASTIGO, message, prisma, posseId);
  if (args.length < 1) {
    throw new CommandUsageError('Informe o usuário e o tempo do castigo. !castigo @menção/id 1h Azaralhando servidor.', 'castigo');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário e o tempo do castigo. !castigo @menção/id 1h Azaralhando servidor.', 'castigo');
  }
  const { durationToken, reasonText } = extractDurationAndReason(args);
  if (!durationToken) {
    throw new CommandUsageError('Informe o usuário e o tempo do castigo. !castigo @menção/id 1h Azaralhando servidor.', 'castigo');
  }
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    throw new Error('Usuário precisa estar no servidor.');
  }
  const result = await runCastigo({
    guild: message.guild,
    moderatorMember: message.member,
    targetMember: member,
    reason: reasonText,
    durationInput: durationToken,
    prisma,
    posseId,
  });
  await sendSuccessFeedback(message.channel, result.message, result.logEmbed);
}

async function handlePrefixRemoveCastigo(message, args, prisma, posseId) {
  await assertCommandPermission(COMMAND_TYPES.CASTIGO, message, prisma, posseId);
  if (args.length < 1) {
    throw new CommandUsageError('Informe o id do usuário. ex: !removercastigo @usuario Resolvido.', 'removercastigo');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('Informe o id do usuário. ex: !removercastigo @usuario Resolvido.', 'removercastigo');
  }
  const reason = args.join(' ');
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    throw new Error('Usuário precisa estar no servidor.');
  }
  const result = await runRemoveCastigo({
    guild: message.guild,
    moderatorMember: message.member,
    targetMember: member,
    reason,
    prisma,
    posseId,
  });
  await sendSuccessFeedback(message.channel, result.message, result.logEmbed);
}

module.exports = { handleMessage };
