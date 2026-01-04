const { getPrisma } = require('../db');

function safeParse(snapshot) {
  if (!snapshot) return null;
  if (typeof snapshot !== 'string') return snapshot;
  try {
    return JSON.parse(snapshot);
  } catch (err) {
    console.warn('[snapshot] Falha ao parsear snapshot salvo:', err?.message || err);
    return null;
  }
}

function normalizeConfig(config) {
  if (!config) return config;
  return {
    ...config,
    targets: (config.targets || []).map((t) => ({
      ...t,
      snapshot: safeParse(t.snapshot),
    })),
  };
}

async function getOrCreateConfig(guildId, prisma = getPrisma()) {
  let config = await prisma.snapshotConfig.findUnique({ where: { guildId }, include: { targets: true } });
  if (!config) {
    config = await prisma.snapshotConfig.create({ data: { guildId }, include: { targets: true } });
  }
  return normalizeConfig(config);
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
        channelType: String(t.channelType),
        snapshot: typeof t.snapshot === 'string' ? t.snapshot : JSON.stringify(t.snapshot),
      })),
    }),
  ]);
  return getOrCreateConfig(guildId, prisma);
}

async function loadConfig(guildId, prisma = getPrisma()) {
  return getOrCreateConfig(guildId, prisma);
}

async function getConfigAndTargetByChannel(guildId, channelId, prisma = getPrisma()) {
  const target = await prisma.snapshotTarget.findFirst({
    where: { channelId, config: { guildId } },
    include: { config: true },
  });
  if (!target) return null;
  const config = normalizeConfig(target.config);
  return {
    config,
    target: {
      ...target,
      snapshot: safeParse(target.snapshot),
    },
  };
}

module.exports = {
  getOrCreateConfig,
  setEnabled,
  setWaitForEmpty,
  setTargets,
  loadConfig,
  normalizeConfig,
  getConfigAndTargetByChannel,
};
