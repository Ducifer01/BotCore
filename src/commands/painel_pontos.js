const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, getTopBalances, toBigInt } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel_pontos')
    .setDescription('Cria ou atualiza o painel de leaderboard de pontos')
    .addChannelOption((opt) => opt.setName('canal').setDescription('Canal para publicar o painel').setRequired(true))
    .addIntegerOption((opt) => opt.setName('refresh_minutos').setDescription('Minutos entre atualizações automáticas').setRequired(false)),
  async execute(interaction) {
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    }
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const channel = interaction.options.getChannel('canal', true);
    if (!channel.isTextBased()) {
      return interaction.reply({ content: 'Escolha um canal de texto.', ephemeral: true });
    }
    const refresh = interaction.options.getInteger('refresh_minutos') || cfg.leaderboardRefreshMinutes || 10;
    const existing = await prisma.pointsLeaderboardPanel.findFirst({ where: { guildId: interaction.guildId, channelId: channel.id, globalConfigId: cfg.globalConfigId || cfg.id } });
    let panel = existing;
    if (existing) {
      await prisma.pointsLeaderboardPanel.update({ where: { id: existing.id }, data: { refreshMinutes: refresh, isActive: true } });
      panel = existing;
    } else {
      panel = await prisma.pointsLeaderboardPanel.create({
        data: {
          globalConfigId: cfg.globalConfigId || cfg.id,
          guildId: interaction.guildId,
          channelId: channel.id,
          refreshMinutes: refresh,
          isActive: true,
        },
      });
      // Envia imediatamente o painel inicial ao criar um novo registro
      const top = await getTopBalances(prisma, cfg, interaction.guildId, 20);
      const embed = new EmbedBuilder()
        .setTitle('Leaderboard de Pontos')
        .setColor(0x00b0f4)
        .setTimestamp(new Date())
        .setFooter({ text: `Painel atualizará a cada ${refresh} min` })
        .setDescription(top.length
          ? top
              .map((bal, idx) => `**${idx + 1}.** <@${bal.userId}> — **${toBigInt(bal.points)}** pts`)
              .join('\n')
          : 'Nenhum dado ainda.');
      const sent = await channel.send({ embeds: [embed] }).catch(() => null);
      if (sent) {
        await prisma.pointsLeaderboardPanel.update({ where: { id: panel.id }, data: { messageId: sent.id, lastRefreshAt: new Date() } });
      }
    }
    await interaction.reply({ content: `Painel registrado em ${channel}. Atualização automática a cada ${refresh} min.`, ephemeral: true });
  },
};
