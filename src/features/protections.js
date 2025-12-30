const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { loadConfig, setEnabled, setWaitForEmpty, setTargets } = require('../services/snapshots');
const { ensureGuild } = require('../permissions');

const CUSTOM_IDS = {
  ROOT: 'menu:protections:root',
  SNAPSHOTS: 'menu:protections:snapshots',
  SNAPSHOTS_TOGGLE: 'menu:protections:snapshots:toggle',
  SNAPSHOTS_WAIT_TOGGLE: 'menu:protections:snapshots:wait',
  SNAPSHOTS_CHANNELS: 'menu:protections:snapshots:channels',
};

const SNAPSHOT_COLOR = 0x00b8d9;
const SNAPSHOT_WARN_COLOR = 0xf1c40f;
const SNAPSHOT_ALERT_COLOR = 0xe74c3c;

const runtime = {
  configs: new Map(), // guildId -> config
  pendingRestore: new Map(), // channelId -> timeout
  restoring: new Set(),
};

function snapshotChannel(channel) {
  if (!channel) return null;
  const base = {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    permissionOverwrites: channel.permissionOverwrites.cache.map((ow) => ({
      id: ow.id,
      type: ow.type,
      allow: ow.allow.bitfield.toString(),
      deny: ow.deny.bitfield.toString(),
    })),
  };
  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    base.bitrate = channel.bitrate;
    base.userLimit = channel.userLimit;
    base.rtcRegion = channel.rtcRegion;
  }
  return base;
}

async function restoreChannel(channel, snapshot) {
  if (!channel || !snapshot) return;
  runtime.restoring.add(channel.id);
  try {
    if (snapshot.name && channel.editable) {
      await channel.edit({
        name: snapshot.name,
        parent: snapshot.parentId || null,
        bitrate: snapshot.bitrate,
        userLimit: snapshot.userLimit,
        rtcRegion: snapshot.rtcRegion,
      }).catch(() => {});
    }
    if (snapshot.permissionOverwrites) {
      const data = snapshot.permissionOverwrites.map((ow) => ({
        id: ow.id,
        type: ow.type,
        allow: BigInt(ow.allow || '0'),
        deny: BigInt(ow.deny || '0'),
      }));
      await channel.permissionOverwrites.set(data).catch(() => {});
    }
  } finally {
    runtime.restoring.delete(channel.id);
  }
}

function buildRootEmbed() {
  return new EmbedBuilder()
    .setTitle('Proteções e Snapshots')
    .setDescription('Escolha um sistema de proteção para configurar.')
    .setColor(0x5865f2);
}

function buildRootComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.ROOT)
    .setPlaceholder('Selecione uma proteção')
    .addOptions([
      { label: 'Snapshots de canais', value: 'snapshots', description: 'Protege canais e categorias com rollback' },
    ]);
  const row1 = new ActionRowBuilder().addComponents(select);
  const back = new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary);
  const row2 = new ActionRowBuilder().addComponents(back);
  return [row1, row2];
}

function buildSnapshotsEmbed(config) {
  const embed = new EmbedBuilder()
    .setTitle('Snapshots de canais')
    .setColor(SNAPSHOT_COLOR)
    .setDescription('Ative o sistema para fazer rollback automático de canais/categorias selecionados.');
  embed.addFields(
    { name: 'Status', value: config.enabled ? '✅ Ativo' : '⏸️ Desativado', inline: true },
    { name: 'Aguardar canal vazio', value: config.waitForEmpty ? '✅ Sim' : '❌ Não', inline: true },
    { name: 'Alvos', value: config.targets?.length ? config.targets.map((t) => `<#${t.channelId}>`).join(', ') : '—' },
  );
  return embed;
}

function buildSnapshotsComponents(config) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.SNAPSHOTS_TOGGLE)
      .setLabel(config.enabled ? 'Desativar snapshots' : 'Ativar snapshots')
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.SNAPSHOTS_WAIT_TOGGLE)
      .setLabel(config.waitForEmpty ? 'Rollback ao esvaziar' : 'Rollback imediato')
      .setStyle(ButtonStyle.Secondary),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.SNAPSHOTS_CHANNELS)
      .setPlaceholder('Selecione canais/categorias protegidos')
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(25)
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

async function presentMenu(interaction, ctx) {
  await ensureGuild(interaction.guild);
  const embed = buildRootEmbed();
  const components = buildRootComponents();
  const payload = { embeds: [embed], components }; 
  if (interaction.isRepliable() && !interaction.deferred && !interaction.replied) {
    await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
  } else if (interaction.isRepliable() && interaction.deferred) {
    await interaction.editReply(payload).catch(() => {});
  } else if (typeof interaction.update === 'function') {
    await interaction.update(payload).catch(() => {});
  }
  return true;
}

async function handleRootSelect(interaction) {
  const choice = interaction.values?.[0];
  if (choice !== 'snapshots') return false;
  const config = await loadConfig(interaction.guildId, interaction.client.prisma);
  runtime.configs.set(interaction.guildId, config);
  const payload = { embeds: [buildSnapshotsEmbed(config)], components: buildSnapshotsComponents(config) };
  if (interaction.deferred) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.update(payload).catch(() => {});
  }
  return true;
}

