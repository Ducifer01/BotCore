const { getProtectionsConfig } = require('../services/protectionsConfig');

async function checkVoiceRestrictionPermission(member, prisma) {
  if (member.permissions.has('Administrator')) {
    return true;
  }
  
  const cfg = await getProtectionsConfig(prisma);
  const allowedRoles = cfg.voiceRestrictions?.allowedRoles || [];
  
  if (allowedRoles.length === 0) {
    return false;
  }
  
  return member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

module.exports = { checkVoiceRestrictionPermission };
