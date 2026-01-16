const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');
const { ensureGuild } = require('../permissions');
const { getProtectionsConfig, saveProtectionsConfig, PUNISH, DEFAULT_CRITICAL_PERMS } = require('../services/protectionsConfig');
const { BACKUP_SCOPES, createBackup, listBackups, countBackups, diffBackup, restoreBackup, getBackup, deleteBackup } = require('../services/backups');

const CUSTOM_IDS = {
  ROOT: 'menu:protections:root',
  MODULE_SELECT: 'menu:protections:select',
  GLOBAL_WH: 'menu:protections:globalwh',
  GLOBAL_WH_USERS: 'menu:protections:globalwhusers',
  GLOBAL_WH_ROLES: 'menu:protections:globalwhroles',
  BACKUP: (action, extra) => `prot:backup:${action}${extra ? `:${extra}` : ''}`,
  TOGGLE: (m) => `prot:toggle:${m}`,
  PUNISH: (m) => `prot:punish:${m}`,
  LIMIT: (m) => `prot:limit:${m}`,
  WHITELIST: (m) => `prot:wh:${m}`,
  LOG: (m) => `prot:log:${m}`,
  ROLE_LIMIT: (m) => `prot:rolelimit:${m}`,
  BLOCKED_ROLES: (m) => `prot:blockroles:${m}`,
  BLOCKED_PERMS: (m) => `prot:blockperms:${m}`,
  MIN_DAYS: (m) => `prot:mindays:${m}`,
  PROTECT_PERMS: (m) => `prot:protectperms:${m}`,
  PROTECT_ASSIGN: (m) => `prot:protectassign:${m}`,
  WH_USERS: (m) => `prot:whusers:${m}`,
  WH_ROLES: (m) => `prot:whroles:${m}`,
  BACK_MODULE: (m) => `prot:back:${m}`,
  PAGE: (m, page) => `prot:page:${m}:${page}`,
  BLOCK_PERM_TOGGLE: (m, perm, page) => `prot:blockperm:${m}:${page}:${perm}`,
};

const MODALS = {
  LIMIT: (m, msg) => `protmodal:limit:${m}:${msg || '0'}`,
  WHITELIST: (m, msg) => `protmodal:wh:${m}:${msg || '0'}`,
  MIN_DAYS: (m, msg) => `protmodal:mindays:${m}:${msg || '0'}`,
  BACKUP_NAME: (msg) => `protmodal:backup:name:${msg || '0'}`,
  BACKUP_CATEGORY_FILTER: (msg) => `protmodal:backup:catfilter:${msg || '0'}`,
};

const MODULES = [
  { id: 'antiRoleHierarchy', label: 'Anti Hierarquia de Cargos', hasLimit: false, hasLog: true, hasWhitelist: true, hasPunish: true, extras: ['roleLimit', 'protectPerms'] },
  { id: 'antiBotAdd', label: 'Anti Bot Add', hasLog: true, hasWhitelist: true, hasPunish: true },
  { id: 'antiCriticalPerms', label: 'Anti Permissão Crítica', hasLog: true, hasWhitelist: true, hasPunish: true, extras: ['blockedPerms'] },
  { id: 'antiAlt', label: 'Anti ALT', hasLog: true, hasWhitelist: false, hasPunish: true, extras: ['minDays'] },
  { id: 'massBanKick', label: 'Proteção Ban/Kick massivo', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
  { id: 'massTimeout', label: 'Proteção Timeout massivo', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
  { id: 'massChannelDelete', label: 'Proteção deleção de canais', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
  { id: 'massRoleDelete', label: 'Proteção deleção de cargos', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
  { id: 'blockedRoles', label: 'Cargos bloqueados', hasLog: true, hasWhitelist: false, hasPunish: false, extras: ['blockedRoles'] },
  { id: 'massDisconnect', label: 'Proteção desconectar massivo', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
  { id: 'massMuteDeafen', label: 'Proteção mute/deafen massivo', hasLog: true, hasWhitelist: true, hasPunish: true, hasLimit: true },
];

const BACKUP_STATES = {
  HOME: 'HOME',
  CREATE_SCOPE: 'CREATE_BACKUP_SELECT_SCOPE',
  CREATE_NAME: 'CREATE_BACKUP_NAMING',
  CREATING: 'CREATING_BACKUP',
  DONE_CREATE: 'DONE_CREATE',
  SELECT_BACKUP: 'SELECT_BACKUP',
  VERIFYING: 'VERIFYING',
  SHOW_DIFF: 'SHOW_DIFF',
  CONFIRM_RESTORE: 'CONFIRM_RESTORE',
  SELECT_CATEGORY: 'SELECT_CATEGORY',
  SELECT_RESTORE_SCOPE: 'SELECT_RESTORE_SCOPE',
  RESTORING: 'RESTORING',
  DONE_RESTORE: 'DONE_RESTORE',
  CONFIRM_DELETE: 'CONFIRM_DELETE',
  DONE_DELETE: 'DONE_DELETE',
  CANCELLED: 'CANCELLED',
};

const CRITICAL_PERM_LABELS = {
  Administrator: 'Administrador',
  ManageGuild: 'Gerenciar servidor',
  ManageRoles: 'Gerenciar cargos',
  ManageChannels: 'Gerenciar canais',
  ViewAuditLog: 'Ver registro de auditoria',
  ViewGuildInsights: 'Ver insights do servidor',
  ManageWebhooks: 'Gerenciar webhooks',
  BanMembers: 'Banir membros',
  ModerateMembers: 'Timeout/Moderar membros',
  MuteMembers: 'Silenciar membros',
  DeafenMembers: 'Ensurdecer membros',
  MoveMembers: 'Mover membros',
};

const criticalPermLabel = (perm) => CRITICAL_PERM_LABELS[perm] || perm;

function isComponent(i) {
  return i.isButton?.() || i.isAnySelectMenu?.();
}

async function ensureDeferred(interaction) {
  if (!interaction?.isRepliable?.()) return;
  if (isComponent(interaction)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }
  } else if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function respond(interaction, payload) {
  if (!interaction?.isRepliable?.()) return;
  if (interaction.isMessageComponent?.()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch((e) => console.error('[protections][respond] deferUpdate failed', e));
    }
    // Em componentes, manter atualização via editReply (seguro para ephemeral); evitar message.edit para não bater 10008
    await interaction.editReply(payload).catch((e) => console.error('[protections][respond] editReply failed', e));
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch((e) => console.error('[protections][respond] editReply failed', e));
  } else {
    await interaction.reply({ ...payload, ephemeral: true }).catch((e) => console.error('[protections][respond] reply failed', e));
  }
}

function buildPayload(embed, components) {
  return { embeds: [embed], components };
}

function punishmentLabel(p) {
  if (p === PUNISH.KICK) return 'Expulsar usuário';
  return 'Remover todos os cargos';
}

function formatIds(arr = []) {
  return arr.length ? arr.map((id) => `\`${id}\``).join(', ') : '—';
}

function moduleById(id) {
  return MODULES.find((m) => m.id === id);
}

function buildRootEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Proteções e Snapshots')
    .setDescription('Selecione uma proteção para configurar. Todos os módulos iniciam desativados.')
    .addFields(
      {
        name: 'Whitelist global',
        value: `${cfg?.globalWhitelistUsers?.length || 0} usuários / ${cfg?.globalWhitelistRoles?.length || 0} cargos`,
        inline: true,
      },
      {
        name: 'Backups',
        value: 'Gerencie backups pelo menu Backups',
        inline: true,
      },
    )
    .addFields(
      MODULES.filter((m) => !m.disabled).map((m) => ({
        name: m.label,
        value: cfg?.[m.id]?.enabled ? 'Ativado' : 'Desativado',
        inline: true,
      })),
    )
    .setColor(0x5865f2);
}

function buildRootComponents(selected) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.MODULE_SELECT)
    .setPlaceholder('Selecione uma proteção')
    .addOptions(
      MODULES.map((m) => ({
        label: m.label,
        value: m.id,
        description: m.disabled ? 'Em breve' : 'Configurar módulo',
        default: selected === m.id,
        emoji: m.disabled ? '⏳' : undefined,
      })).concat([
        {
          label: 'Backups e Snapshots',
          value: 'backups',
          description: 'Criar, verificar e restaurar backups',
          default: selected === 'backups',
        },
      ]),
    );
  const row = new ActionRowBuilder().addComponents(select);
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.GLOBAL_WH).setLabel('Whitelist global').setStyle(ButtonStyle.Secondary),
  );
  return [row, back];
}

