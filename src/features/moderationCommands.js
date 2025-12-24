const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { runBan, runUnban, runCastigo, runRemoveCastigo, resolveTargetUser } = require('../actions/moderationActions');
const { COMMAND_TYPES, ensureModerationConfig, memberHasPermission } = require('../lib/moderation');
const { getGlobalConfig } = require('../services/globalConfig');
const { getUserStats } = require('../services/userStats');
const { getAllowedRolesForCommand } = require('../services/commandPermissions');

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

async function assertCommandPermissionFromMenu(commandNames, member, prisma, posseId) {
  if (!member) {
    throw new PermissionError('Este comando só pode ser usado dentro de um servidor.');
  }
  if (posseId && member.id === posseId) {
    return true;
  }
  const identifiers = (Array.isArray(commandNames) ? commandNames : [commandNames])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  if (!identifiers.length) {
    throw new PermissionError('Comando não configurado para verificação de permissões.');
  }
  const roleLists = await Promise.all(identifiers.map((name) => getAllowedRolesForCommand(name, prisma)));
  const allowedRoles = [...new Set(roleLists.flat())];
  if (!allowedRoles.length) {
    throw new PermissionError('Nenhum cargo foi configurado para este comando. Defina-os em /menu → Permissões.');
  }
  const hasRole = member.roles.cache.some((role) => allowedRoles.includes(role.id));
  if (!hasRole) {
    throw new PermissionError('Você não possui um cargo autorizado para este comando.');
  }
  return true;
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
  ping: handlePingCommand,
  info: handleInfoCommand,
  remover_verificado: handleRemoveVerifiedCommand,
};

const pingCooldowns = new Map();
const PING_COOLDOWN_MS = 10_000;

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
    return false;
  }

  if (commandName === 'ping') {
    const now = Date.now();
    const lastRun = pingCooldowns.get(message.channel.id) || 0;
    if (now - lastRun < PING_COOLDOWN_MS) {
      await deleteCommandMessage(message);
      return true;
    }
    pingCooldowns.set(message.channel.id, now);
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
    commandChannelId: message.channel?.id,
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

async function handlePingCommand(message) {
  const gatewayPing = Math.max(0, Math.round(message.client.ws.ping || 0));
  const messageLatency = Math.max(0, Date.now() - (message.createdTimestamp || Date.now()));
  const feedback = getLatencyFeedback(Math.max(gatewayPing, messageLatency));

  const embed = new EmbedBuilder()
    .setTitle('🏓 Pong!')
    .setColor(feedback.color)
    .addFields(
      { name: 'Latência da mensagem', value: `${messageLatency}ms`, inline: true },
      { name: 'Ping da API', value: `${gatewayPing}ms`, inline: true },
      { name: 'Feedback', value: `${feedback.emoji} ${feedback.label}`, inline: true },
    )
    .setFooter({ text: 'Quanto menor a latência, melhor o desempenho.' })
    .setTimestamp(new Date());

  await sendTemporaryMessage(message.channel, { embeds: [embed] }, 15000);
}

function getLatencyFeedback(value) {
  if (value <= 60) {
    return { label: 'Excelente', emoji: '🟢', color: 0x4ade80 };
  }
  if (value <= 120) {
    return { label: 'Bom', emoji: '🟡', color: 0xfacc15 };
  }
  if (value <= 250) {
    return { label: 'Ruim', emoji: '🟠', color: 0xf97316 };
  }
  return { label: 'Péssimo', emoji: '🔴', color: 0xef4444 };
}

async function handleInfoCommand(message, args, prisma) {
  if (!message.guild) throw new Error('Este comando só funciona em servidores.');
  if (!args.length) {
    throw new CommandUsageError('Informe o usuário. ex: !info @usuario', 'info');
  }
  const targetToken = args[0];
  const targetId = extractId(targetToken);
  if (!targetId) {
    throw new CommandUsageError('Informe o usuário. ex: !info @usuario', 'info');
  }
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    throw new Error('Usuário não encontrado no servidor.');
  }
  const [stats, verifyRecord] = await Promise.all([
    getUserStats(prisma, message.guildId, member.id),
    prisma.verifiedUserGlobal.findUnique({ where: { userId: member.id } }),
  ]);
  const messageCount = stats?.messageCount || 0;
  const voiceHours = ((stats?.voiceSeconds || 0) / 3600).toFixed(2);
  const everyoneId = message.guild.roles.everyone.id;
  const roles = member.roles.cache
    .filter((role) => role.id !== everyoneId)
    .sort((a, b) => b.position - a.position)
    .map((role) => `<@&${role.id}>`);
  const rolesText = roles.length ? roles.join(', ') : 'Nenhum cargo listado.';
  const description = [
    `Informações de <@${member.id}>`,
    `${messageCount} mensagens registradas`,
    `${voiceHours} horas em call`,
    '',
    `Cargos: ${rolesText}`,
  ].join('\n');
  const embed = new EmbedBuilder()
    .setTitle(member.user.username)
    .setDescription(description)
    .addFields({ name: 'Status de verificação', value: verifyRecord ? 'Verificado' : 'Não verificado' })
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `Comando executado por ${message.member?.displayName || message.author.username}`,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    })
    .setColor(verifyRecord ? 0x2ECC71 : 0xE74C3C);
  const sent = await message.channel.send({ embeds: [embed] });

  setTimeout(() => {
    sent.delete().catch(() => {});
  }, 10000);
}

async function handleRemoveVerifiedCommand(message, args, prisma, posseId) {
  if (!message.guild) throw new Error('Este comando só funciona em servidores.');
  if (!args.length) {
    throw new CommandUsageError('Informe o usuário. ex: !remover_verificado @usuario', 'remover_verificado');
  }
  const targetId = extractId(args[0]);
  if (!targetId) {
    throw new CommandUsageError('Informe um usuário válido. ex: !remover_verificado @usuario', 'remover_verificado');
  }
  const cfg = await getGlobalConfig(prisma);
  if (!cfg?.mainRoleId) {
    throw new Error('Sistema de verificação não está configurado.');
  }
  await assertCommandPermissionFromMenu(['remover_verificado', 'remover_verificação'], message.member, prisma, posseId);
  const record = await prisma.verifiedUserGlobal.findUnique({ where: { userId: targetId } }).catch(() => null);
  if (!record) {
    await sendTemporaryMessage(message.channel, 'Este usuário não está verificado.');
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('Remover verificação')
    .setDescription(`Deseja remover a verificação do usuário <@${targetId}> | ${targetId} do banco de dados?`)
    .setColor(0xE74C3C);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:remove:confirm:${targetId}:${message.author.id}`)
      .setLabel('Remover')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`verify:remove:cancel:${targetId}:${message.author.id}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary),
  );
  await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });
}

module.exports = { handleMessage };
