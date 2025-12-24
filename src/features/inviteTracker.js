const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');
const { getPointsConfig, ensurePointsConfig, handleInviteJoin: handlePointsInviteJoin, handleInviteLeave: handlePointsInviteLeave } = require('../services/points');

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const inviteCache = new Map(); // guildId -> Map<code, uses>
const rankingViewState = new Map(); // messageId -> { page, totalPages }

let clientRef = null;
let isGuildAllowedFn = () => true;
let autoRefreshHandle = null;
let refreshingRanking = false;
let pendingRefresh = false;

const runtime = {
  globalConfigId: null,
  enabled: false,
  channelId: null,
  guildId: null,
  messageId: null,
  lastRefresh: null,
  logChannelId: null,
  filterEnabled: false,
  filterMinDays: 7,
};

let nextRefreshAt = null;

function registerInviteTracker(client, { isGuildAllowed } = {}) {
  clientRef = client;
  if (typeof isGuildAllowed === 'function') {
    isGuildAllowedFn = isGuildAllowed;
  }

  client.once('clientReady', async () => {
    const prisma = getPrisma();
    await refreshRuntimeState(prisma);
    await bootstrapInviteCache();
    startAutoRefreshLoop();
    await ensureRankingPanel(prisma);
  });

  client.on('guildMemberAdd', async (member) => {
    try {
      if (!isGuildAllowedFn(member.guild.id)) return;
      await handleMemberJoin(member);
    } catch (error) {
      console.warn('[invites] Falha ao processar entrada de membro:', error?.message || error);
    }
  });

  client.on('inviteCreate', (invite) => {
    if (!invite?.guildId || !invite?.code) return;
    const guildMap = inviteCache.get(invite.guildId) || new Map();
    guildMap.set(invite.code, invite.uses ?? 0);
    inviteCache.set(invite.guildId, guildMap);
  });

  client.on('inviteDelete', (invite) => {
    if (!invite?.guildId || !invite?.code) return;
    const guildMap = inviteCache.get(invite.guildId);
    if (!guildMap) return;
    guildMap.delete(invite.code);
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      if (!isGuildAllowedFn(member.guild.id)) return;
      const prisma = getPrisma();
      const pointsCfg = await getPointsConfig(prisma);
      if (!pointsCfg?.enabled) return;
      await handlePointsInviteLeave({ guildId: member.guild.id, inviteeId: member.id, prisma, cfg: pointsCfg });
    } catch (error) {
      console.warn('[invites->points] Falha ao processar saída de membro:', error?.message || error);
    }
  });
}

async function presentMenu(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  const guildId = cfg.inviteRankingGuildId || interaction.guildId;
  const totalStats = await prisma.inviteStat.count({ where: guildId ? { guildId } : {} });
  const embed = buildInviteEmbed(cfg, totalStats);
  await interaction.editReply({ embeds: [embed], components: buildHomeComponents(cfg) }).catch(() => {});
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (interaction.isModalSubmit() && interaction.customId === 'menu:invite:filter:days:modal') {
    return handleFilterModal(interaction, ctx);
  }
  const id = interaction.customId;
  if (!id) return false;

  if (id.startsWith('menu:invite')) {
    if (interaction.isButton()) {
      return handleMenuButtons(interaction, ctx);
    }
    if (interaction.isChannelSelectMenu()) {
      return handleChannelSelect(interaction, ctx);
    }
  }

  if (id.startsWith('inviteRank:') && interaction.isButton()) {
    return handleRankingButtons(interaction);
  }

  return false;
}

