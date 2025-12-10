const { getPrisma } = require('../db');
const { COMMAND_TYPES, ensureModerationConfig, buildLogEmbed, sendLogMessage } = require('../lib/moderation');
const {
  findExpiredCastigoRecords,
  markCastigoRecordEndedById,
} = require('../services/castigoRecords');

const CHECK_INTERVAL_MS = 15000;
const COMMAND_CHANNEL_TTL = 20000;

let sweepInterval;

function registerCastigoExpiration(client) {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    processExpiredCastigos(client).catch((err) => console.error('[castigo] sweep', err));
  }, CHECK_INTERVAL_MS);
  if (typeof sweepInterval.unref === 'function') sweepInterval.unref();
}

async function processExpiredCastigos(client) {
  const prisma = getPrisma();
  const expired = await findExpiredCastigoRecords(prisma);
  if (!expired.length) return;
  const cfg = await ensureModerationConfig(prisma);
  for (const record of expired) {
    await markCastigoRecordEndedById(record.id, {
      prisma,
      endedReason: 'Tempo expirado',
    }).catch((err) => console.warn('[castigo] falha ao encerrar registro', err?.message || err));
    await notifyCastigoExpiration(client, record, cfg).catch((err) => console.error('[castigo] notify', err));
  }
}

async function notifyCastigoExpiration(client, record, cfg) {
  const guild = await client.guilds.fetch(record.guildId).catch(() => null);
  if (!guild) return;
  const targetUser = await client.users.fetch(record.userId).catch(() => ({ id: record.userId, username: 'Usuário', tag: record.userId }));
  const moderatorUser = record.moderatorId
    ? await client.users.fetch(record.moderatorId).catch(() => ({ id: record.moderatorId, username: 'Moderador', tag: record.moderatorId }))
    : null;
  const embed = buildLogEmbed({
    type: COMMAND_TYPES.CASTIGO,
    action: 'EXPIRE',
    targetUser,
    moderatorUser,
    reason: record.reason || 'Tempo expirado',
    guild,
    durationSeconds: record.durationSeconds,
    expiredAt: record.expiresAt,
  });
  if (cfg?.castigoLogChannelId) {
    await sendLogMessage(guild, cfg.castigoLogChannelId, embed).catch((err) => console.warn('[castigo] log channel erro', err?.message || err));
  }
  if (record.commandChannelId) {
    await notifyCommandChannel(client, record.commandChannelId, embed);
  }
}

async function notifyCommandChannel(client, channelId, embed) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return;
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent && COMMAND_CHANNEL_TTL > 0) {
    const timeout = setTimeout(() => sent.delete().catch(() => {}), COMMAND_CHANNEL_TTL);
    if (typeof timeout.unref === 'function') timeout.unref();
  }
}

module.exports = { registerCastigoExpiration };
