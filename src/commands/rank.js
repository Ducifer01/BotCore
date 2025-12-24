const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, getTopBalances, toBigInt } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Exibe o top 10 de pontos (ephemeral)'),
  async execute(interaction) {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const top = await getTopBalances(prisma, cfg, interaction.guildId, 10);
    const embed = new EmbedBuilder().setTitle('Top 10 - Pontos').setColor(0x00b0f4).setTimestamp(new Date());
    if (!top.length) {
      embed.setDescription('Nenhum ponto registrado ainda.');
    } else {
      const lines = top.map((bal, idx) => {
        const pos = idx + 1;
        const member = interaction.guild.members.cache.get(bal.userId);
        const mention = member ? member.toString() : `<@${bal.userId}>`;
        return `**${pos}.** ${mention} — **${toBigInt(bal.points)}**`;
      });
      embed.setDescription(lines.join('\n'));
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
