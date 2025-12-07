const { getPrisma } = require('../db');
const { ensureGlobalConfig } = require('./globalConfig');

const DAY_MS = 24 * 60 * 60 * 1000;

function buildVipConfigInclude(withPlans = true) {
  return {
    setPermissions: true,
    plans: withPlans
      ? {
          orderBy: { id: 'asc' },
        }
      : false,
  };
}

async function ensureVipConfig(prisma = getPrisma(), opts = { includePlans: true }) {
  const globalCfg = await ensureGlobalConfig(prisma);
  let vipCfg = await prisma.vipConfig.findUnique({
    where: { globalConfigId: globalCfg.id },
    include: buildVipConfigInclude(opts.includePlans),
  });
  if (!vipCfg) {
    await prisma.vipConfig.create({ data: { globalConfigId: globalCfg.id } });
    vipCfg = await prisma.vipConfig.findUnique({
      where: { globalConfigId: globalCfg.id },
      include: buildVipConfigInclude(opts.includePlans),
    });
  }
  return vipCfg;
}

async function getVipConfig(prisma = getPrisma(), opts = { includePlans: true }) {
  const vipCfg = await prisma.vipConfig.findFirst({
    include: buildVipConfigInclude(opts.includePlans),
  });
  return vipCfg || (await ensureVipConfig(prisma, opts));
}

async function updateVipSettings(data, prisma = getPrisma()) {
  const vipCfg = await ensureVipConfig(prisma);
  return prisma.vipConfig.update({
    where: { id: vipCfg.id },
    data,
    include: buildVipConfigInclude(true),
  });
}

async function createVipPlanDraft({ createdById, guildId }, prisma = getPrisma()) {
  const vipCfg = await ensureVipConfig(prisma, { includePlans: false });
  const plan = await prisma.vipPlan.create({
    data: {
      vipConfigId: vipCfg.id,
      createdById,
      guildId,
      isDraft: true,
    },
  });
  return plan;
}

async function updateVipPlan(planId, payload, prisma = getPrisma()) {
  return prisma.vipPlan.update({
    where: { id: planId },
    data: payload,
  });
}

function validatePlanPublish(plan) {
  const missing = [];
  if (!plan.name) missing.push('nome');
  if (!plan.durationDays || plan.durationDays <= 0) missing.push('duração');
  if (!plan.vipRoleId) missing.push('cargo do VIP');
  if (!plan.tagSeparatorRoleId) missing.push('separador de tag');
  if (!plan.callCategoryId) missing.push('categoria de call');
  return missing;
}

async function publishVipPlan(planId, prisma = getPrisma()) {
  const plan = await prisma.vipPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plano não encontrado');
  const missingFields = validatePlanPublish(plan);
  if (missingFields.length) {
    throw new Error(`Preencha os campos: ${missingFields.join(', ')}`);
  }
  return prisma.vipPlan.update({
    where: { id: planId },
    data: { isDraft: false },
  });
}

async function deleteVipPlan(planId, prisma = getPrisma()) {
  return prisma.vipPlan.delete({ where: { id: planId } });
}

async function getVipPlan(planId, prisma = getPrisma()) {
  return prisma.vipPlan.findUnique({ where: { id: planId }, include: { memberships: true } });
}

async function getMembershipByUser(userId, prisma = getPrisma()) {
  return prisma.vipMembership.findUnique({
    where: { userId },
    include: {
      plan: true,
      tag: { include: { shares: true } },
      channel: { include: { permissions: true } },
      logs: true,
    },
  });
}

function computeExpiration(durationDays, baseDate = new Date()) {
  const ms = Math.max(1, durationDays || 0) * DAY_MS;
  return new Date(baseDate.getTime() + ms);
}

