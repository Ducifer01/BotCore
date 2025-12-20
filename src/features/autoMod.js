const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');
const { buildMuteLogEmbed } = require('../lib/mute');
const { sendLogMessage } = require('../lib/moderation');

const DEFAULT_REASON = 'Palavra Proibida';
const WORD_UPLOAD_TIMEOUT = 5 * 60 * 1000;
const wordUploadSessions = new Map();

const DURATION_CHOICES = [
  { label: '60 segundos', value: '60', seconds: 60 },
  { label: '5 minutos', value: '300', seconds: 5 * 60 },
  { label: '10 minutos', value: '600', seconds: 10 * 60 },
  { label: '1 hora', value: '3600', seconds: 60 * 60 },
  { label: '1 dia', value: '86400', seconds: 24 * 60 * 60 },
  { label: '1 semana', value: '604800', seconds: 7 * 24 * 60 * 60 },
];

const PUNISHMENT = {
  DELETE: 'DELETE',
  PUNISH_DELETE: 'PUNISH_DELETE',
};

const MODULE_VALUES = {
  WORDS: 'words',
  SPAM: 'spam',
};

const SPAM_PUNISHMENT = {
  MUTE: 'MUTE',
  TIMEOUT: 'TIMEOUT',
};

const DEFAULT_SPAM_CONFIG = {
  enabled: false,
  messageLimit: 5,
  perSeconds: 5,
  punishmentMode: SPAM_PUNISHMENT.MUTE,
  muteDurationSeconds: 5 * 60,
  timeoutDurationSeconds: 10 * 60,
};

const ANTI_SPAM_SESSION_TTL = 5 * 60 * 1000;
const antiSpamPunishSessions = new Map();
const antiSpamBuckets = new Map();
const antiSpamCooldowns = new Map();

let cachedWordsRuntime = null;
let cachedWordsAt = 0;
let cachedAntiSpamRuntime = null;
let cachedAntiSpamAt = 0;
const CACHE_TTL = 60 * 1000;

function getPrismaFromCtx(ctx) {
  return ctx?.getPrisma ? ctx.getPrisma() : getPrisma();
}

function invalidateWordsCache() {
  cachedWordsRuntime = null;
  cachedWordsAt = 0;
}

function invalidateAntiSpamCache() {
  cachedAntiSpamRuntime = null;
  cachedAntiSpamAt = 0;
}

async function ensureAutoModState(prisma) {
  const globalConfig = await ensureGlobalConfig(prisma);
  let autoConfig = await prisma.autoModConfig.findUnique({
    where: { globalConfigId: globalConfig.id },
    include: { blockedWords: true },
  });
  if (!autoConfig) {
    await prisma.autoModConfig.create({ data: { globalConfigId: globalConfig.id } });
    autoConfig = await prisma.autoModConfig.findUnique({
      where: { globalConfigId: globalConfig.id },
      include: { blockedWords: true },
    });
  }
  return { globalConfig, autoConfig };
}

async function ensureAntiSpamState(prisma) {
  const globalConfig = await ensureGlobalConfig(prisma);
  let antiSpamConfig = await prisma.antiSpamConfig.findUnique({
    where: { globalConfigId: globalConfig.id },
    include: {
      ignoredChannels: true,
      bypassRoles: true,
    },
  });
  if (!antiSpamConfig) {
    antiSpamConfig = await prisma.antiSpamConfig.create({
      data: {
        globalConfigId: globalConfig.id,
        enabled: DEFAULT_SPAM_CONFIG.enabled,
        messageLimit: DEFAULT_SPAM_CONFIG.messageLimit,
        perSeconds: DEFAULT_SPAM_CONFIG.perSeconds,
        punishmentMode: DEFAULT_SPAM_CONFIG.punishmentMode,
        muteDurationSeconds: DEFAULT_SPAM_CONFIG.muteDurationSeconds,
        timeoutDurationSeconds: DEFAULT_SPAM_CONFIG.timeoutDurationSeconds,
      },
      include: {
        ignoredChannels: true,
        bypassRoles: true,
      },
    });
  }
  return { globalConfig, antiSpamConfig };
}

async function fetchAutoModRuntime(prisma) {
  const now = Date.now();
  if (cachedWordsRuntime && (now - cachedWordsAt) < CACHE_TTL) {
    return cachedWordsRuntime;
  }
  const { autoConfig } = await ensureAutoModState(prisma);
  cachedWordsRuntime = {
    punishmentType: autoConfig.punishmentType,
    punishmentDurationSeconds: autoConfig.punishmentDurationSeconds,
    reason: autoConfig.reason || DEFAULT_REASON,
    words: (autoConfig.blockedWords || []).map((w) => w.word.toLowerCase()),
  };
  cachedWordsAt = now;
  return cachedWordsRuntime;
}

async function fetchAntiSpamRuntime(prisma) {
  const now = Date.now();
  if (cachedAntiSpamRuntime && (now - cachedAntiSpamAt) < CACHE_TTL) {
    return cachedAntiSpamRuntime;
  }
  const { globalConfig, antiSpamConfig } = await ensureAntiSpamState(prisma);
  cachedAntiSpamRuntime = {
    enabled: Boolean(antiSpamConfig.enabled),
    messageLimit: antiSpamConfig.messageLimit || DEFAULT_SPAM_CONFIG.messageLimit,
    perSeconds: antiSpamConfig.perSeconds || DEFAULT_SPAM_CONFIG.perSeconds,
    punishmentMode: antiSpamConfig.punishmentMode || DEFAULT_SPAM_CONFIG.punishmentMode,
    muteDurationSeconds: antiSpamConfig.muteDurationSeconds || DEFAULT_SPAM_CONFIG.muteDurationSeconds,
    timeoutDurationSeconds: antiSpamConfig.timeoutDurationSeconds || DEFAULT_SPAM_CONFIG.timeoutDurationSeconds,
    ignoredChannels: new Set((antiSpamConfig.ignoredChannels || []).map((entry) => entry.channelId)),
    bypassRoles: new Set((antiSpamConfig.bypassRoles || []).map((entry) => entry.roleId)),
    globalConfig: {
      id: globalConfig.id,
      muteChatRoleId: globalConfig.muteChatRoleId,
      muteChatLogChannelId: globalConfig.muteChatLogChannelId,
    },
  };
  cachedAntiSpamAt = now;
  return cachedAntiSpamRuntime;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'Não configurado';
  const units = [
    { label: 'semana', value: 7 * 24 * 3600 },
    { label: 'dia', value: 24 * 3600 },
    { label: 'hora', value: 3600 },
    { label: 'minuto', value: 60 },
  ];
  for (const unit of units) {
    if (seconds % unit.value === 0) {
      const amount = seconds / unit.value;
      return `${amount} ${unit.label}${amount > 1 ? 's' : ''}`;
    }
  }
  return `${seconds} segundos`;
}

