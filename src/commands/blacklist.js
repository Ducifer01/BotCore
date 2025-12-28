const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

function buildMainEmbed() {
  return new EmbedBuilder()
    .setTitle('Gerenciar Blacklist')
    .setDescription('Escolha uma opção abaixo para adicionar, remover ou listar usuários na blacklist.')
    .setColor(0x5865F2);
}

function buildMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('blacklist:main:add').setLabel('Add Blacklist').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('blacklist:main:remove').setLabel('Remover Blacklist').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('blacklist:main:list').setLabel('Listar Blacklist').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Gerencie a blacklist do servidor'),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'blacklist'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const embed = buildMainEmbed();
    const components = buildMainComponents();
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  },
};

module.exports.buildMainEmbed = buildMainEmbed;
module.exports.buildMainComponents = buildMainComponents;
