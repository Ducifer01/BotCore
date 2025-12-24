const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { buildSupportConfigEmbed, getSupportPanelPayload } = require('./support');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');

async function ensureDeferred(interaction) {
  if (!interaction.deferred && !interaction.replied && typeof interaction.deferUpdate === 'function') {
    await interaction.deferUpdate().catch(() => {});
  }
}

async function renderHome(interaction, cfg) {
  const embed = buildSupportConfigEmbed(cfg);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:support:channel').setLabel('Canal Suporte').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:support:roles').setLabel('Cargos Suporte').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:support:log').setLabel('Canal Log Suporte').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:support:panel').setLabel('Enviar/Atualizar').setStyle(ButtonStyle.Success),
  );
  await ensureDeferred(interaction);
  await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
  return true;
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await getGlobalConfig(prisma);
  return renderHome(interaction, cfg);
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
  if (customId === 'menu:support:home') {
    return renderHome(interaction, cfg);
  }
  if (customId === 'menu:support:channel') {
    await ensureDeferred(interaction);
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
    await interaction.editReply({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:support:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary)),
    ] }).catch(() => {});
    return true;
  }
  if (customId === 'menu:support:roles') {
    await ensureDeferred(interaction);
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
    await interaction.editReply({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:support:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary)),
    ] }).catch(() => {});
    return true;
  }
  if (customId === 'menu:support:log') {
    await ensureDeferred(interaction);
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
    await interaction.editReply({ embeds: [embed], components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:support:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary)),
    ] }).catch(() => {});
    return true;
  }
  if (customId === 'menu:support:panel') {
    if (!cfg?.supportPanelChannelId) {
      await interaction.reply({ content: 'Antes, você precisa configurar o canal de suporte.', ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const panelChannel = await interaction.client.channels.fetch(cfg.supportPanelChannelId).catch(() => null);
    if (!panelChannel || !panelChannel.isTextBased()) {
      await interaction.editReply({ content: 'Não foi possível acessar o canal de suporte configurado.' }).catch(() => {});
      return true;
    }
    const payload = getSupportPanelPayload();
    await panelChannel.send(payload);
    await interaction.editReply({ content: `Painel enviado/atualizado em <#${panelChannel.id}>.` }).catch(() => {});
    return true;
  }
  return false;
}

async function handleSelects(interaction, prisma) {
  const customId = interaction.customId;
  const cfg = await ensureGlobalConfig(prisma);
  if (customId === 'menu:support:channel:set') {
    await ensureDeferred(interaction);
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true }).catch(() => {});
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { supportPanelChannelId: channelId } });
    const updatedCfg = await getGlobalConfig(prisma);
    await renderHome(interaction, updatedCfg);
    return true;
  }
  if (customId === 'menu:support:log:set') {
    await ensureDeferred(interaction);
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true }).catch(() => {});
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { supportLogChannelId: channelId } });
    const updatedCfg = await getGlobalConfig(prisma);
    await renderHome(interaction, updatedCfg);
    return true;
  }
  if (customId === 'menu:support:roles:set') {
    await ensureDeferred(interaction);
    const roleIds = [...new Set(interaction.values || [])];
    await prisma.supportRoleGlobal.deleteMany({ where: { globalConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.supportRoleGlobal.createMany({ data: roleIds.map((roleId) => ({ globalConfigId: cfg.id, roleId })) });
    }
    const updatedCfg = await getGlobalConfig(prisma);
    await renderHome(interaction, updatedCfg);
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