function buildWordsOverviewEmbed(autoConfig) {
  const words = autoConfig.blockedWords || [];
  const preview = words.length
    ? words.slice(0, 10).map((w) => w.word).join(', ')
    : 'Nenhuma palavra cadastrada ainda.';
  const punishmentText = autoConfig.punishmentType === PUNISHMENT.PUNISH_DELETE
    ? `Castigar e apagar (tempo: ${formatDuration(autoConfig.punishmentDurationSeconds || 60)})`
    : 'Apagar mensagem';
  return new EmbedBuilder()
    .setTitle('AutoMod · Anti-Palavras')
    .setDescription('Gerencie palavras proibidas e o tipo de punição aplicada automaticamente.')
    .addFields(
      { name: 'Palavras monitoradas', value: `Total: **${words.length}**\n${preview}`, inline: false },
      { name: 'Punição atual', value: punishmentText, inline: false },
      { name: 'Motivo padrão', value: autoConfig.reason || DEFAULT_REASON, inline: false },
    )
    .setColor(0xED4245);
}

function buildWordsListEmbed(autoConfig) {
  const words = autoConfig.blockedWords || [];
  const value = words.length
    ? words.slice(0, 20).map((w, idx) => `${idx + 1}. ${w.word}`).join('\n')
    : 'Nenhuma palavra cadastrada. Use "Inserir palavras" para adicionar itens via arquivo .txt.';
  return new EmbedBuilder()
    .setTitle('Palavras Bloqueadas')
    .setDescription('Usuários com qualquer palavra listada terão punição automática.')
    .addFields({ name: 'Lista monitorada', value })
    .setColor(0xED4245);
}

function buildPunishEmbed(autoConfig) {
  const desc = autoConfig.punishmentType === PUNISHMENT.PUNISH_DELETE
    ? 'Atualmente o bot **apaga** a mensagem e aplica timeout.'
    : 'Atualmente o bot **apenas apaga** a mensagem.';
  return new EmbedBuilder()
    .setTitle('Tipo de Punição')
    .setDescription(`${desc}\nMotivo padrão: **${autoConfig.reason || DEFAULT_REASON}**`)
    .addFields({
      name: 'Tempo configurado',
      value: formatDuration(autoConfig.punishmentDurationSeconds || 60),
    })
    .setColor(0xED4245);
}

function buildPunishDetailEmbed(autoConfig) {
  return new EmbedBuilder()
    .setTitle('Castigar e apagar')
    .setDescription('O bot apagará a mensagem e aplicará timeout automático.')
    .addFields({
      name: 'Tempo atual',
      value: formatDuration(autoConfig.punishmentDurationSeconds || 60),
    })
    .setColor(0xED4245);
}

function buildDurationSelect() {
  return new StringSelectMenuBuilder()
    .setCustomId('automod:words:punish:duration')
    .setPlaceholder('Selecione um tempo de castigo')
    .addOptions(DURATION_CHOICES.map((choice) => ({ label: choice.label, value: choice.value })));
}

function wordsOverviewComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:module:list').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:words:list').setLabel('Palavras Bloqueadas').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('automod:words:punish').setLabel('Tipo Punição').setStyle(ButtonStyle.Danger),
  )];
}

function wordsListComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:words:overview').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:words:list:insert').setLabel('Inserir palavras').setStyle(ButtonStyle.Success),
  )];
}

function wordsPunishComponents(autoConfig) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:words:overview').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('automod:words:punish:mode:delete')
      .setLabel('Apagar')
      .setStyle(ButtonStyle.Success)
      .setDisabled(autoConfig.punishmentType === PUNISHMENT.DELETE),
    new ButtonBuilder()
      .setCustomId('automod:words:punish:mode:punish')
      .setLabel('Castigar e apagar')
      .setStyle(ButtonStyle.Danger),
  )];
}

function wordsPunishDetailComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:words:punish:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:words:punish:detail:time').setLabel('Definir tempo').setStyle(ButtonStyle.Primary),
  )];
}

function durationSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:words:punish:detail:return').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(buildDurationSelect()),
  ];
}

function buildModuleOverviewEmbed(autoConfig, antiSpamConfig, globalConfig) {
  const words = autoConfig.blockedWords || [];
  const antiSpamStatus = antiSpamConfig.enabled ? 'Ativado' : 'Desativado';
  const modeText = antiSpamConfig.punishmentMode === SPAM_PUNISHMENT.MUTE
    ? `Mute no chat (${formatDuration(antiSpamConfig.muteDurationSeconds || DEFAULT_SPAM_CONFIG.muteDurationSeconds)})`
    : `Castigo (timeout de ${formatDuration(antiSpamConfig.timeoutDurationSeconds || DEFAULT_SPAM_CONFIG.timeoutDurationSeconds)})`;
  const muteRoleInfo = antiSpamConfig.punishmentMode === SPAM_PUNISHMENT.MUTE
    ? (globalConfig.muteChatRoleId ? `<@&${globalConfig.muteChatRoleId}>` : 'Não configurado – defina em /menu mute')
    : 'Não necessário';
  return new EmbedBuilder()
    .setTitle('AutoMod · Selecionar módulo')
    .setDescription('Escolha qual módulo deseja gerenciar.')
    .addFields(
      {
        name: 'Anti-Palavras',
        value: `Palavras ativas: **${words.length}**\nPunição: ${autoConfig.punishmentType === PUNISHMENT.PUNISH_DELETE ? 'Apagar + timeout' : 'Apagar mensagem'}`,
        inline: false,
      },
      {
        name: 'Anti-Spam',
        value: `Status: **${antiSpamStatus}**\nLimite: **${antiSpamConfig.messageLimit}** mensagens / ${antiSpamConfig.perSeconds}s\nPunição: ${modeText}\nCargo mute: ${muteRoleInfo}`,
        inline: false,
      },
    )
    .setColor(0x5865F2);
}

