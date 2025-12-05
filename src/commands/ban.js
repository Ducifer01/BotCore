const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { runBan } = require('../actions/moderationActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banir um membro com motivo registrado')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário a ser banido').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do ban').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const targetUser = interaction.options.getUser('usuario', true);
    const motivo = interaction.options.getString('motivo', true);
    const posseId = String(process.env.POSSE_USER_ID || '').trim();
    try {
      const result = await runBan({
        guild: interaction.guild,
        moderatorMember: interaction.member,
        targetUser,
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
