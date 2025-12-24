const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getPrisma } = require('../db');
const { ensureGlobalConfig } = require('../services/globalConfig');

const COLLECTOR_TIMEOUT_MS = 60_000;
const MAX_MESSAGES_PER_SWEEP = 1_000;
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 6 * 60 * 60;
const DURATION_REGEX = /^(\d+)\s*([smh])$/i;
const BULK_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_BULK_DELETE = 100;

let clientRef = null;

const runtime = {
  globalConfigId: null,
  panels: [],
};

const jobs = new Map();
const activeRuns = new Set();
const textCollectors = new Map();
const creationSessions = new Map();

function registerChannelCleaner(client) {
  clientRef = client;

  client.once('ready', async () => {
    try {
      const prisma = getPrisma();
      await refreshPanels(prisma);
      restartJobs();
    } catch (error) {
      console.warn('[cleaner] Falha ao preparar jobs:', error?.message || error);
    }
  });
}

async function presentMenu(interaction, ctx) {
  await deferIfNeeded(interaction);
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  cancelCollector(interaction.user.id);
  const prisma = ctx.getPrisma();
  const panels = await refreshPanels(prisma);
  restartJobs();
  await interaction
    .editReply({ embeds: [buildHomeEmbed(panels)], components: buildHomeComponents(panels) })
    .catch(() => {});
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (interaction.isModalSubmit() && interaction.customId?.startsWith('menu:cleaner')) {
    return handleCleanerModal(interaction, ctx);
  }

  const id = interaction.customId;
  if (!id || !id.startsWith('menu:cleaner')) {
    return false;
  }

  const skipDefer = interaction.isButton() && shouldOpenCleanerModal(id);
  if (!skipDefer) {
    await deferIfNeeded(interaction);
  }

  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }

  if (interaction.isButton()) {
    return handleCleanerButton(interaction, ctx);
  }
  if (interaction.isStringSelectMenu()) {
    return handleCleanerSelect(interaction, ctx);
  }
  if (interaction.isChannelSelectMenu()) {
    return handleCleanerChannelSelect(interaction, ctx);
  }
  return false;
}