function moduleOverviewComponents(selected = null) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('automod:module:select')
    .setPlaceholder('Escolha um módulo para continuar')
    .addOptions([
      { label: 'Anti-Palavras', description: 'Gerencie palavras proibidas', value: MODULE_VALUES.WORDS, default: selected === MODULE_VALUES.WORDS },
      { label: 'Anti-Spam', description: 'Detecta spam e aplica punição automática', value: MODULE_VALUES.SPAM, default: selected === MODULE_VALUES.SPAM },
    ]);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(select),
  ];
}

function buildAntiSpamEmbed(antiSpamConfig, globalConfig) {
  const enabledText = antiSpamConfig.enabled ? '✅ Ativado' : '⚪ Desativado';
  const punishmentSummary = antiSpamConfig.punishmentMode === SPAM_PUNISHMENT.MUTE
    ? `Mute no chat (${formatDuration(antiSpamConfig.muteDurationSeconds || DEFAULT_SPAM_CONFIG.muteDurationSeconds)})`
    : `Castigo (timeout ${formatDuration(antiSpamConfig.timeoutDurationSeconds || DEFAULT_SPAM_CONFIG.timeoutDurationSeconds)})`;
  const muteRoleLabel = globalConfig.muteChatRoleId ? `<@&${globalConfig.muteChatRoleId}>` : 'Não configurado';
  const channelsList = formatIdList(antiSpamConfig.ignoredChannels, 'channel');
  const rolesList = formatIdList(antiSpamConfig.bypassRoles, 'role');
  return new EmbedBuilder()
    .setTitle('AutoMod · Anti-Spam')
    .setDescription('Detecta usuários que enviam muitas mensagens em um curto período e aplica punições automáticas.')
    .addFields(
      { name: 'Status', value: enabledText, inline: true },
      { name: 'Limite atual', value: `**${antiSpamConfig.messageLimit}** mensagens / ${antiSpamConfig.perSeconds}s`, inline: true },
      { name: 'Punição configurada', value: punishmentSummary, inline: false },
      { name: 'Cargo de mute (menu mute)', value: muteRoleLabel, inline: false },
      { name: 'Canais ignorados', value: channelsList || 'Nenhum canal ignorado.', inline: false },
      { name: 'Cargos isentos', value: rolesList || 'Nenhum cargo isento.', inline: false },
    )
    .setColor(antiSpamConfig.enabled ? 0x57F287 : 0x5865F2);
}

function formatIdList(entries, type) {
  if (!entries?.length) return '';
  const mapper = type === 'channel'
    ? (entry) => `<#${entry.channelId}>`
    : (entry) => `<@&${entry.roleId}>`;
  const list = entries.slice(0, 10).map(mapper);
  if (entries.length > 10) {
    list.push(`(+${entries.length - 10} itens)`);
  }
  return list.join(', ');
}

function buildAntiSpamComponents(antiSpamConfig) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:module:list').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('automod:spam:toggle')
        .setLabel(antiSpamConfig.enabled ? 'Desativar' : 'Ativar')
        .setStyle(antiSpamConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('automod:spam:limit').setLabel('Configurar limite').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:spam:punishment').setLabel('Configurar punição').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('automod:spam:reset').setLabel('Restaurar padrão').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(buildChannelSelect(antiSpamConfig)),
    new ActionRowBuilder().addComponents(buildRoleSelect(antiSpamConfig)),
  ];
}

function buildChannelSelect(antiSpamConfig) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('automod:spam:channels')
    .setPlaceholder('Canais ignorados (máx. 25)')
    .setMinValues(0)
    .setMaxValues(25)
    .setChannelTypes([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.AnnouncementThread,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.GuildForum,
    ]);
  if (antiSpamConfig.ignoredChannels?.length) {
    select.setDefaultChannels(
      ...antiSpamConfig.ignoredChannels.slice(0, 25).map((entry) => entry.channelId),
    );
  }
  return select;
}

function buildRoleSelect(antiSpamConfig) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId('automod:spam:roles')
    .setPlaceholder('Cargos isentos (máx. 25)')
    .setMinValues(0)
    .setMaxValues(25);
  if (antiSpamConfig.bypassRoles?.length) {
    select.setDefaultRoles(
      ...antiSpamConfig.bypassRoles.slice(0, 25).map((entry) => entry.roleId),
    );
  }
  return select;
}

function buildAntiSpamPunishEmbed(session, globalConfig) {
  const currentMode = session.mode === SPAM_PUNISHMENT.MUTE ? 'Mute no chat' : 'Castigo (timeout)';
  const muteRoleLabel = globalConfig.muteChatRoleId ? `<@&${globalConfig.muteChatRoleId}>` : 'Não configurado';
  return new EmbedBuilder()
    .setTitle('Anti-Spam · Configurar punição')
    .setDescription('Selecione o modo de punição e defina os tempos antes de salvar.')
    .addFields(
      { name: 'Modo atual', value: currentMode, inline: true },
      { name: 'Tempo de mute', value: formatDuration(session.muteDurationSeconds), inline: true },
      { name: 'Tempo de timeout', value: formatDuration(session.timeoutDurationSeconds), inline: true },
      { name: 'Cargo mute configurado', value: muteRoleLabel, inline: false },
    )
    .setColor(0xFEE75C);
}

