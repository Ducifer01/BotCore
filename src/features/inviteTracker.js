const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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
};

let nextRefreshAt = null;

function registerInviteTracker(client, { isGuildAllowed } = {}) {
  clientRef = client;
  if (typeof isGuildAllowed === 'function') {
    isGuildAllowedFn = isGuildAllowed;
  }

  client.once('ready', async () => {
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
  await interaction.deferUpdate().catch(() => {});
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = (await getGlobalConfig(prisma)) || (await ensureGlobalConfig(prisma));
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const action = parts[2] || 'home';
  const subAction = parts[3];

  if (section !== 'invite') {
    return false;
  }

  if (!subAction && action === 'invite') {
    return renderHome(interaction, cfg);
  }

  if (action === 'toggle') {
    const updated = await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: { inviteTrackingEnabled: !cfg.inviteTrackingEnabled },
    });
    await refreshRuntimeState(prisma, updated);
    if (!updated.inviteTrackingEnabled) {
      await renderRankingDisabled();
    } else {
      await ensureRankingPanel(prisma);
      await enqueueRankingRefresh('toggle');
    }
    return renderHome(interaction, updated, {
      type: 'success',
      message: `Sistema ${updated.inviteTrackingEnabled ? 'ativado' : 'desativado'}.`,
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

  if (action === 'resetconfirm') {
    await performReset(interaction, prisma, cfg);
    return true;
  }

  if (action === 'resetcancel') {
    return renderHome(interaction, cfg, { type: 'info', message: 'Reset cancelado.' });
  }

  if (action === 'refresh') {
    const ok = await enqueueRankingRefresh('manual');
    const status = ok
      ? { type: 'success', message: 'Ranking será atualizado em instantes.' }
      : { type: 'error', message: 'Não há ranking ativo ou o canal não está configurado.' };
    return renderHome(interaction, cfg, status);
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

async function handleRankingButtons(interaction) {
  await interaction.deferUpdate().catch(() => {});
  const customId = interaction.customId;
  const messageId = interaction.message?.id;
  const state = rankingViewState.get(messageId) || { page: 1, totalPages: 1 };

  if (customId === 'inviteRank:prev') {
    state.page = Math.max(1, state.page - 1);
  } else if (customId === 'inviteRank:next') {
    state.page = Math.min(state.totalPages, state.page + 1);
  } else if (customId === 'inviteRank:refresh') {
    await enqueueRankingRefresh('button');
    return true;
  }

  rankingViewState.set(messageId, state);
  await updateRankingMessage({ page: state.page, interaction });
  return true;
}

async function ensurePosse(interaction, ctx) {
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.followUp({ content: 'Apenas o usuário posse pode usar esta seção.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

async function renderHome(interaction, cfg, status) {
  const prisma = getPrisma();
  const guildId = cfg.inviteRankingGuildId || interaction.guildId;
  const totalStats = await prisma.inviteStat.count({ where: guildId ? { guildId } : {} });
  const embed = buildInviteEmbed(cfg, totalStats, status);
  await interaction.editReply({ embeds: [embed], components: buildHomeComponents(cfg) }).catch(() => {});
  return true;
}

function buildInviteEmbed(cfg, totalStats, status) {
  const lines = [];
  lines.push(`Status: **${cfg.inviteTrackingEnabled ? 'Ativo' : 'Inativo'}**`);
  lines.push(`Canal: ${cfg.inviteRankingChannelId ? `<#${cfg.inviteRankingChannelId}>` : 'não definido'}`);
  lines.push(`Entradas registradas: **${totalStats}**`);
  lines.push(`Última atualização: ${cfg.inviteRankingLastRefresh ? formatRelative(new Date(cfg.inviteRankingLastRefresh)) : 'nunca'}`);
  const nextText = cfg.inviteTrackingEnabled && nextRefreshAt
    ? formatRelative(nextRefreshAt)
    : 'quando o sistema estiver ativo';
  lines.push(`Próxima atualização: ${nextText}`);
  const descPrefix = status ? `${statusIcon(status.type)} ${status.message}\n\n` : '';
  return new EmbedBuilder()
    .setTitle('Configurar Ranking de Convites')
    .setDescription(`${descPrefix}${lines.join('\n')}`)
    .setColor(cfg.inviteTrackingEnabled ? 0x57F287 : 0xED4245);
}

function buildHomeComponents(cfg) {
  const toggleLabel = cfg.inviteTrackingEnabled ? 'Desativar Sistema' : 'Ativar Sistema';
  const toggleStyle = cfg.inviteTrackingEnabled ? ButtonStyle.Danger : ButtonStyle.Success;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:invite:toggle').setLabel(toggleLabel).setStyle(toggleStyle),
      new ButtonBuilder().setCustomId('menu:invite:channel').setLabel('Definir Canal').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu:invite:refresh').setLabel('Atualizar Ranking').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:invite:reset').setLabel('Resetar Rank').setStyle(ButtonStyle.Danger),
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
  runtime.enabled = Boolean(cfg.inviteTrackingEnabled);
  runtime.channelId = cfg.inviteRankingChannelId || null;
  runtime.guildId = cfg.inviteRankingGuildId || null;
  runtime.messageId = cfg.inviteRankingMessageId || null;
  runtime.lastRefresh = cfg.inviteRankingLastRefresh ? new Date(cfg.inviteRankingLastRefresh) : null;
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

  if (inviterId) {
    await prisma.inviteStat.upsert({
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
  }

  if (runtime.enabled) {
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
  if (runtime.lastRefresh) {
    embed.addFields({ name: 'Última atualização', value: formatRelative(runtime.lastRefresh), inline: true });
  }
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
      new ButtonBuilder()
        .setCustomId('inviteRank:refresh')
        .setLabel('Atualizar agora')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!runtime.enabled),
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
