const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetar_pontos')
    .setDescription('Reseta todos os pontos (confirmação necessária)'),
  async execute(interaction) {
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle('Confirmar reset de pontos')
      .setDescription('Esta ação irá zerar os pontos de todos os usuários. Deseja continuar?')
      .setColor(0xe67e22)
      .setTimestamp(new Date());
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`points:reset:confirm:${interaction.user.id}`).setLabel('Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`points:reset:cancel:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