function buildAntiSpamPunishComponents(session) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('automod:spam:punish:mode')
    .setPlaceholder('Selecione o tipo de punição')
    .addOptions([
      { label: 'Mutar no chat', value: SPAM_PUNISHMENT.MUTE, default: session.mode === SPAM_PUNISHMENT.MUTE },
      { label: 'Castigo (timeout)', value: SPAM_PUNISHMENT.TIMEOUT, default: session.mode === SPAM_PUNISHMENT.TIMEOUT },
    ]);
  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:spam:punish:duration:mute').setLabel('Tempo do mute').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('automod:spam:punish:duration:timeout').setLabel('Tempo do timeout').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:spam:punish:save').setLabel('Salvar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('automod:spam:punish:defaults').setLabel('Restaurar padrão').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('automod:spam:punish:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function ensureAntiSpamPunishSession(userId, config) {
  let entry = antiSpamPunishSessions.get(userId);
  if (!entry) {
    entry = {
      data: {
        mode: config.punishmentMode || DEFAULT_SPAM_CONFIG.punishmentMode,
        muteDurationSeconds: config.muteDurationSeconds || DEFAULT_SPAM_CONFIG.muteDurationSeconds,
        timeoutDurationSeconds: config.timeoutDurationSeconds || DEFAULT_SPAM_CONFIG.timeoutDurationSeconds,
      },
      timeout: null,
    };
    antiSpamPunishSessions.set(userId, entry);
  }
  refreshSessionTimeout(userId, entry);
  return entry.data;
}

function refreshSessionTimeout(userId, entry) {
  if (entry.timeout) clearTimeout(entry.timeout);
  entry.timeout = setTimeout(() => antiSpamPunishSessions.delete(userId), ANTI_SPAM_SESSION_TTL);
}

function updateAntiSpamPunishSession(userId, updater) {
  const entry = antiSpamPunishSessions.get(userId);
  if (!entry) return null;
  const next = typeof updater === 'function' ? updater(entry.data) : updater;
  entry.data = { ...entry.data, ...next };
  refreshSessionTimeout(userId, entry);
  return entry.data;
}

function clearAntiSpamPunishSession(userId) {
  const entry = antiSpamPunishSessions.get(userId);
  if (entry?.timeout) clearTimeout(entry.timeout);
  antiSpamPunishSessions.delete(userId);
}

async function presentMenu(interaction, ctx) {
  const prisma = getPrismaFromCtx(ctx);
  const [{ autoConfig }, antiSpamState] = await Promise.all([
    ensureAutoModState(prisma),
    ensureAntiSpamState(prisma),
  ]);
  await respondWithPanel(interaction, {
    embeds: [buildModuleOverviewEmbed(autoConfig, antiSpamState.antiSpamConfig, antiSpamState.globalConfig)],
    components: moduleOverviewComponents(),
  });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('automod')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await deferIfNeeded(interaction);
    await interaction.followUp({ content: 'Apenas o usuário posse pode usar esta seção.', ephemeral: true }).catch(() => {});
    return true;
  }
  const prisma = getPrismaFromCtx(ctx);

  if (interaction.isStringSelectMenu()) {
    if (customId === 'automod:module:select') {
      return handleModuleSelect(interaction, prisma);
    }
    if (customId === 'automod:words:punish:duration') {
      return saveDuration(interaction, prisma);
    }
    if (customId === 'automod:spam:punish:mode') {
      return handleAntiSpamPunishModeSelect(interaction, prisma);
    }
  }

  if (interaction.isChannelSelectMenu() && customId === 'automod:spam:channels') {
    return handleAntiSpamChannelSelect(interaction, prisma);
  }

  if (interaction.isRoleSelectMenu() && customId === 'automod:spam:roles') {
    return handleAntiSpamRoleSelect(interaction, prisma);
  }

  if (interaction.isModalSubmit()) {
    if (customId === 'automod:spam:limit:modal') {
      return handleAntiSpamLimitModal(interaction, prisma);
    }
    if (customId === 'automod:spam:punish:duration:modal:mute') {
      return handleAntiSpamDurationModal(interaction, prisma, SPAM_PUNISHMENT.MUTE);
    }
    if (customId === 'automod:spam:punish:duration:modal:timeout') {
      return handleAntiSpamDurationModal(interaction, prisma, SPAM_PUNISHMENT.TIMEOUT);
    }
  }

  switch (customId) {
    case 'automod:module:list':
      return showModuleOverview(interaction, prisma);
    case 'automod:words:overview':
      return showWordsOverview(interaction, prisma);
    case 'automod:words:list':
      return showWordsList(interaction, prisma);
    case 'automod:words:list:insert':
      return startWordUpload(interaction);
    case 'automod:words:punish':
      return showWordsPunish(interaction, prisma);
    case 'automod:words:punish:mode:delete':
      return setPunishmentMode(interaction, prisma, PUNISHMENT.DELETE);
    case 'automod:words:punish:mode:punish':
      return setPunishmentMode(interaction, prisma, PUNISHMENT.PUNISH_DELETE);
    case 'automod:words:punish:back':
      return showWordsPunish(interaction, prisma);
    case 'automod:words:punish:detail:time':
      return showDurationSelect(interaction, prisma);
    case 'automod:words:punish:detail:return':
      return showWordsPunish(interaction, prisma);
    case 'automod:spam:toggle':
      return toggleAntiSpam(interaction, prisma);
    case 'automod:spam:limit':
      return showAntiSpamLimitModal(interaction, prisma);
    case 'automod:spam:reset':
      return restoreAntiSpamDefaults(interaction, prisma);
    case 'automod:spam:punishment':
      return showAntiSpamPunishPanel(interaction, prisma);
    case 'automod:spam:punish:duration:mute':
      return showAntiSpamDurationModal(interaction, prisma, SPAM_PUNISHMENT.MUTE);
    case 'automod:spam:punish:duration:timeout':
      return showAntiSpamDurationModal(interaction, prisma, SPAM_PUNISHMENT.TIMEOUT);
    case 'automod:spam:punish:save':
      return saveAntiSpamPunishSession(interaction, prisma);
    case 'automod:spam:punish:defaults':
      return resetAntiSpamPunishSession(interaction, prisma);
    case 'automod:spam:punish:cancel':
      return cancelAntiSpamPunishSession(interaction, prisma);
    default:
      return false;
  }
}

async function handleModuleSelect(interaction, prisma) {
  const value = interaction.values?.[0];
  if (value === MODULE_VALUES.WORDS) {
    return showWordsOverview(interaction, prisma);
  }
  if (value === MODULE_VALUES.SPAM) {
    return showAntiSpamPanel(interaction, prisma);
  }
  await deferIfNeeded(interaction);
  await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true });
  return true;
}