async function handleCleanerButton(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const parts = interaction.customId.split(':');
  const action = parts[2];
  const sub = parts[3];
  const detail = parts[4];

  if (action === 'home') {
    cancelCollector(interaction.user.id);
    return renderHome(interaction, prisma);
  }

  if (action === 'create') {
    if (sub === 'cancel') {
      cancelCollector(interaction.user.id);
      creationSessions.delete(interaction.user.id);
      return renderHome(interaction, prisma, { type: 'info', message: 'Criação cancelada.' });
    }
    if (sub === 'finish') {
      return finishCreation(interaction, prisma);
    }
    if (sub === 'filter-modal') {
      const session = creationSessions.get(interaction.user.id);
      if (!session) {
        return renderHome(interaction, prisma, { type: 'error', message: 'Sessão expirada. Clique em "Criar painel" novamente.' });
      }
      return showCreationFilterModal(interaction, session);
    }
    cancelCollector(interaction.user.id);
    return startCreationFlow(interaction, prisma);
  }

  if (action === 'panel') {
    const panelId = Number(sub);
    if (!Number.isInteger(panelId)) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Painel inválido.' });
    }
    if (detail === 'view' || !detail) {
      cancelCollector(interaction.user.id);
      return renderPanel(interaction, prisma, panelId);
    }
    if (detail === 'toggle') {
      return togglePanel(interaction, prisma, panelId);
    }
    if (detail === 'run') {
      return executePanelNow(interaction, prisma, panelId);
    }
    if (detail === 'delete') {
      return renderDeleteConfirm(interaction, prisma, panelId);
    }
    if (detail === 'delete-confirm') {
      return deletePanel(interaction, prisma, panelId);
    }
    if (detail === 'delete-cancel') {
      return renderPanel(interaction, prisma, panelId, { type: 'info', message: 'Exclusão cancelada.' });
    }
    if (detail === 'edit-config') {
      cancelCollector(interaction.user.id);
      return showPanelConfigModal(interaction, prisma, panelId);
    }
    if (detail === 'filter-add') {
      cancelCollector(interaction.user.id);
      return showFilterModal(interaction, prisma, panelId);
    }
    if (detail === 'filter-remove') {
      return clearFilter(interaction, prisma, panelId);
    }
    if (detail === 'filter-list') {
      const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
      if (!panel) {
        return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
      }
      await renderPanel(interaction, prisma, panelId);
      const ids = parseFilterIds(panel.filterMessageId);
      const message = ids.length
        ? `Filtro atual: não apaga as mensagens com ID ${formatFilterValue(ids)}.`
        : 'Este painel não possui filtro configurado.';
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function handleCleanerSelect(interaction, ctx) {
  if (interaction.customId !== 'menu:cleaner:panel:select') {
    return false;
  }
  const prisma = ctx.getPrisma();
  const value = interaction.values?.[0];
  const panelId = Number(value);
  if (!Number.isInteger(panelId)) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
  }
  cancelCollector(interaction.user.id);
  return renderPanel(interaction, prisma, panelId);
}

async function handleCleanerChannelSelect(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const id = interaction.customId;
  const selected = interaction.values?.[0];
  cancelCollector(interaction.user.id);

  if (id === 'menu:cleaner:create:channel') {
    const session = creationSessions.get(interaction.user.id);
    if (!session) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Sessão expirada.' });
    }
    session.data.channelId = selected;
    session.data.guildId = interaction.guildId;
    return renderCreationFilterStep(interaction, session);
  }

  if (id.startsWith('menu:cleaner:panel:')) {
    const panelId = Number(id.split(':')[3]);
    if (!Number.isInteger(panelId)) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Painel inválido.' });
    }
    const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
    if (!panel) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
    }
    await prisma.channelCleanerPanel.update({
      where: { id: panelId },
      data: { channelId: selected, guildId: interaction.guildId },
    });
    await refreshPanels(prisma);
    restartJobs();
    return renderPanel(interaction, prisma, panelId, { type: 'success', message: 'Canal atualizado.' });
  }

  return false;
}

