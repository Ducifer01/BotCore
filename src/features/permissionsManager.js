const { ChannelType, OverwriteType } = require('discord.js');
const { CUSTOM_IDS, CUSTOM_ID_PREFIX, buildEmbed, buildComponents } = require('../commands/permissoes');

const sessions = new Map(); // key: interaction.user.id => state

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { destinations: [], lastInteraction: null });
  }
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.delete(userId);
}

const MEMBER_TYPE = OverwriteType?.Member ?? 1;
const ROLE_TYPE = OverwriteType?.Role ?? 0;

function overwriteToData(ow = {}) {
  return {
    id: ow.id,
    type: ow.type === MEMBER_TYPE || ow.type === 'member' ? 'member' : 'role',
    allow: ow.allow?.bitfield ?? ow.allow ?? 0n,
    deny: ow.deny?.bitfield ?? ow.deny ?? 0n,
  };
}

function dataToOverwrite(data) {
  return {
    id: data.id,
    type: data.type === 'member' ? MEMBER_TYPE : ROLE_TYPE,
    allow: BigInt(data.allow || 0),
    deny: BigInt(data.deny || 0),
  };
}

async function updatePanel(interaction, state) {
  const target = state.lastInteraction || interaction;
  const embed = buildEmbed(state);
  const components = buildComponents(state);
  if (target?.editReply) {
    await target.editReply({ embeds: [embed], components }).catch(() => {});
  } else {
    await interaction.followUp({ embeds: [embed], components, ephemeral: true }).catch(() => {});
  }
}

async function loadSourceFromChannel(interaction, channel) {
  if (!channel) return null;
  const overwrites = channel.permissionOverwrites.cache.map(overwriteToData);
  return {
    sourceType: channel.type === ChannelType.GuildCategory ? 'category' : 'channel',
    sourceId: channel.id,
    sourceLabel: `${channel.name} (${channel.type === ChannelType.GuildCategory ? 'Categoria' : 'Canal'})`,
    sourceOverwrites: overwrites,
  };
}

async function handleSourceChannel(interaction) {
  const session = getSession(interaction.user.id);
  const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  // Em vez de pegar o canal atual, vamos pedir seleção via select menu específico? Para simplificar, usamos o canal atual.
  const data = await loadSourceFromChannel(interaction, channel);
  Object.assign(session, data);
  session.lastInteraction = interaction;
  await updatePanel(interaction, session);
}

async function handleSourceCategory(interaction) {
  const session = getSession(interaction.user.id);
  const current = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  const category = current?.parentId ? await interaction.guild.channels.fetch(current.parentId).catch(() => null) : (current?.type === ChannelType.GuildCategory ? current : null);
  if (!category) {
    await interaction.followUp({ content: 'Nenhuma categoria encontrada para usar como fonte.', ephemeral: true }).catch(() => {});
    return true;
  }
  const data = await loadSourceFromChannel(interaction, category);
  Object.assign(session, data);
  session.lastInteraction = interaction;
  await updatePanel(interaction, session);
}

async function handleSourceChannelSelect(interaction) {
  const session = getSession(interaction.user.id);
  const channelId = interaction.values?.[0];
  const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
  const data = await loadSourceFromChannel(interaction, channel);
  if (!data) {
    await interaction.followUp({ content: 'Canal inválido.', ephemeral: true }).catch(() => {});
    return true;
  }
  Object.assign(session, data);
  session.lastInteraction = interaction;
  await updatePanel(interaction, session);
  return true;
}

async function handleDestinationSelect(interaction) {
  const session = getSession(interaction.user.id);
  const values = interaction.values || [];
  session.destinations = values;
  session.lastInteraction = interaction;
  await updatePanel(interaction, session);
}

async function handleApply(interaction) {
  const session = getSession(interaction.user.id);
  if (!session.sourceOverwrites || !session.destinations?.length) {
    await interaction.followUp({ content: 'Defina fonte e destinos antes de aplicar.', ephemeral: true }).catch(() => {});
    return true;
  }
  const overwrites = session.sourceOverwrites.map(dataToOverwrite);
  const results = [];
  for (const destId of session.destinations) {
    const dest = await interaction.guild.channels.fetch(destId).catch(() => null);
    if (!dest) {
      results.push(`❌ <#${destId}> não encontrado.`);
      continue;
    }
    try {
      await dest.permissionOverwrites.set(overwrites);
      results.push(`✅ Permissões aplicadas em <#${dest.id}>`);
    } catch (err) {
      results.push(`❌ Falha em <#${dest.id}>: ${err?.message || err}`);
    }
  }
  await interaction.followUp({ content: results.join('\n'), ephemeral: true }).catch(() => {});
  await updatePanel(interaction, session);
  return true;
}

async function handleInteraction(interaction) {
  const { customId } = interaction;
  if (!customId || !customId.startsWith(CUSTOM_ID_PREFIX)) return false;

  if (interaction.isButton()) {
    await interaction.deferUpdate().catch(() => {});
    if (customId === CUSTOM_IDS.APPLY) {
      return handleApply(interaction);
    }
    if (customId === CUSTOM_IDS.BACK) {
      clearSession(interaction.user.id);
      const session = getSession(interaction.user.id);
      session.lastInteraction = interaction;
      await updatePanel(interaction, session);
      return true;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    if (customId === CUSTOM_IDS.DST_SELECT) {
      return handleDestinationSelect(interaction);
    }
    if (customId === CUSTOM_IDS.SRC_SELECT) {
      return handleSourceChannelSelect(interaction);
    }
  }

  return false;
}

module.exports = {
  handleInteraction,
};
