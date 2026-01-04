const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig, recordTransaction, ensureBalance, toBigInt, sendLog, checkBioKeyword } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adicionar_pontos')
    .setDescription('Adiciona pontos a um usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantidade').setDescription('Quantidade de pontos').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Você não tem permissão para usar esse comando. Ele está aqui para corrigir possíveis bugs ou erros na pontuação.', ephemeral: true });
    }
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario', true);
    const qty = interaction.options.getInteger('quantidade', true);
    const amount = toBigInt(qty);
    if (amount > 0n) {
      const bioStatus = await checkBioKeyword({ prisma, pointsCfg: cfg, userId: targetUser.id });
      if (bioStatus.active && !bioStatus.allowed) {
        await interaction.reply({ content: `Não foi possível adicionar pontos. O usuário precisa ter a palavra-chave ${bioStatus.keyword ? `"${bioStatus.keyword}"` : '(defina a palavra-chave)'} no perfil.`, ephemeral: true });
        return;
      }
    }
    await recordTransaction(prisma, cfg, {
      guildId: interaction.guildId,
      userId: targetUser.id,
      amount,
      type: 'ADMIN_ADD',
      source: 'ADMIN',
      reason: 'Ajuste manual',
      actorId: interaction.user.id,
    });
    const balance = await ensureBalance(prisma, cfg, interaction.guildId, targetUser.id);
    await interaction.reply({ content: `Adicionado **${amount}** pontos para ${targetUser}. Total: **${toBigInt(balance.points)}**`, ephemeral: true });
    await sendLog(interaction.client, cfg.logsAdminChannelId, {
      embeds: [
        {
          title: 'Pontos adicionados manualmente',
          description: `${interaction.user} adicionou **${amount}** pontos para ${targetUser} (total: **${toBigInt(balance.points)}**).`,
          timestamp: new Date().toISOString(),
          color: 0x2ecc71,
        },
      ],
    });
  },
};
