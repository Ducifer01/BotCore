const {
  getPointsConfig,
  ensurePointsConfig,
  handleChatMessage,
  tickVoice,
  handleVoiceLeave,
  handleInviteJoin,
  handleInviteLeave,
  confirmPendingInvites,
  getTopBalances,
  isSystemEnabled,
  buildLeaderboardEmbed,
} = require('../services/points');
const { getPrisma } = require('../db');

const CACHE_TTL_MS = 30_000;
const VOICE_TICK_MS = 60_000;
const INVITE_CONFIRM_MS = 5 * 60_000;
const LEADERBOARD_TICK_MS = 2 * 60_000;

let cachedCfg = null;
let lastCfgAt = 0;
let clientRef = null;
let voiceInterval = null;
let inviteInterval = null;
let leaderboardInterval = null;

async function loadConfig(prisma) {
  const now = Date.now();
  if (cachedCfg && now - lastCfgAt < CACHE_TTL_MS) return cachedCfg;
  const cfg = await getPointsConfig(prisma);
  cachedCfg = cfg;
  lastCfgAt = now;
  return cfg;
}

function invalidateCache() {
  cachedCfg = null;
  lastCfgAt = 0;
}

async function handleMessage(message, ctx) {
  try {
    if (!message.guild || message.author.bot) return false;
    const prisma = ctx.getPrisma();
    const cfg = await loadConfig(prisma);
    if (!isSystemEnabled(cfg)) return false;
  await handleChatMessage({ message, prisma, cfg });
  } catch (err) {
    console.warn('[points] erro handleMessage', err?.message || err);
  }
  return false;
}

async function handleVoiceStateUpdate(oldState, newState, ctx) {
  try {
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;
    const prisma = ctx.getPrisma();
    const cfg = await loadConfig(prisma);
    if (!isSystemEnabled(cfg)) return;
    const wasIn = Boolean(oldState?.channelId);
    const isIn = Boolean(newState?.channelId);
    if (wasIn && !isIn) {
      await handleVoiceLeave({ guildId, userId: newState.id || oldState.id, prisma, cfg });
    }
    if (!wasIn && isIn) {
      // nothing; accrual happens via tick
      return;
    }
  } catch (err) {
    console.warn('[points] erro voice', err?.message || err);
  }
}

async function handleGuildMemberAdd(member) {
  try {
    const prisma = getPrisma();
    const cfg = await loadConfig(prisma);
    if (!isSystemEnabled(cfg)) return;
    // Integração real é feita no inviteTracker; aqui não processamos convites para evitar duplicidade/placeholder incorreto.
  } catch (err) {
    console.warn('[points] erro member add', err?.message || err);
  }
}

async function handleGuildMemberRemove(member) {
  try {
    const prisma = getPrisma();
    const cfg = await loadConfig(prisma);
    if (!isSystemEnabled(cfg)) return;
    // Integração real de revogação via inviteTracker; evitamos duplicidade aqui.
  } catch (err) {
    console.warn('[points] erro member remove', err?.message || err);
  }
}

async function refreshLeaderboards(prisma, cfg) {
  const panels = await prisma.pointsLeaderboardPanel.findMany({ where: { isActive: true } });
  if (!panels.length || !clientRef) return;
  for (const panel of panels) {
    const refreshMs = (panel.refreshMinutes || cfg.leaderboardRefreshMinutes || 10) * 60_000;
    const last = panel.lastRefreshAt ? new Date(panel.lastRefreshAt).getTime() : 0;
    if (last && Date.now() - last < refreshMs) continue;
    try {
      const channel = await clientRef.channels.fetch(panel.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;
      const top = await getTopBalances(prisma, cfg, panel.guildId, 20);
  const embed = buildLeaderboardEmbed(top, channel.guild, panel.refreshMinutes || cfg.leaderboardRefreshMinutes || 10);
      if (panel.messageId) {
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
        } else {
          const sent = await channel.send({ embeds: [embed] }).catch(() => null);
          if (sent) {
            await prisma.pointsLeaderboardPanel.update({ where: { id: panel.id }, data: { messageId: sent.id } });
          }
        }
      } else {
        const sent = await channel.send({ embeds: [embed] }).catch(() => null);
        if (sent) {
          await prisma.pointsLeaderboardPanel.update({ where: { id: panel.id }, data: { messageId: sent.id } });
        }
      }
      await prisma.pointsLeaderboardPanel.update({ where: { id: panel.id }, data: { lastRefreshAt: new Date() } });
    } catch (err) {
      console.warn('[points] falha ao atualizar painel', err?.message || err);
    }
  }
}

function register(client) {
  clientRef = client;
  const prisma = getPrisma();
  ensurePointsConfig(prisma).catch(() => {});

  if (voiceInterval) clearInterval(voiceInterval);
  voiceInterval = setInterval(async () => {
    try {
      const cfg = await loadConfig(prisma);
      if (!isSystemEnabled(cfg)) return;
      await tickVoice({ client, prisma, cfg });
    } catch (err) {
      console.warn('[points] tick voice', err?.message || err);
    }
  }, VOICE_TICK_MS);

  if (inviteInterval) clearInterval(inviteInterval);
  inviteInterval = setInterval(async () => {
    try {
      const cfg = await loadConfig(prisma);
      if (!isSystemEnabled(cfg)) return;
      await confirmPendingInvites({ prisma, cfg, client });
    } catch (err) {
      console.warn('[points] tick invites', err?.message || err);
    }
  }, INVITE_CONFIRM_MS);

  if (leaderboardInterval) clearInterval(leaderboardInterval);
  leaderboardInterval = setInterval(async () => {
    try {
      const cfg = await loadConfig(prisma);
      if (!isSystemEnabled(cfg)) return;
      await refreshLeaderboards(prisma, cfg);
    } catch (err) {
      console.warn('[points] tick leaderboard', err?.message || err);
    }
  }, LEADERBOARD_TICK_MS);
}

module.exports = {
  handleMessage,
  handleVoiceStateUpdate,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  register,
  invalidateCache,
  loadConfig,
};
