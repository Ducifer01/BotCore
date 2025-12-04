const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { buildSupportConfigEmbed, getSupportPanelPayload } = require('./support');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await getGlobalConfig(prisma);
  const embed = buildSupportConfigEmbed(cfg);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:support:channel').setLabel('Canal Suporte').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:support:roles').setLabel('Cargos Suporte').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:support:log').setLabel('Canal Log Suporte').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:support:panel').setLabel('Enviar/Atualizar').setStyle(ButtonStyle.Success),
  );
  await interaction.update({ embeds: [embed], components: [row] });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId;
  if (!customId.startsWith('menu:support')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    return true;
  }
  const prisma = ctx.getPrisma();
  if (interaction.isButton()) {
    return handleButtons(interaction, prisma);
  }
  if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
    return handleSelects(interaction, prisma);
  }
  return false;
}

async function handleButtons(interaction, prisma) {
  const customId = interaction.customId;
  const cfg = await getGlobalConfig(prisma);
  if (customId === 'menu:support:channel') {
  const embed = buildActionEmbed('Canal de Suporte', `Escolha o canal onde o painel ficará disponível.\nAtual: ${cfg?.supportPanelChannelId ? `<#${cfg.supportPanelChannelId}>` : 'não definido'}`);
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('menu:support:channel:set')
      .setPlaceholder('Selecione um canal de texto')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText);
    if (cfg?.supportPanelChannelId && typeof select.setDefaultChannels === 'function') {
      select.setDefaultChannels(cfg.supportPanelChannelId);
    }
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (customId === 'menu:support:roles') {
    const selectedRoles = cfg?.supportRolesGlobal?.map((r) => `<@&${r.roleId}>`).join(', ') || 'nenhum configurado';
  const embed = buildActionEmbed('Cargos de Suporte', `Selecione quais cargos poderão encerrar atendimentos.\nAtuais: ${selectedRoles}`);
    const select = new RoleSelectMenuBuilder()
      .setCustomId('menu:support:roles:set')
      .setPlaceholder('Selecione cargos de suporte')
      .setMinValues(0)
      .setMaxValues(10);
    if (cfg?.supportRolesGlobal?.length && typeof select.setDefaultRoles === 'function') {
      select.setDefaultRoles(...cfg.supportRolesGlobal.map((r) => r.roleId));
    }
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (customId === 'menu:support:log') {
  const embed = buildActionEmbed('Canal de Log do Suporte', `Selecione o canal onde as transcrições serão enviadas.\nAtual: ${cfg?.supportLogChannelId ? `<#${cfg.supportLogChannelId}>` : 'não definido'}`);
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('menu:support:log:set')
      .setPlaceholder('Selecione um canal de texto para logs')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText);
    if (cfg?.supportLogChannelId && typeof select.setDefaultChannels === 'function') {
      select.setDefaultChannels(cfg.supportLogChannelId);
    }
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (customId === 'menu:support:panel') {
    if (!cfg?.supportPanelChannelId) {
      await interaction.reply({ content: 'Antes, você precisa configurar o canal de suporte.', ephemeral: true });
      return true;
    }
    const panelChannel = await interaction.client.channels.fetch(cfg.supportPanelChannelId).catch(() => null);
    if (!panelChannel || !panelChannel.isTextBased()) {
      await interaction.reply({ content: 'Não foi possível acessar o canal de suporte configurado.', ephemeral: true });
      return true;
    }
    const payload = getSupportPanelPayload();
    await panelChannel.send(payload);
    await interaction.reply({ content: `Painel enviado/atualizado em <#${panelChannel.id}>.`, ephemeral: true });
    return true;
  }
  return false;
}

async function handleSelects(interaction, prisma) {
  const customId = interaction.customId;
  const cfg = await ensureGlobalConfig(prisma);
  if (customId === 'menu:support:channel:set') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { supportPanelChannelId: channelId } });
  const embed = buildActionEmbed('Canal de suporte atualizado', `Novo canal configurado: <#${channelId}>`);
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }
  if (customId === 'menu:support:log:set') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { supportLogChannelId: channelId } });
  const embed = buildActionEmbed('Canal de log atualizado', `Logs enviados para: <#${channelId}>`);
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }
  if (customId === 'menu:support:roles:set') {
    const roleIds = [...new Set(interaction.values || [])];
    await prisma.supportRoleGlobal.deleteMany({ where: { globalConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.supportRoleGlobal.createMany({ data: roleIds.map((roleId) => ({ globalConfigId: cfg.id, roleId })) });
    }
  const embed = buildActionEmbed('Cargos de suporte atualizados', roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(', ') : 'Nenhum cargo configurado');
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }
  return false;
}

function buildActionEmbed(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x2c2f33);
}

module.exports = {
  presentMenu,
  handleInteraction,
};
