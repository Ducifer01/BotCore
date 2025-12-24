const {
  EmbedBuilder,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { ensureGlobalConfig } = require('../services/globalConfig');
const { MUTE_COMMANDS } = require('../lib/mute');

const SUMMARY_VIEW = 'summary';
const VOICE_VIEW = 'voice';
const CHAT_VIEW = 'chat';

async function ensureDeferred(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    if (typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate().catch(() => {});
    }
  }
}

async function editPanel(interaction, payload) {
  await ensureDeferred(interaction);
  await interaction.editReply(payload).catch(() => {});
}

async function fetchConfig(prisma) {
  const base = await ensureGlobalConfig(prisma);
  return prisma.globalConfig.findUnique({
    where: { id: base.id },
    include: { mutePermissions: true },
  });
}

function formatRole(roleId) {
  return roleId ? `<@&${roleId}>` : 'não configurado';
}

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : 'não configurado';
}

function formatPerms(cfg, commandTypes) {
  const types = Array.isArray(commandTypes) ? commandTypes : [commandTypes];
  const roles = (cfg?.mutePermissions || [])
    .filter((perm) => types.includes(perm.commandType))
    .map((perm) => `<@&${perm.roleId}>`);
  const unique = [...new Set(roles)];
  return unique.length ? unique.join(', ') : 'Somente posse/Admin/MuteMembers';
}

function buildSummaryEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Configurações de Mute')
    .setDescription('Gerencie cargos e permissões para mute por voz e por chat.')
    .addFields(
      {
        name: 'Mute Voz (!mutecall)',
        value: `Cargo: ${formatRole(cfg?.muteVoiceRoleId)}\nCanal desbloqueio: ${formatChannel(cfg?.muteVoiceUnlockChannelId)}\nLog: ${formatChannel(cfg?.muteVoiceLogChannelId)}`,
      },
      {
        name: 'Mute Chat (!mute)',
        value: `Cargo: ${formatRole(cfg?.muteChatRoleId)}\nLog: ${formatChannel(cfg?.muteChatLogChannelId)}`,
      },
    )
    .setColor(0x2c2f33);
}

function buildVoiceEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Mute de Voz (!mutecall / !unmutecall)')
    .setDescription('Configure o cargo aplicado, canal de desbloqueio e permissões específicas para voz.')
    .addFields(
      { name: 'Cargo mutado voz', value: formatRole(cfg?.muteVoiceRoleId), inline: true },
      { name: 'Canal desbloqueio', value: formatChannel(cfg?.muteVoiceUnlockChannelId), inline: true },
      { name: 'Canal de log', value: formatChannel(cfg?.muteVoiceLogChannelId), inline: true },
      {
        name: 'Permissões Mutecall',
        value: formatPerms(cfg, [MUTE_COMMANDS.MUTE_CALL, MUTE_COMMANDS.UNMUTE_CALL]),
        inline: false,
      },
    )
    .setColor(0x5865f2);
}

function buildChatEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Mute de Chat (!mute / !unmute)')
    .setDescription('Configure cargo dedicado, logs e permissões para o mute de chat.')
    .addFields(
      { name: 'Cargo mutado chat', value: formatRole(cfg?.muteChatRoleId), inline: true },
      { name: 'Canal de log', value: formatChannel(cfg?.muteChatLogChannelId), inline: true },
      {
        name: 'Permissões Mute',
        value: formatPerms(cfg, [MUTE_COMMANDS.MUTE_CHAT, MUTE_COMMANDS.UNMUTE_CHAT]),
        inline: false,
      },
    )
    .setColor(0x57f287);
}

function summaryComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:mute:view:voice').setLabel('Configurar Mute Voz').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:mute:view:chat').setLabel('Configurar Mute Chat').setStyle(ButtonStyle.Success),
    ),
  ];
}

function voiceComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:mute:view:summary').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:mute:voice:role').setLabel('Definir cargo voz').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:mute:voice:unlock').setLabel('Canal desbloqueio').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:mute:voice:log').setLabel('Log voz').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:mute:voice:perm:mutecall').setLabel('Permissões Mutecall').setStyle(ButtonStyle.Primary),
    ),
  ];
}

function chatComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:mute:view:summary').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:mute:chat:role').setLabel('Definir cargo chat').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:mute:chat:log').setLabel('Log chat').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:mute:chat:perm:mute').setLabel('Permissões Mute').setStyle(ButtonStyle.Success),
    ),
  ];
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await fetchConfig(prisma);
  await editPanel(interaction, { embeds: [buildSummaryEmbed(cfg)], components: summaryComponents() });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId;
  if (!customId?.startsWith('menu:mute')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await safeReply(interaction, { content: 'Apenas o usuário posse pode acessar esta seção.', ephemeral: true });
    return true;
  }
  const prisma = ctx.getPrisma();

  if (interaction.isButton()) {
    return handleButton(interaction, prisma);
  }

  if (interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
    return handleSelect(interaction, prisma);
  }

  return false;
}

async function handleButton(interaction, prisma) {
  await ensureDeferred(interaction);
  const id = interaction.customId;

  if (id === 'menu:mute:view:summary') {
    return renderView(interaction, prisma, SUMMARY_VIEW);
  }
  if (id === 'menu:mute:view:voice') {
    return renderView(interaction, prisma, VOICE_VIEW);
  }
  if (id === 'menu:mute:view:chat') {
    return renderView(interaction, prisma, CHAT_VIEW);
  }

  if (id === 'menu:mute:voice:role') {
    return showVoiceRoleSelector(interaction, prisma);
  }
  if (id === 'menu:mute:voice:unlock') {
    return showVoiceUnlockSelector(interaction, prisma);
  }
  if (id === 'menu:mute:voice:log') {
    return showLogSelector(interaction, prisma, VOICE_VIEW);
  }
  if (id === 'menu:mute:voice:log:disable') {
    const cfg = await fetchConfig(prisma);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteVoiceLogChannelId: null } });
    await renderView(interaction, prisma, VOICE_VIEW);
    await safeReply(interaction, { content: 'Log de mute voz desativado.', ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:chat:role') {
    return showChatRoleSelector(interaction, prisma);
  }
  if (id === 'menu:mute:chat:log') {
    return showLogSelector(interaction, prisma, CHAT_VIEW);
  }
  if (id === 'menu:mute:chat:log:disable') {
    const cfg = await fetchConfig(prisma);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteChatLogChannelId: null } });
    await renderView(interaction, prisma, CHAT_VIEW);
    await safeReply(interaction, { content: 'Log de mute chat desativado.', ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:voice:perm:mutecall') {
    return showPermissionSelector(interaction, prisma, MUTE_COMMANDS.MUTE_CALL);
  }

  if (id === 'menu:mute:chat:perm:mute') {
    return showPermissionSelector(interaction, prisma, MUTE_COMMANDS.MUTE_CHAT);
  }

  if (id.startsWith('menu:mute:perm:') && id.endsWith(':clear')) {
    const commandType = id.split(':')[3];
    const targets = getLinkedCommandTypes(commandType);
    const cfg = await fetchConfig(prisma);
    await prisma.mutePermission.deleteMany({ where: { globalConfigId: cfg.id, commandType: { in: targets } } });
    await renderView(interaction, prisma, resolveViewFromCommand(commandType));
    await safeReply(interaction, { content: 'Permissões limpas. Apenas posse/Admin poderão usar.', ephemeral: true });
    return true;
  }

  return false;
}

