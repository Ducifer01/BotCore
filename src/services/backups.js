const { ChannelType, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');

const BACKUP_SCOPES = {
  CHANNELS: 'channels',
  ROLES: 'roles',
};

const toArray = (val) => (Array.isArray(val) ? val : val ? [val] : []);
const uniq = (arr = []) => [...new Set(arr)];
const parseJson = (str, fallback) => {
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
};
const genId = () => `bkp_${crypto.randomBytes(4).toString('hex')}`;

function serializeScopes(scopes) {
  return JSON.stringify(uniq(scopes || []));
}

function normalizeRecord(record) {
  if (!record) return null;
  return {
    ...record,
    scopes: parseJson(record.scopes, []),
    payload: parseJson(record.payload, {}),
  };
}

function snapshotOverwrites(channel) {
  return channel.permissionOverwrites.cache.map((po) => ({
    id: po.id,
    type: po.type,
    allow: po.allow.bitfield.toString(),
    deny: po.deny.bitfield.toString(),
  }));
}

async function snapshotChannels(guild) {
  const channels = guild.channels.cache
    .filter((c) => !c.isThread())
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.rawPosition,
      topic: c.topic || null,
      nsfw: Boolean(c.nsfw),
      rateLimitPerUser: c.rateLimitPerUser || 0,
      bitrate: c.bitrate || null,
      userLimit: c.userLimit || null,
      overwrites: snapshotOverwrites(c),
    }));
  return channels;
}

function snapshotRoles(guild) {
  return guild.roles.cache
    .filter((r) => !r.managed)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
    }));
}

async function captureSnapshot(guild, scopes) {
  const data = {};
  const set = new Set(scopes || []);
  if (set.has(BACKUP_SCOPES.CHANNELS)) {
    data.channels = await snapshotChannels(guild);
  }
  if (set.has(BACKUP_SCOPES.ROLES)) {
    data.roles = snapshotRoles(guild);
  }
  return data;
}

async function createBackup(prisma, guild, userId, { name, scopes }) {
  const payloadObj = await captureSnapshot(guild, scopes);
  const backup = await prisma.backup.create({
    data: {
      backupId: genId(),
      guildId: guild.id,
      name: name || null,
      scopes: serializeScopes(scopes),
      payload: JSON.stringify(payloadObj),
      createdBy: userId,
    },
  });
  return normalizeRecord(backup);
}

async function listBackups(prisma, guildId, { skip = 0, take = 25 } = {}) {
  const rows = await prisma.backup.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
  });
  return rows.map(normalizeRecord);
}

async function countBackups(prisma, guildId) {
  return prisma.backup.count({ where: { guildId } });
}

async function getBackup(prisma, backupId, guildId) {
  const row = await prisma.backup.findFirst({ where: { backupId, ...(guildId ? { guildId } : {}) } });
  return normalizeRecord(row);
}

function diffChannels(snapshot, guild) {
  const current = guild.channels.cache;
  const missing = [];
  const changed = [];
  const mapCurrent = new Map();
  current.filter((c) => !c.isThread()).forEach((c) => mapCurrent.set(c.id, c));

  for (const ch of snapshot || []) {
    const live = mapCurrent.get(ch.id);
    if (!live) {
      missing.push(ch);
      continue;
    }
    const diff = [];
    if (live.name !== ch.name) diff.push('name');
    if ((live.parentId || null) !== (ch.parentId || null)) diff.push('parent');
    if ((live.topic || null) !== (ch.topic || null)) diff.push('topic');
    if (Number(live.rateLimitPerUser || 0) !== Number(ch.rateLimitPerUser || 0)) diff.push('slowmode');
    if (Boolean(live.nsfw) !== Boolean(ch.nsfw)) diff.push('nsfw');
    if (live.type === ChannelType.GuildVoice || live.type === ChannelType.GuildStageVoice) {
      if (Number(live.bitrate || 0) !== Number(ch.bitrate || 0)) diff.push('bitrate');
      if (Number(live.userLimit || 0) !== Number(ch.userLimit || 0)) diff.push('userLimit');
    }
    // overwrites
    const liveOv = (live.permissionOverwrites?.cache || new Map()).map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield.toString(),
      deny: o.deny.bitfield.toString(),
    }));
    const keyOv = (ov) => `${ov.id}:${ov.type}:${ov.allow}:${ov.deny}`;
    const setLive = new Set(liveOv.map(keyOv));
    const setSnap = new Set((ch.overwrites || []).map(keyOv));
    if (liveOv.length !== (ch.overwrites || []).length || [...setLive].some((k) => !setSnap.has(k)) || [...setSnap].some((k) => !setLive.has(k))) {
      diff.push('overwrites');
    }
    if (diff.length) changed.push({ channel: ch, diff });
  }
  return { missing, changed };
}

function diffRoles(snapshot, guild) {
  const current = guild.roles.cache.filter((r) => !r.managed);
  const missing = [];
  const changed = [];
  const mapCurrent = new Map();
  current.forEach((r) => mapCurrent.set(r.id, r));

  for (const role of snapshot || []) {
    const live = mapCurrent.get(role.id);
    if (!live) {
      missing.push(role);
      continue;
    }
    const diff = [];
    if (live.name !== role.name) diff.push('name');
    if (live.color !== role.color) diff.push('color');
    if (live.hoist !== role.hoist) diff.push('hoist');
    if (live.mentionable !== role.mentionable) diff.push('mentionable');
    if (live.permissions.bitfield.toString() !== role.permissions) diff.push('permissions');
    if (diff.length) changed.push({ role, diff });
  }
  return { missing, changed };
}

