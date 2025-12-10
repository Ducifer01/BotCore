const { getPrisma } = require('../db');
const { ensureGlobalConfig } = require('./globalConfig');

async function createCastigoRecord({
  prisma = getPrisma(),
  guildId,
  userId,
  moderatorId,
  reason,
  durationSeconds,
  expiresAt,
  commandChannelId,
}) {
  if (!guildId || !userId || !durationSeconds || !expiresAt) {
    throw new Error('Dados insuficientes para registrar castigo.');
  }
  const cfg = await ensureGlobalConfig(prisma);
  const now = new Date();
  await prisma.castigoRecord.updateMany({
    where: { guildId, userId, endedAt: null },
    data: {
      endedAt: now,
      endedReason: 'Substituído por novo castigo',
      endedBy: moderatorId || null,
    },
  });
  return prisma.castigoRecord.create({
    data: {
      globalConfigId: cfg.id,
      guildId,
      userId,
      moderatorId: moderatorId || null,
      reason: reason || null,
      durationSeconds,
      expiresAt,
      commandChannelId: commandChannelId || null,
    },
  });
}

async function completeCastigoRecordForUser({
  prisma = getPrisma(),
  guildId,
  userId,
  endedReason,
  endedBy,
}) {
  if (!guildId || !userId) {
    return null;
  }
  const active = await prisma.castigoRecord.findFirst({
    where: { guildId, userId, endedAt: null },
    orderBy: { expiresAt: 'desc' },
  });
  if (!active) {
    return null;
  }
  return prisma.castigoRecord.update({
    where: { id: active.id },
    data: {
      endedAt: new Date(),
      endedReason: endedReason || null,
      endedBy: endedBy || null,
    },
  });
}

async function findExpiredCastigoRecords(prisma = getPrisma()) {
  const now = new Date();
  return prisma.castigoRecord.findMany({
    where: {
      endedAt: null,
      expiresAt: { lte: now },
    },
  });
}

async function markCastigoRecordEndedById(recordId, { prisma = getPrisma(), endedReason, endedBy } = {}) {
  if (!recordId) return null;
  return prisma.castigoRecord.update({
    where: { id: recordId },
    data: {
      endedAt: new Date(),
      endedReason: endedReason || null,
      endedBy: endedBy || null,
    },
  });
}

module.exports = {
  createCastigoRecord,
  completeCastigoRecordForUser,
  findExpiredCastigoRecords,
  markCastigoRecordEndedById,
};
