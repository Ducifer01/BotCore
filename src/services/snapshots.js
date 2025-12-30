const { getPrisma } = require('../db');

async function getOrCreateConfig(guildId, prisma = getPrisma()) {
  let config = await prisma.snapshotConfig.findUnique({ where: { guildId }, include: { targets: true } });
  if (!config) {
    config = await prisma.snapshotConfig.create({ data: { guildId }, include: { targets: true } });
  }
  return config;
}

async function setEnabled(guildId, enabled, prisma = getPrisma()) {
  await prisma.snapshotConfig.upsert({
    where: { guildId },
    update: { enabled },
    create: { guildId, enabled },
  });
  if (!enabled) {
    await prisma.snapshotTarget.deleteMany({ where: { config: { guildId } } });
  }
  return getOrCreateConfig(guildId, prisma);
}

async function setWaitForEmpty(guildId, waitForEmpty, prisma = getPrisma()) {
  await prisma.snapshotConfig.upsert({
    where: { guildId },
    update: { waitForEmpty },
    create: { guildId, waitForEmpty },
  });
  return getOrCreateConfig(guildId, prisma);
}

async function setTargets(guildId, targets, prisma = getPrisma()) {
  const config = await getOrCreateConfig(guildId, prisma);
  await prisma.$transaction([
    prisma.snapshotTarget.deleteMany({ where: { configId: config.id } }),
    prisma.snapshotTarget.createMany({
      data: targets.map((t) => ({
        configId: config.id,
        channelId: t.channelId,
        channelType: t.channelType,
        snapshot: t.snapshot,
      })),
    }),
  ]);
  return getOrCreateConfig(guildId, prisma);
}

async function loadConfig(guildId, prisma = getPrisma()) {
  return getOrCreateConfig(guildId, prisma);
}

module.exports = {
  getOrCreateConfig,
  setEnabled,
  setWaitForEmpty,
  setTargets,
  loadConfig,
};