async function diffBackup(prisma, guild, backupId) {
  const backup = await getBackup(prisma, backupId, guild.id);
  if (!backup) return null;
  const scopes = backup.scopes || [];
  const payload = backup.payload || {};
  const result = {};
  if (scopes.includes(BACKUP_SCOPES.CHANNELS)) {
    result.channels = diffChannels(payload.channels, guild);
  }
  if (scopes.includes(BACKUP_SCOPES.ROLES)) {
    result.roles = diffRoles(payload.roles, guild);
  }
  return { backup, diff: result };
}

async function ensureCategory(guild, snapshot) {
  const existing = guild.channels.cache.get(snapshot.id);
  if (existing) return existing;
  const created = await guild.channels.create({
    name: snapshot.name,
    type: ChannelType.GuildCategory,
    position: snapshot.position,
    permissionOverwrites: snapshot.overwrites?.map((o) => ({
      id: o.id,
      type: o.type,
      allow: new PermissionsBitField(o.allow || 0n),
      deny: new PermissionsBitField(o.deny || 0n),
    })),
  }).catch(() => null);
  return created;
}

async function restoreChannels(guild, snapshots) {
  let created = 0;
  let updated = 0;
  console.log('[backup] restore channels start', { total: snapshots?.length || 0 });
  const categories = snapshots.filter((c) => c.type === ChannelType.GuildCategory);
  const others = snapshots.filter((c) => c.type !== ChannelType.GuildCategory);

  // Garantir categorias primeiro
  for (const cat of categories) {
    const existing = guild.channels.cache.get(cat.id);
    if (!existing) {
      const createdCat = await ensureCategory(guild, cat);
      if (createdCat) created += 1;
    } else {
      await existing.edit({ name: cat.name, position: cat.position }).catch(() => {});
      updated += 1;
    }
    if ((created + updated) % 10 === 0) console.log('[backup] restore channels progress (cats)', { created, updated });
  }

  for (const ch of others) {
    const existing = guild.channels.cache.get(ch.id);
    const opts = {
      name: ch.name,
      parent: ch.parentId || null,
      position: ch.position,
      topic: ch.topic || null,
      nsfw: Boolean(ch.nsfw),
      rateLimitPerUser: ch.rateLimitPerUser || 0,
      permissionOverwrites: ch.overwrites?.map((o) => ({
        id: o.id,
        type: o.type,
        allow: new PermissionsBitField(o.allow || 0n),
        deny: new PermissionsBitField(o.deny || 0n),
      })),
    };
    if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
      opts.bitrate = ch.bitrate || undefined;
      opts.userLimit = ch.userLimit || undefined;
    }
    if (!existing) {
      const createdChannel = await guild.channels.create({
        name: ch.name,
        type: ch.type,
        parent: ch.parentId || null,
        position: ch.position,
        topic: ch.topic || undefined,
        nsfw: Boolean(ch.nsfw),
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        permissionOverwrites: opts.permissionOverwrites,
        bitrate: opts.bitrate,
        userLimit: opts.userLimit,
      }).catch(() => null);
      if (createdChannel) created += 1;
    } else {
      await existing.edit(opts).catch(() => {});
      updated += 1;
    }
    if ((created + updated) % 10 === 0) console.log('[backup] restore channels progress', { created, updated });
  }
  console.log('[backup] restore channels done', { created, updated });
  return { created, updated };
}

async function restoreRoles(guild, snapshots) {
  let created = 0;
  let updated = 0;
  console.log('[backup] restore roles start', { total: snapshots?.length || 0 });
  for (const role of snapshots) {
    const existing = guild.roles.cache.get(role.id);
    const data = {
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: new PermissionsBitField(role.permissions || 0n),
    };
    if (!existing) {
      const newRole = await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: data.permissions,
        reason: 'Restore de backup',
      }).catch(() => null);
      if (newRole) {
        created += 1;
        // posicionar se possível
        if (typeof role.position === 'number') newRole.setPosition(role.position).catch(() => {});
      }
    } else {
      await existing.edit(data).catch(() => {});
      if (typeof role.position === 'number') existing.setPosition(role.position).catch(() => {});
      updated += 1;
    }
    if ((created + updated) % 10 === 0) console.log('[backup] restore roles progress', { created, updated });
  }
  console.log('[backup] restore roles done', { created, updated });
  return { created, updated };
}

async function restoreBackup(prisma, guild, backupId, scopesOverride) {
  const backup = await getBackup(prisma, backupId, guild.id);
  if (!backup) return null;
  const scopes = scopesOverride?.length ? scopesOverride : backup.scopes || [];
  const payload = backup.payload || {};
  const result = {};
  if (scopes.includes(BACKUP_SCOPES.ROLES) && payload.roles) {
    result.roles = await restoreRoles(guild, payload.roles);
  }
  if (scopes.includes(BACKUP_SCOPES.CHANNELS) && payload.channels) {
    result.channels = await restoreChannels(guild, payload.channels);
  }
  return { backup, result };
}

module.exports = {
  BACKUP_SCOPES,
  createBackup,
  listBackups,
  countBackups,
  getBackup,
  diffBackup,
  restoreBackup,
};
