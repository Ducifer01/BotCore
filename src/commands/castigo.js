const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { runCastigo } = require('../actions/moderationActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('castigo')
    .setDescription('Aplicar timeout em um membro com motivo e duração')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário a receber castigo').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do castigo').setRequired(true))
    .addStringOption((opt) => opt.setName('tempo').setDescription('Duração (ex: 10m, 1h, 1d)').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const member = interaction.options.getMember('usuario');
    const motivo = interaction.options.getString('motivo', true);
    const tempo = interaction.options.getString('tempo', true);
    const posseId = String(process.env.POSSE_USER_ID || '').trim();
    if (!member) {
      await interaction.reply({ content: 'Usuário precisa estar no servidor para receber castigo.', ephemeral: true });
      return;
    }
    try {
      const result = await runCastigo({
        guild: interaction.guild,
        moderatorMember: interaction.member,
        targetMember: member,
        reason: motivo,
        durationInput: tempo,
        prisma,
        posseId,
      });
      await interaction.reply({ content: result.message, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `Erro: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  },
};
