const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const sodium = require('libsodium-wrappers');

async function connectToChannel(channel) {
  // Garante que a lib de criptografia esteja inicializada (necessária para modos AEAD)
  try { await sodium.ready; } catch {}
  if (!channel || !channel.guild) throw new Error('Canal inválido');
  const guildId = channel.guild.id;
  const existing = getVoiceConnection(guildId);
  if (existing) {
    try {
      if (existing.joinConfig.channelId === channel.id) {
        return existing;
      }
      existing.destroy();
    } catch {}
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    return connection;
  } catch (e) {
    try { connection.destroy(); } catch {}
    throw e;
  }
}

function disconnectFromGuild(guildId) {
  const existing = getVoiceConnection(guildId);
  if (existing) existing.destroy();
}

module.exports = { connectToChannel, disconnectFromGuild };
