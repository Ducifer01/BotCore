const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, toBigInt } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('historico_pontos')
    .setDescription('Mostra seu histórico recente de pontos'),
  async execute(interaction) {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const txs = await prisma.pointsTransaction.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    if (!txs.length) {
      return interaction.reply({ content: 'Nenhum histórico de pontos encontrado.', ephemeral: true });
    }

    const lines = txs.map((tx) => {
      const amt = toBigInt(tx.amount || 0n);
      const sign = amt >= 0n ? '+' : '-';
      const abs = amt < 0n ? -amt : amt;
      const when = Math.floor(new Date(tx.createdAt).getTime() / 1000);
      return `${sign}${abs} (${tx.type || 'N/A'}) — ${tx.reason || 'Sem motivo'} — <t:${when}:R>`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Histórico de pontos (últimos 15)')
      .setColor(0x5865f2)
      .setDescription(lines.join('\n'))
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
