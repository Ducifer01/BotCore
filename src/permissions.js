// Gate simplificado 100% global
// - ALLOWED_GUILD_IDS: restringe em quais servidores o bot responde
// - POSSE_USER_ID: superusuário global que pode sempre executar comandos administrativos
// - Permissões de comando são definidas via menu e aplicadas a todos os comandos que usam checkAccess

const {
  getAllowedRolesForCommand,
  isCommandManaged,
  normalizeCommandName,
} = require('./services/commandPermissions');

async function ensureGuild(guild) {
  // Agora é no-op; mantido por compatibilidade com chamadas existentes
  return guild;
}

async function checkAccess(interaction, commandName) {
  const allowedGuilds = String(process.env.ALLOWED_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedGuilds.length > 0 && !allowedGuilds.includes(String(interaction.guildId))) {
    return false;
  }
  const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
  if (POSSE_USER_ID && POSSE_USER_ID === interaction.user.id) {
    return true;
  }
  const normalized = normalizeCommandName(commandName);
  if (!normalized || !isCommandManaged(normalized)) {
    return true;
  }
  const allowedRoles = await getAllowedRolesForCommand(normalized);
  if (!allowedRoles.length) {
    return false;
  }
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles?.size) {
    return false;
  }
  return memberRoles.some((role) => allowedRoles.includes(role.id));
}

module.exports = { ensureGuild, checkAccess };