async function handleSelect(interaction, prisma) {
  await ensureDeferred(interaction);
  const id = interaction.customId;
  const cfg = await fetchConfig(prisma);
  const value = interaction.values?.[0];

  if (id === 'menu:mute:voice:role:set') {
    if (!value) return invalidSelection(interaction);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteVoiceRoleId: value } });
    await renderView(interaction, prisma, VOICE_VIEW);
    await safeReply(interaction, { content: `Cargo mutado voz definido: <@&${value}>`, ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:voice:unlock:set') {
    if (!value) return invalidSelection(interaction);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteVoiceUnlockChannelId: value } });
    await renderView(interaction, prisma, VOICE_VIEW);
    await safeReply(interaction, { content: `Canal de desbloqueio definido: <#${value}>`, ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:voice:log:set') {
    if (!value) return invalidSelection(interaction);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteVoiceLogChannelId: value } });
    await renderView(interaction, prisma, VOICE_VIEW);
    await safeReply(interaction, { content: `Log de mute voz definido: <#${value}>`, ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:chat:role:set') {
    if (!value) return invalidSelection(interaction);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteChatRoleId: value } });
    await renderView(interaction, prisma, CHAT_VIEW);
    await safeReply(interaction, { content: `Cargo mutado chat definido: <@&${value}>`, ephemeral: true });
    return true;
  }

  if (id === 'menu:mute:chat:log:set') {
    if (!value) return invalidSelection(interaction);
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { muteChatLogChannelId: value } });
    await renderView(interaction, prisma, CHAT_VIEW);
    await safeReply(interaction, { content: `Log de mute chat definido: <#${value}>`, ephemeral: true });
    return true;
  }

  if (id.startsWith('menu:mute:perm:') && id.endsWith(':set')) {
    const commandType = id.split(':')[3];
    const targets = getLinkedCommandTypes(commandType);
    const selected = interaction.values || [];
    await prisma.mutePermission.deleteMany({ where: { globalConfigId: cfg.id, commandType: { in: targets } } });
    if (selected.length) {
      const data = selected.slice(0, 25);
      for (const target of targets) {
        await prisma.mutePermission.createMany({
          data: data.map((roleId) => ({ globalConfigId: cfg.id, commandType: target, roleId })),
        });
      }
    }
    await renderView(interaction, prisma, resolveViewFromCommand(commandType));
    await safeReply(interaction, { content: 'Permissões atualizadas.', ephemeral: true });
    return true;
  }

  return false;
}

async function renderView(interaction, prisma, view) {
  const cfg = await fetchConfig(prisma);
  if (view === VOICE_VIEW) {
    await editPanel(interaction, { embeds: [buildVoiceEmbed(cfg)], components: voiceComponents() });
    return true;
  }
  if (view === CHAT_VIEW) {
    await editPanel(interaction, { embeds: [buildChatEmbed(cfg)], components: chatComponents() });
    return true;
  }
  await editPanel(interaction, { embeds: [buildSummaryEmbed(cfg)], components: summaryComponents() });
  return true;
}