async function handleToggle(interaction) {
  const config = await loadConfig(interaction.guildId, interaction.client.prisma);
  const enabled = !config.enabled;
  const updated = await setEnabled(interaction.guildId, enabled, interaction.client.prisma);
  runtime.configs.set(interaction.guildId, updated);
  await interaction.update({ embeds: [buildSnapshotsEmbed(updated)], components: buildSnapshotsComponents(updated) }).catch(() => {});
  return true;
}

async function handleWaitToggle(interaction) {
  const config = await loadConfig(interaction.guildId, interaction.client.prisma);
  const updated = await setWaitForEmpty(interaction.guildId, !config.waitForEmpty, interaction.client.prisma);
  runtime.configs.set(interaction.guildId, updated);
  await interaction.update({ embeds: [buildSnapshotsEmbed(updated)], components: buildSnapshotsComponents(updated) }).catch(() => {});
  return true;
}

async function handleChannelsSelect(interaction) {
  const channelIds = interaction.values || [];
  const guild = interaction.guild;
  const snapshots = [];
  for (const id of channelIds) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch) continue;
    const snap = snapshotChannel(ch);
    if (snap) {
      snapshots.push({ channelId: id, channelType: ch.type, snapshot: snap });
    }
  }
  const updated = await setTargets(interaction.guildId, snapshots, interaction.client.prisma);
  runtime.configs.set(interaction.guildId, updated);
  await interaction.update({ embeds: [buildSnapshotsEmbed(updated)], components: buildSnapshotsComponents(updated) }).catch(() => {});
  return true;
}

function buildInfoEmbed(description, color = SNAPSHOT_COLOR) {
  return new EmbedBuilder().setTitle('Sistema de Snapshot').setDescription(description).setColor(color);
}

async function notifyChannel(channel, description, color) {
  if (!channel || !channel.send) return;
  await channel.send({ embeds: [buildInfoEmbed(description, color)] }).catch(() => {});
}

async function handleChannelUpdate(oldChannel, newChannel) {
  const cfg = runtime.configs.get(newChannel.guildId);
  if (!cfg?.enabled || runtime.restoring.has(newChannel.id)) return;
  const target = cfg.targets?.find((t) => t.channelId === newChannel.id);
  if (!target) return;
  const snapshot = target.snapshot;
  const isVoice = newChannel.type === ChannelType.GuildVoice || newChannel.type === ChannelType.GuildStageVoice;

  if (cfg.waitForEmpty && isVoice && newChannel.members.size > 0) {
    await notifyChannel(newChannel, 'Snapshot ativo: assim que a call esvaziar eu restauro as configurações.', SNAPSHOT_WARN_COLOR);
    runtime.pendingRestore.set(newChannel.id, snapshot);
    return;
  }

  await notifyChannel(newChannel, 'Snapshot ativo: voltando o canal ao estado original agora.', SNAPSHOT_ALERT_COLOR);
  await restoreChannel(newChannel, snapshot);
}

async function handleVoiceStateUpdate(oldState, newState) {
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;
  const cfg = runtime.configs.get(guildId);
  if (!cfg?.enabled) return;
  const channel = newState.channel || oldState.channel;
  if (!channel) return;
  if (!runtime.pendingRestore.has(channel.id)) return;
  if (channel.members.size > 0) return;
  const snapshot = runtime.pendingRestore.get(channel.id);
  await notifyChannel(channel, 'Restaurando as configurações deste canal em 5s...', SNAPSHOT_WARN_COLOR);
  setTimeout(async () => {
    await restoreChannel(channel, snapshot);
    runtime.pendingRestore.delete(channel.id);
  }, 5000);
}

async function preloadConfigs(client) {
  try {
    const prisma = client.prisma;
    const configs = await prisma.snapshotConfig.findMany({ include: { targets: true } });
    for (const cfg of configs) {
      runtime.configs.set(cfg.guildId, cfg);
    }
  } catch (err) {
    console.warn('[snapshot] Falha ao carregar configs:', err?.message || err);
  }
}

function registerSnapshotFeature(client) {
  client.once('ready', async () => {
    await preloadConfigs(client);
  });
  client.on('channelUpdate', handleChannelUpdate);
  client.on('voiceStateUpdate', handleVoiceStateUpdate);
}

async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (interaction.isStringSelectMenu() && id === CUSTOM_IDS.ROOT) {
    return handleRootSelect(interaction);
  }
  if (interaction.isButton() && id === CUSTOM_IDS.SNAPSHOTS_TOGGLE) {
    return handleToggle(interaction);
  }
  if (interaction.isButton() && id === CUSTOM_IDS.SNAPSHOTS_WAIT_TOGGLE) {
    return handleWaitToggle(interaction);
  }
  if (interaction.isChannelSelectMenu() && id === CUSTOM_IDS.SNAPSHOTS_CHANNELS) {
    return handleChannelsSelect(interaction);
  }
  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
  registerSnapshotFeature,
  CUSTOM_IDS,
};
