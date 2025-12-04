const { EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');

function buildMuteEmbed(cfg) {
  const lines = [
    `• Bot responsável: ${cfg?.muteBotId ? `<@${cfg.muteBotId}>` : 'não definido'}`,
    `• Cargo Mutado: ${cfg?.muteRoleId ? `<@&${cfg.muteRoleId}>` : 'não definido'}`,
    `• Canal de desbloqueio: ${cfg?.muteUnlockChannelId ? `<#${cfg.muteUnlockChannelId}>` : 'não definido'}`,
  ].join('\n');
  return new EmbedBuilder()
    .setTitle('Configurar Mute')
    .setDescription(`Defina o cargo mutado, o canal de desbloqueio e o bot responsável.\n\n${lines}`)
    .setColor(0x2c2f33);
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await getGlobalConfig(prisma);
  const embed = buildMuteEmbed(cfg);
  const rowBack = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
  );
  const rowRole = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('menu:mute:role:set').setPlaceholder('Selecione o cargo Mutado').setMinValues(1).setMaxValues(1),
  );
  const rowUnlock = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('menu:mute:unlock:set')
      .setPlaceholder('Selecione o canal de voz de desbloqueio')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildVoice),
  );
  const rowBot = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('menu:mute:bot:set').setPlaceholder('Selecione o bot responsável').setMinValues(1).setMaxValues(1),
  );
  await interaction.update({ embeds: [embed], components: [rowBack, rowRole, rowUnlock, rowBot] });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId;
  if (!customId.startsWith('menu:mute:')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = await ensureGlobalConfig(prisma);

  if (customId === 'menu:mute:role:set') {
    const roleId = interaction.values?.[0];
    if (!roleId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteRoleId: roleId } });
    await interaction.update({ content: `Cargo mutado definido: <@&${roleId}>`, embeds: [], components: [] });
    return true;
  }
  if (customId === 'menu:mute:unlock:set') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteUnlockChannelId: channelId } });
    await interaction.update({ content: `Canal de desbloqueio definido: <#${channelId}>`, embeds: [], components: [] });
    return true;
  }
  if (customId === 'menu:mute:bot:set') {
    const userId = interaction.values?.[0];
    if (!userId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteBotId: userId } });
    await interaction.update({ content: `Bot responsável definido: <@${userId}>`, embeds: [], components: [] });
    return true;
  }
  return false;
}

module.exports = {
  buildMuteEmbed,
  presentMenu,
  handleInteraction,
};