/**
 * Constrói embed de configuração para um módulo de proteção
 * @param {Object} module - Definição do módulo (MODULES array)
 * @param {Object} cfg - Configuração atual completa
 * @returns {EmbedBuilder} Embed configurado com fields dinâmicos
 */
function buildModuleEmbed(module, cfg) {
  const state = cfg[module.id] || {};
  const fields = [
    { name: 'Status', value: state.enabled ? 'Ativado' : 'Desativado', inline: true },
  ];
  if (module.hasPunish) fields.push({ name: 'Punição', value: punishmentLabel(state.punishment), inline: true });
  if (module.hasLog) fields.push({ name: 'Log', value: state.logChannelId ? `<#${state.logChannelId}>` : '—', inline: true });
  if (module.hasWhitelist) fields.push({ name: 'Whitelist Users/Roles', value: `${state.whitelistUsers?.length || 0} / ${state.whitelistRoles?.length || 0}`, inline: true });
  if (module.hasLimit) fields.push({ name: 'Limite', value: state.limit ? `${state.limit.count}/${state.limit.seconds}s` : '—', inline: true });

  if (module.id === 'antiRoleHierarchy') {
    fields.push({ name: 'Cargo limite', value: state.limitRoleId ? `<@&${state.limitRoleId}>` : '—', inline: true });
    fields.push({ name: 'Proteger permissões', value: state.protectPermissions ? 'Sim' : 'Não', inline: true });
    fields.push({ name: 'Anti-set cargos', value: state.preventProtectedRoleGive ? 'Sim' : 'Não', inline: true });
  }
  if (module.id === 'antiCriticalPerms') {
    const active = state.blockedPerms || [];
    fields.push({
      name: 'Perms bloqueadas',
      value: active.length ? `Ativas (${active.length}): ${active.join(', ')}` : 'Nenhuma (todas liberadas)',
      inline: false,
    });
  }
  if (module.id === 'antiAlt') {
    fields.push({ name: 'Idade mínima (dias)', value: String(state.minAccountDays || 7), inline: true });
  }
  if (module.id === 'blockedRoles') {
    fields.push({ name: 'Cargos bloqueados', value: state.roles?.length ? state.roles.map((r) => `<@&${r}>`).join(', ') : '—', inline: false });
  }

  return new EmbedBuilder()
    .setTitle(module.label)
    .setDescription('Ajuste as opções abaixo.')
    .addFields(fields)
    .setColor(state.enabled ? 0x2ecc71 : 0x5865f2);
}

/**
 * Constrói components (botões, selects) para um módulo de proteção
 * Inclui paginação especial para antiCriticalPerms (12 permissions, 5/row, 2 rows/página)
 * @param {Object} module - Definição do módulo
 * @param {Object} cfg - Configuração atual
 * @param {Object} opts - Opções { page: number }
 * @returns {Array<ActionRowBuilder>} Array de action rows (máx 5)
 */
