const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getMembershipByUser, upsertChannelPermission } = require('../services/vip');

const SUCCESS_COLOR = 0xffffff;
const ERROR_COLOR = 0xff4d4d;

function buildEmbed(message, isError = false) {
  return new EmbedBuilder().setColor(isError ? ERROR_COLOR : SUCCESS_COLOR).setDescription(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addvipc')
    .setDescription('Concede acesso ao seu canal VIP')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Quem deve receber acesso').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const target = interaction.options.getUser('usuario', true);
    if (target.bot) {
      return interaction.reply({ embeds: [buildEmbed('Bots não podem usar seu canal.', true)], ephemeral: true });
    }

    const membership = await getMembershipByUser(interaction.user.id, prisma);
    if (!membership?.active || membership.guildId !== interaction.guildId || !membership.channel?.channelId) {
      return interaction.reply({ embeds: [buildEmbed('Crie seu canal VIP primeiro usando /vip > Editar canal.', true)], ephemeral: true });
    }

    const channel = interaction.guild.channels.cache.get(membership.channel.channelId) || (await interaction.guild.channels.fetch(membership.channel.channelId).catch(() => null));
    if (!channel) {
      return interaction.reply({ embeds: [buildEmbed('Não encontrei seu canal VIP. Use a opção Desbugar no painel /vip.', true)], ephemeral: true });
    }

    const memberTarget = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!memberTarget) {
      return interaction.reply({ embeds: [buildEmbed('Usuário não encontrado na guild.', true)], ephemeral: true });
    }

    await channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      Connect: true,
    }).catch(() => {});

    if (membership.channel.id) {
      await upsertChannelPermission(membership.channel.id, target.id, { allowView: true, allowConnect: true, createdById: interaction.user.id }, prisma);
    }

    await interaction.reply({ embeds: [buildEmbed(`${target} pode ver e entrar no seu canal VIP.`)], ephemeral: true });
  },
};