async function handleMenuButtons(interaction, ctx) {
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const action = parts[2] || 'home';
  const subAction = parts[3];
  const opensModal = section === 'invite' && action === 'filter' && subAction === 'days';
  if (!opensModal) {
    await interaction.deferUpdate().catch(() => {});
  }
  const prisma = ctx.getPrisma();
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));

  if (section !== 'invite') {
    return false;
  }

  if (!subAction && action === 'invite') {
    return renderHome(interaction, cfg);
  }

  if (action === 'toggle') {
    const currentStatus = resolveRankingEnabled(cfg);
    const nextStatus = !currentStatus;
    const updated = await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: {
        inviteRankingEnabled: nextStatus,
        inviteTrackingEnabled: nextStatus,
      },
    });
    await refreshRuntimeState(prisma, updated);
    if (!nextStatus) {
      await renderRankingDisabled();
    } else {
      await ensureRankingPanel(prisma);
      await enqueueRankingRefresh('toggle');
    }
    return renderHome(interaction, updated, {
      type: 'success',
      message: `Sistema ${nextStatus ? 'ativado' : 'desativado'}.`,
    });
  }

  if (action === 'channel' && !subAction) {
    return renderChannelPrompt(interaction, cfg);
  }

  if (action === 'channel' && subAction === 'clear') {
    await deleteRankingMessage();
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteRankingChannelId: null, inviteRankingGuildId: null, inviteRankingMessageId: null },
    });
    const updatedCfg = {
      ...cfg,
      inviteRankingChannelId: null,
      inviteRankingGuildId: null,
      inviteRankingMessageId: null,
    };
    await refreshRuntimeState(prisma, updatedCfg);
    return renderHome(interaction, updatedCfg, { type: 'info', message: 'Canal removido.' });
  }

  if (action === 'reset' && !subAction) {
    return showResetPrompt(interaction);
  }

  if (action === 'log' && !subAction) {
    return renderLogChannelPrompt(interaction, cfg);
  }

  if (action === 'log' && subAction === 'clear') {
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteLogChannelId: null },
    });
    const updatedCfg = { ...cfg, inviteLogChannelId: null };
    await refreshRuntimeState(prisma, updatedCfg);
    return renderHome(interaction, updatedCfg, { type: 'info', message: 'Canal de log removido.' });
  }

  if (action === 'filter' && !subAction) {
    return renderFilterPanel(interaction, cfg);
  }

  if (action === 'filter' && subAction === 'toggle') {
    const nextStatus = !cfg.inviteAccountAgeFilterEnabled;
    const updated = await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteAccountAgeFilterEnabled: nextStatus },
    });
    await refreshRuntimeState(prisma, updated);
    return renderFilterPanel(interaction, updated, {
      type: 'success',
      message: `Filtro ${nextStatus ? 'ativado' : 'desativado'}.`,
    });
  }

  if (action === 'filter' && subAction === 'days') {
    return showFilterDaysModal(interaction, cfg);
  }

  if (action === 'antireentry') {
    return handleAntiReentryToggle(interaction, ctx);
  }

  if (action === 'resetconfirm') {
    await performReset(interaction, prisma, cfg);
    return true;
  }

  if (action === 'resetcancel') {
    return renderHome(interaction, cfg, { type: 'info', message: 'Reset cancelado.' });
  }

  if (action === 'home') {
    return renderHome(interaction, cfg);
  }

  return false;
}

async function handleChannelSelect(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  const channelId = interaction.values?.[0];
  if (!channelId) {
    return renderHome(interaction, cfg, { type: 'error', message: 'Seleção inválida.' });
  }
  if (interaction.customId === 'menu:invite:channel:set') {
    await deleteRankingMessage();
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteRankingChannelId: channelId, inviteRankingGuildId: interaction.guildId, inviteRankingMessageId: null },
    });
    await refreshRuntimeState(prisma);
    await ensureRankingPanel(prisma);
    return renderHome(interaction, { ...cfg, inviteRankingChannelId: channelId, inviteRankingGuildId: interaction.guildId }, {
      type: 'success',
      message: `Ranking será publicado em <#${channelId}>.`,
    });
  }

  if (interaction.customId === 'menu:invite:log:set') {
    const updated = await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteLogChannelId: channelId },
    });
    await refreshRuntimeState(prisma, updated);
    return renderHome(interaction, updated, { type: 'success', message: `Logs serão enviados em <#${channelId}>.` });
  }

  return false;
}

async function handleRankingButtons(interaction) {
  await interaction.deferUpdate().catch(() => {});
  const customId = interaction.customId;
  const messageId = interaction.message?.id;
  const state = rankingViewState.get(messageId) || { page: 1, totalPages: 1 };

  if (customId === 'inviteRank:prev') {
    state.page = Math.max(1, state.page - 1); // No-op change
  } else if (customId === 'inviteRank:next') {
    state.page = Math.min(state.totalPages, state.page + 1);
  }

  rankingViewState.set(messageId, state);
  await updateRankingMessage({ page: state.page, interaction });
  return true;
}

