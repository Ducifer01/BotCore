const { getPrisma } = require('./db');

async function ensureGuild(guild) {
  const prisma = getPrisma();
  await prisma.guild.upsert({
    where: { id: guild.id },
    update: { name: guild.name },
    create: { id: guild.id, name: guild.name },
  });
}

async function ensureCommandConfig(guildId, name) {
  const prisma = getPrisma();
  const cfg = await prisma.commandConfig.upsert({
    where: { guildId_name: { guildId, name } },
    update: {},
    create: { guildId, name, enabled: true },
    include: { allowedUsers: true, allowedRoles: true },
  });
  return cfg;
}

async function checkAccess(interaction, commandName) {
  // Lista de guilds permitidas (mesmo dono), separadas por vírgula no .env
  const allowedGuilds = String(process.env.ALLOWED_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedGuilds.length > 0 && !allowedGuilds.includes(interaction.guildId)) {
    // Se a guild não está na lista, nega tudo silenciosamente
    return false;
  }
  const prisma = getPrisma();
  await ensureGuild(interaction.guild);
  const cfg = await ensureCommandConfig(interaction.guildId, commandName);
  if (!cfg.enabled) return false;

  const userId = interaction.user.id;
  const roleIds = interaction.member?.roles?.valueOf?.() ? interaction.member.roles.valueOf() : interaction.member?.roles?.cache?.map(r => r.id) || [];

  const isAllowedUser = cfg.allowedUsers.some(u => u.userId === userId);
  const isAllowedRole = cfg.allowedRoles.some(r => roleIds.includes(r.roleId));

  // Superusuário (POSSE) por guild: bypass total
  const guildRecord = await prisma.guild.findUnique({ where: { id: interaction.guildId } });
  if (guildRecord?.posseUserId && guildRecord.posseUserId === userId) {
    return true;
  }

  // Política: somente BD decide. Sem allow-list => bloqueado.
  return isAllowedUser || isAllowedRole;
}

module.exports = { ensureGuild, ensureCommandConfig, checkAccess };