async function showModuleOverview(interaction, prisma) {
  const [{ autoConfig }, antiSpamState] = await Promise.all([
    ensureAutoModState(prisma),
    ensureAntiSpamState(prisma),
  ]);
  await respondWithPanel(interaction, {
    embeds: [buildModuleOverviewEmbed(autoConfig, antiSpamState.antiSpamConfig, antiSpamState.globalConfig)],
    components: moduleOverviewComponents(),
  });
  return true;
}

async function showWordsOverview(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await respondWithPanel(interaction, { embeds: [buildWordsOverviewEmbed(autoConfig)], components: wordsOverviewComponents() });
  return true;
}

async function showWordsList(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await respondWithPanel(interaction, { embeds: [buildWordsListEmbed(autoConfig)], components: wordsListComponents() });
  return true;
}

async function showWordsPunish(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await respondWithPanel(interaction, { embeds: [buildPunishEmbed(autoConfig)], components: wordsPunishComponents(autoConfig) });
  return true;
}

async function showWordsPunishDetail(interaction, prisma, { silent = false } = {}) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await respondWithPanel(interaction, { embeds: [buildPunishDetailEmbed(autoConfig)], components: wordsPunishDetailComponents() });
  if (!silent) {
    await interaction.followUp({ content: 'Castigar e apagar ativado.', ephemeral: true }).catch(() => {});
  }
  return true;
}

async function showDurationSelect(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  const embed = new EmbedBuilder()
    .setTitle('Definir tempo de castigo')
    .setDescription('Escolha o tempo aplicado junto com a exclusão da mensagem.')
    .addFields({ name: 'Tempo atual', value: formatDuration(autoConfig.punishmentDurationSeconds || 60) })
    .setColor(0x5865F2);
  await respondWithPanel(interaction, { embeds: [embed], components: durationSelectComponents() });
  return true;
}

async function setPunishmentMode(interaction, prisma, mode) {
  const { autoConfig } = await ensureAutoModState(prisma);
  if (mode === PUNISHMENT.DELETE) {
    if (autoConfig.punishmentType === PUNISHMENT.DELETE) {
      await deferIfNeeded(interaction);
      await interaction.followUp({ content: 'Apagar já está ativado.', ephemeral: true });
      return true;
    }
    await prisma.autoModConfig.update({
      where: { id: autoConfig.id },
      data: { punishmentType: PUNISHMENT.DELETE, punishmentDurationSeconds: null },
    });
    invalidateWordsCache();
    await showWordsPunish(interaction, prisma);
    await interaction.followUp({ content: 'Apagar ativado.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (autoConfig.punishmentType !== PUNISHMENT.PUNISH_DELETE) {
    await prisma.autoModConfig.update({
      where: { id: autoConfig.id },
      data: { punishmentType: PUNISHMENT.PUNISH_DELETE, punishmentDurationSeconds: autoConfig.punishmentDurationSeconds || 60 },
    });
    invalidateWordsCache();
  }
  return showWordsPunishDetail(interaction, prisma);
}

async function saveDuration(interaction, prisma) {
  const seconds = Number(interaction.values?.[0]);
  if (!seconds || Number.isNaN(seconds)) {
    await deferIfNeeded(interaction);
    await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true });
    return true;
  }
  const { autoConfig } = await ensureAutoModState(prisma);
  await prisma.autoModConfig.update({
    where: { id: autoConfig.id },
    data: { punishmentType: PUNISHMENT.PUNISH_DELETE, punishmentDurationSeconds: seconds },
  });
  invalidateWordsCache();
  const { autoConfig: refreshed } = await ensureAutoModState(prisma);
  await respondWithPanel(interaction, { embeds: [buildPunishDetailEmbed(refreshed)], components: wordsPunishDetailComponents() });
  await interaction.followUp({ content: `Tempo definido para ${formatDuration(seconds)}.`, ephemeral: true }).catch(() => {});
  return true;
}

async function startWordUpload(interaction) {
  const existing = wordUploadSessions.get(interaction.user.id);
  await deferIfNeeded(interaction);
  if (existing) {
    await interaction.followUp({ content: 'Você já possui uma importação em andamento. Envie o arquivo ou digite cancelar.', ephemeral: true });
    return true;
  }
  const embed = new EmbedBuilder()
    .setTitle('Enviar palavras proibidas')
    .setDescription('Envie um arquivo `.txt` neste canal contendo palavras separadas por vírgula.\nExemplo: `palavra1, palavra2, palavra3`.\nEnvie **cancelar** para abortar.')
    .setColor(0xFEE75C);
  await interaction.followUp({ embeds: [embed], ephemeral: true });
  const timeout = setTimeout(() => wordUploadSessions.delete(interaction.user.id), WORD_UPLOAD_TIMEOUT);
  wordUploadSessions.set(interaction.user.id, { channelId: interaction.channelId, timeout });
  return true;
}

async function showAntiSpamPanel(interaction, prisma) {
  const { antiSpamConfig, globalConfig } = await ensureAntiSpamState(prisma);
  await respondWithPanel(interaction, { embeds: [buildAntiSpamEmbed(antiSpamConfig, globalConfig)], components: buildAntiSpamComponents(antiSpamConfig) });
  return true;
}

