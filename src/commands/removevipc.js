const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getMembershipByUser, deleteChannelPermission } = require('../services/vip');

const SUCCESS_COLOR = 0xffffff;
const ERROR_COLOR = 0xff4d4d;

function buildEmbed(message, isError = false) {
  return new EmbedBuilder().setColor(isError ? ERROR_COLOR : SUCCESS_COLOR).setDescription(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removevipc')
    .setDescription('Remove acesso ao seu canal VIP')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Quem perderá o acesso').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const target = interaction.options.getUser('usuario', true);
    const membership = await getMembershipByUser(interaction.user.id, prisma);
    if (!membership?.active || membership.guildId !== interaction.guildId || !membership.channel?.channelId) {
      return interaction.reply({ embeds: [buildEmbed('Você não possui um canal VIP configurado.', true)], ephemeral: true });
    }

    const channel = interaction.guild.channels.cache.get(membership.channel.channelId) || (await interaction.guild.channels.fetch(membership.channel.channelId).catch(() => null));
    if (!channel) {
      return interaction.reply({ embeds: [buildEmbed('Canal VIP não encontrado. Use a opção Desbugar.', true)], ephemeral: true });
    }

    await channel.permissionOverwrites.delete(target.id).catch(() => {});
    if (membership.channel.id) {
      await deleteChannelPermission(membership.channel.id, target.id, prisma).catch(() => {});
    }

    await interaction.reply({ embeds: [buildEmbed(`${target} não pode mais acessar seu canal VIP.`)], ephemeral: true });
  },
};