function buildModuleComponents(module, cfg, opts = {}) {
  const page = Math.max(0, opts.page || 0);
  const state = cfg[module.id] || {};
  const defaultLogChannel = state.logChannelId ? [state.logChannelId] : [];
  const defaultLimitRole = state.limitRoleId ? [state.limitRoleId] : [];
  const defaultBlockedRoles = Array.isArray(state.roles) ? state.roles.slice(0, 25) : [];
  const rows = [];
  const buttons = [];
  buttons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.TOGGLE(module.id)).setLabel(state.enabled ? 'Desativar' : 'Ativar').setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success));
  if (module.hasPunish) {
    buttons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.PUNISH(module.id)).setLabel(`Punição: ${punishmentLabel(state.punishment)}`).setStyle(ButtonStyle.Secondary));
  }
  if (module.id === 'antiRoleHierarchy') {
    buttons.push(new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.PROTECT_PERMS(module.id))
      .setLabel(state.protectPermissions ? 'Proteger permissões: ON' : 'Proteger permissões: OFF')
      .setStyle(ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.PROTECT_ASSIGN(module.id))
      .setLabel(state.preventProtectedRoleGive ? 'Anti-set cargos: ON' : 'Anti-set cargos: OFF')
      .setStyle(ButtonStyle.Secondary));
  }
  rows.push(new ActionRowBuilder().addComponents(buttons));

  if (module.hasLimit) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CUSTOM_IDS.LIMIT(module.id)).setLabel('Editar limite (X/Y)').setStyle(ButtonStyle.Primary),
    ));
  }

  if (module.id === 'antiRoleHierarchy') {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.ROLE_LIMIT(module.id))
        .setPlaceholder('Selecionar cargo limite')
        .setDefaultRoles(defaultLimitRole)
        .setMinValues(1)
        .setMaxValues(1),
    ));
  }

  if (module.hasLog) {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.LOG(module.id))
        .setPlaceholder('Selecionar canal de log')
        .setDefaultChannels(defaultLogChannel)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ));
  }

  if (module.hasWhitelist && module.id !== 'antiCriticalPerms') {
    const wlRowButtons = [new ButtonBuilder().setCustomId(CUSTOM_IDS.WHITELIST(module.id)).setLabel('Editar whitelist').setStyle(ButtonStyle.Secondary)];
    if (module.id === 'antiAlt') {
      wlRowButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.MIN_DAYS(module.id)).setLabel('Idade mínima (dias)').setStyle(ButtonStyle.Secondary));
    }
    rows.push(new ActionRowBuilder().addComponents(wlRowButtons));
  } else if (!module.hasWhitelist) {
    if (module.id === 'antiAlt') {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.MIN_DAYS(module.id)).setLabel('Idade mínima (dias)').setStyle(ButtonStyle.Secondary),
      ));
    }
  }

  // antiCriticalPerms: paginação especial para 12 permissions (5 buttons/row, 2 rows/page = 10 perms/page)
  if (module.id === 'antiCriticalPerms') {
    const activeSet = new Set(state.blockedPerms || []);
    const buttonsPerRow = 5;
    const perPage = 10; // 2 rows x 5 buttons para respeitar limite de 5 action rows
    const totalPerms = (DEFAULT_CRITICAL_PERMS || []).length;
    const maxPage = Math.max(0, Math.ceil(totalPerms / perPage) - 1);
    const currentPage = Math.min(page, maxPage);
    const permsPage = (DEFAULT_CRITICAL_PERMS || []).slice(currentPage * perPage, currentPage * perPage + perPage);
    const permButtons = permsPage.map((perm) =>
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.BLOCK_PERM_TOGGLE(module.id, perm, currentPage))
        .setLabel(criticalPermLabel(perm))
        .setStyle(activeSet.has(perm) ? ButtonStyle.Success : ButtonStyle.Danger),
    );

    for (let i = 0; i < permButtons.length; i += buttonsPerRow) {
      rows.push(new ActionRowBuilder().addComponents(permButtons.slice(i, i + buttonsPerRow)));
    }

    // Controles de navegação (prev/next, whitelist, voltar) em um único row
    const hasPagination = maxPage > 0;
    const navButtons = [];
    if (hasPagination) {
      navButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.PAGE(module.id, Math.max(0, currentPage - 1))).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0));
    }
    if (module.hasWhitelist) {
      navButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.WHITELIST(module.id)).setLabel('Editar whitelist').setStyle(ButtonStyle.Secondary));
    }
    navButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK_MODULE(module.id)).setLabel('Voltar módulo').setStyle(ButtonStyle.Secondary));
    if (hasPagination) {
      navButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.PAGE(module.id, Math.min(maxPage, currentPage + 1))).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= maxPage));
    }
    navButtons.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.ROOT).setLabel('Voltar menu').setStyle(ButtonStyle.Secondary));
    if (hasPagination && navButtons.length < 5) {
      navButtons.push(new ButtonBuilder().setCustomId('prot:pageinfo').setLabel(`Página ${currentPage + 1}/${maxPage + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(true));
    }
    rows.push(new ActionRowBuilder().addComponents(navButtons.slice(0, 5)));

    // Navegação já incluída acima; retornamos sem adicionar row duplicado
    return rows;
  }

  if (module.id === 'blockedRoles') {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.BLOCKED_ROLES(module.id))
        .setPlaceholder('Selecionar cargos bloqueados')
        .setDefaultRoles(defaultBlockedRoles)
        .setMinValues(1)
        .setMaxValues(25),
    ));
  }

  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(CUSTOM_IDS.ROOT).setLabel('Voltar').setStyle(ButtonStyle.Secondary));
  rows.push(back);
  return rows;
}

/**
 * Constrói components para edição de whitelist de um módulo específico
 * Inclui UserSelectMenu e RoleSelectMenu com defaults pré-preenchidos (máx 25 cada)
 * @param {Object} module - Definição do módulo
 * @param {Object} cfg - Configuração atual
 * @returns {Array<ActionRowBuilder>} Array de 3 action rows (users, roles, navegação)
 */
function buildWhitelistComponents(module, cfg) {
  const state = cfg[module.id] || {};
  const defaultWhitelistUsers = Array.isArray(state.whitelistUsers) ? state.whitelistUsers.slice(0, 25) : [];
  const defaultWhitelistRoles = Array.isArray(state.whitelistRoles) ? state.whitelistRoles.slice(0, 25) : [];
  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.WH_USERS(module.id))
      .setPlaceholder('Selecionar usuários em whitelist')
      .setDefaultUsers(defaultWhitelistUsers)
      .setMinValues(0)
      .setMaxValues(25),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.WH_ROLES(module.id))
      .setPlaceholder('Selecionar cargos em whitelist')
      .setDefaultRoles(defaultWhitelistRoles)
      .setMinValues(0)
      .setMaxValues(25),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK_MODULE(module.id)).setLabel('Voltar ao módulo').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.ROOT).setLabel('Voltar menu').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

/**
 * Constrói components para edição da whitelist global (válida para todos os módulos)
 * @param {Object} cfg - Configuração completa
 * @returns {Array<ActionRowBuilder>} Array de 3 action rows
 */
function buildGlobalWhitelistComponents(cfg) {
  const defaultUsers = Array.isArray(cfg.globalWhitelistUsers) ? cfg.globalWhitelistUsers.slice(0, 25) : [];
  const defaultRoles = Array.isArray(cfg.globalWhitelistRoles) ? cfg.globalWhitelistRoles.slice(0, 25) : [];
  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.GLOBAL_WH_USERS)
      .setPlaceholder('Selecionar usuários em whitelist global')
      .setDefaultUsers(defaultUsers)
      .setMinValues(0)
      .setMaxValues(25),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.GLOBAL_WH_ROLES)
      .setPlaceholder('Selecionar cargos em whitelist global')
      .setDefaultRoles(defaultRoles)
      .setMinValues(0)
      .setMaxValues(25),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.ROOT).setLabel('Voltar menu').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

// --------- Backups / Snapshots ---------
const DEFAULT_BACKUP_SCOPES = [BACKUP_SCOPES.CHANNELS, BACKUP_SCOPES.ROLES];
const backupSessions = new Map();

/**
 * Gera chave única para session de backup baseada na mensagem
 * Para modais: extrai messageId do customId (protmodal:backup:<type>:<messageId>)
 * Para outros: usa message.id ou interaction.id como fallback
 * @param {Object} interaction - Interação Discord
 * @returns {string} Chave única para session
 */
function backupSessionKey(interaction) {
  if (interaction?.isModalSubmit?.()) {
    const parts = String(interaction.customId || '').split(':');
    const maybeMsg = parts[3];
    if (maybeMsg && maybeMsg !== '0') return maybeMsg;
  }
  return interaction?.message?.id || interaction?.id || 'session';
}

/**
 * Obtém session de backup existente ou cria com defaults
 * @param {Object} interaction - Interação Discord
 * @returns {Object} Session object com state, scopes, name, page, etc
 */
function getBackupSession(interaction) {
  const base = {
    state: BACKUP_STATES.HOME,
    scopes: [...DEFAULT_BACKUP_SCOPES],
    name: '',
    page: 0,
    mode: 'home',
    selectedBackupId: null,
    diff: null,
    lastBackup: null,
    restoreScopes: null,
    categoryId: null,
    categoryFilter: '',
  };
  const existing = backupSessions.get(backupSessionKey(interaction));
  return existing ? { ...base, ...existing } : base;
}

function setBackupSession(interaction, data) {
  const merged = { ...getBackupSession(interaction), ...data };
  backupSessions.set(backupSessionKey(interaction), merged);
  return merged;
}

function clearBackupSession(interaction) {
  backupSessions.delete(backupSessionKey(interaction));
}

function backupScopeOptions(scopes = []) {
  return [
    { label: 'Canais + Categorias', value: BACKUP_SCOPES.CHANNELS, default: scopes.includes(BACKUP_SCOPES.CHANNELS) },
    { label: 'Cargos', value: BACKUP_SCOPES.ROLES, default: scopes.includes(BACKUP_SCOPES.ROLES) },
  ];
}

function buildBackupButtonsHome() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start', 'create')).setLabel('➕ Criar backup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start', 'create_category')).setLabel('📁 Backup de categoria').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start', 'verify')).setLabel('🔍 Verificar backup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start', 'restore')).setLabel('♻️ Restaurar backup').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.ROOT).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
  );
}

async function buildBackupPayload(interaction, prisma, session) {
  const guild = interaction.guild;
  const state = session.state;
  const embed = new EmbedBuilder().setColor(0x5865f2);
  const components = [];

  const pushBackHome = () => {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar ao início').setStyle(ButtonStyle.Secondary)));
  };

  if (state === BACKUP_STATES.HOME) {
    embed
      .setTitle('🛡️ Sistema de Backup do Servidor')
      .setDescription('Escolha uma ação:');
    components.push(buildBackupButtonsHome());
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CREATE_SCOPE) {
    embed
      .setTitle('📦 Criar Backup')
      .setDescription('O que você deseja salvar?');
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_IDS.BACKUP('scope'))
          .setPlaceholder('Selecione escopos')
          .setMinValues(1)
          .setMaxValues(backupScopeOptions().length)
          .addOptions(backupScopeOptions(session.scopes)),
      ),
    );
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('next:naming')).setLabel('Próximo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      ),
    );
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CREATE_NAME) {
    embed
      .setTitle('📝 Nome do Backup (opcional)')
      .setDescription(`Nome atual: ${session.name ? `**${session.name}**` : 'Nenhum'}`);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('modal:name')).setLabel('Definir nome').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('create')).setLabel('Criar backup').setStyle(ButtonStyle.Success),
      ),
    );
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('back:scope')).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.SELECT_CATEGORY) {
    embed
      .setTitle('📁 Selecione a categoria')
      .setDescription([
        'Busque pelo nome e escolha a categoria cujos canais serão incluídos no backup.',
        session.categoryId ? `Categoria selecionada: <#${session.categoryId}>` : 'Nenhuma selecionada',
      ].join('\n'));
    components.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CUSTOM_IDS.BACKUP('select_category'))
          .setPlaceholder('Digite para buscar a categoria')
          .setChannelTypes(ChannelType.GuildCategory)
          .setMinValues(1)
          .setMaxValues(1)
          .setDefaultChannels(session.categoryId ? [session.categoryId] : []),
      ),
    );
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('next:naming')).setLabel('Próximo').setStyle(ButtonStyle.Primary).setDisabled(!session.categoryId),
      ),
    );
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('back:scope')).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CREATING) {
    embed.setTitle('⏳ Criando backup...').setDescription('Isso pode levar alguns segundos.');
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.DONE_CREATE) {
    const b = session.lastBackup;
    const categoryId = b?.payload?.categoryId;
    const categoryName = categoryId ? (guild.channels.cache.get(categoryId)?.name || `Categoria ${categoryId}`) : null;
    embed
      .setTitle('✅ Backup criado com sucesso!')
      .setDescription([
        `ID: ${b?.backupId || '—'}`,
        `Nome: ${b?.name || '—'}`,
        `Escopos: ${(b?.scopes || []).join(', ') || '—'}`,
        categoryId ? `Categoria: ${categoryName ? `${categoryName} (${categoryId})` : categoryId}` : null,
      ].join('\n'));
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar ao início').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start:verify')).setLabel('Ver backups').setStyle(ButtonStyle.Primary),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.SELECT_BACKUP) {
    const take = 25;
    const total = await countBackups(prisma, guild.id);
    const maxPage = Math.max(0, Math.ceil(total / take) - 1);
    const page = Math.min(session.page || 0, maxPage);
    const list = await listBackups(prisma, guild.id, { skip: page * take, take });
    embed
      .setTitle('📂 Selecione um backup')
      .setDescription(total ? `Página ${page + 1}/${maxPage + 1}` : 'Nenhum backup encontrado.');
    const select = new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.BACKUP('select'))
      .setPlaceholder(total ? 'Escolha um backup' : 'Nenhum backup disponível')
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!total)
      .addOptions(
        (list || []).map((b) => ({
          label: b.name || b.backupId,
          value: b.backupId,
          description: new Date(b.createdAt).toLocaleString('pt-BR'),
        })),
      );
    components.push(new ActionRowBuilder().addComponents(select));
    const nav = [];
    if (maxPage > 0) {
      nav.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP(`page:${Math.max(0, page - 1)}`)).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0));
      nav.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP(`page:${Math.min(maxPage, page + 1)}`)).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage));
    }
    nav.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary));
    nav.push(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar início').setStyle(ButtonStyle.Secondary));
    components.push(new ActionRowBuilder().addComponents(nav));
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.VERIFYING) {
    embed.setTitle('🔍 Verificando diferenças...');
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.SHOW_DIFF) {
    const diff = session.diff || {};
    embed.setTitle('📊 Diferenças encontradas');
    if (diff.channels) {
      embed.addFields({
        name: 'Canais + Categorias',
        value: `Ausentes: ${diff.channels.missing.length} | Alterados: ${diff.channels.changed.length}`,
        inline: false,
      });
    }
    if (diff.roles) {
      embed.addFields({
        name: 'Cargos',
        value: `Ausentes: ${diff.roles.missing.length} | Alterados: ${diff.roles.changed.length}`,
        inline: false,
      });
    }
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start:verify')).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('restore:fromdiff')).setLabel('♻️ Restaurar com base neste backup').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('delete')).setLabel('Excluir backup').setStyle(ButtonStyle.Danger),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CONFIRM_RESTORE) {
    const categoryId = session.lastBackup?.payload?.categoryId;
    const categoryName = categoryId ? (guild.channels.cache.get(categoryId)?.name || `Categoria ${categoryId}`) : null;
    embed
      .setTitle('⚠️ Confirmação necessária')
      .setDescription([
        'O bot fará alterações no servidor. Deseja continuar?',
        categoryId ? `Este backup é parcial: apenas canais da categoria ${categoryName || categoryId}.` : null,
      ].filter(Boolean).join('\n'));
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('confirm')).setLabel('Prosseguir').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('delete')).setLabel('Excluir backup').setStyle(ButtonStyle.Danger),
      ),
    );
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.SELECT_RESTORE_SCOPE) {
    const backup = session.lastBackup || (session.selectedBackupId ? await getBackup(prisma, session.selectedBackupId, guild.id) : null);
    const scopes = backup?.scopes || DEFAULT_BACKUP_SCOPES;
    embed
      .setTitle('🧩 O que deseja restaurar?')
      .setDescription('Selecione os escopos para restaurar.');
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_IDS.BACKUP('restore:scope'))
          .setPlaceholder('Selecione escopos para restaurar')
          .setMinValues(1)
          .setMaxValues(scopes.length)
          .addOptions(backupScopeOptions(session.restoreScopes || scopes)),
      ),
    );
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('do_restore')).setLabel('Restaurar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      ),
    );
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CONFIRM_DELETE) {
    const b = session.lastBackup;
    embed
      .setTitle('🗑️ Excluir backup')
      .setDescription([
        'Tem certeza que deseja excluir este backup?',
        `ID: ${b?.backupId || '—'}`,
        `Nome: ${b?.name || '—'}`,
      ].join('\n'));
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('confirm_delete')).setLabel('Sim, excluir').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('cancel')).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      ),
    );
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.RESTORING) {
    const st = session.restoreStatus || {};
    const total = st.total || (session.restoreScopes?.length || 1);
    const stage = st.stage || 0;
    const percent = st.percent ?? Math.round((stage / Math.max(total, 1)) * 100);
    embed
      .setTitle('♻️ Restaurando servidor...')
      .setDescription([
        `Etapas: ${stage}/${total}`,
        st.label ? `Etapa atual: ${st.label}` : null,
        `Progresso: ${percent}%`,
        st.message || null,
      ].filter(Boolean).join('\n'));
    pushBackHome();
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.DONE_RESTORE) {
    const res = session.restoreResult || {};
    const channels = res.channels || { created: 0, updated: 0 };
    const roles = res.roles || { created: 0, updated: 0 };
    embed
      .setTitle('✅ Restauração concluída')
      .setDescription(`Canais criados/atualizados: ${channels.created}/${channels.updated}\nCargos criados/atualizados: ${roles.created}/${roles.updated}`);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar ao início').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start:verify')).setLabel('Ver backups').setStyle(ButtonStyle.Primary),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.DONE_DELETE) {
    embed.setTitle('✅ Backup excluído').setDescription('O backup foi removido com sucesso.');
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar ao início').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('start:verify')).setLabel('Ver backups').setStyle(ButtonStyle.Primary),
      ),
    );
    return { embeds: [embed], components };
  }

  if (state === BACKUP_STATES.CANCELLED) {
    embed.setTitle('🚫 Operação cancelada');
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(CUSTOM_IDS.BACKUP('home')).setLabel('Voltar ao início').setStyle(ButtonStyle.Secondary)));
    return { embeds: [embed], components };
  }

  return { embeds: [embed.setDescription('Estado desconhecido')], components };
}

