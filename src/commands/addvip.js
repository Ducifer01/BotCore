const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getMembershipByUser, shareVipTag } = require('../services/vip');
const { getVipConfig } = require('../services/vip');

const SUCCESS_COLOR = 0xffffff;
const ERROR_COLOR = 0xff4d4d;

function buildEmbed(message, isError = false) {
  return new EmbedBuilder().setColor(isError ? ERROR_COLOR : SUCCESS_COLOR).setDescription(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addvip')
    .setDescription('Concede sua tag VIP a alguém')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Quem deve receber a tag').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const target = interaction.options.getUser('usuario', true);
    if (target.bot) {
      return interaction.reply({ embeds: [buildEmbed('Bots não podem receber tags VIP.', true)], ephemeral: true });
    }
    if (target.id === interaction.user.id) {
      return interaction.reply({ embeds: [buildEmbed('Use seu painel /vip para editar sua própria tag.', true)], ephemeral: true });
    }

    const membership = await getMembershipByUser(interaction.user.id, prisma);
    if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
      return interaction.reply({ embeds: [buildEmbed('Você não possui um VIP ativo.', true)], ephemeral: true });
    }

    const vipCfg = await getVipConfig(prisma);
    if (vipCfg && vipCfg.allowManualTags === false) {
      return interaction.reply({ embeds: [buildEmbed('Adicionar tags manualmente está desativado.', true)], ephemeral: true });
    }

    if (!membership.tag?.roleId) {
      return interaction.reply({ embeds: [buildEmbed('Crie sua tag VIP primeiro usando /vip > Editar tag.', true)], ephemeral: true });
    }

    const guildRole = interaction.guild.roles.cache.get(membership.tag.roleId) || (await interaction.guild.roles.fetch(membership.tag.roleId).catch(() => null));
    if (!guildRole) {
      return interaction.reply({ content: 'Não encontrei sua tag no servidor. Recrie pelo menu /vip.', ephemeral: true });
    }

    const memberTarget = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!memberTarget) {
      return interaction.reply({ embeds: [buildEmbed('Usuário não encontrado na guild.', true)], ephemeral: true });
    }

    await memberTarget.roles.add(guildRole).catch(() => {});
    await shareVipTag(membership.tag.id, target.id, interaction.user.id, prisma);

    await interaction.reply({ embeds: [buildEmbed(`${target} recebeu sua tag VIP.`)], ephemeral: true });
  },
};
