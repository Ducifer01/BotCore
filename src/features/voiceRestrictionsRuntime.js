const { EmbedBuilder, ChannelType } = require('discord.js');
const { getPrisma } = require('../db');
const { getVoiceRestrictionsConfig, isRestrictedPair } = require('../services/voiceRestrictions');

function pickTextChannelForVoice(voiceChannel) {
  if (!voiceChannel?.guild) return null;
  const parentId = voiceChannel.parentId;
  const guild = voiceChannel.guild;
  const textInParent = guild.channels.cache.find((c) => c.parentId === parentId && c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me || guild.client.user)?.has('SendMessages'));
  return textInParent || null;
}

async function sendActionLog(guild, logChannelId, { entrant, occupant, channel, reason }) {
  if (!logChannelId) return;
  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('🚫 Restrição de voz aplicada')
    .setColor(0xE74C3C)
    .setTimestamp(new Date())
    .addFields(
      entrant ? { name: 'Entrante', value: `${entrant.user.tag} (${entrant.id})` } : null,
      occupant ? { name: 'Em chamada com restrição', value: `${occupant.user.tag} (${occupant.id})` } : null,
      channel ? { name: 'Canal', value: `<#${channel.id}>` } : null,
      reason ? { name: 'Motivo', value: reason } : null,
    ).toJSON();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

async function notifyChannel(voiceChannel, entrant, occupant) {
  const textChannel = pickTextChannelForVoice(voiceChannel);
  if (!textChannel) return;
  const content = `⛔ ${entrant} foi removido da call por ter restrição com ${occupant}.`;
  await textChannel.send({ content }).catch(() => {});
}

function register(client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      if (newState.member?.user?.bot) return;
      if (oldState.channelId === newState.channelId) return;
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const prisma = client.prisma || getPrisma();
      const cfg = await getVoiceRestrictionsConfig(prisma);
      if (!cfg?.enabled) return;

      const channel = newState.channel;
      if (!channel) return; // saiu da call
      const monitored = (cfg.monitoredChannels || []).includes(channel.id) || (cfg.monitoredCategories || []).includes(channel.parentId);
      if (!monitored) return;

      const entrant = newState.member;
      if (!entrant) return;
      const occupants = channel.members?.filter((m) => m.id !== entrant.id) || [];
      if (!occupants.size) return;

      const match = occupants.find((m) => isRestrictedPair(cfg, entrant.id, m.id));
      if (!match) return;

      await entrant.voice?.disconnect?.().catch(() => {});
      await notifyChannel(channel, entrant, match);
      const pairReason = (cfg.restrictions || []).find((r) => !r.removedAt && ((r.a === entrant.id && r.b === match.id) || (r.a === match.id && r.b === entrant.id)))?.reason;
      await sendActionLog(guild, cfg.actionLogChannelId, { entrant, occupant: match, channel, reason: pairReason });
    } catch (err) {
      console.warn('[voiceRestrictions] erro no voiceStateUpdate', err?.message || err);
    }
  });
}

module.exports = { register };
