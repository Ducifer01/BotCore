const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const MUTE_COMMANDS = {
  MUTE_CALL: 'MUTE_CALL',
  UNMUTE_CALL: 'UNMUTE_CALL',
  MUTE_CHAT: 'MUTE_CHAT',
  UNMUTE_CHAT: 'UNMUTE_CHAT',
};

const DEFAULT_REASON = 'Motivo não especificado';

const DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 3600,
};

function parseDurationToken(input) {
  if (!input) return null;
  const match = String(input).trim().toLowerCase().match(/^(\d+)(s|m|h)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const multiplier = DURATION_UNITS[match[2]];
  if (!value || !multiplier) return null;
  return value * multiplier;
}

function formatDuration(seconds) {
  if (!seconds) return 'indefinido';
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hora${hours > 1 ? 's' : ''}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minuto${minutes > 1 ? 's' : ''}`;
  }
  return `${seconds} segundo${seconds > 1 ? 's' : ''}`;
}

function memberHasMutePermission(member, config, commandType, posseId) {
  if (!member) return false;
  if (posseId && member.id === posseId) return true;
  const allowedRoles = (config?.mutePermissions || [])
    .filter((perm) => perm.commandType === commandType)
    .map((perm) => perm.roleId);
  if (!allowedRoles.length) {
    return Boolean(
      member.permissions?.has(PermissionFlagsBits.Administrator)
      || member.permissions?.has(PermissionFlagsBits.MuteMembers)
      || member.permissions?.has(PermissionFlagsBits.ModerateMembers),
    );
  }
  return member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

function sanitizeReason(input) {
  const value = String(input || '').trim();
  return value.length ? value.slice(0, 1024) : DEFAULT_REASON;
}

function buildMuteLogEmbed({ scope, action, targetUser, moderatorUser, reason, durationSeconds, guild }) {
  const embed = new EmbedBuilder();
  const isVoice = scope === 'voice';
  const applying = action === 'apply';
  embed
    .setTitle(`${isVoice ? 'Mute de Voz' : 'Mute de Chat'} ${applying ? 'aplicado' : 'removido'}`)
    .setColor(applying ? (isVoice ? 0xfaa61a : 0x57f287) : 0x5865f2)
    .setTimestamp(new Date());

  if (targetUser && typeof targetUser.displayAvatarURL === 'function') {
    const thumb = targetUser.displayAvatarURL({ size: 256 });
    if (thumb) embed.setThumbnail(thumb);
  }

  const fields = [
    { name: 'Membro', value: formatUserField(targetUser), inline: true },
    { name: 'Moderador', value: formatUserField(moderatorUser, 'Sistema'), inline: true },
  ];
  if (applying && durationSeconds) {
    const expirationValue = buildDiscordTimestampValue(durationSeconds);
    if (expirationValue) {
      fields.push({ name: 'Tempo', value: formatDuration(durationSeconds), inline: false });
      fields.push({ name: 'Expira em', value: expirationValue, inline: true });
    }
  }
  fields.push({ name: 'Motivo', value: '```' + (reason || DEFAULT_REASON) + '```', inline: false });
  embed.addFields(fields);
  if (guild?.name) {
    embed.setFooter({ text: guild.name });
  }
  return embed;
}

function buildMuteExpirationEmbed({ scope, targetUser, reason, guild }) {
  const embed = new EmbedBuilder();
  const isVoice = scope === 'voice';
  embed
    .setTitle(`${isVoice ? 'Mute de Voz' : 'Mute de Chat'} expirado`)
    .setColor(0x57f287)
    .setTimestamp(new Date());

  const fields = [
    { name: 'Membro', value: formatUserField(targetUser), inline: true },
    { name: 'Motivo original', value: '```' + (reason || DEFAULT_REASON) + '```' },
  ];

  embed.addFields(fields);
  if (guild?.name) {
    embed.setFooter({ text: guild.name });
  }
  return embed;
}

function formatUserField(user, fallback = 'Desconhecido') {
  if (!user) return fallback;
  const base = user.tag || `${user.username || fallback}${user.discriminator ? `#${user.discriminator}` : ''}`;
  const mention = user.id ? `<@${user.id}>` : base;
  const idLine = user.id ? `ID: \`${user.id}\`` : 'ID: `N/A`';
  return `${mention}\n${idLine}`;
}

function buildDiscordTimestampValue(durationSeconds) {
  if (!durationSeconds || Number.isNaN(durationSeconds)) return null;
  const expiresAtSeconds = Math.floor((Date.now() + durationSeconds * 1000) / 1000);
  if (!Number.isFinite(expiresAtSeconds)) return null;
  return `<t:${expiresAtSeconds}:R>`;
}

module.exports = {
  MUTE_COMMANDS,
  DEFAULT_REASON,
  parseDurationToken,
  formatDuration,
  memberHasMutePermission,
  sanitizeReason,
  buildMuteLogEmbed,
  buildMuteExpirationEmbed,
};
