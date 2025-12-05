const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { runRemoveCastigo } = require('../actions/moderationActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removercastigo')
    .setDescription('Remover o timeout de um membro')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário para remover castigo').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da remoção do castigo').setRequired(false)),
  async execute(interaction) {
    const prisma = getPrisma();
    const member = interaction.options.getMember('usuario');
    const motivo = interaction.options.getString('motivo');
    const posseId = String(process.env.POSSE_USER_ID || '').trim();
    if (!member) {
      await interaction.reply({ content: 'Usuário precisa estar no servidor.', ephemeral: true });
      return;
    }
    try {
      const result = await runRemoveCastigo({
        guild: interaction.guild,
        moderatorMember: interaction.member,
        targetMember: member,
        reason: motivo,
        prisma,
        posseId,
      });
      await interaction.reply({ content: result.message, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `Erro: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  },
};
