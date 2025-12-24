const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getPointsConfig, ensurePointsConfig, ensureBalance, toBigInt } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pontos')
    .setDescription('Mostra seus pontos ou de outro usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(false)),
  async execute(interaction) {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const balance = await ensureBalance(prisma, cfg, interaction.guildId, targetUser.id);
    const pts = toBigInt(balance.points || 0n);
    const mention = targetUser.id === interaction.user.id ? 'Você tem' : `${targetUser} tem`;
    await interaction.reply({ content: `${mention} **${pts}** pontos.`, ephemeral: true });
  },
};
