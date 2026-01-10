const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, toBigInt } = require('../services/points');

const PAGE_SIZE = 10;
const MAX_PAGES = 5;

function buildPageEmbed(txs, page) {
  const lines = txs.map((tx) => {
    const amt = toBigInt(tx.amount || 0n);
    const sign = amt >= 0n ? '+' : '-';
    const abs = amt < 0n ? -amt : amt;
    const when = Math.floor(new Date(tx.createdAt).getTime() / 1000);
    return `${sign}${abs} (${tx.type || 'N/A'}) — ${tx.reason || 'Sem motivo'} — <t:${when}:R>`;
  });

  return new EmbedBuilder()
    .setTitle('Histórico de pontos')
    .setColor(0x5865f2)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Página ${page}` })
    .setTimestamp(new Date());
}

function buildButtons(current, total) {
  const prev = new ButtonBuilder().setCustomId('hist:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(current <= 1);
  const next = new ButtonBuilder().setCustomId('hist:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(current >= total);
  return [new ActionRowBuilder().addComponents(prev, next)];
}

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
      take: PAGE_SIZE * MAX_PAGES,
    });

    if (!txs.length) {
      return interaction.reply({ content: 'Nenhum histórico de pontos encontrado.', ephemeral: true });
    }

    const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));
    let page = 1;

    const msg = await interaction.reply({
      embeds: [buildPageEmbed(txs.slice(0, PAGE_SIZE), page)],
      components: buildButtons(page, totalPages),
      ephemeral: true,
      fetchReply: true,
    });

    const collector = interaction.channel?.createMessageComponentCollector({
      time: 2 * 60_000,
      filter: (i) => i.user.id === interaction.user.id && i.message?.id === msg.id,
    });

    collector?.on('collect', async (i) => {
      await i.deferUpdate().catch(() => {});
      if (i.customId === 'hist:prev' && page > 1) {
        page -= 1;
      }
      if (i.customId === 'hist:next' && page < totalPages) {
        page += 1;
      }
      await interaction.editReply({
        embeds: [buildPageEmbed(txs.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE), page)],
        components: buildButtons(page, totalPages),
      }).catch(() => {});
    });

    collector?.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