async function showFilterModal(interaction, prisma, panelId) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  const current = formatFilterValue(parseFilterIds(panel.filterMessageId));
  const modal = new ModalBuilder()
    .setCustomId(`menu:cleaner:panel:${panelId}:filter-modal`)
    .setTitle('Filtro de mensagens');
  const input = new TextInputBuilder()
    .setCustomId('menu:cleaner:panel:filter:ids')
    .setLabel('IDs separados por vírgula')
    .setPlaceholder('Ex: 1453465273259659360, 1453465276254392351')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  if (current && current !== 'Não definido') {
    input.setValue(current);
  }
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function showCreationFilterModal(interaction, session) {
  const current = formatFilterValue(parseFilterIds(session.data.filterMessageId));
  const modal = new ModalBuilder().setCustomId('menu:cleaner:create:filter-modal').setTitle('Filtro de mensagens');
  const input = new TextInputBuilder()
    .setCustomId('menu:cleaner:panel:filter:ids')
    .setLabel('IDs separados por vírgula')
    .setPlaceholder('Ex: 1453465273259659360, 1453465276254392351')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  if (current && current !== 'Não definido') {
    input.setValue(current);
  }
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function handleCleanerModal(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const id = interaction.customId;
  if (id === 'menu:cleaner:create:modal') {
    const session = creationSessions.get(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: 'Sessão expirada. Clique em "Criar painel" novamente.', ephemeral: true }).catch(() => {});
      return true;
    }
    const rawName = interaction.fields.getTextInputValue('menu:cleaner:create:name')?.trim();
    const rawInterval = interaction.fields.getTextInputValue('menu:cleaner:create:interval')?.trim();
    if (!rawName || rawName.length > 80) {
      await interaction.reply({ content: 'Informe um nome válido (1-80 caracteres).', ephemeral: true }).catch(() => {});
      return true;
    }
    const seconds = parseDuration(rawInterval || '');
    if (!seconds) {
      await interaction.reply({ content: 'Informe um intervalo válido (ex: 30s, 5m, 2h).', ephemeral: true }).catch(() => {});
      return true;
    }
    session.data.name = rawName;
    session.data.intervalSeconds = seconds;
    session.step = 'channel';
    await interaction.deferUpdate().catch(() => {});
    return promptCreationChannel(interaction);
  }

  if (id.startsWith('menu:cleaner:panel:') && id.endsWith(':config-modal')) {
    const parts = id.split(':');
    const panelId = Number(parts[3]);
    if (!Number.isInteger(panelId)) {
      await interaction.reply({ content: 'Painel inválido.', ephemeral: true }).catch(() => {});
      return true;
    }
    const nameValue = interaction.fields.getTextInputValue('menu:cleaner:panel:name')?.trim();
    const intervalValue = interaction.fields.getTextInputValue('menu:cleaner:panel:interval')?.trim();
    if (!nameValue || nameValue.length > 80) {
      await interaction.reply({ content: 'O nome precisa ter entre 1 e 80 caracteres.', ephemeral: true }).catch(() => {});
      return true;
    }
    const seconds = parseDuration(intervalValue || '');
    if (!seconds) {
      await interaction.reply({ content: 'Intervalo inválido. Use s/m/h (ex: 30s, 10m, 2h).', ephemeral: true }).catch(() => {});
      return true;
    }
    const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
    if (!panel) {
      await interaction.reply({ content: 'Painel não encontrado.', ephemeral: true }).catch(() => {});
      return true;
    }
    await prisma.channelCleanerPanel.update({ where: { id: panelId }, data: { name: nameValue, intervalSeconds: seconds } });
    await refreshPanels(prisma);
    restartJobs();
    await interaction.deferUpdate().catch(() => {});
    return renderPanel(interaction, prisma, panelId, { type: 'success', message: 'Nome e intervalo atualizados.' });
  }

  if (id === 'menu:cleaner:create:filter-modal') {
    const session = creationSessions.get(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: 'Sessão expirada. Clique em "Criar painel" novamente.', ephemeral: true }).catch(() => {});
      return true;
    }
    const raw = interaction.fields.getTextInputValue('menu:cleaner:panel:filter:ids')?.trim();
    const ids = parseFilterIds(raw || '');
    if (raw && ids.length === 0) {
      await interaction.reply({ content: 'Informe IDs válidos, separados por vírgula.', ephemeral: true }).catch(() => {});
      return true;
    }
    session.data.filterMessageId = ids.join(',') || null;
    await interaction.deferUpdate().catch(() => {});
    return renderCreationFilterStep(interaction, session);
  }

  if (id.startsWith('menu:cleaner:panel:') && id.endsWith(':filter-modal')) {
    const parts = id.split(':');
    const panelId = Number(parts[3]);
    if (!Number.isInteger(panelId)) {
      await interaction.reply({ content: 'Painel inválido.', ephemeral: true }).catch(() => {});
      return true;
    }
    const raw = interaction.fields.getTextInputValue('menu:cleaner:panel:filter:ids')?.trim();
    const ids = parseFilterIds(raw || '');
    if (raw && ids.length === 0) {
      await interaction.reply({ content: 'Informe IDs válidos, separados por vírgula.', ephemeral: true }).catch(() => {});
      return true;
    }
    const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
    if (!panel) {
      await interaction.reply({ content: 'Painel não encontrado.', ephemeral: true }).catch(() => {});
      return true;
    }
    const stored = ids.join(',');
    await prisma.channelCleanerPanel.update({ where: { id: panelId }, data: { filterMessageId: stored || null } });
    await refreshPanels(prisma);
    restartJobs();
    await interaction.deferUpdate().catch(() => {});
    return renderPanel(interaction, prisma, panelId, {
      type: ids.length ? 'success' : 'info',
      message: ids.length ? 'Filtro atualizado.' : 'Filtro removido.',
    });
  }

  return false;
}

