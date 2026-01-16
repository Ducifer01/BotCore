const { getProtectionsConfig, saveProtectionsConfig } = require('./protectionsConfig');

function normalizePair(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return { a: x, b: y };
}

function findRestriction(cfg, a, b) {
  const { a: x, b: y } = normalizePair(a, b);
  return (cfg.restrictions || []).find((r) => r.a === x && r.b === y && !r.removedAt);
}

async function getVoiceRestrictionsConfig(prisma) {
  const cfg = await getProtectionsConfig(prisma);
  return cfg.voiceRestrictions || {};
}

async function setVoiceRestrictionsConfig(prisma, updater) {
  const cfg = await getProtectionsConfig(prisma);
  const next = typeof updater === 'function'
    ? updater({ ...cfg.voiceRestrictions })
    : updater;
  const merged = { ...cfg, voiceRestrictions: { ...cfg.voiceRestrictions, ...next } };
  await saveProtectionsConfig(prisma, merged);
  return merged.voiceRestrictions;
}

async function addRestriction(prisma, userA, userB, { reason = null, authorId }) {
  const now = new Date().toISOString();
  return setVoiceRestrictionsConfig(prisma, (prev) => {
    const existing = findRestriction(prev, userA, userB);
    if (existing) return prev; // já existe ativa
    const pair = normalizePair(userA, userB);
    const next = { ...prev };
    next.restrictions = [...(prev.restrictions || []), {
      ...pair,
      reason: reason || null,
      createdBy: authorId || null,
      createdAt: now,
    }];
    return next;
  });
}

async function removeRestriction(prisma, userA, userB, { reason = null, authorId }) {
  const now = new Date().toISOString();
  let found = false;
  await setVoiceRestrictionsConfig(prisma, (prev) => {
    const { a, b } = normalizePair(userA, userB);
    const next = { ...prev };
    next.restrictions = (prev.restrictions || []).map((r) => {
      if (r.a === a && r.b === b && !r.removedAt) {
        found = true;
        return { ...r, removedAt: now, removedBy: authorId || null, removeReason: reason || null };
      }
      return r;
    });
    return next;
  });
  return found;
}

async function listRestrictions(prisma) {
  const cfg = await getVoiceRestrictionsConfig(prisma);
  return cfg.restrictions || [];
}

function isRestrictedPair(cfg, userA, userB) {
  if (!cfg?.restrictions?.length) return false;
  const { a, b } = normalizePair(userA, userB);
  return Boolean(cfg.restrictions.find((r) => r.a === a && r.b === b && !r.removedAt));
}

module.exports = {
  getVoiceRestrictionsConfig,
  setVoiceRestrictionsConfig,
  addRestriction,
  removeRestriction,
  listRestrictions,
  isRestrictedPair,
};
