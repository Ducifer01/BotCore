const { ensureGlobalConfig } = require('./globalConfig');

const PUNISH = {
  STRIP_ROLES: 'STRIP_ROLES',
  KICK: 'KICK',
};

const DEFAULT_CRITICAL_PERMS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ViewAuditLog',
  'ViewGuildInsights',
  'ManageWebhooks',
  'BanMembers',
  'ModerateMembers',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
];

function defaultConfig() {
  return {
    globalWhitelistUsers: [],
    globalWhitelistRoles: [],
    antiRoleHierarchy: {
      enabled: false,
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
      whitelistUsers: [],
      whitelistRoles: [],
      limitRoleId: null,
      protectPermissions: true,
      preventProtectedRoleGive: true,
      punishOnProtectedRoleDelete: true,
    },
    antiBotAdd: {
      enabled: false,
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
      whitelistUsers: [],
      whitelistRoles: [],
      botAction: 'KICK', // KICK or BAN for the new bot
    },
    antiCriticalPerms: {
      enabled: false,
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
      whitelistUsers: [],
      whitelistRoles: [],
      // Por padrão nenhum bloqueio ativo; admin escolhe o que bloquear no painel.
      blockedPerms: [],
    },
    antiAlt: {
      enabled: false,
      minAccountDays: 7,
      punishment: PUNISH.KICK,
      logChannelId: null,
    },
    massBanKick: {
      enabled: false,
      limit: { count: 3, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
    massTimeout: {
      enabled: false,
      limit: { count: 3, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
    massChannelDelete: {
      enabled: false,
      limit: { count: 3, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
    massRoleDelete: {
      enabled: false,
      limit: { count: 3, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
    blockedRoles: {
      enabled: false,
      roles: [],
      logChannelId: null,
    },
    massDisconnect: {
      enabled: false,
      limit: { count: 5, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
    massMuteDeafen: {
      enabled: false,
      limit: { count: 5, seconds: 30 },
      punishment: PUNISH.STRIP_ROLES,
      logChannelId: null,
    },
  };
}

function mergeConfig(raw) {
  const base = defaultConfig();
  return {
    ...base,
    ...raw,
    globalWhitelistUsers: raw?.globalWhitelistUsers || base.globalWhitelistUsers,
    globalWhitelistRoles: raw?.globalWhitelistRoles || base.globalWhitelistRoles,
    antiRoleHierarchy: { ...base.antiRoleHierarchy, ...raw?.antiRoleHierarchy },
    antiBotAdd: { ...base.antiBotAdd, ...raw?.antiBotAdd },
    antiCriticalPerms: {
      ...base.antiCriticalPerms,
      ...raw?.antiCriticalPerms,
      blockedPerms: raw?.antiCriticalPerms?.blockedPerms || base.antiCriticalPerms.blockedPerms,
    },
    antiAlt: { ...base.antiAlt, ...raw?.antiAlt },
    massBanKick: {
      ...base.massBanKick,
      ...raw?.massBanKick,
      limit: { ...base.massBanKick.limit, ...(raw?.massBanKick?.limit || {}) },
    },
    massTimeout: {
      ...base.massTimeout,
      ...raw?.massTimeout,
      limit: { ...base.massTimeout.limit, ...(raw?.massTimeout?.limit || {}) },
    },
    massChannelDelete: {
      ...base.massChannelDelete,
      ...raw?.massChannelDelete,
      limit: { ...base.massChannelDelete.limit, ...(raw?.massChannelDelete?.limit || {}) },
    },
    massRoleDelete: {
      ...base.massRoleDelete,
      ...raw?.massRoleDelete,
      limit: { ...base.massRoleDelete.limit, ...(raw?.massRoleDelete?.limit || {}) },
    },
    blockedRoles: {
      ...base.blockedRoles,
      ...raw?.blockedRoles,
      roles: raw?.blockedRoles?.roles || base.blockedRoles.roles,
    },
    massDisconnect: {
      ...base.massDisconnect,
      ...raw?.massDisconnect,
      limit: { ...base.massDisconnect.limit, ...(raw?.massDisconnect?.limit || {}) },
    },
    massMuteDeafen: {
      ...base.massMuteDeafen,
      ...raw?.massMuteDeafen,
      limit: { ...base.massMuteDeafen.limit, ...(raw?.massMuteDeafen?.limit || {}) },
    },
  };
}

async function getProtectionsConfig(prisma) {
  const cfg = await ensureGlobalConfig(prisma);
  let parsed = {};
  if (cfg.protectionsConfigJson) {
    try {
      parsed = JSON.parse(cfg.protectionsConfigJson);
    } catch (err) {
      console.warn('[protections] falha ao parsear protectionsConfigJson', err?.message || err);
    }
  }
  return mergeConfig(parsed || {});
}

async function saveProtectionsConfig(prisma, input) {
  const merged = mergeConfig(input || {});
  const cfg = await ensureGlobalConfig(prisma);
  await prisma.globalConfig.update({
    where: { id: cfg.id },
    data: { protectionsConfigJson: JSON.stringify(merged) },
  });
  return merged;
}

module.exports = {
  getProtectionsConfig,
  saveProtectionsConfig,
  defaultConfig,
  PUNISH,
  DEFAULT_CRITICAL_PERMS,
};
