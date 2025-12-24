const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editar_cargo')
    .setDescription('Abre painel para editar nome/emoji de um cargo'),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'editar_cargo'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const prompt = new EmbedBuilder()
      .setTitle('Editar Cargo')
      .setDescription('Selecione o cargo que deseja editar usando o menu abaixo.')
      .setColor(0x5865F2);
    const select = new RoleSelectMenuBuilder()
      .setCustomId('role-edit:select')
      .setPlaceholder('Selecione um cargo')
      .setMinValues(1)
      .setMaxValues(1);
    const rows = [new ActionRowBuilder().addComponents(select)];
    await interaction.reply({ embeds: [prompt], components: rows, ephemeral: true });
  }
};
