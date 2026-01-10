const { AuditLogEvent, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { getProtectionsConfig, saveProtectionsConfig, PUNISH } = require('../services/protectionsConfig');
const { ensureGlobalConfig } = require('../services/globalConfig');

// Pequeno rate limiter por executor/módulo
class Counter {
  constructor() {
    this.map = new Map();
  }
  hit(key, seconds, now = Date.now()) {
    const arr = this.map.get(key) || [];
    const cutoff = now - seconds * 1000;
    const filtered = arr.filter((ts) => ts >= cutoff);
    filtered.push(now);
    this.map.set(key, filtered);
    return filtered.length;
  }
}

function isWhitelisted(userId, member, whitelistUsers = [], whitelistRoles = []) {
  if (!userId) return false;
  const botId = member?.guild?.members?.me?.id || member?.client?.user?.id;
  if (botId && userId === botId) return true;
  if (whitelistUsers.includes(userId)) return true;
  if (member) {
    const roles = member.roles?.cache || new Map();
    if (roles.some((r) => whitelistRoles.includes(r.id))) return true;
  }
  return false;
}

async function punishMember(member, punishment = PUNISH.STRIP_ROLES, reason = 'Proteção acionada') {
  if (!member) return { ok: false, message: 'membro não encontrado' };
  if (punishment === PUNISH.KICK) {
    try {
      await member.kick(reason);
      return { ok: true, action: 'kick' };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  }
  // Remover todos os cargos (exceto @everyone)
  const roles = member.roles.cache.filter((r) => r.id !== member.guild.roles.everyone.id);
  try {
    await member.roles.remove([...roles.keys()], reason);
    return { ok: true, action: 'strip_roles' };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
}

async function logAction(guild, logChannelId, embedData) {
  if (!logChannelId) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const embed = new EmbedBuilder(embedData);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function fetchAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((e) => (!targetId || e.target?.id === targetId));
    return entry?.executor || null;
  } catch (err) {
    return null;
  }
}

function hasCriticalPermsDiff(oldRole, newRole, blockedPerms) {
  const added = new PermissionsBitField(newRole.permissions).remove(oldRole.permissions);
  return blockedPerms.some((p) => added.has(PermissionsBitField.Flags[p] || p));
}

function roleHasAny(role, permNames) {
  return permNames.some((p) => role.permissions.has(PermissionsBitField.Flags[p] || p));
}

function buildBaseEmbed(title, executor, target, description) {
  return {
    title,
    description,
    color: 0xE74C3C,
    fields: [
      executor ? { name: 'Usuário', value: `${executor.tag || executor.username} (${executor.id})` } : undefined,
      target ? { name: 'Alvo', value: `${target.name || target.tag || target.id} (${target.id})` } : undefined,
    ].filter(Boolean),
    timestamp: new Date().toISOString(),
  };
}

function buildViolationText(violations = []) {
  return violations.map((v) => `• ${v}`).join('\n') || 'Violação detectada';
}

function describePermDiff(oldRole, newRole, blockedPerms) {
  const added = new PermissionsBitField(newRole.permissions).remove(oldRole.permissions);
  const names = blockedPerms.filter((p) => added.has(PermissionsBitField.Flags[p] || p));
  const removed = new PermissionsBitField(oldRole.permissions).remove(newRole.permissions);
  const removedNames = blockedPerms.filter((p) => removed.has(PermissionsBitField.Flags[p] || p));
  if (names.length && removedNames.length) {
    return `Tentou conceder: ${names.join(', ')} | Tentou remover: ${removedNames.join(', ')}`;
  }
  if (names.length) return `Tentou conceder: ${names.join(', ')}`;
  if (removedNames.length) return `Tentou remover: ${removedNames.join(', ')}`;
  return null;
}

function roleIsProtected(role, limitRole) {
  if (!limitRole) return false;
  if (role.id === limitRole.id) return true;
  return role.position >= limitRole.position;
}

function cacheLimit(keyedMap, key, seconds) {
  const now = Date.now();
  const arr = keyedMap.get(key) || [];
  const cutoff = now - seconds * 1000;
  const filtered = arr.filter((ts) => ts >= cutoff);
  filtered.push(now);
  keyedMap.set(key, filtered);
  return filtered.length;
}

function dateDiffDays(a, b) {
  const diff = Math.abs(a.getTime() - b.getTime());
  return diff / (1000 * 60 * 60 * 24);
}

function splitIds(text) {
  return (text || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toSet(arr) {
  return [...new Set(arr || [])];
}

function ensureArrays(cfg) {
  ['whitelistUsers', 'whitelistRoles', 'blockedPerms', 'roles'].forEach(() => {});
}

function createRuntime() {
  const limiter = {
    ban: new Counter(),
    timeout: new Counter(),
    channelDelete: new Counter(),
    roleDelete: new Counter(),
    disconnect: new Counter(),
    muteDeafen: new Counter(),
  };

  // Evita loop ao dar rollback em cargos
  const suppressRoleUpdate = new Set();


  async function handleGuildRoleUpdate(oldRole, newRole, prisma) {
    if (suppressRoleUpdate.has(newRole.id)) return;
    const cfg = await getProtectionsConfig(prisma);
    const guild = newRole.guild;
    const limitRole = cfg.antiRoleHierarchy.limitRoleId
      ? guild.roles.cache.get(cfg.antiRoleHierarchy.limitRoleId) || null
      : null;

    const shouldCheckHierarchy = cfg.antiRoleHierarchy.enabled && limitRole;
    const shouldCheckPerms = cfg.antiCriticalPerms.enabled;
    if (!shouldCheckHierarchy && !shouldCheckPerms) return;

    const executor = await fetchAuditExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id);
    const executorMember = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    if (executor?.id === guild.members.me?.id) return;

    // If whitelisted for both modules, skip
    const whitelistedHierarchy = shouldCheckHierarchy && isWhitelisted(executor?.id, executorMember, cfg.antiRoleHierarchy.whitelistUsers, cfg.antiRoleHierarchy.whitelistRoles);
    const whitelistedPerms = shouldCheckPerms && isWhitelisted(executor?.id, executorMember, cfg.antiCriticalPerms.whitelistUsers, cfg.antiCriticalPerms.whitelistRoles);

    const violations = [];
    let rollbackPerms = false;

    if (shouldCheckHierarchy && !whitelistedHierarchy) {
      const isProtected = roleIsProtected(newRole, limitRole) || roleHasAny(newRole, ['Administrator']);
      const moved = oldRole.position !== newRole.position;
      const permsChanged = cfg.antiRoleHierarchy.protectPermissions && !oldRole.permissions.equals(newRole.permissions);
      if (isProtected && (moved || permsChanged)) {
        if (moved && !executor) {
          violations.push('Alguém alterou a ordem dos cargos (executor não identificado)');
        }
        violations.push('Alteração indevida em cargo protegido (Cargos Críticos)');
        const desc = describePermDiff(oldRole, newRole, cfg.antiCriticalPerms.blockedPerms || []);
        if (desc) violations.push(desc);
        if (moved) violations.push('Tentou mover cargo protegido');
        if (permsChanged && !desc) violations.push('Alterou permissões do cargo');
        if (permsChanged) rollbackPerms = true;
      }
    }

    if (shouldCheckPerms && !whitelistedPerms) {
      const blocked = hasCriticalPermsDiff(oldRole, newRole, cfg.antiCriticalPerms.blockedPerms);
      if (blocked) {
        violations.push('Permissão crítica adicionada ao cargo');
        const desc = describePermDiff(oldRole, newRole, cfg.antiCriticalPerms.blockedPerms || []);
        if (desc) violations.push(desc);
        rollbackPerms = true;
      }
    }

    if (!violations.length) return;

    // Rollback apenas de permissões (sem reverter posição)
    if (rollbackPerms && !oldRole.permissions.equals(newRole.permissions)) {
      suppressRoleUpdate.add(newRole.id);
      await newRole.setPermissions(oldRole.permissions).catch(() => {});
      setTimeout(() => suppressRoleUpdate.delete(newRole.id), 3000);
    }

    const punishment = shouldCheckHierarchy && !whitelistedHierarchy
      ? cfg.antiRoleHierarchy.punishment
      : cfg.antiCriticalPerms.punishment;
    const memberToPunish = executorMember;
    if (memberToPunish && punishment) {
      await punishMember(memberToPunish, punishment, 'Proteção de cargos');
    }

    const embed = buildBaseEmbed('Proteção: Cargo', executor, newRole, buildViolationText(violations));
    await logAction(guild, cfg.antiRoleHierarchy.logChannelId || cfg.antiCriticalPerms.logChannelId, embed);
  }

  async function handleRoleDelete(role, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massRoleDelete.enabled && !cfg.antiRoleHierarchy.enabled) return;
    const guild = role.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.RoleDelete, role.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;

    const whitelisted = isWhitelisted(executor?.id, member, cfg.massRoleDelete.whitelistUsers || [], cfg.massRoleDelete.whitelistRoles || []);
    if (whitelisted) return;

    let violateHierarchy = false;
    if (cfg.antiRoleHierarchy.enabled && cfg.antiRoleHierarchy.punishOnProtectedRoleDelete) {
      const limitRole = cfg.antiRoleHierarchy.limitRoleId
        ? guild.roles.cache.get(cfg.antiRoleHierarchy.limitRoleId) || null
        : null;
      if (limitRole && (role.id === limitRole.id || role.position >= limitRole.position || role.permissions.has(PermissionsBitField.Flags.Administrator))) {
        violateHierarchy = true;
      }
    }

    const limit = cfg.massRoleDelete.limit;
    const hitCount = cfg.massRoleDelete.enabled
      ? limiter.roleDelete.hit(`${executor?.id || 'unknown'}`, limit.seconds)
      : 0;

    const shouldPunishMass = cfg.massRoleDelete.enabled && hitCount >= limit.count;
    if (!violateHierarchy && !shouldPunishMass) return;

    const punishment = violateHierarchy ? cfg.antiRoleHierarchy.punishment : cfg.massRoleDelete.punishment;
    if (member) await punishMember(member, punishment, 'Proteção de cargos (deleção)');
    const embed = buildBaseEmbed('Proteção: Deleção de Cargo', executor, role, buildViolationText([
      violateHierarchy ? 'Cargo protegido deletado' : null,
      shouldPunishMass ? 'Limite de deleções atingido' : null,
    ].filter(Boolean)));
    const logChannel = cfg.massRoleDelete.logChannelId || cfg.antiRoleHierarchy.logChannelId;
    await logAction(guild, logChannel, embed);
  }

  async function handleChannelDelete(channel, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massChannelDelete.enabled) return;
    const guild = channel.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.ChannelDelete, channel.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, member, cfg.massChannelDelete.whitelistUsers || [], cfg.massChannelDelete.whitelistRoles || []);
    if (whitelisted) return;
    const limit = cfg.massChannelDelete.limit;
    const count = limiter.channelDelete.hit(`${executor?.id || 'unknown'}`, limit.seconds);
    if (count < limit.count) return;
    if (member) await punishMember(member, cfg.massChannelDelete.punishment, 'Proteção: deleção de canais');
    const embed = buildBaseEmbed('Proteção: Deleção de Canais', executor, channel, `Limite atingido (${count}/${limit.count} em ${limit.seconds}s)`);
    await logAction(guild, cfg.massChannelDelete.logChannelId, embed);
  }


  async function handleBotAdd(member, prisma) {
    if (!member.user.bot) return;
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.antiBotAdd.enabled) return;
    const guild = member.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.BotAdd, member.id);
    const executorMember = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, executorMember, cfg.antiBotAdd.whitelistUsers, cfg.antiBotAdd.whitelistRoles);
    if (!whitelisted) {
      if (cfg.antiBotAdd.botAction === 'BAN') {
        await guild.members.ban(member.id, { reason: 'Proteção: bot não autorizado' }).catch(() => member.kick('Proteção: bot não autorizado').catch(() => {}));
      } else {
        await member.kick('Proteção: bot não autorizado').catch(() => {});
      }
      if (executorMember) await punishMember(executorMember, cfg.antiBotAdd.punishment, 'Proteção: bot não autorizado');
    }
    const embed = buildBaseEmbed('Proteção: Bot Add', executor, member.user, whitelisted ? 'Bot permitido (whitelist)' : 'Bot removido e usuário punido');
    await logAction(guild, cfg.antiBotAdd.logChannelId, embed);
  }

  async function handleAntiAlt(member, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.antiAlt.enabled) return;
    if (member.user.bot) return;
    const ageDays = dateDiffDays(new Date(), member.user.createdAt || new Date());
    if (ageDays >= cfg.antiAlt.minAccountDays) return;
    await member.kick('Proteção: conta jovem').catch(() => {});
    const embed = buildBaseEmbed('Proteção: ALT', null, member.user, `Conta com ${ageDays.toFixed(1)}d (mín: ${cfg.antiAlt.minAccountDays}d)`);
    await logAction(member.guild, cfg.antiAlt.logChannelId, embed);
  }

  async function handleBan(ban, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massBanKick.enabled) return;
    const guild = ban.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, member, cfg.massBanKick.whitelistUsers || [], cfg.massBanKick.whitelistRoles || []);
    if (whitelisted) return;
    const limit = cfg.massBanKick.limit;
    const count = limiter.ban.hit(`${executor?.id || 'unknown'}`, limit.seconds);
    if (count < limit.count) return;
    if (member) await punishMember(member, cfg.massBanKick.punishment, 'Proteção: ban massivo');
    const embed = buildBaseEmbed('Proteção: Ban Massivo', executor, ban.user, `Limite atingido (${count}/${limit.count} em ${limit.seconds}s)`);
    await logAction(guild, cfg.massBanKick.logChannelId, embed);
  }

  async function handleTimeout(oldMember, newMember, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massTimeout.enabled) return;
    const before = oldMember.communicationDisabledUntilTimestamp || 0;
    const after = newMember.communicationDisabledUntilTimestamp || 0;
    if (!(after && after > before)) return;
    const guild = newMember.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, member, cfg.massTimeout.whitelistUsers || [], cfg.massTimeout.whitelistRoles || []);
    if (whitelisted) return;
    const limit = cfg.massTimeout.limit;
    const count = limiter.timeout.hit(`${executor?.id || 'unknown'}`, limit.seconds);
    if (count < limit.count) return;
    if (member) await punishMember(member, cfg.massTimeout.punishment, 'Proteção: timeout massivo');
    const embed = buildBaseEmbed('Proteção: Timeout Massivo', executor, newMember.user, `Limite atingido (${count}/${limit.count} em ${limit.seconds}s)`);
    await logAction(guild, cfg.massTimeout.logChannelId, embed);
  }

  async function handleMemberRoleAdd(oldMember, newMember, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    const guild = newMember.guild;
    const limitRole = cfg.antiRoleHierarchy.limitRoleId
      ? guild.roles.cache.get(cfg.antiRoleHierarchy.limitRoleId) || null
      : null;

    const checkHierarchy = cfg.antiRoleHierarchy.enabled && limitRole && cfg.antiRoleHierarchy.preventProtectedRoleGive;
    const checkCritical = cfg.antiCriticalPerms.enabled;
    if (!checkHierarchy && !checkCritical) return;

    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    if (!added.size) return;

    const executor = await fetchAuditExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    const executorMember = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;

    const whitelistedHierarchy = checkHierarchy && isWhitelisted(executor?.id, executorMember, cfg.antiRoleHierarchy.whitelistUsers, cfg.antiRoleHierarchy.whitelistRoles);
    const whitelistedPerms = checkCritical && isWhitelisted(executor?.id, executorMember, cfg.antiCriticalPerms.whitelistUsers, cfg.antiCriticalPerms.whitelistRoles);

    const toRemove = [];
    const violations = [];

    for (const role of added.values()) {
      if (checkHierarchy && !whitelistedHierarchy) {
        if (roleIsProtected(role, limitRole) || role.permissions.has(PermissionsBitField.Flags.Administrator)) {
          toRemove.push(role.id);
          violations.push(`Cargo protegido adicionado: ${role.name}`);
        }
      }
      if (checkCritical && !whitelistedPerms) {
        const hasBlocked = roleHasAny(role, cfg.antiCriticalPerms.blockedPerms || []);
        if (hasBlocked && !toRemove.includes(role.id)) {
          toRemove.push(role.id);
          const blockedNames = (cfg.antiCriticalPerms.blockedPerms || []).filter((p) => role.permissions.has(PermissionsBitField.Flags[p] || p));
          violations.push(`Cargo com permissão crítica adicionado: ${role.name}${blockedNames.length ? ` (perms: ${blockedNames.join(', ')})` : ''}`);
        }
      }
    }

    if (!toRemove.length) return;

    // rollback roles
    await newMember.roles.remove(toRemove, 'Proteção: cargo protegido/permissão crítica').catch(() => {});

    const punishment = checkHierarchy && !whitelistedHierarchy
      ? cfg.antiRoleHierarchy.punishment
      : cfg.antiCriticalPerms.punishment;
    if (executorMember) {
      await punishMember(executorMember, punishment, 'Proteção: cargo protegido/permissão crítica');
    }

    const embed = buildBaseEmbed('Proteção: Cargo em membro', executor, newMember.user, buildViolationText(violations));
    await logAction(guild, cfg.antiRoleHierarchy.logChannelId || cfg.antiCriticalPerms.logChannelId, embed);
  }

  async function handleMassDisconnect(oldState, newState, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massDisconnect.enabled) return;
    if (!oldState?.channelId || newState?.channelId) return; // saiu de um canal
    const guild = oldState.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.MemberDisconnect, oldState.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, member, cfg.massDisconnect.whitelistUsers || [], cfg.massDisconnect.whitelistRoles || []);
    if (whitelisted) return;
    const limit = cfg.massDisconnect.limit;
    const count = limiter.disconnect.hit(`${executor?.id || 'unknown'}`, limit.seconds);
    if (count < limit.count) return;
    if (member) await punishMember(member, cfg.massDisconnect.punishment, 'Proteção: desconectar massivo');
    const embed = buildBaseEmbed('Proteção: Desconectar Massivo', executor, oldState.member?.user || { id: oldState.id }, `Limite atingido (${count}/${limit.count} em ${limit.seconds}s)`);
    await logAction(guild, cfg.massDisconnect.logChannelId, embed);
  }

  async function handleMassMuteDeafen(oldState, newState, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.massMuteDeafen.enabled) return;
    const toggledMute = !oldState.serverMute && newState.serverMute;
    const toggledDeaf = !oldState.serverDeaf && newState.serverDeaf;
    if (!toggledMute && !toggledDeaf) return;
    const guild = newState.guild;
    const executor = await fetchAuditExecutor(guild, AuditLogEvent.MemberUpdate, newState.id);
    const member = executor ? await guild.members.fetch(executor.id).catch(() => null) : null;
    const whitelisted = isWhitelisted(executor?.id, member, cfg.massMuteDeafen.whitelistUsers || [], cfg.massMuteDeafen.whitelistRoles || []);
    if (whitelisted) return;
    const limit = cfg.massMuteDeafen.limit;
    const count = limiter.muteDeafen.hit(`${executor?.id || 'unknown'}`, limit.seconds);
    if (count < limit.count) return;
    if (member) await punishMember(member, cfg.massMuteDeafen.punishment, 'Proteção: mute/deafen massivo');
    const embed = buildBaseEmbed('Proteção: Mute/Deafen Massivo', executor, newState.member?.user || { id: newState.id }, `Limite atingido (${count}/${limit.count} em ${limit.seconds}s)`);
    await logAction(guild, cfg.massMuteDeafen.logChannelId, embed);
  }

  async function handleBlockedRoles(oldMember, newMember, prisma) {
    const cfg = await getProtectionsConfig(prisma);
    if (!cfg.blockedRoles.enabled || !cfg.blockedRoles.roles?.length) return;
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const blocked = added.filter((r) => cfg.blockedRoles.roles.includes(r.id));
    if (!blocked.size) return;
    await newMember.roles.remove([...blocked.keys()], 'Proteção: cargo bloqueado').catch(() => {});
    const embed = buildBaseEmbed('Proteção: Cargos Bloqueados', null, newMember.user, `Cargos removidos: ${blocked.map((r) => r.name).join(', ')}`);
    await logAction(newMember.guild, cfg.blockedRoles.logChannelId, embed);
  }

  return {
    async register(client) {
      const prisma = client.prisma;
      await ensureGlobalConfig(prisma);

      client.on('roleUpdate', (oldRole, newRole) => {
        handleGuildRoleUpdate(oldRole, newRole, prisma).catch((err) => console.error('[protections] roleUpdate', err));
      });

      client.on('roleDelete', (role) => {
        handleRoleDelete(role, prisma).catch((err) => console.error('[protections] roleDelete', err));
      });

      client.on('channelDelete', (channel) => {
        handleChannelDelete(channel, prisma).catch((err) => console.error('[protections] channelDelete', err));
      });

      // antiWebhook removido

      client.on('guildMemberAdd', (member) => {
        handleBotAdd(member, prisma).catch((err) => console.error('[protections] botAdd', err));
        handleAntiAlt(member, prisma).catch((err) => console.error('[protections] antiAlt', err));
      });

      client.on('guildBanAdd', (ban) => {
        handleBan(ban, prisma).catch((err) => console.error('[protections] banAdd', err));
      });

      client.on('guildMemberUpdate', (oldMember, newMember) => {
        handleTimeout(oldMember, newMember, prisma).catch((err) => console.error('[protections] timeout', err));
        handleBlockedRoles(oldMember, newMember, prisma).catch((err) => console.error('[protections] blockedRoles', err));
        handleMemberRoleAdd(oldMember, newMember, prisma).catch((err) => console.error('[protections] memberRoleAdd', err));
      });

      client.on('voiceStateUpdate', (oldState, newState) => {
        handleMassDisconnect(oldState, newState, prisma).catch((err) => console.error('[protections] disconnect', err));
        handleMassMuteDeafen(oldState, newState, prisma).catch((err) => console.error('[protections] muteDeafen', err));
      });
    },
  };
}

module.exports = { createRuntime, PUNISH };