async function startCreationFlow(interaction, prisma) {
  await hydrateRuntime(prisma);
  const session = {
    userId: interaction.user.id,
    step: 'modal',
    data: {},
  };
  creationSessions.set(interaction.user.id, session);
  const modal = new ModalBuilder().setCustomId('menu:cleaner:create:modal').setTitle('Novo painel de limpeza');
  const nameInput = new TextInputBuilder()
    .setCustomId('menu:cleaner:create:name')
    .setLabel('Nome do painel')
    .setRequired(true)
    .setMaxLength(80)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: Limpar geral');
  const intervalInput = new TextInputBuilder()
    .setCustomId('menu:cleaner:create:interval')
    .setLabel('Intervalo (s/m/h)')
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: 30s, 5m, 2h');
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(intervalInput));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function promptCreationChannel(interaction) {
  const session = creationSessions.get(interaction.user.id);
  if (!session) return;
  session.step = 'channel';
  await renderCreationStep(interaction, session, {
    title: `Painel: ${session.data.name}`,
    description: 'Escolha o canal que será limpo automaticamente usando o seletor abaixo.',
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('menu:cleaner:create:channel')
          .setPlaceholder('Selecione o canal alvo')
          .setMinValues(1)
          .setMaxValues(1)
          .setChannelTypes(ChannelType.GuildText),
      ),
      buildCreationControls(),
    ],
  });
}

async function renderCreationFilterStep(interaction, session) {
  session.step = 'filter';
  const filterValue = formatFilterValue(parseFilterIds(session.data.filterMessageId));
  await renderCreationStep(interaction, session, {
    title: `Painel: ${session.data.name}`,
    description: 'Opcional: configure IDs de mensagem (separados por vírgula) que NÃO devem ser apagadas.',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('menu:cleaner:create:filter-modal')
          .setLabel('Filtro de mensagens')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('menu:cleaner:create:finish')
          .setLabel('Salvar painel')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('menu:cleaner:create:cancel')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
    extraFields: filterValue && filterValue !== 'Não definido' ? [{ name: 'Filtro atual', value: filterValue, inline: false }] : undefined,
  });
  return true;
}

async function finishCreation(interaction, prisma) {
  const session = creationSessions.get(interaction.user.id);
  if (!session) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Sessão expirada.' });
  }
  creationSessions.delete(interaction.user.id);
  const data = session.data;
  await hydrateRuntime(prisma);
  await prisma.channelCleanerPanel.create({
    data: {
      globalConfigId: runtime.globalConfigId,
      name: data.name,
      guildId: data.guildId || interaction.guildId,
      channelId: data.channelId,
      intervalSeconds: data.intervalSeconds,
      filterMessageId: data.filterMessageId || null,
    },
  });
  const panels = await refreshPanels(prisma);
  restartJobs();
  await renderHome(interaction, prisma, {
    type: 'success',
    message: `Painel **${data.name}** criado com sucesso. (${panels.length} no total)`,
  });
}

async function promptEditFilter(interaction, prisma, panelId) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  await renderPanel(interaction, prisma, panelId, {
    type: 'info',
    message: 'Envie o ID da mensagem limite ou **pular** para remover/ignorar.',
  });
  return collectTextValue(interaction, {
    validator: (raw) => {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === 'pular') {
        return { skip: true };
      }
      if (!/^\d{17,20}$/.test(raw.trim())) {
        return null;
      }
      return { messageId: raw.trim() };
    },
    onSubmit: async (result) => {
      await prisma.channelCleanerPanel.update({
        where: { id: panelId },
        data: { filterMessageId: result.skip ? null : result.messageId },
      });
      await refreshPanels(prisma);
      restartJobs();
      await renderPanel(interaction, prisma, panelId, { type: 'success', message: 'Filtro atualizado.' });
    },
    onCancel: async () => renderPanel(interaction, prisma, panelId, { type: 'info', message: 'Edição cancelada.' }),
    onTimeout: async () => renderPanel(interaction, prisma, panelId, { type: 'error', message: 'Tempo esgotado.' }),
  });
}

