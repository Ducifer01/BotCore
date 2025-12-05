const { runBan, runUnban, runCastigo, runRemoveCastigo, resolveTargetUser } = require('../actions/moderationActions');

const PREFIX = '!';
const TEMP_MESSAGE_TTL = 15000;
const LOG_PREVIEW_TTL = 20000;

const USAGE = {
  ban: '!ban <menção/ID> [motivo]'
    + '\nExemplo: !ban @Usuário quebrou regras',
  unban: '!unban <ID> [motivo]'
    + '\nExemplo: !unban 123456789 resolvido',
  castigo: '!castigo <menção/ID> <tempo> [motivo]'
    + '\nExemplo: !castigo @Usuário 1h spam no chat',
  removercastigo: '!removercastigo <menção/ID> [motivo]'
    + '\nExemplo: !removercastigo @Usuário colaboração restabelecida',
};

class CommandUsageError extends Error {
  constructor(message, usageKey) {
    super(message);
    this.name = 'CommandUsageError';
    this.usageKey = usageKey;
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

async function sendUnknownCommandFeedback(channel) {
  if (!channel) return;
  const list = Object.values(USAGE)
    .map((usage) => usage.split('\n')[0])
    .join('\n');
  const content = `Comando prefixado inválido. Disponíveis:\n${list}`;
  await sendTemporaryMessage(channel, { content });
}

async function handleCommandError(message, err, commandName) {
  console.warn('[moderation prefix]', commandName, err?.message || err);
  const channel = message.channel;
  const usageKey = err instanceof CommandUsageError ? err.usageKey : null;
  const usageText = usageKey ? USAGE[usageKey] : null;
  const parts = [`⚠️ ${err?.message || 'Erro inesperado.'}`];
  if (usageText) {
    parts.push(usageText);
  }
  await sendTemporaryMessage(channel, { content: parts.join('\n') });
}

async function sendSuccessFeedback(channel, confirmationMessage, logEmbed) {
  await sendTemporaryMessage(channel, { content: `✅ ${confirmationMessage}` });
  await sendLogPreview(channel, logEmbed);
}

async function sendLogPreview(channel, logEmbed) {
  const embedData = cloneEmbedData(logEmbed);
  if (!embedData) return;
  await sendTemporaryMessage(
    channel,
    {
      content: 'Log (visualização temporária – será removido em instantes):',
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
  const [commandNameRaw, ...rawArgs] = withoutPrefix.split(/\s+/);
  const commandName = (commandNameRaw || '').toLowerCase();
  const handler = COMMAND_HANDLERS[commandName];
  if (!handler) {
    await deleteCommandMessage(message);
    await sendUnknownCommandFeedback(message.channel);
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
  if (args.length < 1) {
    throw new CommandUsageError('Informe o usuário a ser banido.', 'ban');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('ID ou menção inválida.', 'ban');
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
  if (args.length < 1) {
    throw new CommandUsageError('Informe o ID do usuário a ser desbanido.', 'unban');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('ID inválido.', 'unban');
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
  if (args.length < 2) {
    throw new CommandUsageError('Informe o usuário e o tempo do castigo.', 'castigo');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('ID ou menção inválida.', 'castigo');
  }
  const duration = args.shift();
  if (!duration) {
    throw new CommandUsageError('Informe a duração (ex.: 30s, 5m, 1h).', 'castigo');
  }
  const reason = args.join(' ');
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    throw new Error('Usuário precisa estar no servidor.');
  }
  const result = await runCastigo({
    guild: message.guild,
    moderatorMember: message.member,
    targetMember: member,
    reason,
    durationInput: duration,
    prisma,
    posseId,
  });
  await sendSuccessFeedback(message.channel, result.message, result.logEmbed);
}

async function handlePrefixRemoveCastigo(message, args, prisma, posseId) {
  if (args.length < 1) {
    throw new CommandUsageError('Informe o usuário alvo.', 'removercastigo');
  }
  const targetId = extractId(args.shift());
  if (!targetId) {
    throw new CommandUsageError('ID ou menção inválida.', 'removercastigo');
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
