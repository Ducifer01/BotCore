const { incrementMessageCount, startVoiceSession, completeVoiceSession, moveVoiceSession } = require('../services/userStats');

async function handleMessage(message, ctx) {
  try {
    if (!message.guild || message.author.bot) return false;
    if (!ctx.isGuildAllowed(message.guildId)) return false;
    const prisma = ctx.getPrisma();
    await incrementMessageCount(prisma, message.guildId, message.author.id);
  } catch (err) {
    console.warn('[userStats] Falha ao registrar mensagem:', err?.message || err);
  }
  return false;
}

async function handleVoiceStateUpdate(oldState, newState, ctx) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    if (!ctx.isGuildAllowed(guild.id)) return;
    const prisma = ctx.getPrisma();
    const userId = newState.id || oldState.id;
    const wasInVoice = Boolean(oldState?.channelId);
    const isInVoice = Boolean(newState?.channelId);

    if (!wasInVoice && isInVoice) {
      await startVoiceSession(prisma, guild.id, userId, newState.channelId);
      return;
    }
    if (wasInVoice && !isInVoice) {
      await completeVoiceSession(prisma, guild.id, userId);
      return;
    }
    if (wasInVoice && isInVoice && oldState.channelId !== newState.channelId) {
      await moveVoiceSession(prisma, guild.id, userId, newState.channelId);
    }
  } catch (err) {
    console.warn('[userStats] Falha ao registrar voz:', err?.message || err);
  }
}

module.exports = { handleMessage, handleVoiceStateUpdate };