async function showPanelConfigModal(interaction, prisma, panelId) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  const modal = new ModalBuilder()
    .setCustomId(`menu:cleaner:panel:${panel.id}:config-modal`)
    .setTitle('Editar painel');
  const nameInput = new TextInputBuilder()
    .setCustomId('menu:cleaner:panel:name')
    .setLabel('Nome do painel')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setValue(panel.name.slice(0, 80));
  const intervalInput = new TextInputBuilder()
    .setCustomId('menu:cleaner:panel:interval')
    .setLabel('Intervalo (s/m/h)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatIntervalInput(panel.intervalSeconds));
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(intervalInput));
  await interaction.showModal(modal).catch(() => {});
  return true;
}

async function renderHome(interaction, prisma, status) {
  const panels = await refreshPanels(prisma);
  restartJobs();
  await interaction
    .editReply({ embeds: [buildHomeEmbed(panels, status)], components: buildHomeComponents(panels) })
    .catch(() => {});
  return true;
}

async function renderPanel(interaction, prisma, panelId, status) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  await interaction
    .editReply({ embeds: [buildPanelEmbed(panel, status)], components: buildPanelComponents(panel) })
    .catch(() => {});
  return true;
}

async function renderDeleteConfirm(interaction, prisma, panelId) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  const embed = buildPanelEmbed(panel, {
    type: 'error',
    message: 'Confirma excluir este painel? Esta ação não pode ser desfeita.',
  });
  const rows = buildPanelComponents(panel);
  rows.unshift(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:delete-confirm`)
        .setLabel('Sim, excluir')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:delete-cancel`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  await interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
  return true;
}

async function deletePanel(interaction, prisma, panelId) {
  await prisma.channelCleanerPanel.delete({ where: { id: panelId } }).catch(() => {});
  await refreshPanels(prisma);
  restartJobs();
  return renderHome(interaction, prisma, { type: 'success', message: 'Painel removido.' });
}

async function togglePanel(interaction, prisma, panelId) {
  const panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  if (!panel) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Painel não encontrado.' });
  }
  await prisma.channelCleanerPanel.update({
    where: { id: panelId },
    data: { isActive: !panel.isActive },
  });
  await refreshPanels(prisma);
  restartJobs();
  return renderPanel(interaction, prisma, panelId, {
    type: 'success',
    message: panel.isActive ? 'Painel desativado.' : 'Painel ativado.',
  });
}

async function clearFilter(interaction, prisma, panelId) {
  await prisma.channelCleanerPanel.update({ where: { id: panelId }, data: { filterMessageId: null } }).catch(() => {});
  await refreshPanels(prisma);
  restartJobs();
  return renderPanel(interaction, prisma, panelId, { type: 'success', message: 'Filtro removido.' });
}

async function executePanelNow(interaction, prisma, panelId) {
  const ok = await triggerCleaner(panelId, 'manual');
  if (!ok) {
    return renderPanel(interaction, prisma, panelId, { type: 'error', message: 'Não foi possível executar agora.' });
  }
  await refreshPanels(prisma);
  restartJobs();
  return renderPanel(interaction, prisma, panelId, { type: 'success', message: 'Limpeza executada.' });
}

async function hydrateRuntime(prisma) {
  if (runtime.globalConfigId) {
    return runtime.globalConfigId;
  }
  const cfg = await ensureGlobalConfig(prisma);
  runtime.globalConfigId = cfg.id;
  return runtime.globalConfigId;
}

async function refreshPanels(prisma) {
  await hydrateRuntime(prisma);
  const panels = await prisma.channelCleanerPanel.findMany({
    where: { globalConfigId: runtime.globalConfigId },
    orderBy: { createdAt: 'asc' },
  });
  runtime.panels = panels;
  return panels;
}

