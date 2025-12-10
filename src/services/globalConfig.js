const { getPrisma } = require('../db');

async function getGlobalConfig(prisma = getPrisma()) {
  const cfg = await prisma.globalConfig.findFirst({
    include: {
      ticketPingRolesGlobal: true,
      supportRolesGlobal: true,
      mutePermissions: true,
      commandPermissions: true,
      autoModConfig: {
        include: {
          blockedWords: true,
        },
      },
      moderationConfig: {
        include: {
          permissions: true,
        },
      },
      channelCleanerPanels: true,
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
