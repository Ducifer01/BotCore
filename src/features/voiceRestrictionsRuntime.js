const { EmbedBuilder, ChannelType } = require('discord.js');
const { getPrisma } = require('../db');
const { getVoiceRestrictionsConfig, isRestrictedPair } = require('../services/voiceRestrictions');
const { runCastigo } = require('../actions/moderationActions');

// Rastreamento de tentativas: userId => { attempts: number, firstAttempt: timestamp, lastNotification: timestamp }
const attemptTracker = new Map();

function pickTextChannelForVoice(voiceChannel) {
  if (!voiceChannel?.guild) return null;
  
  // O próprio canal de voz tem um chat integrado, basta verificar se o bot pode enviar mensagens
  if (voiceChannel.isVoiceBased() && voiceChannel.permissionsFor(voiceChannel.guild.members.me || voiceChannel.guild.client.user)?.has('SendMessages')) {
    console.log('[voiceRestrictions] Usando chat do próprio canal de voz:', voiceChannel.id);
    return voiceChannel;
  }
  
  console.log('[voiceRestrictions] Bot não tem permissão para enviar no chat do canal de voz');
  return null;
}

async function sendActionLog(guild, logChannelId, { entrant, occupant, channel, reason }) {
  if (!logChannelId) return;
  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('🚫 Restrição de voz aplicada')
    .setColor(0xE74C3C)
    .setTimestamp(new Date())
    .addFields(
      entrant ? { name: 'Tentou entrar', value: `${entrant.user.tag} (${entrant.id})` } : null,
      occupant ? { name: 'Estava em Call', value: `${occupant.user.tag} (${occupant.id})` } : null,
      channel ? { name: 'Canal', value: `<#${channel.id}>` } : null,
      reason ? { name: 'Motivo', value: reason } : null,
    ).toJSON();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

async function notifyChannel(voiceChannel, entrant, occupant) {
  const textChannel = pickTextChannelForVoice(voiceChannel);
  if (!textChannel) return;
  const content = `⛔ ${entrant} foi removido da call por ter restrição com ${occupant}.`;
  await textChannel.send({ content }).catch(() => {});
}

async function sendUserNotification(voiceChannel, supportChannelId, entrant) {
  const textChannel = pickTextChannelForVoice(voiceChannel);
  
  console.log('[voiceRestrictions] Tentando enviar notificação:', {
    hasTextChannel: !!textChannel,
    textChannelId: textChannel?.id || null,
    entrantId: entrant?.id
  });
  
  if (!textChannel) {
    console.warn('[voiceRestrictions] Nenhum canal de texto encontrado na categoria');
    return;
  }
  
  const supportMention = supportChannelId ? ` Qualquer dúvida, consulte o suporte <#${supportChannelId}>` : '';
  
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Sistema de Restrição')
    .setDescription(`Olá ${entrant}, você não pode entrar nessa call, pois uma pessoa tem restrição contra você.${supportMention}`)
    .setColor(0xfacc15)
    .setTimestamp();
  
  const msg = await textChannel.send({ embeds: [embed] }).catch((err) => {
    console.warn('[voiceRestrictions] Erro ao enviar embed:', err?.message || err);
    return null;
  });
  
  if (msg) {
    console.log('[voiceRestrictions] Embed enviado com sucesso:', msg.id);
    setTimeout(() => msg.delete().catch(() => {}), 20000);
  }
}

async function sendPunishmentNotification(voiceChannel, entrant, punishmentMinutes) {
  const textChannel = pickTextChannelForVoice(voiceChannel);
  
  if (!textChannel) {
    console.warn('[voiceRestrictions] Nenhum canal para enviar notificação de castigo');
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🚫 Usuário Castigado')
    .setDescription(`${entrant} foi castigado por **${punishmentMinutes} minuto(s)** por insistir em entrar na call com restrição.`)
    .addFields(
      { name: 'Motivo', value: 'Desobedecendo a restrição imposta', inline: false },
      { name: 'Duração', value: `${punishmentMinutes} minuto(s)`, inline: true }
    )
    .setColor(0xe74c3c)
    .setTimestamp();
  
  const msg = await textChannel.send({ embeds: [embed] }).catch((err) => {
    console.warn('[voiceRestrictions] Erro ao enviar embed de castigo:', err?.message || err);
    return null;
  });
  
  if (msg) {
    console.log('[voiceRestrictions] Embed de castigo enviado:', msg.id);
    setTimeout(() => msg.delete().catch(() => {}), 30000); // 30s para castigo
  }
}

function trackAttempt(userId, cfg) {
  const now = Date.now();
  const windowMs = (cfg.antiSpam?.windowSeconds || 60) * 1000;
  const maxAttempts = cfg.antiSpam?.maxAttempts || 3;
  
  let record = attemptTracker.get(userId);
  
  if (!record || (now - record.firstAttempt) > windowMs) {
    // Nova janela - primeira tentativa
    record = { attempts: 1, firstAttempt: now, lastNotification: now };
    attemptTracker.set(userId, record);
    return { shouldNotify: true, shouldPunish: false, attempts: 1 };
  }
  
  // Incrementa tentativas
  record.attempts += 1;
  
  // NUNCA notifica em tentativas subsequentes (só na primeira)
  const shouldNotify = false;
  
  attemptTracker.set(userId, record);
  
  const shouldPunish = record.attempts >= maxAttempts;
  
  return { shouldNotify, shouldPunish, attempts: record.attempts };
}

async function applyPunishment(guild, member, cfg, prisma) {
  const punishmentMinutes = cfg.antiSpam?.punishmentMinutes || 5;
  const reason = 'Desobedecendo a restrição imposta';
  
  try {
    await runCastigo({
      guild,
      moderatorMember: guild.members.me,
      targetMember: member,
      reason,
      durationInput: `${punishmentMinutes}m`,
      prisma,
      posseId: null,
      commandChannelId: null,
    });
    console.log(`[voiceRestrictions] Castigo aplicado em ${member.id} por ${punishmentMinutes}m`);
  } catch (err) {
    console.warn('[voiceRestrictions] Erro ao aplicar castigo:', err?.message || err);
  }
}

function register(client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      if (newState.member?.user?.bot) return;
      if (oldState.channelId === newState.channelId) return;
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const prisma = client.prisma || getPrisma();
      const cfg = await getVoiceRestrictionsConfig(prisma);

      if (!cfg?.enabled) return;

      const channel = newState.channel;
      if (!channel) return; // saiu da call
      
      const hasSelections = (cfg.monitoredChannels?.length > 0) || (cfg.monitoredCategories?.length > 0);
      const monitored = hasSelections
        ? ((cfg.monitoredChannels || []).includes(channel.id) || (cfg.monitoredCategories || []).includes(channel.parentId))
        : true; // Se vazio, monitora tudo
      
      if (!monitored) return;

      const entrant = newState.member;
      if (!entrant) return;
      const occupants = channel.members?.filter((m) => m.id !== entrant.id) || [];
      
      if (!occupants.size) return;

      const match = occupants.find((m) => isRestrictedPair(cfg, entrant.id, m.id));
      
      if (!match) return;

      console.log('[voiceRestrictions] Par restrito detectado:', entrant.id, 'com', match.id);

      // Rastrear tentativa e decidir ações
      const { shouldNotify, shouldPunish, attempts } = trackAttempt(entrant.id, cfg);
      
      console.log(`[voiceRestrictions] Tentativa ${attempts}/${cfg.antiSpam?.maxAttempts || 3}`);

      // Desconectar sempre
      await entrant.voice?.disconnect?.().catch(() => {});
      
      // Notificar usuário se não for spam
      if (shouldNotify) {
        await sendUserNotification(channel, cfg.supportChannelId, entrant);
      }
      
      // Log de ação
      const pairReason = (cfg.restrictions || []).find((r) => !r.removedAt && ((r.a === entrant.id && r.b === match.id) || (r.a === match.id && r.b === entrant.id)))?.reason;
      await sendActionLog(guild, cfg.actionLogChannelId, { entrant, occupant: match, channel, reason: pairReason });
      
      // Aplicar castigo se ultrapassou limite
      if (shouldPunish) {
        console.log('[voiceRestrictions] Limite excedido! Aplicando castigo...');
        const punishmentMinutes = cfg.antiSpam?.punishmentMinutes || 5;
        await applyPunishment(guild, entrant, cfg, prisma);
        await sendPunishmentNotification(channel, entrant, punishmentMinutes);
        // Limpar registro após punir
        attemptTracker.delete(entrant.id);
      }
    } catch (err) {
      console.warn('[voiceRestrictions] erro no voiceStateUpdate', err?.message || err);
    }
  });
}

module.exports = { register };