async function presentRoot(interaction, prisma) {
  await ensureDeferred(interaction);
  const cfg = await getProtectionsConfig(prisma);
  const embed = buildRootEmbed(cfg);
  const components = buildRootComponents();
  await respond(interaction, { embeds: [embed], components });
  return true;
}

async function presentBackup(interaction, prisma, data) {
  await ensureDeferred(interaction);
  const session = setBackupSession(interaction, data || {});
  const payload = await buildBackupPayload(interaction, prisma, session);
  await respond(interaction, payload);
  return true;
}

async function presentGlobalWhitelist(interaction, prisma) {
  await ensureDeferred(interaction);
  const cfg = await getProtectionsConfig(prisma);
  const desc = [
    'Whitelist global válida para todos os módulos.',
    '',
    `Usuários atuais: ${cfg.globalWhitelistUsers?.length ? cfg.globalWhitelistUsers.map((id) => `<@${id}>`).join(', ') : '—'}`,
    `Cargos atuais: ${cfg.globalWhitelistRoles?.length ? cfg.globalWhitelistRoles.map((id) => `<@&${id}>`).join(', ') : '—'}`,
  ].join('\n');
  const embed = new EmbedBuilder()
    .setTitle('Whitelist Global')
    .setDescription(desc)
    .setColor(0x5865f2);
  const components = buildGlobalWhitelistComponents(cfg);
  await respond(interaction, { embeds: [embed], components });
  return true;
}

