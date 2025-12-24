const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');
const { ensureModerationConfig } = require('../services/moderationConfig');
const { COMMAND_TYPES } = require('../lib/moderation');

function buildSummaryEmbed(cfg, guild) {
  const fields = [];
  fields.push({
    name: 'Banimento',
    value: [
      `Status: **${cfg.banEnabled ? 'Ativo' : 'Inativo'}**`,
      `Log: ${cfg.banLogChannelId ? `<#${cfg.banLogChannelId}>` : 'não configurado'}`,
      `DM: ${cfg.banDmEnabled ? 'Ativo' : 'Desativado'}`,
    ].join('\n'),
  });
  fields.push({
    name: 'Castigo',
    value: [
      `Status: **${cfg.castigoEnabled ? 'Ativo' : 'Inativo'}**`,
      `Log: ${cfg.castigoLogChannelId ? `<#${cfg.castigoLogChannelId}>` : 'não configurado'}`,
      `DM: ${cfg.castigoDmEnabled ? 'Ativo' : 'Desativado'}`,
    ].join('\n'),
  });
  return new EmbedBuilder()
    .setTitle('Configurar Moderação')
    .setDescription('Gerencie banimentos e castigos, incluindo permissões, logs e avisos.')
    .addFields(fields)
    .setColor(0x5865F2)
    .setFooter({ text: guild?.name || 'Moderação' });
}

function buildBanEmbed(cfg) {
  const roles = (cfg.permissions || [])
    .filter((perm) => perm.commandType === COMMAND_TYPES.BAN)
    .map((perm) => `<@&${perm.roleId}>`);
  const dmMessage = (cfg.banDmMessage || 'Não definida').slice(0, 1024);
  return new EmbedBuilder()
    .setTitle('Config Ban')
    .setDescription('Ative/desative banimentos, defina logs, permissões e mensagem DM.')
    .addFields(
      { name: 'Status', value: cfg.banEnabled ? '✅ Ativo' : '❌ Inativo', inline: true },
      { name: 'Log', value: cfg.banLogChannelId ? `<#${cfg.banLogChannelId}>` : 'Não configurado', inline: true },
      { name: 'DM', value: cfg.banDmEnabled ? 'Ativa' : 'Desativada', inline: true },
      { name: 'Cargos com acesso', value: roles.length ? roles.join(', ') : 'Nenhum (apenas posse/admin)', inline: false },
      { name: 'Mensagem DM', value: dmMessage, inline: false }
    )
    .setColor(0xED4245);
}

function buildCastigoEmbed(cfg) {
  const roles = (cfg.permissions || [])
    .filter((perm) => perm.commandType === COMMAND_TYPES.CASTIGO)
    .map((perm) => `<@&${perm.roleId}>`);
  const dmMessage = (cfg.castigoDmMessage || 'Não definida').slice(0, 1024);
  return new EmbedBuilder()
    .setTitle('Config Castigo')
    .setDescription('Gerencie timeouts automáticos, logs, permissões e DM.')
    .addFields(
      { name: 'Status', value: cfg.castigoEnabled ? '✅ Ativo' : '❌ Inativo', inline: true },
      { name: 'Log', value: cfg.castigoLogChannelId ? `<#${cfg.castigoLogChannelId}>` : 'Não configurado', inline: true },
      { name: 'DM', value: cfg.castigoDmEnabled ? 'Ativa' : 'Desativada', inline: true },
      { name: 'Cargos com acesso', value: roles.length ? roles.join(', ') : 'Nenhum (apenas posse/admin)', inline: false },
      { name: 'Mensagem DM', value: dmMessage, inline: false }
    )
    .setColor(0xFEE75C);
}

function summaryComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('moderation:ban').setLabel('Config Ban').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('moderation:castigo').setLabel('Config Castigo').setStyle(ButtonStyle.Primary),
    ),
  ];
}

function banComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('moderation:back:root').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('moderation:ban:toggle').setLabel('Ativar/Desativar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('moderation:ban:log').setLabel('Config Log').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('moderation:ban:perms').setLabel('Permissões').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('moderation:ban:dm').setLabel('Config DM').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function castigoComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('moderation:back:root').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('moderation:castigo:toggle').setLabel('Ativar/Desativar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('moderation:castigo:log').setLabel('Config Log').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('moderation:castigo:perms').setLabel('Permissões').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('moderation:castigo:dm').setLabel('Config DM').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function dmComponents(target) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`moderation:${target}:dm:back`).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`moderation:${target}:dm:toggle`).setLabel('Ativar/Desativar DM').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`moderation:${target}:dm:message`).setLabel('Editar mensagem').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`moderation:${target}:dm:contact`).setLabel('Definir contato').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`moderation:${target}:dm:clearcontact`).setLabel('Remover contato').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await ensureModerationConfig(prisma);
  const embed = buildSummaryEmbed(cfg, interaction.guild);
  await interaction.update({ embeds: [embed], components: summaryComponents() });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId;
  if (!customId?.startsWith('moderation')) return false;

  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode acessar esta seção.', ephemeral: true });
    return true;
  }

  const prisma = ctx.getPrisma();

  if (interaction.isButton()) {
    return handleButton(interaction, prisma);
  }

  if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isStringSelectMenu()) {
    return handleSelect(interaction, prisma);
  }

  if (interaction.isModalSubmit()) {
    return handleModal(interaction, prisma);
  }

  return false;
}

