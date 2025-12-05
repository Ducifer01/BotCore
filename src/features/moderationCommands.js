const { runBan, runUnban, runCastigo, runRemoveCastigo, resolveTargetUser } = require('../actions/moderationActions');

const PREFIX = '!';

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
  const prisma = ctx.getPrisma();
  const posseId = String(process.env.POSSE_USER_ID || '').trim();
  const withoutPrefix = content.slice(PREFIX.length).trim();
  const [commandNameRaw, ...rawArgs] = withoutPrefix.split(/\s+/);
  const commandName = (commandNameRaw || '').toLowerCase();
  try {
    if (commandName === 'ban') {
      await handlePrefixBan(message, rawArgs, prisma, posseId);
      return true;
    }
    if (commandName === 'unban') {
      await handlePrefixUnban(message, rawArgs, prisma, posseId);
      return true;
    }
    if (commandName === 'castigo') {
      await handlePrefixCastigo(message, rawArgs, prisma, posseId);
      return true;
    }
    if (commandName === 'removercastigo') {
      await handlePrefixRemoveCastigo(message, rawArgs, prisma, posseId);
      return true;
    }
  } catch (err) {
    await message.reply({ content: `Erro: ${err.message}` }).catch(() => {});
    return true;
  }
  return false;
}

async function handlePrefixBan(message, args, prisma, posseId) {
  if (args.length < 2) {
    throw new Error('Uso: !ban <menção/ID> <motivo>');
  }
  const targetId = extractId(args.shift());
  if (!targetId) throw new Error('ID inválido.');
  const reason = args.join(' ');
  const targetUser = await resolveTargetUser(message.guild, targetId);
  if (!targetUser) throw new Error('Usuário não encontrado.');
  const result = await runBan({
    guild: message.guild,
    moderatorMember: message.member,
    targetUser,
    reason,
    prisma,
    posseId,
  });
  await message.reply({ content: result.message }).catch(() => {});
}

async function handlePrefixUnban(message, args, prisma, posseId) {
  if (args.length < 2) {
    throw new Error('Uso: !unban <ID> <motivo>');
  }
  const targetId = extractId(args.shift());
  if (!targetId) throw new Error('ID inválido.');
  const reason = args.join(' ');
  const result = await runUnban({
    guild: message.guild,
    moderatorMember: message.member,
    targetUserId: targetId,
    reason,
    prisma,
    posseId,
  });
  await message.reply({ content: result.message }).catch(() => {});
}

async function handlePrefixCastigo(message, args, prisma, posseId) {
  if (args.length < 3) {
    throw new Error('Uso: !castigo <menção/ID> <motivo> <tempo>');
  }
  const targetId = extractId(args.shift());
  if (!targetId) throw new Error('ID inválido.');
  const duration = args.pop();
  const reason = args.join(' ');
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) throw new Error('Usuário precisa estar no servidor.');
  const result = await runCastigo({
    guild: message.guild,
    moderatorMember: message.member,
    targetMember: member,
    reason,
    durationInput: duration,
    prisma,
    posseId,
  });
  await message.reply({ content: result.message }).catch(() => {});
}

async function handlePrefixRemoveCastigo(message, args, prisma, posseId) {
  if (args.length < 1) {
    throw new Error('Uso: !removercastigo <menção/ID> [motivo]');
  }
  const targetId = extractId(args.shift());
  if (!targetId) throw new Error('ID inválido.');
  const reason = args.join(' ');
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) throw new Error('Usuário precisa estar no servidor.');
  const result = await runRemoveCastigo({
    guild: message.guild,
    moderatorMember: message.member,
    targetMember: member,
    reason,
    prisma,
    posseId,
  });
  await message.reply({ content: result.message }).catch(() => {});
}

module.exports = { handleMessage };
