const { getPrisma } = require('../db');

async function addToBlacklist({ prisma = getPrisma(), guildId, userId, reason, createdBy }) {
  if (!guildId || !userId) throw new Error('guildId e userId são obrigatórios.');
  return prisma.blacklist.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, reason: reason?.trim() || null, createdBy },
    update: { reason: reason?.trim() || null, createdBy },
  });
}

async function removeFromBlacklist({ prisma = getPrisma(), guildId, userId }) {
  if (!guildId || !userId) throw new Error('guildId e userId são obrigatórios.');
  return prisma.blacklist.delete({ where: { guildId_userId: { guildId, userId } } });
}

async function isBlacklisted({ prisma = getPrisma(), guildId, userId }) {
  if (!guildId || !userId) return false;
  const entry = await prisma.blacklist.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return Boolean(entry);
}

async function getBlacklistEntry({ prisma = getPrisma(), guildId, userId }) {
  if (!guildId || !userId) return null;
  return prisma.blacklist.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

async function listBlacklist({ prisma = getPrisma(), guildId, take = 50 }) {
  if (!guildId) return [];
  return prisma.blacklist.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

module.exports = {
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getBlacklistEntry,
  listBlacklist,
};
