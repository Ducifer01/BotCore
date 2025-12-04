const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_insta')
    .setDescription('Reseta os canais de insta (boys e girls) e anuncia o ganhador da semana.'),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'reset_insta'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const embed = new EmbedBuilder().setTitle('Tem certeza?').setDescription('Isso vai limpar os posts dos canais de insta e anunciar o ganhador de cada canal.').setColor(0xE74C3C);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reset:confirm:${interaction.user.id}`).setLabel('Sim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('reset:cancel').setLabel('Não').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};