async function handleButton(interaction, prisma) {
  const id = interaction.customId;
  const cfg = await ensureModerationConfig(prisma);

  // Ações que precisam abrir modal NÃO podem ser deferidas antes do showModal
  if (id === 'moderation:ban:dm:message' || id === 'moderation:castigo:dm:message') {
    const target = id.includes('ban') ? 'ban' : 'castigo';
    return showDmModal(interaction, target, cfg);
  }

  if (id === 'moderation:ban:dm:contact' || id === 'moderation:castigo:dm:contact') {
    const target = id.includes('ban') ? 'ban' : 'castigo';
    return showContactModal(interaction, target, cfg);
  }

  // Demais ações podem ser deferidas para evitar timeout e manter painel único
  await interaction.deferUpdate().catch(() => {});

  if (id === 'moderation:back:root') {
    const embed = buildSummaryEmbed(cfg, interaction.guild);
    await safeUpdate(interaction, { embeds: [embed], components: summaryComponents() });
    return true;
  }

  if (id === 'moderation:ban') {
    await safeUpdate(interaction, { embeds: [buildBanEmbed(cfg)], components: banComponents() });
    return true;
  }

  if (id === 'moderation:castigo') {
    await safeUpdate(interaction, { embeds: [buildCastigoEmbed(cfg)], components: castigoComponents() });
    return true;
  }

  if (id === 'moderation:ban:toggle') {
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { banEnabled: !cfg.banEnabled } });
    const updated = await ensureModerationConfig(prisma);
    await safeUpdate(interaction, { embeds: [buildBanEmbed(updated)], components: banComponents() });
    return true;
  }

  if (id === 'moderation:castigo:toggle') {
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { castigoEnabled: !cfg.castigoEnabled } });
    const updated = await ensureModerationConfig(prisma);
    await safeUpdate(interaction, { embeds: [buildCastigoEmbed(updated)], components: castigoComponents() });
    return true;
  }

  if (id === 'moderation:ban:log') {
    return showLogSelector(interaction, cfg, COMMAND_TYPES.BAN);
  }

  if (id === 'moderation:castigo:log') {
    return showLogSelector(interaction, cfg, COMMAND_TYPES.CASTIGO);
  }

  if (id === 'moderation:ban:log:disable' || id === 'moderation:castigo:log:disable') {
    const data = id.includes('ban') ? { banLogChannelId: null } : { castigoLogChannelId: null };
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data });
    const updated = await ensureModerationConfig(prisma);
    await safeUpdate(interaction, {
      embeds: [id.includes('ban') ? buildBanEmbed(updated) : buildCastigoEmbed(updated)],
      components: id.includes('ban') ? banComponents() : castigoComponents(),
    });
    await safeReply(interaction, { content: 'Logs desativados.', ephemeral: true });
    return true;
  }

  if (id === 'moderation:ban:perms') {
    return showRoleSelector(interaction, cfg, COMMAND_TYPES.BAN);
  }

  if (id === 'moderation:castigo:perms') {
    return showRoleSelector(interaction, cfg, COMMAND_TYPES.CASTIGO);
  }

  if (id === 'moderation:ban:perms:clear' || id === 'moderation:castigo:perms:clear') {
    const commandType = id.includes('ban') ? COMMAND_TYPES.BAN : COMMAND_TYPES.CASTIGO;
    await prisma.moderationPermission.deleteMany({ where: { moderationConfigId: cfg.id, commandType } });
    const updated = await ensureModerationConfig(prisma);
    await safeUpdate(interaction, {
      embeds: [commandType === COMMAND_TYPES.BAN ? buildBanEmbed(updated) : buildCastigoEmbed(updated)],
      components: commandType === COMMAND_TYPES.BAN ? banComponents() : castigoComponents(),
    });
    await safeReply(interaction, { content: 'Permissões limpas. Apenas posse/admin podem usar.', ephemeral: true });
    return true;
  }

  if (id === 'moderation:ban:dm') {
    return showDmConfig(interaction, cfg, 'ban');
  }

  if (id === 'moderation:castigo:dm') {
    return showDmConfig(interaction, cfg, 'castigo');
  }

  if (id === 'moderation:ban:dm:toggle') {
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { banDmEnabled: !cfg.banDmEnabled } });
    const updated = await ensureModerationConfig(prisma);
    return showDmConfig(interaction, updated, 'ban');
  }

  if (id === 'moderation:castigo:dm:toggle') {
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { castigoDmEnabled: !cfg.castigoDmEnabled } });
    const updated = await ensureModerationConfig(prisma);
    return showDmConfig(interaction, updated, 'castigo');
  }

  if (id === 'moderation:ban:dm:back') {
    await safeUpdate(interaction, { embeds: [buildBanEmbed(cfg)], components: banComponents() });
    return true;
  }

  if (id === 'moderation:castigo:dm:back') {
    await safeUpdate(interaction, { embeds: [buildCastigoEmbed(cfg)], components: castigoComponents() });
    return true;
  }

  if (id === 'moderation:ban:dm:clearcontact' || id === 'moderation:castigo:dm:clearcontact') {
    const target = id.includes('ban') ? 'ban' : 'castigo';
    const field = target === 'ban' ? { banDmContactId: null } : { castigoDmContactId: null };
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: field });
    const updated = await ensureModerationConfig(prisma);
    return showDmConfig(interaction, updated, target);
  }

  return false;
}