function restartJobs() {
  for (const job of jobs.values()) {
    clearTimeout(job.timeout);
  }
  jobs.clear();
  for (const panel of runtime.panels) {
    schedulePanel(panel);
  }
}

function schedulePanel(panel) {
  if (!panel.isActive || !clientRef) {
    return;
  }
  const lastRun = panel.lastRunAt ? Date.now() - new Date(panel.lastRunAt).getTime() : null;
  const remaining = panel.intervalSeconds * 1_000 - (lastRun ?? panel.intervalSeconds * 1_000);
  const delay = Math.max(5_000, remaining);
  const timeout = setTimeout(async () => {
    await triggerCleaner(panel.id, 'interval');
  }, delay);
  jobs.set(panel.id, { timeout });
}

async function triggerCleaner(panelId, reason = 'manual') {
  if (activeRuns.has(panelId)) {
    return false;
  }
  activeRuns.add(panelId);
  const prisma = getPrisma();
  let panel = runtime.panels.find((p) => p.id === panelId);
  if (!panel) {
    panel = await prisma.channelCleanerPanel.findUnique({ where: { id: panelId } });
  }
  if (!panel || !panel.isActive) {
    activeRuns.delete(panelId);
    return false;
  }
  try {
    await runCleaner(panel, reason);
    await prisma.channelCleanerPanel.update({ where: { id: panelId }, data: { lastRunAt: new Date() } });
    await refreshPanels(prisma);
  } catch (error) {
    console.warn(`[cleaner] Falha ao limpar painel ${panelId}:`, error?.message || error);
  } finally {
    activeRuns.delete(panelId);
    restartJobs();
  }
  return true;
}

async function runCleaner(panel, reason) {
  if (!clientRef) return false;
  const channel = await clientRef.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await getPrisma().channelCleanerPanel.update({
      where: { id: panel.id },
      data: { isActive: false },
    });
    return false;
  }
  let lastId = null;
  let deleted = 0;
  let stop = false;
  const filterIds = parseFilterIds(panel.filterMessageId);
  while (deleted < MAX_MESSAGES_PER_SWEEP && !stop) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId || undefined }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const bulk = [];
    const singles = [];
    for (const message of batch.values()) {
      lastId = message.id;
      if (message.pinned) continue;
      if (filterIds.length && filterIds.includes(message.id)) {
        continue; // protege IDs filtrados (não apaga)
      }
      const age = Date.now() - message.createdTimestamp;
      if (age <= BULK_WINDOW_MS) {
        bulk.push(message.id);
      } else {
        singles.push(message);
      }
      if (bulk.length >= MAX_BULK_DELETE) break;
      if (deleted + bulk.length + singles.length >= MAX_MESSAGES_PER_SWEEP) break;
    }
    if (bulk.length) {
      const chunk = bulk.splice(0, MAX_BULK_DELETE);
      const result = await channel.bulkDelete(chunk, true).catch(() => null);
      deleted += result ? result.size : chunk.length;
    }
    for (const msg of singles) {
      const success = await msg.delete().catch(() => null);
      if (success) deleted += 1;
      await wait(750);
      if (deleted >= MAX_MESSAGES_PER_SWEEP) break;
    }
    if (batch.size < 100) break;
  }
  return true;
}

function buildHomeEmbed(panels, status) {
  const embed = new EmbedBuilder()
    .setTitle('🧹 Limpeza automática de canais')
    .setDescription('Configure painéis que apagam mensagens em canais específicos. Use os botões abaixo.')
    .setColor(0x5865f2)
    .setTimestamp(new Date());
  if (status) {
    embed.addFields({ name: `${statusIcon(status.type)} Status`, value: status.message });
  }
  if (!panels.length) {
    embed.addFields({
      name: 'Nenhum painel (ainda)',
      value: 'Clique em **Criar painel** para começar.',
    });
  } else {
    for (const panel of panels.slice(0, 5)) {
      embed.addFields({
        name: `${panel.isActive ? '🟢' : '🔴'} ${panel.name}`,
        value: [
          `• Canal: <#${panel.channelId}>`,
          `• Intervalo: ${formatInterval(panel.intervalSeconds)}`,
          `• Última execução: ${panel.lastRunAt ? formatRelative(panel.lastRunAt) : 'nunca'}`,
        ].join('\n'),
        inline: true,
      });
    }
    if (panels.length > 5) {
      embed.addFields({ name: '...', value: `${panels.length - 5} painel(is) adicionais.` });
    }
  }
  return embed;
}

