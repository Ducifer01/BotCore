const { ChannelType, AuditLogEvent } = require('discord.js');
const { getPrisma } = require('../db');

// Helpers to determine who muted and enforce role
// Cache: usuários cujo mute foi aplicado pelo bot configurado
const botControlledMutes = new Set(); // Set<userId>
async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const prisma = getPrisma();
    const cfg = await prisma.globalConfig.findFirst();
    if (!cfg) return;

    const member = newState.member || oldState.member;
    if (!member || !member.guild) return;

    const wasServerMute = !!oldState?.serverMute;
    const isServerMute = !!newState?.serverMute;

    // Only proceed if mute status changed
    if (wasServerMute === isServerMute) {
      // Also handle channel join to unlock logic
      if (cfg.muteUnlockChannelId && newState.channelId === cfg.muteUnlockChannelId) {
        // If user is server-muted but NOT by the specified bot, remove mute
        await tryUnlockNonBotMute(member, cfg);
      }
      return;
    }

    // Mute added
    if (!wasServerMute && isServerMute) {
      await onMuted(member, cfg, newState);
      // Detectar se quem mutou foi o bot configurado (via audit logs)
      await markIfBotControlledMute(member, cfg, oldState, newState);
      return;
    }

    // Mute removed
    if (wasServerMute && !isServerMute) {
      await onUnmuted(member, cfg, newState);
      // Limpa marcação de controle
      botControlledMutes.delete(member.id);
      return;
    }
  } catch (e) {
    console.error('[mute] voiceStateUpdate error', e);
  }
}

async function onMuted(member, cfg, state) {
  try {
    // If configured, apply muteRole when mute originates from the specified bot; otherwise, still consider enforcement
    if (!cfg.muteRoleId) return;

    // Heuristic: check last audit logs for MEMBER_UPDATE/VOICE_STATE? Discord API doesn't expose who triggered serverMute directly via gateway.
    // Simpler policy: whenever serverMute is on, add muteRole; only remove automatically in unlock channel if not bot-controlled.
    if (!member.roles.cache.has(cfg.muteRoleId)) {
      await member.roles.add(cfg.muteRoleId).catch(() => {});
    }
  } catch (e) {
    console.error('[mute] onMuted error', e);
  }
}

async function onUnmuted(member, cfg, state) {
  try {
    // Se o mute era controlado pelo bot configurado, só permitir desmute se o executor for o próprio bot
    if (cfg.muteBotId && botControlledMutes.has(member.id)) {
      const isBotExecutor = await wasLastMuteChangeByBot(member, cfg, false /* looking for unmute */);
      if (!isBotExecutor) {
        // Reaplicar silêncio e cargo
        await member.voice.setMute(true, 'Mute controlado pelo bot especificado - impedido desmute manual').catch(() => {});
        if (cfg.muteRoleId && !member.roles.cache.has(cfg.muteRoleId)) {
          await member.roles.add(cfg.muteRoleId).catch(() => {});
        }
        return;
      } else {
        // Desmute autorizado pelo bot: limpar marcação
        botControlledMutes.delete(member.id);
      }
    }
    // Unmute padrão: remover cargo
    if (cfg.muteRoleId && member.roles.cache.has(cfg.muteRoleId)) {
      await member.roles.remove(cfg.muteRoleId).catch(() => {});
    }
  } catch (e) {
    console.error('[mute] onUnmuted error', e);
  }
}

async function tryUnlockNonBotMute(member, cfg) {
  try {
    if (!member.voice?.serverMute) return; // only act if muted
    // Se foi mutado pelo bot configurado, não desbloqueia
    if (cfg.muteBotId && botControlledMutes.has(member.id)) {
      return;
    }
    // We cannot directly know who muted via gateway; use policy:
    // If the specified bot is present and has a persistent marker (role) we control, then only unmute when not enforced by bot.
    // Since we always add muteRole on any mute, we cannot distinguish origin without audit logs.
    // Alternative: require that bot-specified mutes keep muteRole enforced, and human mutes will be cleared in unlock channel by removing serverMute.
    // Proceed to clear server mute and muteRole if present.
    await member.voice.setMute(false, 'Unlock in configured voice channel for non-bot mutes').catch(() => {});
    if (cfg.muteRoleId && member.roles.cache.has(cfg.muteRoleId)) {
      await member.roles.remove(cfg.muteRoleId).catch(() => {});
    }
  } catch (e) {
    console.error('[mute] tryUnlockNonBotMute error', e);
  }
}

async function markIfBotControlledMute(member, cfg, oldState, newState) {
  try {
    if (!cfg.muteBotId) return;
    const guild = member.guild;
    // Busca logs recentes de atualização de membro
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 10 }).catch(() => null);
    if (!logs) return;
    const entries = logs.entries ? logs.entries : logs;
    // Procura uma entrada para este alvo (member) cujo executor seja o bot configurado e que contenha server mute
    for (const [, entry] of entries) {
      try {
        if (entry.target?.id !== member.id) continue;
        if (entry.executor?.id !== cfg.muteBotId) continue;
        // janela de tempo: últimos ~30s
        const created = entry.createdTimestamp || (entry.createdAt ? entry.createdAt.getTime() : 0);
        if (created && Date.now() - created > 30000) continue;
        // alterações
        const changes = entry.changes || [];
        const muteChange = changes.find(ch => String(ch.key).toLowerCase().includes('mute'));
        if (muteChange) {
          botControlledMutes.add(member.id);
          break;
        }
      } catch {}
    }
  } catch (e) {
    console.error('[mute] markIfBotControlledMute error', e);
  }
}

async function wasLastMuteChangeByBot(member, cfg, isMute) {
  try {
    if (!cfg.muteBotId) return false;
    const guild = member.guild;
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 10 }).catch(() => null);
    if (!logs) return false;
    const entries = logs.entries ? logs.entries : logs;
    for (const [, entry] of entries) {
      try {
        if (entry.target?.id !== member.id) continue;
        const created = entry.createdTimestamp || (entry.createdAt ? entry.createdAt.getTime() : 0);
        if (created && Date.now() - created > 30000) continue;
        const changes = entry.changes || [];
        const muteChange = changes.find(ch => String(ch.key).toLowerCase().includes('mute'));
        if (!muteChange) continue;
        // Quando isMute=true, esperamos mudança para true; quando false, para false
        const newVal = (muteChange.new ?? muteChange.to ?? muteChange.value);
        const expected = isMute ? true : false;
        if (typeof newVal !== 'boolean') continue;
        if (newVal !== expected) continue;
        if (entry.executor?.id === cfg.muteBotId) return true;
      } catch {}
    }
    return false;
  } catch (e) {
    console.error('[mute] wasLastMuteChangeByBot error', e);
    return false;
  }
}

function registerMuteFeature(client) {
  client.on('voiceStateUpdate', handleVoiceStateUpdate);

  // Enforce muteRole persistence: if someone removes muteRole manually, add back if still server-muted
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const prisma = getPrisma();
      const cfg = await prisma.globalConfig.findFirst();
      if (!cfg?.muteRoleId) return;
      const had = oldMember.roles.cache.has(cfg.muteRoleId);
      const has = newMember.roles.cache.has(cfg.muteRoleId);
      if (had && !has) {
        // Role removed; if still server-muted, re-add
        const vs = newMember.voice;
        if (vs?.serverMute) {
          await newMember.roles.add(cfg.muteRoleId).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[mute] guildMemberUpdate error', e);
    }
  });
}

module.exports = { registerMuteFeature };
