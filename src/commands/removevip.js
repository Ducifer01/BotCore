const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getMembershipByUser, unshareVipTag } = require('../services/vip');

const SUCCESS_COLOR = 0xffffff;
const ERROR_COLOR = 0xff4d4d;

function buildEmbed(message, isError = false) {
  return new EmbedBuilder().setColor(isError ? ERROR_COLOR : SUCCESS_COLOR).setDescription(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removevip')
    .setDescription('Remove sua tag VIP de alguém')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Quem deve perder a tag').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const target = interaction.options.getUser('usuario', true);
    if (target.bot) {
      return interaction.reply({ embeds: [buildEmbed('Bots não possuem tag para remover.', true)], ephemeral: true });
    }

    const membership = await getMembershipByUser(interaction.user.id, prisma);
    if (!membership || !membership.active || membership.guildId !== interaction.guildId || !membership.tag?.roleId) {
      return interaction.reply({ embeds: [buildEmbed('Você não possui um VIP/tag ativos.', true)], ephemeral: true });
    }

    const memberTarget = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!memberTarget) {
      return interaction.reply({ embeds: [buildEmbed('Usuário não encontrado na guild.', true)], ephemeral: true });
    }

    const role = interaction.guild.roles.cache.get(membership.tag.roleId) || (await interaction.guild.roles.fetch(membership.tag.roleId).catch(() => null));
    if (role) {
      await memberTarget.roles.remove(role).catch(() => {});
    }

    if (membership.tag.id) {
      await unshareVipTag(membership.tag.id, target.id, prisma).catch(() => {});
    }

    await interaction.reply({ embeds: [buildEmbed(`${target} não possui mais sua tag VIP.`)], ephemeral: true });
  },
};
