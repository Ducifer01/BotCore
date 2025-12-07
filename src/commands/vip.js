const { SlashCommandBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getMembershipByUser } = require('../services/vip');
const { buildVipHomePayload } = require('../features/vipSystem');

module.exports = {
  data: new SlashCommandBuilder().setName('vip').setDescription('Gerencia seu VIP'),
  async execute(interaction) {
    const prisma = getPrisma();
    const membership = await getMembershipByUser(interaction.user.id, prisma);
    if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
      return interaction.reply({ content: 'Você não possui um VIP ativo no momento.', ephemeral: true });
    }

    const payload = buildVipHomePayload(interaction.user, membership);
    await interaction.reply({ ...payload, ephemeral: true });
  },
};
