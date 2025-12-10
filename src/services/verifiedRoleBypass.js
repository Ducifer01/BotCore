const pendingBotVerifiedRoleAdds = new Map();

function buildKey(guildId, userId) {
  if (!guildId || !userId) return null;
  return `${guildId}:${userId}`;
}

function markBotVerifiedRoleAction(guildId, userId, ttlMs = 15000) {
  const key = buildKey(guildId, userId);
  if (!key) return;
  const existing = pendingBotVerifiedRoleAdds.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    pendingBotVerifiedRoleAdds.delete(key);
  }, ttlMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  pendingBotVerifiedRoleAdds.set(key, timer);
}

function consumeBotVerifiedRoleAction(guildId, userId) {
  const key = buildKey(guildId, userId);
  if (!key) return false;
  const timer = pendingBotVerifiedRoleAdds.get(key);
  if (!timer) return false;
  clearTimeout(timer);
  pendingBotVerifiedRoleAdds.delete(key);
  return true;
}

module.exports = {
  markBotVerifiedRoleAction,
  consumeBotVerifiedRoleAction,
};