async function handleFilterModal(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  const raw = interaction.fields.getTextInputValue('menu:invite:filter:days:value');
  let minDays = parseInt(raw, 10);
  if (!Number.isFinite(minDays) || minDays < 1) {
    minDays = 1;
  }
  if (minDays > 365) {
    minDays = 365;
  }
  const updated = await prisma.globalConfig.update({
    where: { id: cfg.id },
    data: { inviteAccountAgeMinDays: minDays },
  });
  await refreshRuntimeState(prisma, updated);
  return renderFilterPanel(interaction, updated, {
    type: 'success',
    message: `Filtro ajustado para contas com pelo menos ${minDays} dias.`,
  });
}

async function ensurePosse(interaction, ctx) {
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.followUp({ content: 'Apenas o usuário posse pode usar esta seção.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

async function handleAntiReentryToggle(interaction, ctx) {
  const prisma = ctx.getPrisma();
  await ensurePointsConfig(prisma);
  const pointsCfg = await getPointsConfig(prisma);
  const next = !(pointsCfg?.inviteAntiReentryEnabled !== false);
  await prisma.pointsConfig.update({ where: { id: pointsCfg.id }, data: { inviteAntiReentryEnabled: next } });
  const updatedPointsCfg = await getPointsConfig(prisma);
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  const merged = { ...cfg, inviteAntiReentryEnabled: updatedPointsCfg?.inviteAntiReentryEnabled };
  return renderHome(interaction, merged, { type: 'success', message: `Anti reentrada ${next ? 'ativado' : 'desativado'}.` });
}

async function renderHome(interaction, cfg, status) {
  const prisma = getPrisma();
  const pointsCfg = await getPointsConfig(prisma);
  const merged = { ...cfg, inviteAntiReentryEnabled: pointsCfg?.inviteAntiReentryEnabled }; // merge info from pontos
  const guildId = cfg.inviteRankingGuildId || interaction.guildId;
  const totalStats = await prisma.inviteStat.count({ where: guildId ? { guildId } : {} });
  const embed = buildInviteEmbed(merged, totalStats, status);
  await interaction.editReply({ embeds: [embed], components: buildHomeComponents(merged) }).catch(() => {});
  return true;
}

function resolveRankingEnabled(cfg) {
  if (typeof cfg?.inviteRankingEnabled === 'boolean') {
    return cfg.inviteRankingEnabled;
  }
  return Boolean(cfg?.inviteTrackingEnabled);
}

function buildInviteEmbed(cfg, totalStats, status) {
  const rankingEnabled = resolveRankingEnabled(cfg);
  const antiReentry = cfg.inviteAntiReentryEnabled !== false;
  const lines = [];
  lines.push(`Status: **${rankingEnabled ? 'Ativo' : 'Inativo'}**`);
  lines.push(`Canal: ${cfg.inviteRankingChannelId ? `<#${cfg.inviteRankingChannelId}>` : 'não definido'}`);
  lines.push(`Log: ${cfg.inviteLogChannelId ? `<#${cfg.inviteLogChannelId}>` : 'não definido'}`);
  lines.push(`Entradas registradas: **${totalStats}**`);
  const filterStatus = cfg.inviteAccountAgeFilterEnabled
    ? `Ativo (≥ ${cfg.inviteAccountAgeMinDays || 0} dias)`
    : 'Inativo';
  lines.push(`Filtro conta: ${filterStatus}`);
  lines.push(`Anti reentrada: **${antiReentry ? 'Ativo' : 'Inativo'}**`);
  const nextText = rankingEnabled && nextRefreshAt
    ? formatRelative(nextRefreshAt)
    : 'quando o sistema estiver ativo';
  lines.push(`Próxima atualização: ${nextText}`);
  const descPrefix = status ? `${statusIcon(status.type)} ${status.message}\n\n` : '';
  return new EmbedBuilder()
    .setTitle('Configurar Ranking de Convites')
    .setDescription(`${descPrefix}${lines.join('\n')}`)
    .setColor(rankingEnabled ? 0x57F287 : 0xED4245);
}

function buildHomeComponents(cfg) {
  const rankingEnabled = resolveRankingEnabled(cfg);
  const toggleLabel = rankingEnabled ? 'Desativar Sistema' : 'Ativar Sistema';
  const toggleStyle = rankingEnabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const antiReentry = cfg.inviteAntiReentryEnabled !== false;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:invite:toggle').setLabel(toggleLabel).setStyle(toggleStyle),
      new ButtonBuilder().setCustomId('menu:invite:channel').setLabel('Definir Canal').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:invite:reset').setLabel('Resetar Rank').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:invite:log').setLabel('Canal de Log').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:invite:filter').setLabel('Filtro de Contas').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:invite:antireentry').setLabel(antiReentry ? 'Anti reentrada: ON' : 'Anti reentrada: OFF').setStyle(antiReentry ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  ];
}

async function renderChannelPrompt(interaction, cfg) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('menu:invite:channel:set')
    .setPlaceholder('Escolha o canal para o ranking')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (cfg.inviteRankingChannelId) {
    select.setDefaultChannels(cfg.inviteRankingChannelId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Canal do Ranking')
    .setDescription('Selecione o canal onde o ranking será mantido.')
    .setColor(0x5865F2);
  const row = new ActionRowBuilder().addComponents(select);
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:invite:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('menu:invite:channel:clear')
      .setLabel('Remover Canal')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!cfg.inviteRankingChannelId),
  );
  await interaction.editReply({ embeds: [embed], components: [row, nav] }).catch(() => {});
  return true;
}

async function renderLogChannelPrompt(interaction, cfg) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('menu:invite:log:set')
    .setPlaceholder('Escolha o canal de logs')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (cfg.inviteLogChannelId) {
    select.setDefaultChannels(cfg.inviteLogChannelId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Canal de Logs de Convites')
    .setDescription('Selecione o canal onde enviarei os logs de novas entradas por convite.')
    .setColor(0x57F287);
  const row = new ActionRowBuilder().addComponents(select);
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:invite:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('menu:invite:log:clear')
      .setLabel('Remover Canal')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!cfg.inviteLogChannelId),
  );
  await interaction.editReply({ embeds: [embed], components: [row, nav] }).catch(() => {});
  return true;
}

async function showResetPrompt(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Resetar Ranking')
    .setDescription('Tem certeza? Isso vai apagar todo o histórico do ranking de convites.')
    .setColor(0xED4245);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:invite:resetconfirm').setLabel('Sim, resetar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('menu:invite:resetcancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
  return true;
}

function buildFilterEmbed(cfg, status) {
  const lines = [];
  const enabled = cfg.inviteAccountAgeFilterEnabled;
  lines.push(`Status: **${enabled ? 'Ativo' : 'Inativo'}**`);
  lines.push(`Dias mínimos: **${cfg.inviteAccountAgeMinDays || 0}**`);
  const desc = status ? `${statusIcon(status.type)} ${status.message}\n\n` : '';
  return new EmbedBuilder()
    .setTitle('Filtro por idade da conta')
    .setDescription(`${desc}Quando ativo, somente contas com pelo menos X dias serão contabilizadas.`)
    .addFields({ name: 'Configuração atual', value: lines.join('\n') })
    .setColor(enabled ? 0x57F287 : 0x5865F2);
}

async function renderFilterPanel(interaction, cfg, status) {
  const embed = buildFilterEmbed(cfg, status);
  const toggleLabel = cfg.inviteAccountAgeFilterEnabled ? 'Desativar filtro' : 'Ativar filtro';
  const toggleStyle = cfg.inviteAccountAgeFilterEnabled ? ButtonStyle.Danger : ButtonStyle.Success;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:invite:filter:toggle').setLabel(toggleLabel).setStyle(toggleStyle),
    new ButtonBuilder().setCustomId('menu:invite:filter:days').setLabel('Definir dias').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:invite:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
  return true;
}

async function showFilterDaysModal(interaction, cfg) {
  const modal = new ModalBuilder()
    .setCustomId('menu:invite:filter:days:modal')
    .setTitle('Definir mínimo de dias');
  const input = new TextInputBuilder()
    .setCustomId('menu:invite:filter:days:value')
    .setLabel('Dias mínimos da conta')
    .setPlaceholder('Ex: 7')
    .setRequired(true)
    .setValue(String(cfg.inviteAccountAgeMinDays || 7))
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function performReset(interaction, prisma, cfg) {
  const guildId = cfg.inviteRankingGuildId || interaction.guildId;
  await prisma.inviteStat.deleteMany({ where: guildId ? { guildId } : {} });
  await prisma.inviteEvent.deleteMany({ where: guildId ? { guildId } : {} });
  await enqueueRankingRefresh('reset');
  await renderHome(interaction, cfg, { type: 'success', message: 'Ranking limpo com sucesso.' });
}

function statusIcon(type) {
  if (type === 'success') return '✅';
  if (type === 'error') return '⚠️';
  return 'ℹ️';
}

function formatRelative(date) {
  if (!date) return 'nunca';
  const ts = Math.floor(date.getTime() / 1000);
  return `<t:${ts}:R>`;
}

async function refreshRuntimeState(prisma = getPrisma(), forcedConfig) {
  let cfg = forcedConfig;
  if (!cfg) {
    cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  }
  runtime.globalConfigId = cfg.id;
  runtime.enabled = resolveRankingEnabled(cfg);
  runtime.channelId = cfg.inviteRankingChannelId || null;
  runtime.guildId = cfg.inviteRankingGuildId || null;
  runtime.messageId = cfg.inviteRankingMessageId || null;
  runtime.lastRefresh = cfg.inviteRankingLastRefresh ? new Date(cfg.inviteRankingLastRefresh) : null;
  runtime.logChannelId = cfg.inviteLogChannelId || null;
  runtime.filterEnabled = Boolean(cfg.inviteAccountAgeFilterEnabled);
  runtime.filterMinDays = cfg.inviteAccountAgeMinDays || 7;
  return cfg;
}

async function bootstrapInviteCache() {
  if (!clientRef) return;
  const guilds = clientRef.guilds.cache;
  for (const guild of guilds.values()) {
    if (!isGuildAllowedFn(guild.id)) continue;
    await snapshotGuildInvites(guild).catch(() => {});
  }
}

async function snapshotGuildInvites(guild) {
  const collection = await guild.invites.fetch().catch(() => null);
  if (!collection) return;
  const map = new Map();
  for (const invite of collection.values()) {
    map.set(invite.code, invite.uses ?? 0);
  }
  inviteCache.set(guild.id, map);
}

async function handleMemberJoin(member) {
  if (!clientRef) return;
  const guild = member.guild;
  const before = new Map(inviteCache.get(guild.id) || []);
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  let usedInvite = null;
  for (const invite of invites.values()) {
    const prevUses = before.get(invite.code) ?? 0;
    if ((invite.uses ?? 0) > prevUses) {
      usedInvite = invite;
      break;
    }
  }
  const latestMap = new Map();
  for (const invite of invites.values()) {
    latestMap.set(invite.code, invite.uses ?? 0);
  }
  inviteCache.set(guild.id, latestMap);

  const prisma = getPrisma();
  const cfg = runtime.globalConfigId ? null : await refreshRuntimeState(prisma);
  const globalConfigId = runtime.globalConfigId || cfg?.id;
  if (!globalConfigId) return;

  const inviterId = usedInvite?.inviter?.id || null;
  const inviterTag = usedInvite?.inviter?.tag || usedInvite?.inviter?.username || null;
  const inviteCode = usedInvite?.code || null;

  if (!inviterId || !inviteCode) {
    return;
  }

  const filterEnabled = runtime.filterEnabled;
  const minDays = runtime.filterMinDays || 0;
  const createdAt = member.user?.createdAt ? member.user.createdAt.getTime() : null;
  const accountAgeMs = createdAt ? Date.now() - createdAt : Number.MAX_SAFE_INTEGER;
  const meetsFilter = !filterEnabled || accountAgeMs >= minDays * DAY_MS;

  let totalUses = null;

  if (meetsFilter) {
    await prisma.inviteEvent.create({
      data: {
        globalConfigId,
        guildId: guild.id,
        userId: member.id,
        inviterId,
        inviterTag,
        inviteCode,
      },
    }).catch(() => {});

    const stat = await prisma.inviteStat.upsert({
      where: {
        globalConfigId_guildId_inviterId: {
          globalConfigId,
          guildId: guild.id,
          inviterId,
        },
      },
      update: {
        uses: { increment: 1 },
        inviteCode,
        inviterTag,
        lastJoinedUserId: member.id,
        lastJoinAt: new Date(),
      },
      create: {
        globalConfigId,
        guildId: guild.id,
        inviterId,
        inviterTag,
        inviteCode,
        uses: 1,
        lastJoinedUserId: member.id,
        lastJoinAt: new Date(),
      },
    });
    totalUses = stat?.uses ?? null;
  }

  await sendInviteLog({
    member,
    inviteCode,
    inviterId,
    inviterTag,
    counted: meetsFilter,
    minDays,
    totalUses,
  });

  // Integração com sistema de pontos (convites)
  if (meetsFilter && inviterId) {
    try {
      const pointsCfg = await getPointsConfig(prisma);
      if (pointsCfg?.enabled) {
        const accountAgeDays = createdAt ? (Date.now() - createdAt) / DAY_MS : Number.MAX_SAFE_INTEGER;
        await handlePointsInviteJoin({
          guildId: guild.id,
          inviterId,
          inviteeId: member.id,
          invitedAt: new Date(),
          accountAgeDays,
          prisma,
          cfg: pointsCfg,
        });
      }
    } catch (err) {
      console.warn('[invites->points] falha ao registrar convite:', err?.message || err);
    }
  }

  if (meetsFilter && runtime.enabled) {
    await enqueueRankingRefresh('member-join');
  }
}

function startAutoRefreshLoop() {
  if (autoRefreshHandle) {
    clearInterval(autoRefreshHandle);
  }
  autoRefreshHandle = setInterval(() => {
    if (!runtime.enabled) return;
    enqueueRankingRefresh('interval');
  }, REFRESH_INTERVAL_MS);
}

async function enqueueRankingRefresh(reason = 'auto') {
  if (!runtime.enabled || !runtime.channelId) {
    return false;
  }
  if (refreshingRanking) {
    pendingRefresh = true;
    return true;
  }
  await refreshRankingMessage({ page: 1, reason });
  return true;
}

async function refreshRankingMessage({ page = 1 } = {}) {
  refreshingRanking = true;
  try {
    const prisma = getPrisma();
    if (!runtime.channelId || !clientRef) {
      return;
    }
    const channel = await clientRef.channels.fetch(runtime.channelId).catch(() => null);
    if (!channel) {
      runtime.channelId = null;
      runtime.messageId = null;
      rankingViewState.clear();
      await prisma.globalConfig.update({
        where: { id: runtime.globalConfigId },
        data: { inviteRankingChannelId: null, inviteRankingMessageId: null },
      }).catch(() => {});
      return;
    }
    if (!runtime.guildId) {
      runtime.guildId = channel.guildId;
      await prisma.globalConfig.update({
        where: { id: runtime.globalConfigId },
        data: { inviteRankingGuildId: channel.guildId },
      }).catch(() => {});
    }
    const message = runtime.messageId
      ? await channel.messages.fetch(runtime.messageId).catch(() => null)
      : null;
    const { embeds, components, totalPages } = await buildRankingPayload({ page, guildId: runtime.guildId || channel.guildId });
    const messagePayload = { embeds, components };
    let targetMessage = message;
    if (targetMessage) {
      await targetMessage.edit(messagePayload).catch(() => {});
    } else {
      targetMessage = await channel.send(messagePayload).catch(() => null);
      if (targetMessage) {
        runtime.messageId = targetMessage.id;
        await prisma.globalConfig.update({
          where: { id: runtime.globalConfigId },
          data: { inviteRankingMessageId: targetMessage.id },
        }).catch(() => {});
      }
    }
    if (targetMessage) {
      rankingViewState.set(targetMessage.id, { page, totalPages: totalPages || 1 });
    }
    runtime.lastRefresh = new Date();
    nextRefreshAt = new Date(Date.now() + REFRESH_INTERVAL_MS);
    await prisma.globalConfig.update({
      where: { id: runtime.globalConfigId },
      data: { inviteRankingLastRefresh: runtime.lastRefresh },
    }).catch(() => {});
  } finally {
    refreshingRanking = false;
    if (pendingRefresh) {
      pendingRefresh = false;
      await enqueueRankingRefresh('pending');
    }
  }
}

async function updateRankingMessage({ page, interaction }) {
  if (!interaction) return;
  const { embeds, components, totalPages } = await buildRankingPayload({ page, guildId: runtime.guildId || interaction.guildId });
  await interaction.editReply({ embeds, components }).catch(() => {});
  if (interaction.message?.id) {
    rankingViewState.set(interaction.message.id, { page, totalPages: totalPages || 1 });
  }
}

async function sendInviteLog({ member, inviteCode, inviterId, inviterTag, counted, minDays, totalUses }) {
  if (!clientRef) return;
  const channelId = runtime.logChannelId;
  if (!channelId) return;
  const channel = await clientRef.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    runtime.logChannelId = null;
    const prisma = getPrisma();
    await prisma.globalConfig.update({
      where: { id: runtime.globalConfigId },
      data: { inviteLogChannelId: null },
    }).catch(() => {});
    return;
  }
  const userMention = member?.id ? `<@${member.id}>` : member?.user?.username || 'Usuário';
  const inviterMention = inviterId ? `<@${inviterId}>` : inviterTag || 'Desconhecido';
  const inviteLabel = inviteCode ? `\`${inviteCode}\`` : 'desconhecido';
  let description = `${userMention} entrou no servidor usando o convite ${inviteLabel}, criado por ${inviterMention}.`;
  if (!counted) {
    const effectiveMinDays = Math.max(1, minDays || 1);
    description += ` Atenção: a conta possui menos de ${effectiveMinDays} dias. **NÃO CONTABILIZADO.**`;
  } else if (typeof totalUses === 'number') {
    description += ` Agora ${inviterMention} possui **${totalUses}** convites.`;
  }
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setDescription(description)
    .setTimestamp(new Date());
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function buildRankingPayload({ page = 1, guildId }) {
  const prisma = getPrisma();
  const skip = Math.max(0, (page - 1) * PAGE_SIZE);
  const [entries, total] = await Promise.all([
    prisma.inviteStat.findMany({
      where: guildId ? { guildId } : {},
      orderBy: [{ uses: 'desc' }, { inviterId: 'asc' }],
      skip,
      take: PAGE_SIZE,
    }),
    prisma.inviteStat.count({ where: guildId ? { guildId } : {} }),
  ]);
  const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
  const lines = entries.length
    ? entries.map((stat, index) => {
        const position = skip + index + 1;
        const label = stat.inviterTag || stat.inviterId || 'Desconhecido';
        return `**${position}.** ${label} — **${stat.uses}** convites`;
      })
    : ['Ainda não há convites registrados.'];
  const embed = new EmbedBuilder()
    .setTitle('Ranking de Convites')
    .setDescription(lines.join('\n'))
    .setColor(entries.length ? 0x5865F2 : 0x2b2d31)
    .setFooter({ text: `Página ${page}/${totalPages}` });
  const nextField = runtime.enabled && nextRefreshAt
    ? formatRelative(nextRefreshAt)
    : 'quando o sistema estiver ativo';
  embed.addFields({ name: 'Ranking atualizará em', value: nextField, inline: true });
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('inviteRank:prev')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1 || !runtime.enabled),
      new ButtonBuilder()
        .setCustomId('inviteRank:next')
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages || !runtime.enabled),
    ),
  ];
  return { embeds: [embed], components, totalPages };
}

