const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, liftPunishment, sendLog } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('despunir')
    .setDescription('Remove a punição de pontos de um usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Você não tem permissão para usar esse comando.', ephemeral: true });
    }
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario', true);
    await liftPunishment(prisma, cfg, { guildId: interaction.guildId, userId: targetUser.id });
    await interaction.reply({ content: `Punição removida de ${targetUser}.`, ephemeral: true });
    await sendLog(interaction.client, cfg.logsAdminChannelId, {
      embeds: [
        {
          title: 'Punição removida',
          description: `${interaction.user} removeu a punição de ${targetUser}.`,
          color: 0x2ecc71,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    await sendLog(interaction.client, cfg.logsUsuariosChannelId, {
      embeds: [
        {
          title: 'Punição removida',
          description: `${targetUser} voltou a ganhar pontos.`,
          color: 0x2ecc71,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  },
};