async function handleSelect(interaction, prisma) {
  // Evitar timeout em seleções
  await interaction.deferUpdate().catch(() => {});
  const id = interaction.customId;
  const cfg = await ensureModerationConfig(prisma);

  if (id === 'moderation:ban:log:set' || id === 'moderation:castigo:log:set') {
    const value = interaction.values?.[0];
    if (!value) {
      await safeReply(interaction, { content: 'Seleção inválida.', ephemeral: true });
      return true;
    }

    if (id.includes('ban')) {
      await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { banLogChannelId: value } });
      const updated = await ensureModerationConfig(prisma);
      await safeUpdate(interaction, { embeds: [buildBanEmbed(updated)], components: banComponents() });
      await safeReply(interaction, { content: `Log de ban definido: <#${value}>`, ephemeral: true });
    } else {
      await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { castigoLogChannelId: value } });
      const updated = await ensureModerationConfig(prisma);
      await safeUpdate(interaction, { embeds: [buildCastigoEmbed(updated)], components: castigoComponents() });
      await safeReply(interaction, { content: `Log de castigo definido: <#${value}>`, ephemeral: true });
    }

    return true;
  }

  if (id === 'moderation:ban:perms:set' || id === 'moderation:castigo:perms:set') {
    const selected = interaction.values || [];
    const commandType = id.includes('ban') ? COMMAND_TYPES.BAN : COMMAND_TYPES.CASTIGO;

    await prisma.moderationPermission.deleteMany({ where: { moderationConfigId: cfg.id, commandType } });
    if (selected.length) {
      await prisma.moderationPermission.createMany({
        data: selected.map((roleId) => ({ moderationConfigId: cfg.id, commandType, roleId })),
      });
    }

    const updated = await ensureModerationConfig(prisma);
    await safeUpdate(interaction, {
      embeds: [commandType === COMMAND_TYPES.BAN ? buildBanEmbed(updated) : buildCastigoEmbed(updated)],
      components: commandType === COMMAND_TYPES.BAN ? banComponents() : castigoComponents(),
    });
    await safeReply(interaction, { content: 'Permissões atualizadas.', ephemeral: true });
    return true;
  }

  return false;
}

async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    // Manter uma única mensagem/painel
    return interaction.editReply(payload).catch(() => {});
  }
  return interaction.update(payload).catch(() => {});
}

async function showLogSelector(interaction, cfg, type) {
  const selectedId = type === COMMAND_TYPES.BAN ? cfg.banLogChannelId : cfg.castigoLogChannelId;
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban:log:set' : 'moderation:castigo:log:set')
    .setPlaceholder('Selecione o canal de log')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (selectedId) {
    select.setDefaultChannels(selectedId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Selecionar canal de log')
    .setDescription('Escolha um canal de texto para receber os logs.')
    .setColor(0x5865F2);
  const backButton = new ButtonBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban' : 'moderation:castigo')
    .setLabel('Cancelar')
    .setStyle(ButtonStyle.Secondary);
  const disableButton = new ButtonBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban:log:disable' : 'moderation:castigo:log:disable')
    .setLabel('Desativar log')
    .setStyle(ButtonStyle.Danger);
  await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(backButton, disableButton),
    ],
  });
  return true;
}