async function presentModule(interaction, prisma, moduleId, opts = {}) {
  await ensureDeferred(interaction);
  const module = moduleById(moduleId);
  if (!module || module.disabled) return presentRoot(interaction, prisma);
  const cfg = await getProtectionsConfig(prisma);
  const payload = buildPayload(buildModuleEmbed(module, cfg), buildModuleComponents(module, cfg, opts));
  if (interaction?.isRepliable?.()) {
    await respond(interaction, payload);
  } else if (interaction?.edit) {
    await interaction.edit(payload).catch(() => {});
  }
  return true;
}

async function presentWhitelist(interaction, prisma, moduleId) {
  await ensureDeferred(interaction);
  const module = moduleById(moduleId);
  if (!module || !module.hasWhitelist) return presentModule(interaction, prisma, moduleId);
  const cfg = await getProtectionsConfig(prisma);
  const state = cfg[module.id] || {};
  const desc = [
    'Edite a whitelist deste módulo.',
    '',
    `Usuários atuais: ${state.whitelistUsers?.length ? state.whitelistUsers.map((id) => `<@${id}>`).join(', ') : '—'}`,
    `Cargos atuais: ${state.whitelistRoles?.length ? state.whitelistRoles.map((id) => `<@&${id}>`).join(', ') : '—'}`,
  ].join('\n');
  const embed = buildModuleEmbed(module, cfg).setDescription(desc);
  const components = buildWhitelistComponents(module, cfg);
  await respond(interaction, { embeds: [embed], components });
  return true;
}

function cyclePunishment(current) {
  if (current === PUNISH.STRIP_ROLES) return PUNISH.KICK;
  return PUNISH.STRIP_ROLES;
}

async function updateConfig(prisma, updater) {
  const cfg = await getProtectionsConfig(prisma);
  const next = updater(cfg) || cfg;
  await saveProtectionsConfig(prisma, next);
  return next;
}

async function handleBackupInteraction(interaction, prisma) {
  const cid = interaction.customId || '';
  const isBackupAction = cid.startsWith('prot:backup:');
  const isBackupModal = cid.startsWith('protmodal:backup:');
  if (!isBackupAction && !isBackupModal) return false;

  const messageId = interaction.message?.id || '0';

  if (isBackupModal && interaction.isModalSubmit()) {
    const parts = cid.split(':');
    const modalType = parts[2];
    const sourceMessageId = parts[3];
    if (modalType === 'name') {
      const name = interaction.fields.getTextInputValue('name') || '';
      const session = setBackupSession(interaction, { state: BACKUP_STATES.CREATE_NAME, name });
      const payload = await buildBackupPayload(interaction, prisma, session);
      const message = sourceMessageId && interaction.channel?.messages
        ? await interaction.channel.messages.fetch(sourceMessageId).catch(() => null)
        : null;
      if (message) {
        await message.edit(payload).catch(() => {});
      } else {
        await respond(interaction, payload);
      }
      // reconhecer sem criar novo embed
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        await interaction.deleteReply().catch(() => {});
      }
      return true;
    }
    // catfilter modal removido
    return false;
  }

  if (!interaction.isButton() && !interaction.isAnySelectMenu()) return false;

  const parts = cid.split(':'); // prot:backup:<action>[:extra]
  const action = parts[2];
  const extra = parts.slice(3).join(':');
  const session = getBackupSession(interaction);

  const go = (data) => presentBackup(interaction, prisma, data);

