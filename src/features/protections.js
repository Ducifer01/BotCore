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

const CUSTOM_IDS = {
  ROOT: 'menu:protections:root',
  MODULE_SELECT: 'menu:protections:select',
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
      await interaction.deferUpdate().catch(() => {});
    }
    await interaction.editReply(payload).catch(() => {});
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
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
      })),
    );
  const row = new ActionRowBuilder().addComponents(select);
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary));
  return [row, back];
}

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

  if (module.id === 'antiCriticalPerms') {
    const activeSet = new Set(state.blockedPerms || []);
    const buttonsPerRow = 5;
    const perPage = 10; // 2 rows x 5 buttons to respeitar limite de 5 action rows
    const totalPerms = (DEFAULT_CRITICAL_PERMS || []).length;
    const maxPage = Math.max(0, Math.ceil(totalPerms / perPage) - 1);
    const currentPage = Math.min(page, maxPage);
    const permsPage = (DEFAULT_CRITICAL_PERMS || []).slice(currentPage * perPage, currentPage * perPage + perPage);
    const permButtons = permsPage.map((perm) =>
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.BLOCK_PERM_TOGGLE(module.id, perm, currentPage))
        .setLabel(perm)
        .setStyle(activeSet.has(perm) ? ButtonStyle.Success : ButtonStyle.Danger),
    );

    for (let i = 0; i < permButtons.length; i += buttonsPerRow) {
      rows.push(new ActionRowBuilder().addComponents(permButtons.slice(i, i + buttonsPerRow)));
    }

    // Controles de paginação + navegação sem estourar o limite de 5 action rows
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

    // Já incluímos navegação e voltar no mesmo row; evitamos adicionar outro row de voltar no final.
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

async function presentRoot(interaction, prisma) {
  await ensureDeferred(interaction);
  const cfg = await getProtectionsConfig(prisma);
  const embed = buildRootEmbed(cfg);
  const components = buildRootComponents();
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

async function handleButton(interaction, prisma) {
  const parts = (interaction.customId || '').split(':');
  const [prefix, action, moduleId] = parts;
  if (prefix !== 'prot') return false;
  const module = moduleById(moduleId);
  if (!module) return false;
  if (module.disabled) return presentRoot(interaction, prisma);

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
    const modal = new ModalBuilder()
      .setCustomId(MODALS.LIMIT(moduleId, messageId))
      .setTitle('Limite X em Y segundos')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('Qtd (X)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('seconds').setLabel('Janela em segundos (Y)').setStyle(TextInputStyle.Short).setRequired(true)),
      );
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'wh') {
    return presentWhitelist(interaction, prisma, moduleId);
  }
  // bloqueio de perms agora é via botões toggle
  if (action === 'mindays') {
    const messageId = interaction.message?.id || '0';
    const modal = new ModalBuilder()
      .setCustomId(MODALS.MIN_DAYS(moduleId, messageId))
      .setTitle('Idade mínima (dias)')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Dias').setStyle(TextInputStyle.Short).setRequired(true)));
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
}

async function handleSelect(interaction, prisma) {
  if (interaction.customId === CUSTOM_IDS.MODULE_SELECT) {
    await ensureDeferred(interaction);
    const choice = interaction.values?.[0];
    return presentModule(interaction, prisma, choice);
  }
  const [prefix, action, moduleId] = (interaction.customId || '').split(':');
  if (prefix !== 'prot') return false;
  await ensureDeferred(interaction);
  const module = moduleById(moduleId);
  if (!module) return false;
  const prismaUpdate = async (dataUpdater) => updateConfig(prisma, dataUpdater);

  if (action === 'log' && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values?.[0];
    await prismaUpdate((cfg) => {
      cfg[moduleId].logChannelId = channelId;
      return cfg;
    });
    return presentModule(interaction, prisma, moduleId);
  }

  if (action === 'rolelimit' && interaction.isRoleSelectMenu()) {
    const roleId = interaction.values?.[0];
    await prismaUpdate((cfg) => {
      cfg[moduleId].limitRoleId = roleId;
      return cfg;
    });
    return presentModule(interaction, prisma, moduleId);
  }

  if (action === 'blockroles' && interaction.isRoleSelectMenu()) {
    const roleIds = interaction.values || [];
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
}

function parseIntSafe(val, fallback) {
  const num = parseInt(val, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function splitIds(text) {
  return (text || '')
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function handleModal(interaction, prisma) {
  const [prefix, action, moduleId, messageId] = (interaction.customId || '').split(':');
  if (prefix !== 'protmodal') return false;
  await ensureDeferred(interaction);
  const module = moduleById(moduleId);
  if (!module) return false;

  if (action === 'limit') {
    const count = parseIntSafe(interaction.fields.getTextInputValue('count'), module.hasLimit ? 3 : 1);
    const seconds = parseIntSafe(interaction.fields.getTextInputValue('seconds'), 30);
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
    const days = parseIntSafe(interaction.fields.getTextInputValue('days'), 7);
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
      // Apenas uma confirmação silenciosa para evitar criar novos embeds.
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Configuração atualizada.', components: [], embeds: [] }).catch(() => {});
      } else {
        await interaction.reply({ content: 'Configuração atualizada.', ephemeral: true }).catch(() => {});
      }
      return true;
    }
  }
  return presentModule(interaction, prisma, moduleId);
}

async function presentMenu(interaction, ctx) {
  await ensureGuild(interaction.guild);
  const prisma = ctx.getPrisma();
  return presentRoot(interaction, prisma);
}

async function handleInteraction(interaction, ctx) {
  const prisma = ctx.getPrisma();
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === CUSTOM_IDS.MODULE_SELECT) return handleSelect(interaction, prisma);
    if (interaction.customId === CUSTOM_IDS.ROOT) return presentRoot(interaction, prisma);
  }
  if (interaction.isButton()) {
    if (interaction.customId === CUSTOM_IDS.ROOT) return presentRoot(interaction, prisma);
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