async function showRoleSelector(interaction, cfg, type) {
  const selectedIds = (cfg.permissions || [])
    .filter((perm) => perm.commandType === type)
    .map((perm) => perm.roleId);
  const select = new RoleSelectMenuBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban:perms:set' : 'moderation:castigo:perms:set')
    .setPlaceholder('Selecione os cargos permitidos')
    .setMinValues(1)
    .setMaxValues(25);
  if (selectedIds.length) {
    select.setDefaultRoles(selectedIds.slice(0, 25));
  }
  const embed = new EmbedBuilder()
    .setTitle('Permissões de comando')
    .setDescription('Selecione os cargos que podem usar este comando. Use "Nenhum" para limpar.')
    .setColor(0x5865F2);
  const backButton = new ButtonBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban' : 'moderation:castigo')
    .setLabel('Cancelar')
    .setStyle(ButtonStyle.Secondary);
  const clearButton = new ButtonBuilder()
    .setCustomId(type === COMMAND_TYPES.BAN ? 'moderation:ban:perms:clear' : 'moderation:castigo:perms:clear')
    .setLabel('Limpar permissões')
    .setStyle(ButtonStyle.Danger);
  await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(backButton, clearButton),
    ],
  });
  return true;
}

async function showDmConfig(interaction, cfg, target) {
  const isBan = target === 'ban';
  const messageText = isBan ? (cfg.banDmMessage || 'Não definida') : (cfg.castigoDmMessage || 'Não definida');
  const embed = new EmbedBuilder()
    .setTitle(`Config DM - ${isBan ? 'Ban' : 'Castigo'}`)
    .setDescription('Ative/desative o envio de DM antes da punição e personalize a mensagem.')
    .addFields(
      { name: 'Status', value: isBan ? (cfg.banDmEnabled ? 'Ativo' : 'Desativado') : (cfg.castigoDmEnabled ? 'Ativo' : 'Desativado'), inline: true },
      { name: 'Contato', value: isBan ? (cfg.banDmContactId ? `<@${cfg.banDmContactId}>` : 'Não definido') : (cfg.castigoDmContactId ? `<@${cfg.castigoDmContactId}>` : 'Não definido'), inline: true },
      { name: 'Mensagem atual', value: messageText.slice(0, 1024), inline: false },
    )
    .setColor(0x5865F2);
  await safeUpdate(interaction, { embeds: [embed], components: dmComponents(target) });
  return true;
}

async function showDmModal(interaction, target, cfg) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:${target}:dm:modal`)
    .setTitle('Mensagem enviada na DM');
  const current = target === 'ban' ? cfg.banDmMessage : cfg.castigoDmMessage;
  const textInput = new TextInputBuilder()
    .setCustomId('moderation:dm:text')
    .setLabel('Mensagem (texto simples)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder('Ex: Se acha que seu ban foi injusto, fale com ...');
  if (current) {
    textInput.setValue(current.slice(0, 4000));
  }
  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  await interaction.showModal(modal);
  return true;
}

async function showContactModal(interaction, target, cfg) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:${target}:dm:contactModal`)
    .setTitle('Contato para DM');
  const current = target === 'ban' ? cfg.banDmContactId : cfg.castigoDmContactId;
  const contactInput = new TextInputBuilder()
    .setCustomId('moderation:dm:contact')
    .setLabel('ID ou menção do contato')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (current) {
    contactInput.setValue(`<@${current}>`);
  }
  modal.addComponents(new ActionRowBuilder().addComponents(contactInput));
  await interaction.showModal(modal);
  return true;
}

function extractId(value) {
  if (!value) return null;
  const match = String(value).match(/\d{5,}/);
  return match ? match[0] : null;
}

async function handleModal(interaction, prisma) {
  const id = interaction.customId;
  const cfg = await ensureModerationConfig(prisma);
  if (id === 'moderation:ban:dm:modal' || id === 'moderation:castigo:dm:modal') {
    const text = interaction.fields.getTextInputValue('moderation:dm:text');
    if (id.includes('ban')) {
      await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { banDmMessage: text || null } });
      await interaction.reply({ content: 'Mensagem de DM (ban) atualizada.', ephemeral: true });
      return true;
    }
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { castigoDmMessage: text || null } });
    await interaction.reply({ content: 'Mensagem de DM (castigo) atualizada.', ephemeral: true });
    return true;
  }
  if (id === 'moderation:ban:dm:contactModal' || id === 'moderation:castigo:dm:contactModal') {
    const raw = interaction.fields.getTextInputValue('moderation:dm:contact');
    const parsed = extractId(raw);
    if (id.includes('ban')) {
      await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { banDmContactId: parsed || null } });
      await interaction.reply({ content: parsed ? `Contato definido: <@${parsed}>` : 'Contato removido.', ephemeral: true });
      return true;
    }
    await prisma.moderationConfig.update({ where: { id: cfg.id }, data: { castigoDmContactId: parsed || null } });
    await interaction.reply({ content: parsed ? `Contato definido: <@${parsed}>` : 'Contato removido.', ephemeral: true });
    return true;
  }
  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
};
