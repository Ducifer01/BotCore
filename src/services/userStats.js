const { getPrisma } = require('../db');

function buildWhere(guildId, userId) {
  return { guildId_userId: { guildId, userId } };
}

async function incrementMessageCount(prisma = getPrisma(), guildId, userId) {
  if (!guildId || !userId) return null;
  return prisma.userStatGlobal.upsert({
    where: buildWhere(guildId, userId),
    update: {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
    },
    create: {
      guildId,
      userId,
      messageCount: 1,
      lastMessageAt: new Date(),
    },
  });
}

async function startVoiceSession(prisma = getPrisma(), guildId, userId, channelId) {
  if (!guildId || !userId) return null;
  const now = new Date();
  return prisma.userStatGlobal.upsert({
    where: buildWhere(guildId, userId),
    update: {
      voiceSessionStartedAt: now,
      voiceSessionChannelId: channelId || null,
    },
    create: {
      guildId,
      userId,
      voiceSessionStartedAt: now,
      voiceSessionChannelId: channelId || null,
    },
  });
}

async function completeVoiceSession(prisma = getPrisma(), guildId, userId) {
  if (!guildId || !userId) return 0;
  const record = await prisma.userStatGlobal.findUnique({ where: buildWhere(guildId, userId) });
  if (!record || !record.voiceSessionStartedAt) {
    return 0;
  }
  const startedAt = new Date(record.voiceSessionStartedAt).getTime();
  const diffSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  await prisma.userStatGlobal.update({
    where: buildWhere(guildId, userId),
    data: {
      voiceSeconds: diffSeconds > 0 ? { increment: diffSeconds } : undefined,
      voiceSessionStartedAt: null,
      voiceSessionChannelId: null,
    },
  }).catch(() => {});
  return diffSeconds;
}

async function moveVoiceSession(prisma = getPrisma(), guildId, userId, newChannelId) {
  await completeVoiceSession(prisma, guildId, userId);
  await startVoiceSession(prisma, guildId, userId, newChannelId);
}

async function getUserStats(prisma = getPrisma(), guildId, userId) {
  if (!guildId || !userId) return null;
  return prisma.userStatGlobal.findUnique({ where: buildWhere(guildId, userId) });
}

module.exports = {
  incrementMessageCount,
  startVoiceSession,
  completeVoiceSession,
  moveVoiceSession,
  getUserStats,
};