/**
 * Executa restore de backup com progress tracking e error handling
 * @param {string} backupId - ID do backup
 * @param {Array<string>} scopes - Escopos a restaurar
 * @param {Object} backup - Objeto do backup
 * @returns {Promise<Object|null>} Resultado ou null em caso de erro
 */
  const runRestore = async (backupId, scopes, backup) => {
    const totalSteps = scopes.length || 1;
    const scopeLabel = (scope) => {
      if (scope === BACKUP_SCOPES.ROLES) return 'Cargos';
      if (scope === BACKUP_SCOPES.CHANNELS) return 'Canais/Categorias';
      if (scope === BACKUP_SCOPES.CHANNELS_CATEGORY) return 'Canais da categoria';
      return scope || '—';
    };
    const updateUI = async (stage, scope, message) => {
      const percent = Math.round((stage / Math.max(totalSteps, 1)) * 100);
      await presentBackup(interaction, prisma, {
        state: BACKUP_STATES.RESTORING,
        restoreScopes: scopes,
        lastBackup: backup,
        restoreStatus: {
          stage,
          total: totalSteps,
          label: scope ? scopeLabel(scope) : undefined,
          percent,
          message,
        },
      });
    };

    console.log('[backup] restore start', { guild: interaction.guild.id, backupId, scopes });
    
    try {
      await updateUI(0, scopes[0], 'Preparando restauração...');

      let result = { channels: { created: 0, updated: 0 }, roles: { created: 0, updated: 0 } };

      if (scopes.includes(BACKUP_SCOPES.ROLES)) {
        await updateUI(0, BACKUP_SCOPES.ROLES, 'Restaurando cargos...');
        const resRoles = await restoreBackup(prisma, interaction.guild, backupId, [BACKUP_SCOPES.ROLES]).catch((e) => {
          console.error('[backup] restore failed roles', e);
          return null;
        });
        if (!resRoles) {
          console.error('[backup] Falha crítica ao restaurar cargos');
          return null;
        }
        result.roles = resRoles.result?.roles || result.roles;
        await updateUI(totalSteps === 1 ? totalSteps : 1, BACKUP_SCOPES.ROLES, 'Cargos restaurados.');
        backup = resRoles.backup || backup;
      }

      const wantsChannels = scopes.includes(BACKUP_SCOPES.CHANNELS) || scopes.includes(BACKUP_SCOPES.CHANNELS_CATEGORY);
      if (wantsChannels) {
        const channelScope = scopes.find((s) => s === BACKUP_SCOPES.CHANNELS_CATEGORY) || BACKUP_SCOPES.CHANNELS;
        const stageIdx = scopes.includes(BACKUP_SCOPES.ROLES) ? 1 : 0;
        await updateUI(stageIdx, channelScope, 'Restaurando canais/categorias...');
        const resChannels = await restoreBackup(prisma, interaction.guild, backupId, [channelScope]).catch((e) => {
          console.error('[backup] restore failed channels', e);
          return null;
        });
        if (!resChannels) {
          console.error('[backup] Falha crítica ao restaurar canais');
          return null;
        }
        result.channels = resChannels.result?.channels || result.channels;
        await updateUI(totalSteps, channelScope, 'Canais restaurados.');
        backup = resChannels.backup || backup;
      }

      console.log('[backup] restore done', { backupId, scopes, result });
      return { backup, result };
    } catch (error) {
      console.error('[backup] restore exception', { backupId, scopes, error });
      return null;
    }
  };

  // Navegação básica
  if (action === 'home') {
    await ensureDeferred(interaction);
    clearBackupSession(interaction);
    return go({ state: BACKUP_STATES.HOME, mode: 'home', page: 0 });
  }
  if (action === 'cancel') {
    await ensureDeferred(interaction);
    return go({ state: BACKUP_STATES.CANCELLED });
  }

  if (action === 'start') {
    await ensureDeferred(interaction);
    if (extra === 'create') return go({ state: BACKUP_STATES.CREATE_SCOPE, mode: 'create' });
    if (extra === 'create_category') return go({ state: BACKUP_STATES.SELECT_CATEGORY, mode: 'create_category', scopes: [BACKUP_SCOPES.CHANNELS_CATEGORY], categoryId: null });
    if (extra === 'verify') return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'verify', page: 0, selectedBackupId: null });
    if (extra === 'restore') return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore', page: 0, selectedBackupId: null });
  }

  if (action === 'scope' && interaction.isStringSelectMenu()) {
    await ensureDeferred(interaction);
    const scopes = interaction.values || DEFAULT_BACKUP_SCOPES;
    const nextState = { state: BACKUP_STATES.CREATE_SCOPE, scopes };
    nextState.categoryId = null;
    nextState.categoryFilter = '';
    return go(nextState);
  }

  if (action === 'next' && extra === 'naming') {
    await ensureDeferred(interaction);
    const wantsCategory = session.mode === 'create_category' || session.scopes.includes(BACKUP_SCOPES.CHANNELS_CATEGORY);
    if (wantsCategory && !session.categoryId) {
      return go({ state: BACKUP_STATES.SELECT_CATEGORY });
    }
    return go({ state: BACKUP_STATES.CREATE_NAME });
  }

  if (action === 'back' && extra === 'scope') {
    await ensureDeferred(interaction);
    return go({ state: BACKUP_STATES.CREATE_SCOPE });
  }

  if (action === 'select_category' && interaction.isChannelSelectMenu()) {
    await ensureDeferred(interaction);
    const categoryId = interaction.values?.[0] || null;
    return go({ state: BACKUP_STATES.SELECT_CATEGORY, categoryId });
  }

  if (action === 'modal' && extra === 'name') {
    const modal = new ModalBuilder()
      .setCustomId(MODALS.BACKUP_NAME(messageId))
      .setTitle('Nome do Backup')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Nome (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(session.name || ''),
      ));
    await interaction.showModal(modal);
    return true;
  }

  // filtro por modal removido — canal select já tem busca nativa

  await ensureDeferred(interaction);

  if (action === 'create') {
    const wantsCategory = session.mode === 'create_category' || session.scopes.includes(BACKUP_SCOPES.CHANNELS_CATEGORY);
    if (wantsCategory && !session.categoryId) {
      await interaction.followUp({ content: 'Selecione uma categoria antes de criar o backup.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.SELECT_CATEGORY });
    }
    await go({ state: BACKUP_STATES.CREATING });
    const backup = await createBackup(prisma, interaction.guild, interaction.user.id, {
      name: session.name,
      scopes: wantsCategory ? [BACKUP_SCOPES.CHANNELS_CATEGORY] : (session.scopes || DEFAULT_BACKUP_SCOPES),
      categoryId: wantsCategory ? session.categoryId : null,
    }).catch(() => null);
    if (!backup) {
      await interaction.followUp({ content: 'Falha ao criar backup.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.CANCELLED });
    }
    return go({ state: BACKUP_STATES.DONE_CREATE, lastBackup: backup, mode: 'home' });
  }

  if (action === 'page') {
    const page = parseInt(extra, 10) || 0;
    return go({ state: BACKUP_STATES.SELECT_BACKUP, page });
  }

  if (action === 'select' && interaction.isStringSelectMenu()) {
    const backupId = interaction.values?.[0];
    if (!backupId) return go({ state: BACKUP_STATES.SELECT_BACKUP });
    if (session.mode === 'verify') {
      await go({ state: BACKUP_STATES.VERIFYING, selectedBackupId: backupId });
      const diff = await diffBackup(prisma, interaction.guild, backupId).catch(() => null);
      if (!diff) {
        await interaction.followUp({ content: 'Falha ao verificar backup.', ephemeral: true }).catch(() => {});
        return go({ state: BACKUP_STATES.CANCELLED });
      }
      return go({ state: BACKUP_STATES.SHOW_DIFF, diff: diff.diff, selectedBackupId: backupId, lastBackup: diff.backup });
    }
    // restore flow
    const backup = await getBackup(prisma, backupId, interaction.guild.id).catch(() => null);
    if (!backup) {
      await interaction.followUp({ content: 'Backup não encontrado.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.SELECT_BACKUP });
    }
    return go({ state: BACKUP_STATES.CONFIRM_RESTORE, selectedBackupId: backupId, lastBackup: backup });
  }

  if (action === 'restore' && extra === 'fromdiff') {
    if (!session.selectedBackupId) return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    return go({ state: BACKUP_STATES.CONFIRM_RESTORE, mode: 'restore' });
  }

  if (action === 'confirm') {
    const backupId = session.selectedBackupId;
    if (!backupId) return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    const backup = session.lastBackup || (await getBackup(prisma, backupId, interaction.guild.id).catch(() => null));
    const scopes = backup?.scopes || DEFAULT_BACKUP_SCOPES;
    if (scopes.length > 1) {
      return go({ state: BACKUP_STATES.SELECT_RESTORE_SCOPE, restoreScopes: scopes, lastBackup: backup });
    }
    await go({ state: BACKUP_STATES.RESTORING, restoreScopes: scopes, lastBackup: backup });
    const res = await runRestore(backupId, scopes, backup);
    if (!res) {
      await interaction.followUp({ content: 'Falha ao restaurar backup.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.CANCELLED });
    }
    return go({ state: BACKUP_STATES.DONE_RESTORE, restoreResult: res.result, lastBackup: res.backup, restoreScopes: scopes });
  }

  if (action === 'delete') {
    const backupId = session.selectedBackupId || session.lastBackup?.backupId;
    if (!backupId) return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    const backup = session.lastBackup || (await getBackup(prisma, backupId, interaction.guild.id).catch(() => null));
    if (!backup) {
      await interaction.followUp({ content: 'Backup não encontrado.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    }
    return go({ state: BACKUP_STATES.CONFIRM_DELETE, selectedBackupId: backupId, lastBackup: backup });
  }

  if (action === 'confirm_delete') {
    const backupId = session.selectedBackupId || session.lastBackup?.backupId;
    if (!backupId) return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    const ok = await deleteBackup(prisma, backupId, interaction.guild.id).catch(() => false);
    if (!ok) {
      await interaction.followUp({ content: 'Falha ao excluir backup.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.CANCELLED });
    }
    return go({ state: BACKUP_STATES.DONE_DELETE, selectedBackupId: null, lastBackup: null });
  }

  if (action === 'restore' && extra === 'scope' && interaction.isStringSelectMenu()) {
    const scopes = interaction.values || DEFAULT_BACKUP_SCOPES;
    return go({ state: BACKUP_STATES.SELECT_RESTORE_SCOPE, restoreScopes: scopes });
  }

  if (action === 'do_restore') {
    const backupId = session.selectedBackupId || session.lastBackup?.backupId;
    if (!backupId) return go({ state: BACKUP_STATES.SELECT_BACKUP, mode: 'restore' });
    const scopes = session.restoreScopes || session.lastBackup?.scopes || DEFAULT_BACKUP_SCOPES;
    const backup = session.lastBackup || (await getBackup(prisma, backupId, interaction.guild.id).catch(() => null));
    await go({ state: BACKUP_STATES.RESTORING, restoreScopes: scopes, lastBackup: backup });
    const res = await runRestore(backupId, scopes, backup);
    if (!res) {
      await interaction.followUp({ content: 'Falha ao restaurar backup.', ephemeral: true }).catch(() => {});
      return go({ state: BACKUP_STATES.CANCELLED });
    }
    return go({ state: BACKUP_STATES.DONE_RESTORE, restoreResult: res.result, lastBackup: res.backup, restoreScopes: scopes });
  }

  return false;
}

/**
 * Handler principal para ButtonInteraction
 * Processa toggle, punish, limit, whitelist, protect perms, block perm toggle, paginação
 * @param {Object} interaction - Interação de botão
 * @param {Object} prisma - Cliente Prisma
 * @returns {Promise<boolean>} true se processado
 */
async function handleButton(interaction, prisma) {
  try {
    if ((interaction.customId || '').startsWith('prot:backup:')) {
      return handleBackupInteraction(interaction, prisma);
    }
    const parts = (interaction.customId || '').split(':');
    const [prefix, action, moduleId] = parts;
    if (prefix !== 'prot') return false;
    const module = moduleById(moduleId);
    if (!module) return false;
    if (module.disabled) return presentRoot(interaction, prisma);

    // Carrega estado atual para pré-preencher modais/valores padrão
    const cfgCurrent = await getProtectionsConfig(prisma);
    const moduleState = cfgCurrent[moduleId] || {};

    const modalActions = ['limit', 'wh', 'mindays'];
    if (!modalActions.includes(action)) {
      await ensureDeferred(interaction);
    }

    if (action === 'toggle') {
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].enabled = !cfg[moduleId].enabled;
        return cfg;
      });
    }
    if (action === 'punish') {
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].punishment = cyclePunishment(cfg[moduleId].punishment);
        return cfg;
      });
    }
    if (action === 'limit') {
      const messageId = interaction.message?.id || '0';
      const currentCount = moduleState?.limit?.count;
      const currentSeconds = moduleState?.limit?.seconds;
      const modal = new ModalBuilder()
        .setCustomId(MODALS.LIMIT(moduleId, messageId))
        .setTitle('Limite X em Y segundos')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('count')
            .setLabel('Qtd (X)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(currentCount != null ? String(currentCount) : '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('seconds')
            .setLabel('Janela em segundos (Y)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(currentSeconds != null ? String(currentSeconds) : '')),
        );
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'wh') {
      return presentWhitelist(interaction, prisma, moduleId);
    }
    if (action === 'mindays') {
      const messageId = interaction.message?.id || '0';
      const currentDays = moduleState?.minAccountDays;
      const modal = new ModalBuilder()
        .setCustomId(MODALS.MIN_DAYS(moduleId, messageId))
        .setTitle('Idade mínima (dias)')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('days')
          .setLabel('Dias')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(currentDays != null ? String(currentDays) : '')));
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'protectperms') {
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].protectPermissions = !cfg[moduleId].protectPermissions;
        return cfg;
      });
    }
    if (action === 'protectassign') {
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].preventProtectedRoleGive = !cfg[moduleId].preventProtectedRoleGive;
        return cfg;
      });
    }
    if (action === 'blockperm' && parts.length >= 5) {
      const page = parseInt(parts[3], 10) || 0;
      const perm = parts.slice(4).join(':');
      await updateConfig(prisma, (cfg) => {
        const arr = new Set(cfg[moduleId].blockedPerms || []);
        if (arr.has(perm)) arr.delete(perm); else arr.add(perm);
        cfg[moduleId].blockedPerms = [...arr];
        return cfg;
      });
      return presentModule(interaction, prisma, moduleId, { page });
    }

    if (action === 'page' && parts.length >= 4) {
      const page = parseInt(parts[3], 10) || 0;
      return presentModule(interaction, prisma, moduleId, { page });
    }

    return presentModule(interaction, prisma, moduleId);
  } catch (error) {
    console.error('[protections] Erro em handleButton:', error);
    await interaction.followUp({ content: '❌ Erro ao processar ação. Tente novamente.', ephemeral: true }).catch(() => {});
    return false;
  }
}

