const { getPrisma } = require('../db');
const { ensureGlobalConfig } = require('./globalConfig');

const DEFAULT_EXCLUDED_COMMANDS = new Set([
  'ban',
  'castigo',
  'removercastigo',
  'unban',
  'menu',
]);

function normalizeCommandName(commandName) {
  return String(commandName || '').trim().toLowerCase();
}

function isCommandManaged(commandName) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return false;
  return !DEFAULT_EXCLUDED_COMMANDS.has(normalized);
}

async function getGlobalConfigId(prisma = getPrisma()) {
  const cfg = await ensureGlobalConfig(prisma);
  return cfg.id;
}

async function getAllCommandPermissions(prisma = getPrisma()) {
  const globalConfigId = await getGlobalConfigId(prisma);
  const rows = await prisma.commandPermissionGlobal.findMany({
    where: { globalConfigId },
  });
  const map = new Map();
  for (const row of rows) {
    const key = normalizeCommandName(row.commandName);
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key).add(row.roleId);
  }
  return map;
}

async function getAllowedRolesForCommand(commandName, prisma = getPrisma()) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return [];
  const globalConfigId = await getGlobalConfigId(prisma);
  const rows = await prisma.commandPermissionGlobal.findMany({
    where: {
      globalConfigId,
      commandName: normalized,
    },
  });
  return rows.map((row) => row.roleId);
}

async function addRolesToCommand(commandName, roleIds, prisma = getPrisma()) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized || !Array.isArray(roleIds) || !roleIds.length) return { created: 0 };
  const unique = [...new Set(roleIds.map(String))];
  const globalConfigId = await getGlobalConfigId(prisma);
  const existing = await prisma.commandPermissionGlobal.findMany({
    where: {
      globalConfigId,
      commandName: normalized,
      roleId: { in: unique },
    },
    select: { roleId: true },
  });
  const existingSet = new Set(existing.map((row) => row.roleId));
  const insertData = unique
    .filter((roleId) => !existingSet.has(roleId))
    .map((roleId) => ({ globalConfigId, commandName: normalized, roleId }));
  if (!insertData.length) {
    return { created: 0 };
  }
  try {
    await prisma.commandPermissionGlobal.createMany({ data: insertData });
    return { created: insertData.length };
  } catch (error) {
    if (error?.code === 'P2002') {
      // Outra instância inseriu os mesmos registros simultaneamente; ignora.
      return { created: 0 };
    }
    throw error;
  }
}

async function removeRolesFromCommand(commandName, roleIds, prisma = getPrisma()) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized || !Array.isArray(roleIds) || !roleIds.length) return { deleted: 0 };
  const unique = [...new Set(roleIds.map(String))];
  const globalConfigId = await getGlobalConfigId(prisma);
  const result = await prisma.commandPermissionGlobal.deleteMany({
    where: {
      globalConfigId,
      commandName: normalized,
      roleId: { in: unique },
    },
  });
  return { deleted: result.count };
}

async function clearRolesForCommand(commandName, prisma = getPrisma()) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return { deleted: 0 };
  const globalConfigId = await getGlobalConfigId(prisma);
  const result = await prisma.commandPermissionGlobal.deleteMany({
    where: { globalConfigId, commandName: normalized },
  });
  return { deleted: result.count };
}

module.exports = {
  normalizeCommandName,
  isCommandManaged,
  getAllCommandPermissions,
  getAllowedRolesForCommand,
  addRolesToCommand,
  removeRolesFromCommand,
  clearRolesForCommand,
  EXCLUDED_COMMANDS: DEFAULT_EXCLUDED_COMMANDS,
};
