const { getPrisma } = require('../db');

function serializeOverwrite(overwrite) {
  return {
    subjectId: overwrite.id,
    subjectType: overwrite.type === 1 || overwrite.type === 'member' ? 'member' : 'role',
    allow: overwrite.allow?.bitfield?.toString() || overwrite.allow?.toString() || '0',
    deny: overwrite.deny?.bitfield?.toString() || overwrite.deny?.toString() || '0',
  };
}

function deserializeEntry(entry) {
  return {
    id: entry.subjectId,
    type: entry.subjectType === 'member' ? 1 : 0,
    allow: BigInt(entry.allow || '0'),
    deny: BigInt(entry.deny || '0'),
  };
}

async function saveTemplateFromOverwrites({ prisma, guildId, name, overwrites, createdBy }) {
  const db = prisma || getPrisma();
  if (!guildId || !name) throw new Error('guildId e name são obrigatórios.');
  const normalized = name.trim();
  if (!normalized) throw new Error('Nome do template inválido.');
  const entries = (overwrites || []).map(serializeOverwrite);
  return db.$transaction(async (tx) => {
    const template = await tx.permissionTemplate.upsert({
      where: { guildId_name: { guildId, name: normalized } },
      create: { guildId, name: normalized, createdBy },
      update: { createdBy },
    });
    await tx.permissionTemplateEntry.deleteMany({ where: { templateId: template.id } });
    if (entries.length) {
      await tx.permissionTemplateEntry.createMany({
        data: entries.map((e) => ({ ...e, templateId: template.id })),
      });
    }
    return template;
  });
}

async function listTemplates({ prisma, guildId, take = 25 }) {
  if (!guildId) return [];
  const db = prisma || getPrisma();
  return db.permissionTemplate.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

async function getTemplateWithEntries({ prisma, guildId, templateId }) {
  if (!guildId || !templateId) return null;
  const db = prisma || getPrisma();
  const template = await db.permissionTemplate.findFirst({
    where: { guildId, id: templateId },
    include: { entries: true },
  });
  if (!template) return null;
  return {
    ...template,
    overwrites: template.entries.map(deserializeEntry),
  };
}

async function deleteTemplate({ prisma, guildId, templateId }) {
  if (!guildId || !templateId) return { deleted: 0 };
  const db = prisma || getPrisma();
  const result = await db.permissionTemplate.deleteMany({ where: { guildId, id: templateId } });
  return { deleted: result.count };
}

module.exports = {
  saveTemplateFromOverwrites,
  listTemplates,
  getTemplateWithEntries,
  deleteTemplate,
};
