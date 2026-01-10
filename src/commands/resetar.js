const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetar_insta')
    .setDescription('Executar ações de reset')
    .addSubcommand((sub) => sub
      .setName('insta')
      .setDescription('Abrir confirmação para resetar os canais de Insta')
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'insta') {
      await interaction.reply({ content: 'Subcomando inválido.', ephemeral: true });
      return;
    }

    // Gate por "Permissões de Comandos"
  const allowed = await checkAccess(interaction, 'resetar_insta');
    if (!allowed) {
      await interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
      return;
    }

    // Monta o mesmo embed e botões usados no menu de Insta
    const embed = new EmbedBuilder()
      .setTitle('Resetar canais de Insta')
      .setDescription('Isso vai anunciar o ganhador da semana e limpar todos os posts de InstaBoy/InstaGirl. Deseja continuar?')
      .setColor(0xE74C3C);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`menu:insta:reset:confirm:${interaction.user.id}:slash`).setLabel('Sim, resetar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu:insta:reset:cancel:slash').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
