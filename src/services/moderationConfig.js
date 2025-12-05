const { getPrisma } = require('../db');
const { ensureGlobalConfig } = require('./globalConfig');

const DEFAULT_BAN_DM_MESSAGE = 'Se acha que seu ban foi injusto, fale com a moderação.';
const DEFAULT_CASTIGO_DM_MESSAGE = 'Você recebeu um castigo no servidor.';

async function getModerationConfig(prisma = getPrisma()) {
  const cfg = await prisma.moderationConfig.findFirst({
    include: { permissions: true },
  });
  return cfg || null;
}

async function ensureModerationConfig(prisma = getPrisma()) {
  const globalCfg = await ensureGlobalConfig(prisma);
  let cfg = await prisma.moderationConfig.findUnique({
    where: { globalConfigId: globalCfg.id },
    include: { permissions: true },
  });
  if (!cfg) {
    cfg = await prisma.moderationConfig.create({
      data: {
        globalConfigId: globalCfg.id,
        banDmMessage: DEFAULT_BAN_DM_MESSAGE,
        castigoDmMessage: DEFAULT_CASTIGO_DM_MESSAGE,
      },
      include: { permissions: true },
    });
  } else {
    const needsUpdate = !cfg.banDmMessage || !cfg.castigoDmMessage;
    if (needsUpdate) {
      cfg = await prisma.moderationConfig.update({
        where: { id: cfg.id },
        data: {
          banDmMessage: cfg.banDmMessage || DEFAULT_BAN_DM_MESSAGE,
          castigoDmMessage: cfg.castigoDmMessage || DEFAULT_CASTIGO_DM_MESSAGE,
        },
        include: { permissions: true },
      });
    }
  }
  return cfg;
}

module.exports = {
  getModerationConfig,
  ensureModerationConfig,
  DEFAULT_BAN_DM_MESSAGE,
  DEFAULT_CASTIGO_DM_MESSAGE,
};
