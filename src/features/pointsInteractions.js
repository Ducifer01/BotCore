const { resetAllPoints, ensurePointsConfig, getPointsConfig, sendLog } = require('../services/points');
const { getPrisma } = require('../db');

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;
  if (!customId?.startsWith('points:')) return false;
  await interaction.deferUpdate().catch(() => {});
  const parts = customId.split(':');
  const action = parts[1];
  const targetUserId = parts[3];
  if (targetUserId && targetUserId !== interaction.user.id) {
    await interaction.followUp({ content: 'Apenas quem iniciou a ação pode confirmá-la.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (action === 'reset') {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    if (parts[2] === 'confirm') {
      await resetAllPoints(prisma, cfg, interaction.user.id);
      await interaction.editReply({ content: 'Pontos resetados com sucesso.', embeds: [], components: [] }).catch(() => {});
      await sendLog(interaction.client, cfg.logsAdminChannelId, {
        embeds: [
          {
            title: 'Reset de pontos',
            description: `${interaction.user} resetou todos os pontos.`,
            color: 0xe67e22,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      return true;
    }
    if (parts[2] === 'cancel') {
      await interaction.editReply({ content: 'Reset cancelado.', embeds: [], components: [] }).catch(() => {});
      return true;
    }
  }
  return false;
}

module.exports = { handleInteraction };
