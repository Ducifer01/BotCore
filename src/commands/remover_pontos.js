const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, recordTransaction, ensureBalance, toBigInt, sendLog } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remover_pontos')
    .setDescription('Remove pontos de um usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantidade').setDescription('Quantidade de pontos').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da remoção').setRequired(false)),
  async execute(interaction) {
    const prisma = getPrisma();
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    }
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario', true);
    const qty = interaction.options.getInteger('quantidade', true);
    const motivo = interaction.options.getString('motivo') || null;
    const amount = toBigInt(qty) * -1n;
    await recordTransaction(prisma, cfg, {
      guildId: interaction.guildId,
      userId: targetUser.id,
      amount,
      type: 'ADMIN_REMOVE',
      source: 'ADMIN',
      reason: motivo || 'Ajuste manual',
      actorId: interaction.user.id,
    });
    const balance = await ensureBalance(prisma, cfg, interaction.guildId, targetUser.id);
    // create immutable points log entry
    try {
      await prisma.pointsLog.create({
        data: {
          globalConfigId: cfg.globalConfigId || cfg.id,
          guildId: interaction.guildId,
          userId: targetUser.id,
          change: amount,
          totalAfter: toBigInt(balance.points || 0n),
          actorId: interaction.user.id,
          motivo,
        },
      });
    } catch (err) {
      console.warn('[points] falha ao gravar PointsLog (remove)', err?.message || err);
    }
    await interaction.reply({ content: `Removido **${toBigInt(qty)}** pontos de ${targetUser}. Total: **${toBigInt(balance.points)}**`, ephemeral: true });
    await sendLog(interaction.client, cfg.logsAdminChannelId, {
      embeds: [
        {
          title: 'Pontos removidos (manual)',
          description: `${interaction.user} removeu **${toBigInt(qty)}** pontos de ${targetUser} (total: **${toBigInt(balance.points)}**).`,
          fields: motivo ? [{ name: 'Motivo', value: motivo }] : undefined,
          timestamp: new Date().toISOString(),
          color: 0xe74c3c,
        },
      ],
    });
  },
};