/**
 * Handler principal para StringSelectMenu, UserSelectMenu, RoleSelectMenu, ChannelSelectMenu
 * Processa seleção de módulos, whitelist global/local, log channels, blocked roles, etc
 * @param {Object} interaction - Interação de select menu
 * @param {Object} prisma - Cliente Prisma
 * @returns {Promise<boolean>} true se processado
 */
async function handleSelect(interaction, prisma) {
  try {
    if (interaction.customId === CUSTOM_IDS.MODULE_SELECT) {
      await ensureDeferred(interaction);
      const choice = interaction.values?.[0];
      if (choice === 'backups') {
        clearBackupSession(interaction);
        return presentBackup(interaction, prisma, { state: BACKUP_STATES.HOME, mode: 'home', page: 0 });
      }
      return presentModule(interaction, prisma, choice);
    }
    if (interaction.customId?.startsWith('prot:backup:')) {
      return handleBackupInteraction(interaction, prisma);
    }
    if (interaction.customId === CUSTOM_IDS.GLOBAL_WH_USERS && interaction.isUserSelectMenu()) {
      await ensureDeferred(interaction);
      const userIds = interaction.values || [];
      await updateConfig(prisma, (cfg) => {
        cfg.globalWhitelistUsers = userIds;
        return cfg;
      });
      return presentGlobalWhitelist(interaction, prisma);
    }
    if (interaction.customId === CUSTOM_IDS.GLOBAL_WH_ROLES && interaction.isRoleSelectMenu()) {
      await ensureDeferred(interaction);
      const roleIds = interaction.values || [];
      await updateConfig(prisma, (cfg) => {
        cfg.globalWhitelistRoles = roleIds;
        return cfg;
      });
      return presentGlobalWhitelist(interaction, prisma);
    }
    const [prefix, action, moduleId] = (interaction.customId || '').split(':');
    if (prefix !== 'prot') return false;
    await ensureDeferred(interaction);
    const module = moduleById(moduleId);
    if (!module) return false;
    const prismaUpdate = async (dataUpdater) => updateConfig(prisma, dataUpdater);

    if (action === 'log' && interaction.isChannelSelectMenu()) {
      const channelId = interaction.values?.[0];
      if (!channelId) {
        await interaction.followUp({ content: '❌ Selecione um canal válido.', ephemeral: true }).catch(() => {});
        return presentModule(interaction, prisma, moduleId);
      }
      await prismaUpdate((cfg) => {
        cfg[moduleId].logChannelId = channelId;
        return cfg;
      });
      return presentModule(interaction, prisma, moduleId);
    }

    if (action === 'rolelimit' && interaction.isRoleSelectMenu()) {
      const roleId = interaction.values?.[0];
      if (!roleId) {
        await interaction.followUp({ content: '❌ Selecione um cargo válido.', ephemeral: true }).catch(() => {});
        return presentModule(interaction, prisma, moduleId);
      }
      await prismaUpdate((cfg) => {
        cfg[moduleId].limitRoleId = roleId;
        return cfg;
      });
      return presentModule(interaction, prisma, moduleId);
    }

    if (action === 'blockroles' && interaction.isRoleSelectMenu()) {
      const roleIds = interaction.values || [];
      if (!roleIds.length) {
        await interaction.followUp({ content: '❌ Selecione pelo menos um cargo para bloquear.', ephemeral: true }).catch(() => {});
        return presentModule(interaction, prisma, moduleId);
      }
      await prismaUpdate((cfg) => {
        cfg[moduleId].roles = roleIds;
        cfg[moduleId].enabled = true;
        return cfg;
      });
      return presentModule(interaction, prisma, moduleId);
    }

    if (action === 'whusers' && interaction.isUserSelectMenu()) {
      const userIds = interaction.values || [];
      await prismaUpdate((cfg) => {
        cfg[moduleId].whitelistUsers = userIds;
        return cfg;
      });
      return presentWhitelist(interaction, prisma, moduleId);
    }

    if (action === 'whroles' && interaction.isRoleSelectMenu()) {
      const roleIds = interaction.values || [];
      await prismaUpdate((cfg) => {
        cfg[moduleId].whitelistRoles = roleIds;
        return cfg;
      });
      return presentWhitelist(interaction, prisma, moduleId);
    }

    return false;
  } catch (error) {
    console.error('[protections] Erro em handleSelect:', error);
    await interaction.followUp({ content: '❌ Erro ao processar seleção. Tente novamente.', ephemeral: true }).catch(() => {});
    return false;
  }
}

