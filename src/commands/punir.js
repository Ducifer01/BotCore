const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, setFrozen, sendLog } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('punir')
    .setDescription('Congela os pontos de um usuário por X dias (0 = permanente)')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
    .addIntegerOption((opt) => opt.setName('dias').setDescription('Dias de punição (0 = permanente)').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo').setRequired(false)),
  async execute(interaction) {
    const prisma = getPrisma();
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    }
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario', true);
    const dias = interaction.options.getInteger('dias', true);
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
    const expiresAt = dias > 0 ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;
    await setFrozen(prisma, cfg, { guildId: interaction.guildId, userId: targetUser.id, expiresAt, reason: motivo, moderatorId: interaction.user.id, commandChannelId: interaction.channelId });
    await interaction.reply({ content: `${targetUser} punido. ${dias === 0 ? 'Permanente' : `${dias} dia(s)`}. Motivo: ${motivo}`, ephemeral: true });
    await sendLog(interaction.client, cfg.logsAdminChannelId, {
      embeds: [
        {
          title: 'Punição aplicada',
          description: `${interaction.user} puniu ${targetUser} por ${dias === 0 ? 'tempo indeterminado' : `${dias} dia(s)`}. Motivo: ${motivo}`,
          color: 0xe74c3c,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    await sendLog(interaction.client, cfg.logsUsuariosChannelId, {
      embeds: [
        {
          title: 'Punição aplicada',
          description: `${targetUser} não ganhará pontos ${dias === 0 ? 'até remover a punição' : `pelos próximos ${dias} dia(s)`}. Motivo: ${motivo}`,
          color: 0xe74c3c,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  },
};