function buildHomeComponents(panels) {
  const rows = [];
  // Linha de navegação principal: voltar ao menu raiz
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  );
  if (panels.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('menu:cleaner:panel:select')
      .setPlaceholder('Abrir painel...')
      .addOptions(
        panels.slice(0, 25).map((panel) => ({
          label: `${panel.isActive ? '🟢' : '🔴'} ${panel.name}`.slice(0, 90),
          value: String(panel.id),
          description: `Intervalo ${formatInterval(panel.intervalSeconds)}`.slice(0, 100),
        })),
      );
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:cleaner:create:start').setLabel('Criar painel').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('menu:cleaner:home:refresh').setLabel('Atualizar').setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildPanelEmbed(panel, status) {
  const filterValue = formatFilterValue(parseFilterIds(panel.filterMessageId));
  const embed = new EmbedBuilder()
    .setTitle(`🧹 Painel: ${panel.name}`)
    .setColor(panel.isActive ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Status', value: panel.isActive ? 'Ativo' : 'Pausado', inline: true },
      { name: 'Intervalo', value: formatInterval(panel.intervalSeconds), inline: true },
      { name: 'Canal', value: `<#${panel.channelId}>`, inline: true },
      {
        name: 'Filtro de mensagem',
        value: filterValue !== 'Não definido' ? `Não apagar: ${filterValue}` : 'Não definido',
        inline: true,
      },
      {
        name: 'Última execução',
        value: panel.lastRunAt ? formatRelative(panel.lastRunAt) : 'Nunca executado',
        inline: true,
      },
    )
    .setFooter({ text: 'Use os botões para editar este painel.' })
    .setTimestamp(new Date());
  if (status) {
    embed.setDescription(`${statusIcon(status.type)} ${status.message}`);
  }
  return embed;
}

function buildPanelComponents(panel) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu:cleaner:home:back').setLabel('Painéis').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:edit-config`)
        .setLabel('Editar nome/tempo')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:filter-add`)
        .setLabel('Filtro de mensagens')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:filter-list`)
        .setLabel('Listar filtro')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:filter-remove`)
        .setLabel('Remover filtro')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!panel.filterMessageId),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:toggle`)
        .setLabel(panel.isActive ? 'Pausar' : 'Ativar')
        .setStyle(panel.isActive ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:run`)
        .setLabel('Executar agora')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:delete`)
        .setLabel('Excluir')
        .setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`menu:cleaner:panel:${panel.id}:channel`)
        .setPlaceholder('Alterar canal do painel')
        .setMinValues(1)
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText),
    ),
  ];
}

function buildCreationControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:cleaner:create:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger),
  );
}

async function renderCreationStep(interaction, session, options) {
  const embed = new EmbedBuilder()
    .setTitle(options.title || 'Novo painel')
    .setDescription(options.description || 'Siga as instruções acima.')
    .setColor(0xf1c40f)
    .setFooter({ text: 'Use o botão Cancelar ou digite "cancelar" quando solicitado.' })
    .addFields(
      { name: 'Nome', value: session.data.name || '—', inline: true },
      { name: 'Canal', value: session.data.channelId ? `<#${session.data.channelId}>` : '—', inline: true },
      { name: 'Intervalo', value: session.data.intervalSeconds ? formatInterval(session.data.intervalSeconds) : '—', inline: true },
      { name: 'Filtro', value: formatFilterValue(parseFilterIds(session.data.filterMessageId)), inline: true },
    );
  if (options.extraFields && Array.isArray(options.extraFields)) {
    for (const field of options.extraFields) {
      embed.addFields(field);
    }
  }
  await interaction
    .editReply({ embeds: [embed], components: options.components || [buildCreationControls()] })
    .catch(() => {});
}

