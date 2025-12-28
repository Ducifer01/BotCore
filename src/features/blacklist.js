const { getBlacklistEntry } = require('../services/blacklist');
const { runBan } = require('../actions/moderationActions');

async function handleGuildMemberAdd(member, ctx) {
  try {
    const prisma = ctx.getPrisma();
    const entry = await getBlacklistEntry({ prisma, guildId: member.guild.id, userId: member.id });
    if (!entry) return false;
    const posseId = String(process.env.POSSE_USER_ID || '').trim();
    const moderatorMember = member.guild.members.me || await member.guild.members.fetch(member.guild.members.me?.id || member.client.user.id).catch(() => null);
    await runBan({
      guild: member.guild,
      moderatorMember: moderatorMember || member.guild.members.me,
      targetUser: member.user,
      reason: entry.reason || 'Blacklist',
      prisma,
      posseId,
    });
  } catch (err) {
    console.warn('[blacklist] auto ban falhou:', err?.message || err);
  }
  return false;
}

module.exports = {
  handleGuildMemberAdd,
};
