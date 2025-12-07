const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPrisma } = require('../db');
const { ensureVipConfig } = require('../services/vip');

function splitButtons(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

function hasSetVipPermission(member, vipCfg) {
  const configuredRoles = vipCfg.setPermissions || [];
  if (!configuredRoles.length) {
    return member.permissions.has('ManageGuild');
  }
  return configuredRoles.some((perm) => member.roles.cache.has(perm.roleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setvip')
    .setDescription('Concede um VIP a um usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const targetUser = interaction.options.getUser('usuario', true);
    if (targetUser.bot) {
      return interaction.reply({ content: 'Bots não podem receber VIP.', ephemeral: true });
    }
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Usuário não encontrado na guild.', ephemeral: true });
    }

    const vipCfg = await ensureVipConfig(prisma);
    if (!hasSetVipPermission(interaction.member, vipCfg)) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

  const plans = (vipCfg.plans || []).filter((plan) => !plan.isDraft && plan.guildId === interaction.guildId);
    if (!plans.length) {
      return interaction.reply({ content: 'Não há planos de VIP publicados.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Conceder VIP')
      .setDescription(`Selecione qual VIP aplicar em ${targetMember}.`)
      .setColor(0x5865f2);

    const buttons = plans.map((plan) =>
      new ButtonBuilder()
        .setCustomId(`vipset:${plan.id}:${targetMember.id}`)
        .setLabel(plan.name?.slice(0, 80) || `VIP #${plan.id}`)
        .setStyle(ButtonStyle.Primary),
    );

    const rows = splitButtons(buttons).slice(0, 5);
    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  },
};