async function ensureRankingPanel(prisma = getPrisma()) {
  if (!runtime.channelId || !runtime.enabled || !clientRef) {
    await renderRankingDisabled();
    return;
  }
  await refreshRankingMessage({ page: 1 });
}

async function renderRankingDisabled() {
  if (!runtime.channelId || !runtime.messageId || !clientRef) {
    return;
  }
  const channel = await clientRef.channels.fetch(runtime.channelId).catch(() => null);
  if (!channel) return;
  const message = await channel.messages.fetch(runtime.messageId).catch(() => null);
  if (!message) return;
  const embed = new EmbedBuilder()
    .setTitle('Ranking de Convites')
    .setDescription('O sistema está desativado no momento.')
    .setColor(0x2b2d31);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('inviteRank:disabled').setLabel('Desativado').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  await message.edit({ embeds: [embed], components: [row] }).catch(() => {});
  rankingViewState.delete(message.id);
}

async function deleteRankingMessage() {
  if (!runtime.channelId || !runtime.messageId || !clientRef) {
    return;
  }
  const channel = await clientRef.channels.fetch(runtime.channelId).catch(() => null);
  if (!channel) {
    runtime.messageId = null;
    rankingViewState.clear();
    return;
  }
  await channel.messages.delete(runtime.messageId).catch(() => {});
  rankingViewState.delete(runtime.messageId);
  runtime.messageId = null;
}

module.exports = {
  registerInviteTracker,
  presentMenu,
  handleInteraction,
};
