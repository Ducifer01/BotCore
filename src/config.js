const ALLOWED_GUILD_IDS = String(process.env.ALLOWED_GUILD_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isGuildAllowed(guildId) {
  if (!guildId) return false;
  if (!ALLOWED_GUILD_IDS.length) return true;
  return ALLOWED_GUILD_IDS.includes(String(guildId));
}

module.exports = {
  ALLOWED_GUILD_IDS,
  isGuildAllowed,
};