/**
 * Parse de forma segura um inteiro positivo com validação de range
 * @param {string} val - Valor a parsear
 * @param {number} fallback - Valor padrão caso parse falhe
 * @param {Object} options - Opções de validação
 * @param {number} options.min - Valor mínimo permitido
 * @param {number} options.max - Valor máximo permitido
 * @returns {number} Número parseado ou fallback
 */
function parseIntSafe(val, fallback, options = {}) {
  const num = parseInt(val, 10);
  if (!Number.isFinite(num) || num < 1) return fallback;
  
  const { min = 1, max = Infinity } = options;
  if (num < min) return min;
  if (num > max) return max;
  
  return num;
}

function splitIds(text) {
  return (text || '')
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Handler para submissão de modais com validação robusta
 * @param {Object} interaction - Interação do Discord
 * @param {Object} prisma - Cliente Prisma
 * @returns {Promise<boolean>} true se o modal foi processado
 */
async function handleModal(interaction, prisma) {
  if ((interaction.customId || '').startsWith('protmodal:backup:')) {
    return handleBackupInteraction(interaction, prisma);
  }
  const [prefix, action, moduleId, messageId] = (interaction.customId || '').split(':');
  if (prefix !== 'protmodal') return false;
  await ensureDeferred(interaction);
  const module = moduleById(moduleId);
  if (!module) return false;

  try {
    if (action === 'limit') {
      const countRaw = interaction.fields.getTextInputValue('count');
      const secondsRaw = interaction.fields.getTextInputValue('seconds');
      
      const count = parseIntSafe(countRaw, 3, { min: 1, max: 100 });
      const seconds = parseIntSafe(secondsRaw, 30, { min: 1, max: 3600 });
      
      if (!countRaw || !secondsRaw) {
        await interaction.followUp({ content: '❌ Preencha ambos os campos (quantidade e segundos).', ephemeral: true }).catch(() => {});
        return presentModule(interaction, prisma, moduleId);
      }
      
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].limit = { count, seconds };
        return cfg;
      });
    }
    
    if (action === 'wh') {
      const users = splitIds(interaction.fields.getTextInputValue('users'));
      const roles = splitIds(interaction.fields.getTextInputValue('roles'));
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].whitelistUsers = users;
        cfg[moduleId].whitelistRoles = roles;
        return cfg;
      });
    }
    
    if (action === 'mindays') {
      const daysRaw = interaction.fields.getTextInputValue('days');
      const days = parseIntSafe(daysRaw, 7, { min: 0, max: 365 });
      
      if (!daysRaw) {
        await interaction.followUp({ content: '❌ Preencha o campo de dias.', ephemeral: true }).catch(() => {});
        return presentModule(interaction, prisma, moduleId);
      }
      
      await updateConfig(prisma, (cfg) => {
        cfg[moduleId].minAccountDays = days;
        return cfg;
      });
    }

    if (messageId && messageId !== '0') {
      const msg = await interaction.channel?.messages?.fetch(messageId).catch(() => null);
      if (msg) {
        const cfg = await getProtectionsConfig(prisma);
        const payload = buildPayload(buildModuleEmbed(module, cfg), buildModuleComponents(module, cfg));
        await msg.edit(payload).catch(() => {});
        
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '✅ Configuração atualizada.', components: [], embeds: [] }).catch(() => {});
        } else {
          await interaction.reply({ content: '✅ Configuração atualizada.', ephemeral: true }).catch(() => {});
        }
        return true;
      }
    }
    return presentModule(interaction, prisma, moduleId);
  } catch (error) {
    console.error(`[protections] Erro ao processar modal ${action} para ${moduleId}:`, error);
    await interaction.followUp({ content: '❌ Erro ao processar configuração. Tente novamente.', ephemeral: true }).catch(() => {});
    return presentModule(interaction, prisma, moduleId);
  }
}

async function presentMenu(interaction, ctx) {
  await ensureGuild(interaction.guild);
  const prisma = ctx.getPrisma();
  return presentRoot(interaction, prisma);
}

async function handleInteraction(interaction, ctx) {
  const prisma = ctx.getPrisma();
  if ((interaction.customId || '').startsWith('prot:backup:') || (interaction.customId || '').startsWith('protmodal:backup:')) {
    return handleBackupInteraction(interaction, prisma);
  }
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === CUSTOM_IDS.MODULE_SELECT) return handleSelect(interaction, prisma);
    if (interaction.customId === CUSTOM_IDS.ROOT) return presentRoot(interaction, prisma);
  }
  if (interaction.isButton()) {
    if (interaction.customId === CUSTOM_IDS.ROOT) return presentRoot(interaction, prisma);
    if (interaction.customId === CUSTOM_IDS.GLOBAL_WH) return presentGlobalWhitelist(interaction, prisma);
    if (interaction.customId.startsWith('prot:back:')) {
      const moduleId = interaction.customId.split(':')[2];
      return presentModule(interaction, prisma, moduleId);
    }
    return handleButton(interaction, prisma);
  }
  if (interaction.isModalSubmit()) {
    return handleModal(interaction, prisma);
  }
  if (interaction.isAnySelectMenu()) {
    return handleSelect(interaction, prisma);
  }
  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
  CUSTOM_IDS,
};
