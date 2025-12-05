const { getPrisma } = require('../db');

async function getGlobalConfig(prisma = getPrisma()) {
  const cfg = await prisma.globalConfig.findFirst({
    include: {
      ticketPingRolesGlobal: true,
      supportRolesGlobal: true,
      autoModConfig: {
        include: {
          blockedWords: true,
        },
      },
    },
  });
  return cfg || null;
}

async function ensureGlobalConfig(prisma = getPrisma()) {
  let cfg = await prisma.globalConfig.findFirst();
  if (!cfg) {
    cfg = await prisma.globalConfig.create({ data: {} });
  }
  return cfg;
}

module.exports = {
  getGlobalConfig,
  ensureGlobalConfig,
};