async function toggleAntiSpam(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  await prisma.antiSpamConfig.update({
    where: { id: antiSpamConfig.id },
    data: { enabled: !antiSpamConfig.enabled },
  });
  invalidateAntiSpamCache();
  await interaction.followUp({ content: `Anti-Spam ${!antiSpamConfig.enabled ? 'ativado' : 'desativado'}.`, ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function showAntiSpamLimitModal(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  const modal = new ModalBuilder()
    .setCustomId('automod:spam:limit:modal')
    .setTitle('Configurar Anti-Spam')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('limit')
          .setLabel('Mensagens permitidas (1-100)')
          .setPlaceholder('Ex: 5')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setValue(String(antiSpamConfig.messageLimit || DEFAULT_SPAM_CONFIG.messageLimit)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('window')
          .setLabel('Intervalo em segundos (1-600)')
          .setPlaceholder('Ex: 10')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setValue(String(antiSpamConfig.perSeconds || DEFAULT_SPAM_CONFIG.perSeconds)),
      ),
    );
  await interaction.showModal(modal);
  return true;
}

async function handleAntiSpamLimitModal(interaction, prisma) {
  const limitRaw = Number(interaction.fields.getTextInputValue('limit'));
  const windowRaw = Number(interaction.fields.getTextInputValue('window'));
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : NaN;
  const windowSeconds = Number.isFinite(windowRaw) ? Math.trunc(windowRaw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 600) {
    await interaction.reply({ content: 'Valores inválidos. Use números entre 1-100 para mensagens e 1-600 para segundos.', ephemeral: true });
    return true;
  }
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  await prisma.antiSpamConfig.update({
    where: { id: antiSpamConfig.id },
    data: { messageLimit: limit, perSeconds: windowSeconds },
  });
  invalidateAntiSpamCache();
  return showAntiSpamPanel(interaction, prisma);
}

async function handleAntiSpamChannelSelect(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  const values = interaction.values || [];
  await prisma.antiSpamIgnoredChannel.deleteMany({ where: { antiSpamConfigId: antiSpamConfig.id } });
  if (values.length) {
    await prisma.antiSpamIgnoredChannel.createMany({
      data: values.slice(0, 25).map((channelId) => ({ antiSpamConfigId: antiSpamConfig.id, channelId })),
    });
  }
  invalidateAntiSpamCache();
  await interaction.deferUpdate();
  await interaction.followUp({ content: 'Lista de canais ignorados atualizada.', ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function handleAntiSpamRoleSelect(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  const values = interaction.values || [];
  await prisma.antiSpamBypassRole.deleteMany({ where: { antiSpamConfigId: antiSpamConfig.id } });
  if (values.length) {
    await prisma.antiSpamBypassRole.createMany({
      data: values.slice(0, 25).map((roleId) => ({ antiSpamConfigId: antiSpamConfig.id, roleId })),
    });
  }
  invalidateAntiSpamCache();
  await interaction.deferUpdate();
  await interaction.followUp({ content: 'Cargos isentos atualizados.', ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function restoreAntiSpamDefaults(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  await prisma.$transaction([
    prisma.antiSpamIgnoredChannel.deleteMany({ where: { antiSpamConfigId: antiSpamConfig.id } }),
    prisma.antiSpamBypassRole.deleteMany({ where: { antiSpamConfigId: antiSpamConfig.id } }),
    prisma.antiSpamConfig.update({
      where: { id: antiSpamConfig.id },
      data: {
        enabled: DEFAULT_SPAM_CONFIG.enabled,
        messageLimit: DEFAULT_SPAM_CONFIG.messageLimit,
        perSeconds: DEFAULT_SPAM_CONFIG.perSeconds,
        punishmentMode: DEFAULT_SPAM_CONFIG.punishmentMode,
        muteDurationSeconds: DEFAULT_SPAM_CONFIG.muteDurationSeconds,
        timeoutDurationSeconds: DEFAULT_SPAM_CONFIG.timeoutDurationSeconds,
      },
    }),
  ]);
  invalidateAntiSpamCache();
  await interaction.followUp({ content: 'Configurações Anti-Spam restauradas para o padrão.', ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function showAntiSpamPunishPanel(interaction, prisma) {
  const { antiSpamConfig, globalConfig } = await ensureAntiSpamState(prisma);
  const session = ensureAntiSpamPunishSession(interaction.user.id, antiSpamConfig);
  await respondWithPanel(interaction, {
    embeds: [buildAntiSpamPunishEmbed(session, globalConfig)],
    components: buildAntiSpamPunishComponents(session),
  });
  return true;
}

async function handleAntiSpamPunishModeSelect(interaction, prisma) {
  const value = interaction.values?.[0];
  if (!Object.values(SPAM_PUNISHMENT).includes(value)) {
    await deferIfNeeded(interaction);
    await interaction.followUp({ content: 'Modo inválido.', ephemeral: true });
    return true;
  }
  const session = updateAntiSpamPunishSession(interaction.user.id, { mode: value });
  if (!session) {
    await deferIfNeeded(interaction);
    await interaction.followUp({ content: 'Reabra o painel de punição para continuar.', ephemeral: true });
    return true;
  }
  const { globalConfig } = await ensureAntiSpamState(prisma);
  await respondWithPanel(interaction, {
    embeds: [buildAntiSpamPunishEmbed(session, globalConfig)],
    components: buildAntiSpamPunishComponents(session),
  });
  return true;
}

async function showAntiSpamDurationModal(interaction, prisma, mode) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  const session = ensureAntiSpamPunishSession(interaction.user.id, antiSpamConfig);
  const isMute = mode === SPAM_PUNISHMENT.MUTE;
  const modal = new ModalBuilder()
    .setCustomId(isMute ? 'automod:spam:punish:duration:modal:mute' : 'automod:spam:punish:duration:modal:timeout')
    .setTitle(isMute ? 'Tempo de mute (minutos)' : 'Tempo de timeout (minutos)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('minutes')
          .setLabel('Quantidade em minutos (>=1)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(4)
          .setValue(String(Math.max(1, Math.round((isMute ? session.muteDurationSeconds : session.timeoutDurationSeconds) / 60))))
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
  return true;
}

async function handleAntiSpamDurationModal(interaction, prisma, mode) {
  const minutesRaw = Number(interaction.fields.getTextInputValue('minutes'));
  const minutes = Number.isFinite(minutesRaw) ? Math.trunc(minutesRaw) : NaN;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) {
    await interaction.reply({ content: 'Informe um número entre 1 e 600 minutos.', ephemeral: true });
    return true;
  }
  const seconds = Math.round(minutes * 60);
  const next = mode === SPAM_PUNISHMENT.MUTE
    ? { muteDurationSeconds: seconds }
    : { timeoutDurationSeconds: seconds };
  const session = updateAntiSpamPunishSession(interaction.user.id, next);
  if (!session) {
    await interaction.reply({ content: 'Reabra o painel de punição para continuar.', ephemeral: true });
    return true;
  }
  const { globalConfig } = await ensureAntiSpamState(prisma);
  await respondWithPanel(interaction, {
    embeds: [buildAntiSpamPunishEmbed(session, globalConfig)],
    components: buildAntiSpamPunishComponents(session),
  });
  return true;
}

async function saveAntiSpamPunishSession(interaction, prisma) {
  const session = antiSpamPunishSessions.get(interaction.user.id)?.data;
  if (!session) {
    await deferIfNeeded(interaction);
    await interaction.followUp({ content: 'Sessão expirada. Abra novamente para alterar.', ephemeral: true });
    return true;
  }
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  await prisma.antiSpamConfig.update({
    where: { id: antiSpamConfig.id },
    data: {
      punishmentMode: session.mode,
      muteDurationSeconds: session.muteDurationSeconds,
      timeoutDurationSeconds: session.timeoutDurationSeconds,
    },
  });
  invalidateAntiSpamCache();
  clearAntiSpamPunishSession(interaction.user.id);
  await interaction.followUp({ content: 'Punição atualizada com sucesso.', ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function resetAntiSpamPunishSession(interaction, prisma) {
  const { antiSpamConfig } = await ensureAntiSpamState(prisma);
  ensureAntiSpamPunishSession(interaction.user.id, antiSpamConfig);
  updateAntiSpamPunishSession(interaction.user.id, {
    mode: DEFAULT_SPAM_CONFIG.punishmentMode,
    muteDurationSeconds: DEFAULT_SPAM_CONFIG.muteDurationSeconds,
    timeoutDurationSeconds: DEFAULT_SPAM_CONFIG.timeoutDurationSeconds,
  });
  const session = antiSpamPunishSessions.get(interaction.user.id).data;
  const { globalConfig } = await ensureAntiSpamState(prisma);
  await respondWithPanel(interaction, {
    embeds: [buildAntiSpamPunishEmbed(session, globalConfig)],
    components: buildAntiSpamPunishComponents(session),
  });
  await interaction.followUp({ content: 'Valores padrão carregados. Clique em salvar para aplicar.', ephemeral: true }).catch(() => {});
  return true;
}

async function cancelAntiSpamPunishSession(interaction, prisma) {
  clearAntiSpamPunishSession(interaction.user.id);
  await interaction.followUp({ content: 'Alterações descartadas.', ephemeral: true }).catch(() => {});
  return showAntiSpamPanel(interaction, prisma);
}

async function handleWordFile(message, ctx) {
  const attachment = message.attachments.find((att) => att.name && att.name.toLowerCase().endsWith('.txt'));
  if (!attachment) {
    await respondAndDelete(message, 'Envie um arquivo .txt válido ou digite cancelar.');
    return true;
  }
  let text;
  try {
    const res = await fetch(attachment.url);
    text = await res.text();
  } catch (err) {
    console.error('[automod] Falha ao baixar arquivo:', err?.message || err);
    await respondAndDelete(message, 'Não consegui ler o arquivo. Tente novamente.');
    return true;
  }
  const words = text
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) {
    await respondAndDelete(message, 'Nenhuma palavra válida encontrada no arquivo.');
    return true;
  }
  const prisma = getPrismaFromCtx(ctx);
  const { autoConfig } = await ensureAutoModState(prisma);
  const existingWords = new Set((autoConfig.blockedWords || []).map((w) => w.word));
  const uniqueWords = Array.from(new Set(words)).filter((word) => !existingWords.has(word));
  if (!uniqueWords.length) {
    await respondAndDelete(message, 'Nenhuma nova palavra para cadastrar.');
    clearWordSession(message.author.id);
    return true;
  }
  await prisma.autoModBlockedWord.createMany({
    data: uniqueWords.map((word) => ({ autoModConfigId: autoConfig.id, word })),
  });
  invalidateWordsCache();
  clearWordSession(message.author.id);
  await respondAndDelete(message, `Importei ${uniqueWords.length} palavra(s).`, { mention: true });
  return true;
}

function clearWordSession(userId) {
  const session = wordUploadSessions.get(userId);
  if (session?.timeout) {
    clearTimeout(session.timeout);
  }
  wordUploadSessions.delete(userId);
}

async function respondAndDelete(message, content, { mention = false } = {}) {
  try {
    const reply = await message.reply({
      content: mention ? `<@${message.author.id}> ${content}` : content,
      allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
    });
    setTimeout(() => reply.delete().catch(() => {}), 8000);
  } catch {}
}

function getAntiSpamKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function handleMessage(message, ctx) {
  if (message.author.bot) return false;
  const pending = wordUploadSessions.get(message.author.id);
  if (pending && pending.channelId === message.channelId) {
    const content = (message.content || '').trim().toLowerCase();
    if (content === 'cancelar') {
      clearWordSession(message.author.id);
      await respondAndDelete(message, 'Operação cancelada.', { mention: true });
      return true;
    }
    return handleWordFile(message, ctx);
  }
  if (!message.guild || !ctx.isGuildAllowed(message.guildId)) return false;
  const prisma = getPrismaFromCtx(ctx);
  const runtime = await fetchAutoModRuntime(prisma);
  if (await handleWordDetection(message, runtime)) {
    return true;
  }
  return handleAntiSpamDetection(message, prisma);
}

async function handleWordDetection(message, runtime) {
  if (!runtime.words.length) return false;
  const content = (message.content || '').toLowerCase();
  if (!content) return false;
  const matched = runtime.words.find((word) => word && content.includes(word));
  if (!matched) return false;
  const reason = runtime.reason || DEFAULT_REASON;
  try {
    await message.delete().catch(() => {});
  } catch {}
  if (runtime.punishmentType === PUNISHMENT.PUNISH_DELETE && runtime.punishmentDurationSeconds) {
    try {
      await message.member?.timeout(runtime.punishmentDurationSeconds * 1000, reason);
    } catch (err) {
      console.error('[automod] Falha ao aplicar timeout:', err?.message || err);
    }
  }
  try {
    const warn = await message.channel.send({
      content: `<@${message.author.id}>, sua mensagem foi removida (${reason}).`,
      allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
    });
    setTimeout(() => warn.delete().catch(() => {}), 8000);
  } catch {}
  return true;
}

async function handleAntiSpamDetection(message, prisma) {
  const runtime = await fetchAntiSpamRuntime(prisma);
  if (!runtime.enabled) return false;
  if (runtime.ignoredChannels.has(message.channelId)) return false;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return false;
  if (runtime.bypassRoles.size && member.roles.cache.some((role) => runtime.bypassRoles.has(role.id))) {
    return false;
  }
  const key = getAntiSpamKey(message.guildId, member.id);
  const now = Date.now();
  const cooldownUntil = antiSpamCooldowns.get(key);
  if (cooldownUntil && cooldownUntil > now) {
    return false;
  }
  const windowMs = (runtime.perSeconds || DEFAULT_SPAM_CONFIG.perSeconds) * 1000;
  const bucketEntries = (antiSpamBuckets.get(key) || [])
    .map((entry) => (typeof entry === 'number'
      ? { timestamp: entry, messageId: null, channelId: null }
      : entry))
    .filter((entry) => entry && typeof entry.timestamp === 'number');
  const filtered = bucketEntries.filter((entry) => now - entry.timestamp <= windowMs);
  filtered.push({ timestamp: now, messageId: message.id, channelId: message.channelId });
  const limit = runtime.messageLimit || DEFAULT_SPAM_CONFIG.messageLimit;
  if (filtered.length >= limit) {
    const recentEntries = filtered.slice(-limit);
    antiSpamBuckets.set(key, []);
    antiSpamCooldowns.set(key, now + windowMs);
    await applyAntiSpamPunishment({ message, member, runtime, prisma });
    await deleteSpamMessages(message, recentEntries);
    return true;
  }
  antiSpamBuckets.set(key, filtered);
  return false;
}

async function deleteSpamMessages(message, entries) {
  if (!entries?.length) return;
  const grouped = new Map();
  for (const entry of entries) {
    if (!entry?.messageId || !entry?.channelId) continue;
    if (!grouped.has(entry.channelId)) {
      grouped.set(entry.channelId, new Set());
    }
    grouped.get(entry.channelId).add(entry.messageId);
  }
  for (const [channelId, ids] of grouped.entries()) {
    const channel = channelId === message.channelId
      ? message.channel
      : await message.client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) continue;
    for (const id of ids) {
      const targetMessage = id === message.id
        ? message
        : await channel.messages.fetch(id).catch(() => null);
      if (!targetMessage) continue;
      if (targetMessage.deletable) {
        await targetMessage.delete().catch(() => {});
        continue;
      }
      await channel.messages.delete(id).catch(() => {});
    }
  }
}

async function applyAntiSpamPunishment({ message, member, runtime, prisma }) {
  const reason = `Anti-Spam automático: ${runtime.messageLimit} mensagens / ${runtime.perSeconds}s`;
  if (runtime.punishmentMode === SPAM_PUNISHMENT.TIMEOUT) {
    return applyTimeoutPunishment({ message, member, runtime, reason });
  }
  return applyChatMutePunishment({ message, member, runtime, prisma, reason });
}

async function applyChatMutePunishment({ message, member, runtime, prisma, reason }) {
  const roleId = runtime.globalConfig.muteChatRoleId;
  if (!roleId) {
    console.warn('[automod] Anti-Spam configurado para mute, mas cargo mute não está definido.');
    return false;
  }
  const botMember = message.guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    console.warn('[automod] Falha ao aplicar mute automático: permissão ManageRoles ausente.');
    return false;
  }
  const durationSeconds = runtime.muteDurationSeconds || DEFAULT_SPAM_CONFIG.muteDurationSeconds;
  const existing = await prisma.chatMute.findFirst({ where: { guildId: message.guild.id, userId: member.id, endedAt: null } });
  const expiresAt = new Date(Date.now() + durationSeconds * 1000);
  if (existing) {
    await prisma.chatMute.update({
      where: { id: existing.id },
      data: { reason, durationSeconds, expiresAt, moderatorId: message.client.user.id, commandChannelId: message.channel.id },
    });
  } else {
    await prisma.chatMute.create({
      data: {
        globalConfigId: runtime.globalConfig.id,
        guildId: message.guild.id,
        userId: member.id,
        moderatorId: message.client.user.id,
        reason,
        durationSeconds,
        expiresAt,
        commandChannelId: message.channel.id,
      },
    });
  }
  await member.roles.add(roleId, reason).catch((err) => console.warn('[automod] Falha ao aplicar cargo de mute:', err?.message || err));
  await sendAntiSpamLog({ message, member, reason, durationSeconds, logChannelId: runtime.globalConfig.muteChatLogChannelId });
  await notifyChannel(message, `${member} foi mutado automaticamente por spam.`);
  return true;
}

async function applyTimeoutPunishment({ message, member, runtime, reason }) {
  const botMember = message.guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
    console.warn('[automod] Falha ao aplicar timeout automático: permissão ModerateMembers ausente.');
    return false;
  }
  const durationSeconds = runtime.timeoutDurationSeconds || DEFAULT_SPAM_CONFIG.timeoutDurationSeconds;
  try {
    await member.timeout(durationSeconds * 1000, reason);
  } catch (err) {
    console.error('[automod] Falha ao aplicar timeout automático:', err?.message || err);
    return false;
  }
  await sendAntiSpamLog({ message, member, reason, durationSeconds, logChannelId: runtime.globalConfig.muteChatLogChannelId });
  await notifyChannel(message, `${member} recebeu timeout automático por spam.`);
  return true;
}

async function sendAntiSpamLog({ message, member, reason, durationSeconds, logChannelId }) {
  const embed = buildMuteLogEmbed({
    scope: 'chat',
    action: 'apply',
    targetUser: member.user,
    moderatorUser: message.client.user,
    reason,
    durationSeconds,
    guild: message.guild,
  });
  await sendLogMessage(message.guild, logChannelId, embed);
}

async function notifyChannel(message, content) {
  try {
    const sent = await message.channel.send(content);
    setTimeout(() => sent.delete().catch(() => {}), 60000);
  } catch {}
}

async function respondWithPanel(interaction, payload) {
  await deferIfNeeded(interaction);
  await interaction.editReply(payload);
}

async function deferIfNeeded(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    if (typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate();
    }
  }
}

module.exports = {
  presentMenu,
  handleInteraction,
  handleMessage,
};