async function collectTextValue(interaction, { validator, onSubmit, onCancel, onTimeout }) {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    return interaction.followUp({ content: 'Não consigo iniciar coleta neste canal.', ephemeral: true }).catch(() => {});
  }
  cancelCollector(interaction.user.id);
  await interaction
    .followUp({ content: 'Digite a resposta nesta conversa. Envie **cancelar** para desistir.', ephemeral: true })
    .catch(() => {});
  const collector = channel.createMessageCollector({
    filter: (msg) => msg.author.id === interaction.user.id,
    time: COLLECTOR_TIMEOUT_MS,
  });
  textCollectors.set(interaction.user.id, collector);
  collector.on('collect', async (msg) => {
    const content = msg.content?.trim();
    if (!content) return;
    if (content.toLowerCase() === 'cancelar') {
      collector.stop('cancelled');
      if (onCancel) await onCancel();
      return;
    }
    const parsed = validator ? validator(content) : content;
    if (parsed === null || typeof parsed === 'undefined') {
      await msg.react('⚠️').catch(() => {});
      await interaction
        .followUp({ content: 'Valor inválido, tente novamente ou digite **cancelar**.', ephemeral: true })
        .catch(() => {});
      return;
    }
    collector.stop('fulfilled');
    if (onSubmit) await onSubmit(parsed);
  });
  collector.on('end', async (_, reason) => {
    textCollectors.delete(interaction.user.id);
    if (reason === 'time' && onTimeout) {
      await onTimeout();
    }
  });
}

function cancelCollector(userId) {
  const collector = textCollectors.get(userId);
  if (collector) {
    collector.stop('replaced');
    textCollectors.delete(userId);
  }
}

function parseDuration(input) {
  const match = input.trim().match(DURATION_REGEX);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  let seconds = value;
  if (unit === 'm') seconds = value * 60;
  if (unit === 'h') seconds = value * 60 * 60;
  if (seconds < MIN_INTERVAL_SECONDS || seconds > MAX_INTERVAL_SECONDS) {
    return null;
  }
  return seconds;
}

function parseFilterIds(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => /^\d{17,20}$/.test(v));
}

function formatFilterValue(ids) {
  if (!ids || !ids.length) return 'Não definido';
  return ids.join(', ');
}

function formatInterval(seconds) {
  if (seconds >= 3600) {
    return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)} h`;
  }
  if (seconds >= 60) {
    return `${(seconds / 60).toFixed(seconds % 60 === 0 ? 0 : 1)} min`;
  }
  return `${seconds}s`;
}

function formatIntervalInput(seconds) {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

function formatRelative(date) {
  const ts = Math.floor(new Date(date).getTime() / 1_000);
  return `<t:${ts}:R>`;
}

function shouldOpenCleanerModal(customId) {
  if (customId === 'menu:cleaner:create:start') {
    return true;
  }
  if (customId === 'menu:cleaner:create:filter-modal') {
    return true;
  }
  if (customId.startsWith('menu:cleaner:panel:')) {
    const detail = customId.split(':')[4];
    if (detail === 'edit-config') {
      return true;
    }
    if (detail === 'filter-add') {
      return true;
    }
  }
  return false;
}

function statusIcon(type) {
  if (type === 'success') return '✅';
  if (type === 'error') return '⚠️';
  return 'ℹ️';
}

async function deferIfNeeded(interaction) {
  if (interaction.deferred || interaction.replied) return;
  if (interaction.isRepliable()) {
    await interaction.deferUpdate().catch(() => {});
  }
}

async function ensurePosse(interaction, ctx) {
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.followUp({ content: 'Apenas o usuário posse pode usar esta seção.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  registerChannelCleaner,
  presentMenu,
  handleInteraction,
};
