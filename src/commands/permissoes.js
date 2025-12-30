const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { checkAccess } = require('../permissions');

const CUSTOM_ID_PREFIX = 'perm:';
const CUSTOM_IDS = {
  SRC_SELECT: 'perm:src:select',
  DST_SELECT: 'perm:dst',
  APPLY: 'perm:apply',
  BACK: 'perm:back',
};

function buildEmbed(state = {}) {
  const embed = new EmbedBuilder()
    .setTitle('Gerenciar permissões')
    .setColor(0x5865f2)
    .setDescription('Escolha uma fonte e destinos para aplicar permissões.');

  const lines = [];
  lines.push(`Fonte: ${state.sourceLabel || '—'}`);
  lines.push(`Destinos: ${state.destinations?.length || 0}`);
  embed.addFields({ name: 'Resumo', value: lines.join('\n') });
  return embed;
}

function buildComponents(state = {}) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK).setLabel('Limpar').setStyle(ButtonStyle.Danger),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.SRC_SELECT)
      .setPlaceholder('Selecione a fonte (canal ou categoria)')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildCategory,
        ChannelType.GuildForum,
        ChannelType.GuildStageVoice
      )
      .setMinValues(1)
      .setMaxValues(1)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.DST_SELECT)
      .setPlaceholder('Selecione destinos (canais ou categorias)')
      .setMinValues(1)
      .setMaxValues(25)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.APPLY).setLabel('Aplicar').setStyle(ButtonStyle.Success).setDisabled(!state.sourceOverwrites || !state.destinations?.length),
  ));

  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('permissoes')
    .setDescription('Gerenciar permissões: copiar e aplicar'),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'permissoes'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const state = {};
    const embed = buildEmbed(state);
    const components = buildComponents(state);
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  },
  CUSTOM_IDS,
  CUSTOM_ID_PREFIX,
  buildEmbed,
  buildComponents,
};