async function showVoiceRoleSelector(interaction, prisma) {
  const cfg = await fetchConfig(prisma);
  const select = new RoleSelectMenuBuilder()
    .setCustomId('menu:mute:voice:role:set')
    .setPlaceholder('Selecione o cargo mutado voz')
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg?.muteVoiceRoleId) {
    select.setDefaultRoles(cfg.muteVoiceRoleId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Cargo mutado voz')
    .setDescription('Escolha o cargo que será aplicado pelo !mutecall.')
    .setColor(0x5865f2);
  await editPanel(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:mute:view:voice').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  return true;
}

async function showVoiceUnlockSelector(interaction, prisma) {
  const cfg = await fetchConfig(prisma);
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('menu:mute:voice:unlock:set')
    .setPlaceholder('Selecione o canal de desbloqueio (voz)')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildVoice);
  if (cfg?.muteVoiceUnlockChannelId) {
    select.setDefaultChannels(cfg.muteVoiceUnlockChannelId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Canal de desbloqueio')
    .setDescription('Quando configurado, usuários mutados manualmente serão soltos ao entrar neste canal.')
    .setColor(0x5865f2);
  await editPanel(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:mute:view:voice').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  return true;
}

async function showChatRoleSelector(interaction, prisma) {
  const cfg = await fetchConfig(prisma);
  const select = new RoleSelectMenuBuilder()
    .setCustomId('menu:mute:chat:role:set')
    .setPlaceholder('Selecione o cargo mutado chat')
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg?.muteChatRoleId) {
    select.setDefaultRoles(cfg.muteChatRoleId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Cargo mutado chat')
    .setDescription('Cargo aplicado pelo comando !mute para bloquear envio de mensagens.')
    .setColor(0x57f287);
  await editPanel(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('menu:mute:view:chat').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  return true;
}

async function showLogSelector(interaction, prisma, view) {
  const cfg = await fetchConfig(prisma);
  const isVoice = view === VOICE_VIEW;
  const current = isVoice ? cfg?.muteVoiceLogChannelId : cfg?.muteChatLogChannelId;
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(isVoice ? 'menu:mute:voice:log:set' : 'menu:mute:chat:log:set')
    .setPlaceholder('Selecione o canal de texto de log')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (current) {
    select.setDefaultChannels(current);
  }
  const embed = new EmbedBuilder()
    .setTitle(isVoice ? 'Log de mute voz' : 'Log de mute chat')
    .setDescription('Escolha onde os registros serão publicados.')
    .setColor(isVoice ? 0x5865f2 : 0x57f287);
  const backId = isVoice ? 'menu:mute:view:voice' : 'menu:mute:view:chat';
  const disableId = isVoice ? 'menu:mute:voice:log:disable' : 'menu:mute:chat:log:disable';
  await editPanel(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(backId).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(disableId).setLabel('Desativar log').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
  return true;
}

async function showPermissionSelector(interaction, prisma, commandType) {
  const cfg = await fetchConfig(prisma);
  const targets = getLinkedCommandTypes(commandType);
  const selected = (cfg?.mutePermissions || [])
    .filter((perm) => targets.includes(perm.commandType))
    .map((perm) => perm.roleId);
  const uniqueSelected = [...new Set(selected)];
  const select = new RoleSelectMenuBuilder()
    .setCustomId(`menu:mute:perm:${commandType}:set`)
    .setPlaceholder('Selecione os cargos autorizados')
    .setMinValues(1)
    .setMaxValues(25);
  if (uniqueSelected.length) {
    select.setDefaultRoles(...uniqueSelected.slice(0, 25));
  }
  const embed = new EmbedBuilder()
    .setTitle('Permissões do comando')
    .setDescription('Escolha quais cargos podem usar este comando. Use "Limpar" para voltar ao padrão (posse/Admin).')
    .addFields({ name: 'Comando', value: describeCommandLabel(commandType) })
    .setColor(resolveViewFromCommand(commandType) === VOICE_VIEW ? 0x5865f2 : 0x57f287);
  await editPanel(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(resolveViewFromCommand(commandType) === VOICE_VIEW ? 'menu:mute:view:voice' : 'menu:mute:view:chat')
          .setLabel('Voltar')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`menu:mute:perm:${commandType}:clear`)
          .setLabel('Limpar')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
  return true;
}

function describeCommandLabel(commandType) {
  const linked = getLinkedCommandTypes(commandType);
  const unique = [...new Set(linked)];
  const hasVoice =
    unique.includes(MUTE_COMMANDS.MUTE_CALL) && unique.includes(MUTE_COMMANDS.UNMUTE_CALL);
  const hasChat =
    unique.includes(MUTE_COMMANDS.MUTE_CHAT) && unique.includes(MUTE_COMMANDS.UNMUTE_CHAT);
  if (hasVoice) {
    return '!mutecall / !unmutecall (mute voz)';
  }
  if (hasChat) {
    return '!mute / !unmute (mute chat)';
  }
  return describeSingleCommand(commandType);
}

function describeSingleCommand(commandType) {
  switch (commandType) {
    case MUTE_COMMANDS.MUTE_CALL:
      return '!mutecall (aplicar mute voz)';
    case MUTE_COMMANDS.UNMUTE_CALL:
      return '!unmutecall (remover mute voz)';
    case MUTE_COMMANDS.MUTE_CHAT:
      return '!mute (aplicar mute chat)';
    case MUTE_COMMANDS.UNMUTE_CHAT:
      return '!unmute (remover mute chat)';
    default:
      return 'Comando desconhecido';
  }
}

function getLinkedCommandTypes(commandType) {
  if (
    commandType === MUTE_COMMANDS.MUTE_CALL ||
    commandType === MUTE_COMMANDS.UNMUTE_CALL
  ) {
    return [MUTE_COMMANDS.MUTE_CALL, MUTE_COMMANDS.UNMUTE_CALL];
  }
  if (
    commandType === MUTE_COMMANDS.MUTE_CHAT ||
    commandType === MUTE_COMMANDS.UNMUTE_CHAT
  ) {
    return [MUTE_COMMANDS.MUTE_CHAT, MUTE_COMMANDS.UNMUTE_CHAT];
  }
  return [commandType];
}

function resolveViewFromCommand(commandType) {
  if (commandType === MUTE_COMMANDS.MUTE_CALL || commandType === MUTE_COMMANDS.UNMUTE_CALL) {
    return VOICE_VIEW;
  }
  return CHAT_VIEW;
}

async function invalidSelection(interaction) {
  await editPanel(interaction, { content: 'Seleção inválida.', components: [] }).catch(() => {});
  return true;
}

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
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

module.exports = {
  presentMenu,
  handleInteraction,
};
