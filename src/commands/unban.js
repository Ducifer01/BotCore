const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { runUnban } = require('../actions/moderationActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remover o banimento de um usuário pelo ID')
    .addStringOption((opt) =>
      opt.setName('usuario')
        .setDescription('ID do usuário (ou menção)')
        .setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da remoção do ban').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const rawTarget = interaction.options.getString('usuario', true);
    const motivo = interaction.options.getString('motivo', true);
    const posseId = String(process.env.POSSE_USER_ID || '').trim();
    const targetId = extractId(rawTarget);
    if (!targetId) {
      await interaction.reply({ content: 'Forneça um ID ou menção válido.', ephemeral: true });
      return;
    }
    try {
      const result = await runUnban({
        guild: interaction.guild,
        moderatorMember: interaction.member,
        targetUserId: targetId,
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

function extractId(value) {
  const match = String(value).match(/\d{5,}/);
  return match ? match[0] : null;
}
