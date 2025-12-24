const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { invalidateCache } = require('./pointsSystem');
const pointsService = require('../services/points');

function buildEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Configuração - Sistema de Pontos')
    .setColor(cfg?.enabled ? 0x2ecc71 : 0xe74c3c)
    .setDescription([
      `Status: **${cfg?.enabled ? 'Ativado' : 'Desativado'}** (${cfg?.mode || 'GLOBAL'})`,
      `Chat: +${cfg?.pontosChat || 0} | Cooldown: ${cfg?.cooldownChatMinutes || 0} min | Limite diário: ${cfg?.limitDailyChat ?? 'desligado'}`,
      `Call: +${cfg?.pontosCall || 0} a cada ${cfg?.tempoCallMinutes || 0} min | min usuários: ${cfg?.minUserCall || 0}`,
      `Convites: +${cfg?.pontosConvites || 0} | dias convocação: ${cfg?.diasConvite || 0} | tempo servidor: ${cfg?.tempoServerHours || 0}h | idade conta: ${cfg?.idadeContaDias || 0}d`,
      `Chars chat min: ${cfg?.qtdCaracteresMin || 0}`,
      `Canais chat: ${cfg?.chatChannels?.length || 0}`,
      `Roles participante: ${cfg?.participantRoles?.length || 0}`,
      `Roles ignorados: ${cfg?.ignoredRoles?.length || 0} | Usuários ignorados: ${cfg?.ignoredUsers?.length || 0}`,
      `Logs admin: ${cfg?.logsAdminChannelId ? `<#${cfg.logsAdminChannelId}>` : 'nenhum'} | Logs usuários: ${cfg?.logsUsuariosChannelId ? `<#${cfg.logsUsuariosChannelId}>` : 'nenhum'}`,
      `Leaderboard refresh: ${cfg?.leaderboardRefreshMinutes || 10} min`,
    ].join('\n'))
    .setTimestamp(new Date());
}

function buildHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:points:toggle').setLabel('Ativar/Desativar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:points:mode').setLabel('Modo (Global/Seletivo)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:points:numbers1').setLabel('Pontos / Cooldown').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('menu:points:numbers2').setLabel('Call / Regras').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('menu:points:leaderboard').setLabel('Refresh painel').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:points:channels').setLabel('Canais de chat').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:points:roles').setLabel('Cargos participantes').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:points:ignoredroles').setLabel('Cargos ignorados').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:points:ignoredusers').setLabel('Usuários ignorados').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:points:logs').setLabel('Canais de log').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function presentMenu(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.ensurePointsConfig(prisma);
  const fullCfg = await pointsService.getPointsConfig(prisma);
  const embed = buildEmbed(fullCfg || cfg);
  await interaction.editReply({ embeds: [embed], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (interaction.isButton() && interaction.customId === 'menu:points:toggle') {
    return toggleEnabled(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:mode') {
    return toggleMode(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:numbers1') {
    return showNumbersModal(interaction, ctx, 'numbers1');
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:numbers2') {
    return showNumbersModal(interaction, ctx, 'numbers2');
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:channels') {
    return promptChannels(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:roles') {
    return promptRoles(interaction, ctx, 'participant');
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:ignoredroles') {
    return promptRoles(interaction, ctx, 'ignored');
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:ignoredusers') {
    return promptIgnoredUsers(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:logs') {
    return promptLogs(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId === 'menu:points:leaderboard') {
    return promptLeaderboard(interaction, ctx);
  }
  if (interaction.isModalSubmit() && interaction.customId === 'menu:points:numbers1:modal') {
    return handleNumbersModal(interaction, ctx, 'numbers1');
  }
  if (interaction.isModalSubmit() && interaction.customId === 'menu:points:numbers2:modal') {
    return handleNumbersModal(interaction, ctx, 'numbers2');
  }
  if (interaction.isModalSubmit() && interaction.customId === 'menu:points:leaderboard:modal') {
    return handleLeaderboardModal(interaction, ctx);
  }
  if (interaction.isChannelSelectMenu() && interaction.customId === 'menu:points:channels:set') {
    return saveChannels(interaction, ctx);
  }
  if (interaction.isChannelSelectMenu() && interaction.customId === 'menu:points:logs:set') {
    return saveLogs(interaction, ctx);
  }
  if (interaction.isRoleSelectMenu()) {
    if (interaction.customId === 'menu:points:roles:set') return saveRoles(interaction, ctx, 'participant');
    if (interaction.customId === 'menu:points:ignoredroles:set') return saveRoles(interaction, ctx, 'ignored');
  }
  if (interaction.isUserSelectMenu() && interaction.customId === 'menu:points:ignoredusers:set') {
    return saveIgnoredUsers(interaction, ctx);
  }
  return false;
}

async function toggleEnabled(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const next = !cfg.enabled;
  await prisma.pointsConfig.update({ where: { id: cfg.id }, data: { enabled: next } });
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function toggleMode(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const next = cfg.mode === 'SELECTIVE' ? 'GLOBAL' : 'SELECTIVE';
  await prisma.pointsConfig.update({ where: { id: cfg.id }, data: { mode: next } });
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function showNumbersModal(interaction, ctx, which) {
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const modal = new ModalBuilder().setTitle(which === 'numbers1' ? 'Pontos / Cooldown' : 'Call / Convites').setCustomId(`menu:points:${which}:modal`);
  if (which === 'numbers1') {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pontos_chat')
          .setLabel('pontos chat')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.pontosChat ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pontos_call')
          .setLabel('pontos call')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.pontosCall ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pontos_convites')
          .setLabel('pontos convites')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.pontosConvites ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown_chat')
          .setLabel('cooldown_chat (min)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.cooldownChatMinutes ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('limit_diario')
          .setLabel('limite diário (0 = off)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.limitDailyChat ?? 0))),
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tempo_call')
          .setLabel('tempo_call (min)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.tempoCallMinutes ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min_user_call')
          .setLabel('min_user_call')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.minUserCall ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('qtd_caracteres')
          .setLabel('qtd_caracteres')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.qtdCaracteresMin ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dias_convite')
          .setLabel('dias_convite')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.diasConvite ?? 0))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tempo_server')
          .setLabel('tempo_server (h)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(cfg?.tempoServerHours ?? 0))),
    );
  }
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function handleNumbersModal(interaction, ctx, which) {
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const values = {};
  const getVal = (id) => Number(interaction.fields.getTextInputValue(id) || '0');
  if (which === 'numbers1') {
    values.pontosChat = BigInt(Math.max(0, getVal('pontos_chat')));
    values.pontosCall = BigInt(Math.max(0, getVal('pontos_call')));
    values.pontosConvites = BigInt(Math.max(0, getVal('pontos_convites')));
    values.cooldownChatMinutes = getVal('cooldown_chat');
    const lim = getVal('limit_diario');
    values.limitDailyChat = lim > 0 ? BigInt(lim) : null;
  } else {
    values.tempoCallMinutes = getVal('tempo_call');
    values.minUserCall = getVal('min_user_call');
    values.qtdCaracteresMin = getVal('qtd_caracteres');
    values.diasConvite = getVal('dias_convite');
    values.tempoServerHours = getVal('tempo_server');
  }
  await prisma.pointsConfig.update({ where: { id: cfg.id }, data: values });
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function promptChannels(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('menu:points:channels:set')
    .setPlaceholder('Selecione canais para pontuar')
    .setMinValues(0)
    .setMaxValues(10)
    .addChannelTypes(ChannelType.GuildText);
  await interaction.editReply({ embeds: [buildEmbed(cfg)], components: [new ActionRowBuilder().addComponents(select), buildBackRow()] }).catch(() => {});
  return true;
}

async function saveChannels(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const channelIds = interaction.values || [];
  await prisma.pointsChatChannel.deleteMany({ where: { pointsConfigId: cfg.id } });
  if (channelIds.length) {
    await prisma.pointsChatChannel.createMany({ data: channelIds.map((channelId) => ({ pointsConfigId: cfg.id, channelId, guildId: interaction.guildId })) });
  }
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function promptRoles(interaction, ctx, kind) {
  await interaction.deferUpdate().catch(() => {});
  const select = new RoleSelectMenuBuilder()
    .setCustomId(kind === 'participant' ? 'menu:points:roles:set' : 'menu:points:ignoredroles:set')
    .setPlaceholder(kind === 'participant' ? 'Cargos participantes' : 'Cargos ignorados')
    .setMinValues(0)
    .setMaxValues(25);
  await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select), buildBackRow()] }).catch(() => {});
  return true;
}

async function saveRoles(interaction, ctx, kind) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const roleIds = interaction.values || [];
  if (kind === 'participant') {
    await prisma.pointsParticipantRole.deleteMany({ where: { pointsConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.pointsParticipantRole.createMany({ data: roleIds.map((roleId) => ({ pointsConfigId: cfg.id, roleId })) });
    }
  } else {
    await prisma.pointsIgnoredRole.deleteMany({ where: { pointsConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.pointsIgnoredRole.createMany({ data: roleIds.map((roleId) => ({ pointsConfigId: cfg.id, roleId })) });
    }
  }
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function promptIgnoredUsers(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const select = new UserSelectMenuBuilder()
    .setCustomId('menu:points:ignoredusers:set')
    .setPlaceholder('Usuários ignorados')
    .setMinValues(0)
    .setMaxValues(25);
  await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select), buildBackRow()] }).catch(() => {});
  return true;
}

async function saveIgnoredUsers(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const userIds = interaction.values || [];
  await prisma.pointsIgnoredUser.deleteMany({ where: { pointsConfigId: cfg.id } });
  if (userIds.length) {
    await prisma.pointsIgnoredUser.createMany({ data: userIds.map((userId) => ({ pointsConfigId: cfg.id, userId })) });
  }
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

function buildBackRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary));
}

async function promptLogs(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('menu:points:logs:set')
    .setPlaceholder('Selecione canais de log (2 canais)')
    .setMinValues(0)
    .setMaxValues(2)
    .addChannelTypes(ChannelType.GuildText);
  await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select), buildBackRow()] }).catch(() => {});
  return true;
}

async function saveLogs(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const channelIds = interaction.values || [];
  const adminLog = channelIds[0] || null;
  const userLog = channelIds[1] || null;
  await prisma.pointsConfig.update({ where: { id: cfg.id }, data: { logsAdminChannelId: adminLog, logsUsuariosChannelId: userLog } });
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function handleLeaderboardModal(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await pointsService.getPointsConfig(prisma);
  const refresh = Number(interaction.fields.getTextInputValue('refresh') || '10');
  const minutes = Number.isFinite(refresh) && refresh > 0 ? refresh : 10;
  await prisma.pointsConfig.update({ where: { id: cfg.id }, data: { leaderboardRefreshMinutes: minutes } });
  invalidateCache();
  const updated = await pointsService.getPointsConfig(prisma);
  await interaction.editReply({ embeds: [buildEmbed(updated)], components: buildHomeComponents() }).catch(() => {});
  return true;
}

async function promptLeaderboard(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const modal = new ModalBuilder()
    .setCustomId('menu:points:leaderboard:modal')
    .setTitle('Refresh do painel (minutos)');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('refresh').setLabel('Minutos').setStyle(TextInputStyle.Short).setRequired(true)));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

module.exports = {
  presentMenu,
  handleInteraction,
};
