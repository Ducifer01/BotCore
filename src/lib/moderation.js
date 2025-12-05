const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureModerationConfig } = require('../services/moderationConfig');

const COMMAND_TYPES = {
  BAN: 'BAN',
  CASTIGO: 'CASTIGO',
};

const COLORS = {
  BAN: 0xED4245,
  UNBAN: 0x57F287,
  CASTIGO: 0xFEE75C,
  CASTIGO_REMOVE: 0x5865F2,
};

const BAN_TITLES = {
  BAN: 'Banimento',
  UNBAN: 'Banimento removido',
};

const CASTIGO_TITLES = {
  APPLY: 'Castigo aplicado',
  REMOVE: 'Castigo removido',
};

const DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

function parseDuration(input) {
  if (!input) return null;
  const match = String(input).trim().toLowerCase().match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = DURATION_UNITS[match[2]];
  if (!value || !unit) return null;
  return value * unit;
}

function formatDuration(seconds) {
  if (!seconds) return 'não informado';
  const units = [
    { label: 'semana', value: 604800 },
    { label: 'dia', value: 86400 },
    { label: 'hora', value: 3600 },
    { label: 'minuto', value: 60 },
    { label: 'segundo', value: 1 },
  ];
  for (const unit of units) {
    if (seconds % unit.value === 0) {
      const amount = seconds / unit.value;
      return `${amount} ${unit.label}${amount > 1 ? 's' : ''}`;
    }
  }
  return `${seconds} segundos`;
}

function getPermissionsByType(config, type) {
  return (config.permissions || [])
    .filter((perm) => perm.commandType === type)
    .map((perm) => perm.roleId);
}

function memberHasPermission(member, config, type, posseId) {
  if (posseId && member.id === posseId) return true;
  const allowedRoles = getPermissionsByType(config, type);
  if (allowedRoles.length === 0) {
    return member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.BanMembers) || false;
  }
  return member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

function checkHierarchy(actorMember, targetMember, botMember) {
  if (!targetMember) return { ok: true };
  if (actorMember.id === targetMember.id) {
    return { ok: false, message: 'Você não pode executar esse comando em si mesmo.' };
  }
  const actorRole = actorMember.roles?.highest;
  const targetRole = targetMember.roles?.highest;
  if (actorRole && targetRole && actorRole.position <= targetRole.position) {
    return { ok: false, message: 'Você só pode agir em membros com cargo abaixo do seu.' };
  }
  if (botMember) {
    const botHighest = botMember.roles?.highest;
    if (botHighest && targetRole && botHighest.position <= targetRole.position) {
      return { ok: false, message: 'Meu maior cargo está abaixo do alvo. Ajuste a hierarquia.' };
    }
  }
  return { ok: true };
}

function formatUserValue(user, fallbackLabel = 'Desconhecido') {
  if (!user) {
    return `${fallbackLabel}\nID: \`N/A\``;
  }
  const tag = user.tag || `${user.username || fallbackLabel}${user.discriminator ? `#${user.discriminator}` : ''}`;
  const mention = user.id ? `<@${user.id}>` : tag;
  return [`${mention} (${tag})`, `ID: \`${user.id || 'N/A'}\``].join('\n');
}

function getAvatarUrl(user) {
  if (!user) return null;
  if (typeof user.displayAvatarURL === 'function') {
    return user.displayAvatarURL({ size: 256, extension: 'png' });
  }
  if (user.avatar && user.id) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }
  return null;
}

function buildLogEmbed({ type, action, targetUser, moderatorUser, reason, guild, durationSeconds }) {
  const embed = new EmbedBuilder();
  if (type === COMMAND_TYPES.BAN) {
    embed.setTitle(action === 'UNBAN' ? BAN_TITLES.UNBAN : BAN_TITLES.BAN);
    embed.setColor(action === 'UNBAN' ? COLORS.UNBAN : COLORS.BAN);
  } else {
    const isRemoval = action === 'REMOVE';
    embed.setTitle(isRemoval ? CASTIGO_TITLES.REMOVE : CASTIGO_TITLES.APPLY);
    embed.setColor(isRemoval ? COLORS.CASTIGO_REMOVE : COLORS.CASTIGO);
    if (!isRemoval && durationSeconds) {
      embed.addFields({ name: 'Duração', value: formatDuration(durationSeconds), inline: true });
    }
  }
  const thumbnailUrl = getAvatarUrl(targetUser);
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }
  embed.addFields(
    { name: 'Membro', value: formatUserValue(targetUser), inline: true },
    { name: 'Moderador', value: formatUserValue(moderatorUser, 'Desconhecido'), inline: true },
    { name: 'Motivo', value: `\`\`\`${reason || 'Não informado'}\`\`\`` },
  );
  embed.setFooter({ text: guild.name });
  embed.setTimestamp(new Date());
  return embed;
}

function getDmSettings(config, type) {
  if (type === COMMAND_TYPES.BAN) {
    return {
      enabled: Boolean(config.banDmEnabled),
      message: config.banDmMessage,
      contactId: config.banDmContactId,
    };
  }
  return {
    enabled: Boolean(config.castigoDmEnabled),
    message: config.castigoDmMessage,
    contactId: config.castigoDmContactId,
  };
}

async function sendDmIfConfigured(user, embed, config, type) {
  const settings = getDmSettings(config, type);
  if (!settings.enabled) return false;
  try {
    const contentParts = [];
    if (settings.message) contentParts.push(settings.message);
    if (settings.contactId) contentParts.push(`Contato: <@${settings.contactId}>`);
    await user.send({ content: contentParts.join('\n') || undefined, embeds: [embed] });
    return true;
  } catch (err) {
    console.warn('[moderation] Falha ao enviar DM:', err?.message || err);
    return false;
  }
}

async function sendLogMessage(guild, channelId, embed) {
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || (typeof channel.isTextBased === 'function' && !channel.isTextBased())) return false;
  await channel.send({ embeds: [embed] });
  return true;
}

module.exports = {
  COMMAND_TYPES,
  parseDuration,
  formatDuration,
  ensureModerationConfig,
  memberHasPermission,
  checkHierarchy,
  buildLogEmbed,
  sendDmIfConfigured,
  sendLogMessage,
};