async function createMembership({ planId, userId, executorId, durationDays, guildId, bonusRoleId }, prisma = getPrisma()) {
  const existing = await getMembershipByUser(userId, prisma);
  if (existing?.active) {
    throw new Error('Usuário já possui um VIP ativo.');
  }
  const plan = await prisma.vipPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.isDraft) {
    throw new Error('Plano inválido para concessão.');
  }
  if (guildId && plan.guildId !== guildId) {
    throw new Error('Este plano pertence a outra guild.');
  }
  const expiresAt = computeExpiration(durationDays ?? plan.durationDays ?? 30);
  const data = {
    vipPlanId: planId,
    guildId: guildId || plan.guildId,
    userId,
    startedAt: new Date(),
    expiresAt,
    lastSetById: executorId,
    vipRoleId: plan.vipRoleId,
    bonusRoleId: bonusRoleId || null,
    active: true,
    logs: {
      create: {
        action: 'CREATE',
        amountDays: durationDays ?? plan.durationDays ?? 30,
        actorId: executorId,
      },
    },
  };
  if (existing) {
    return prisma.vipMembership.update({
      where: { id: existing.id },
      data,
      include: { plan: true },
    });
  }
  return prisma.vipMembership.create({
    data,
    include: {
      plan: true,
    },
  });
}

async function adjustMembershipDays({ membershipId, deltaDays, actorId }, prisma = getPrisma()) {
  const membership = await prisma.vipMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new Error('VIP não encontrado');
  const newExpire = new Date(membership.expiresAt.getTime() + deltaDays * DAY_MS);
  return prisma.vipMembership.update({
    where: { id: membershipId },
    data: {
      expiresAt: newExpire,
      logs: {
        create: {
          action: deltaDays >= 0 ? 'ADD_DAYS' : 'REMOVE_DAYS',
          amountDays: Math.abs(deltaDays),
          actorId,
        },
      },
    },
    include: {
      plan: true,
    },
  });
}

async function deleteMembership(membershipId, prisma = getPrisma(), actorId) {
  return prisma.vipMembership.update({
    where: { id: membershipId },
    data: {
      active: false,
      logs: actorId
        ? {
            create: { action: 'DELETE', actorId },
          }
        : undefined,
    },
  });
}

async function saveVipTag(membershipId, payload, prisma = getPrisma()) {
  const existing = await prisma.vipTag.findUnique({ where: { membershipId } });
  if (existing) {
    return prisma.vipTag.update({ where: { membershipId }, data: payload, include: { shares: true } });
  }
  return prisma.vipTag.create({ data: { membershipId, ...payload }, include: { shares: true } });
}

async function saveVipChannel(membershipId, payload, prisma = getPrisma()) {
  const existing = await prisma.vipChannel.findUnique({ where: { membershipId } });
  if (existing) {
    return prisma.vipChannel.update({ where: { membershipId }, data: payload, include: { permissions: true } });
  }
  return prisma.vipChannel.create({ data: { membershipId, ...payload }, include: { permissions: true } });
}

async function shareVipTag(tagId, targetUserId, createdById, prisma = getPrisma()) {
  return prisma.vipTagShare.upsert({
    where: {
      vipTagId_targetUserId: {
        vipTagId: tagId,
        targetUserId,
      },
    },
    create: { vipTagId: tagId, targetUserId, createdById },
    update: { createdById },
  });
}

async function unshareVipTag(tagId, targetUserId, prisma = getPrisma()) {
  return prisma.vipTagShare.delete({
    where: {
      vipTagId_targetUserId: {
        vipTagId: tagId,
        targetUserId,
      },
    },
  });
}

async function upsertChannelPermission(vipChannelId, targetUserId, data, prisma = getPrisma()) {
  return prisma.vipChannelPermission.upsert({
    where: {
      vipChannelId_targetUserId: {
        vipChannelId,
        targetUserId,
      },
    },
    create: { vipChannelId, targetUserId, ...data },
    update: data,
  });
}

async function deleteChannelPermission(vipChannelId, targetUserId, prisma = getPrisma()) {
  return prisma.vipChannelPermission.delete({
    where: {
      vipChannelId_targetUserId: {
        vipChannelId,
        targetUserId,
      },
    },
  });
}

async function listExpiringMemberships(prisma = getPrisma()) {
  return prisma.vipMembership.findMany({
    where: { active: true, expiresAt: { lt: new Date() } },
    include: {
      plan: true,
      tag: true,
      channel: true,
    },
  });
}

module.exports = {
  ensureVipConfig,
  getVipConfig,
  updateVipSettings,
  createVipPlanDraft,
  updateVipPlan,
  publishVipPlan,
  deleteVipPlan,
  getVipPlan,
  createMembership,
  getMembershipByUser,
  adjustMembershipDays,
  deleteMembership,
  saveVipTag,
  saveVipChannel,
  shareVipTag,
  unshareVipTag,
  upsertChannelPermission,
  deleteChannelPermission,
  listExpiringMemberships,
};
