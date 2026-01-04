const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { ensureGuild } = require('../permissions');

const CUSTOM_IDS = {
  ROOT: 'menu:protections:root',
  // Reservado para módulos futuros.
  SNAPSHOTS: 'menu:protections:snapshots',
};

function isMessageComponent(interaction) {
  return (
    interaction?.isButton?.() ||
    interaction?.isStringSelectMenu?.() ||
    interaction?.isChannelSelectMenu?.() ||
    interaction?.isAnySelectMenu?.()
  );
}

async function ensureDeferred(interaction) {
  if (!interaction?.isRepliable?.()) return;
  if (isMessageComponent(interaction)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
}

async function respondPanel(interaction, payload) {
  if (!interaction?.isRepliable?.()) return;
  if (isMessageComponent(interaction)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    await interaction.editReply(payload).catch(() => {});
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
  }
}

function parseSnapshotSafe(snapshot) {
  if (!snapshot) return null;
  if (typeof snapshot === 'string') {
    try {
      return JSON.parse(snapshot);
    } catch (err) {
      console.warn('[snapshot] Falha ao parsear snapshot salvo:', err?.message || err);
      return null;
    }
  }
  return snapshot;
}

function normalizeOverwriteType(type) {
  if (type === 1 || type === '1' || type === 'member') return 'member';
  if (type === 0 || type === '0' || type === 'role') return 'role';
  return String(type || 'role');
}

function sortOverwrites(overwrites = []) {
  return [...overwrites].sort((a, b) => {
    if (a.id === b.id) return normalizeOverwriteType(a.type).localeCompare(normalizeOverwriteType(b.type));
    return String(a.id).localeCompare(String(b.id));
  });
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    permissionOverwrites: sortOverwrites(
      (snapshot.permissionOverwrites || []).map((ow) => ({
        id: ow.id,
        type: normalizeOverwriteType(ow.type),
        allow: String(ow.allow || '0'),
        deny: String(ow.deny || '0'),
      })),
    ),
  };
}

function snapshotChannel(channel) {
  if (!channel) return null;
  const base = normalizeSnapshot({
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    permissionOverwrites: channel.permissionOverwrites.cache.map((ow) => ({
      id: ow.id,
      type: normalizeOverwriteType(ow.type),
      allow: ow.allow.bitfield.toString(),
      deny: ow.deny.bitfield.toString(),
    })),
  });

  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    base.bitrate = channel.bitrate;
    base.userLimit = channel.userLimit;
    base.rtcRegion = channel.rtcRegion || null;
  }
  return base;
}

function cacheConfig(config) {
  const normalized = normalizeConfig(config);
  runtime.configs.set(normalized.guildId, normalized);
  return normalized;
}

async function loadAndCacheConfig(guildId, prisma) {
  const cfg = await loadConfig(guildId, prisma);
  return cacheConfig(cfg);
}

function hasManagePermission(channel) {
  const me = channel.guild?.members?.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return perms?.has(PermissionsBitField.Flags.ManageChannels, true) || false;
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
      { label: 'Em breve', value: 'coming_soon', description: 'Módulos de proteção serão adicionados depois' },
    ]);
  const row1 = new ActionRowBuilder().addComponents(select);
  const back = new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary);
  const row2 = new ActionRowBuilder().addComponents(back);
  return [row1, row2];
}

async function presentMenu(interaction, ctx) {
  await ensureGuild(interaction.guild);
  const embed = buildRootEmbed();
  const components = buildRootComponents();
  await respondPanel(interaction, { embeds: [embed], components });
  return true;
}
async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (interaction.isStringSelectMenu() && id === CUSTOM_IDS.ROOT) {
    await ensureDeferred(interaction);
    await respondPanel(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('Proteções e Snapshots')
          .setDescription('Ainda não há módulos disponíveis. Em breve adicionaremos novas proteções aqui.')
          .setColor(0x5865f2),
      ],
      components: buildRootComponents(),
    });
    return true;
  }
  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
  CUSTOM_IDS,
};
