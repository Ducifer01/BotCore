const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');

const DEFAULT_REASON = 'Palavra Proibida';
const WORD_UPLOAD_TIMEOUT = 5 * 60 * 1000;
const wordUploadSessions = new Map();

const DURATION_CHOICES = [
  { label: '60 segundos', value: '60', seconds: 60 },
  { label: '5 minutos', value: '300', seconds: 5 * 60 },
  { label: '10 minutos', value: '600', seconds: 10 * 60 },
  { label: '1 hora', value: '3600', seconds: 60 * 60 },
  { label: '1 dia', value: '86400', seconds: 24 * 60 * 60 },
  { label: '1 semana', value: '604800', seconds: 7 * 24 * 60 * 60 },
];

const PUNISHMENT = {
  DELETE: 'DELETE',
  PUNISH_DELETE: 'PUNISH_DELETE',
};

let cachedAutoMod = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 1000;

function getPrismaFromCtx(ctx) {
  return ctx?.getPrisma ? ctx.getPrisma() : getPrisma();
}

function invalidateCache() {
  cachedAutoMod = null;
  cachedAt = 0;
}

async function ensureAutoModState(prisma) {
  const globalConfig = await ensureGlobalConfig(prisma);
  let autoConfig = await prisma.autoModConfig.findUnique({
    where: { globalConfigId: globalConfig.id },
    include: { blockedWords: true },
  });
  if (!autoConfig) {
    await prisma.autoModConfig.create({ data: { globalConfigId: globalConfig.id } });
    autoConfig = await prisma.autoModConfig.findUnique({
      where: { globalConfigId: globalConfig.id },
      include: { blockedWords: true },
    });
  }
  return { globalConfig, autoConfig };
}

async function fetchAutoModRuntime(prisma) {
  const now = Date.now();
  if (cachedAutoMod && (now - cachedAt) < CACHE_TTL) {
    return cachedAutoMod;
  }
  const { autoConfig } = await ensureAutoModState(prisma);
  cachedAutoMod = {
    punishmentType: autoConfig.punishmentType,
    punishmentDurationSeconds: autoConfig.punishmentDurationSeconds,
    reason: autoConfig.reason || DEFAULT_REASON,
    words: (autoConfig.blockedWords || []).map((w) => w.word.toLowerCase()),
  };
  cachedAt = now;
  return cachedAutoMod;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'Não configurado';
  const units = [
    { label: 'semana', value: 7 * 24 * 3600 },
    { label: 'dia', value: 24 * 3600 },
    { label: 'hora', value: 3600 },
    { label: 'minuto', value: 60 },
  ];
  for (const unit of units) {
    if (seconds % unit.value === 0) {
      const amount = seconds / unit.value;
      return `${amount} ${unit.label}${amount > 1 ? 's' : ''}`;
    }
  }
  return `${seconds} segundos`;
}

function buildRootEmbed(autoConfig) {
  const words = autoConfig.blockedWords || [];
  const preview = words.length
    ? words.slice(0, 10).map((w) => w.word).join(', ')
    : 'Nenhuma palavra cadastrada ainda.';
  const punishmentText = autoConfig.punishmentType === PUNISHMENT.PUNISH_DELETE
    ? `Castigar e apagar (tempo: ${formatDuration(autoConfig.punishmentDurationSeconds || 60)})`
    : 'Apagar mensagem';
  return new EmbedBuilder()
    .setTitle('AutoMod')
    .setDescription('Gerencie palavras proibidas e o tipo de punição aplicada automaticamente.')
    .addFields(
      { name: 'Palavras monitoradas', value: `Total: **${words.length}**\n${preview}`, inline: false },
      { name: 'Punição atual', value: punishmentText, inline: false },
      { name: 'Motivo padrão', value: autoConfig.reason || DEFAULT_REASON, inline: false },
    )
    .setColor(0xED4245);
}

function buildWordsEmbed(autoConfig) {
  const words = autoConfig.blockedWords || [];
  const value = words.length
    ? words.slice(0, 20).map((w, idx) => `${idx + 1}. ${w.word}`).join('\n')
    : 'Nenhuma palavra cadastrada. Use "Inserir palavras" para adicionar mais itens via arquivo .txt.';
  return new EmbedBuilder()
    .setTitle('Palavras Bloqueadas')
    .setDescription('Usuários com qualquer palavra listada na mensagem terão a punição aplicada.')
    .addFields({ name: 'Lista monitorada', value })
    .setColor(0xED4245);
}

function buildPunishEmbed(autoConfig) {
  const desc = autoConfig.punishmentType === PUNISHMENT.PUNISH_DELETE
    ? 'Atualmente o bot **apaga** a mensagem e aplica timeout.'
    : 'Atualmente o bot **apenas apaga** a mensagem.';
  return new EmbedBuilder()
    .setTitle('Tipo de Punição')
    .setDescription(`${desc}\nMotivo padrão: **${autoConfig.reason || DEFAULT_REASON}**`)
    .addFields({
      name: 'Tempo configurado',
      value: formatDuration(autoConfig.punishmentDurationSeconds || 60),
    })
    .setColor(0xED4245);
}

function buildPunishDetailEmbed(autoConfig) {
  return new EmbedBuilder()
    .setTitle('Castigar e apagar')
    .setDescription('O bot apagará a mensagem e aplicará timeout automático.')
    .addFields({
      name: 'Tempo atual',
      value: formatDuration(autoConfig.punishmentDurationSeconds || 60),
    })
    .setColor(0xED4245);
}

function buildDurationSelect() {
  return new StringSelectMenuBuilder()
    .setCustomId('automod:punish:duration')
    .setPlaceholder('Selecione um tempo de castigo')
    .addOptions(DURATION_CHOICES.map((choice) => ({ label: choice.label, value: choice.value })));
}

function rootComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:words').setLabel('Palavras Bloqueadas').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('automod:punish').setLabel('Tipo Punição').setStyle(ButtonStyle.Danger),
  )];
}

function wordsComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:back:root').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:words:insert').setLabel('Inserir palavras').setStyle(ButtonStyle.Success),
  )];
}

function punishComponents(autoConfig) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:back:root').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('automod:punish:mode:delete')
      .setLabel('Apagar')
      .setStyle(ButtonStyle.Success)
      .setDisabled(autoConfig.punishmentType === PUNISHMENT.DELETE),
    new ButtonBuilder()
      .setCustomId('automod:punish:mode:punish')
      .setLabel('Castigar e apagar')
      .setStyle(ButtonStyle.Danger),
  )];
}

function punishDetailComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('automod:punish:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('automod:punish:detail:time').setLabel('Definir tempo').setStyle(ButtonStyle.Primary),
  )];
}

function durationSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod:punish:detail:return').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(buildDurationSelect()),
  ];
}

async function presentMenu(interaction, ctx) {
  const prisma = getPrismaFromCtx(ctx);
  const { autoConfig } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildRootEmbed(autoConfig)], components: rootComponents() });
  return true;
}

async function handleInteraction(interaction, ctx) {
  const customId = interaction.customId;
  if (!customId.startsWith('automod')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode usar esta seção.', ephemeral: true });
    return true;
  }
  const prisma = getPrismaFromCtx(ctx);
  if (interaction.isStringSelectMenu() && customId === 'automod:punish:duration') {
    return saveDuration(interaction, prisma);
  }
  switch (customId) {
    case 'automod:words':
      return showWords(interaction, prisma);
    case 'automod:punish':
      return showPunish(interaction, prisma);
    case 'automod:back:root':
      return showRoot(interaction, prisma);
    case 'automod:words:insert':
      return startWordUpload(interaction);
    case 'automod:punish:mode:delete':
      return setPunishmentMode(interaction, prisma, PUNISHMENT.DELETE);
    case 'automod:punish:mode:punish':
      return setPunishmentMode(interaction, prisma, PUNISHMENT.PUNISH_DELETE);
    case 'automod:punish:back':
      return showPunish(interaction, prisma);
    case 'automod:punish:detail:time':
      return showDurationSelect(interaction, prisma);
    case 'automod:punish:detail:return':
      return showPunishDetail(interaction, prisma, { silent: true });
    default:
      return false;
  }
}

async function showRoot(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildRootEmbed(autoConfig)], components: rootComponents() });
  return true;
}

async function showWords(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildWordsEmbed(autoConfig)], components: wordsComponents() });
  return true;
}

async function startWordUpload(interaction) {
  const existing = wordUploadSessions.get(interaction.user.id);
  if (existing) {
    await interaction.reply({ content: 'Você já possui uma importação em andamento. Envie o arquivo ou digite cancelar.', ephemeral: true });
    return true;
  }
  const embed = new EmbedBuilder()
    .setTitle('Enviar palavras proibidas')
    .setDescription('Envie um arquivo `.txt` neste canal contendo palavras separadas por vírgula.\nExemplo: `palavra1, palavra2, palavra3`.\nEnvie **cancelar** para abortar.')
    .setColor(0xFEE75C);
  await interaction.reply({ embeds: [embed], ephemeral: true });
  const timeout = setTimeout(() => wordUploadSessions.delete(interaction.user.id), WORD_UPLOAD_TIMEOUT);
  wordUploadSessions.set(interaction.user.id, { channelId: interaction.channelId, timeout });
  return true;
}

async function showPunish(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildPunishEmbed(autoConfig)], components: punishComponents(autoConfig) });
  return true;
}

async function showPunishDetail(interaction, prisma, { silent = false } = {}) {
  const { autoConfig } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildPunishDetailEmbed(autoConfig)], components: punishDetailComponents() });
  if (!silent) {
    await interaction.followUp({ content: 'Castigar e apagar ativado.', ephemeral: true }).catch(() => {});
  }
  return true;
}

async function showDurationSelect(interaction, prisma) {
  const { autoConfig } = await ensureAutoModState(prisma);
  const embed = new EmbedBuilder()
    .setTitle('Definir tempo de castigo')
    .setDescription('Escolha o tempo de timeout aplicado junto com a exclusão da mensagem.')
    .addFields({ name: 'Tempo atual', value: formatDuration(autoConfig.punishmentDurationSeconds || 60) })
    .setColor(0x5865F2);
  await interaction.update({ embeds: [embed], components: durationSelectComponents() });
  return true;
}

async function setPunishmentMode(interaction, prisma, mode) {
  const { autoConfig } = await ensureAutoModState(prisma);
  if (mode === PUNISHMENT.DELETE) {
    if (autoConfig.punishmentType === PUNISHMENT.DELETE) {
      await interaction.reply({ content: 'Apagar já está ativado.', ephemeral: true });
      return true;
    }
    await prisma.autoModConfig.update({
      where: { id: autoConfig.id },
      data: { punishmentType: PUNISHMENT.DELETE, punishmentDurationSeconds: null },
    });
    invalidateCache();
    await showPunish(interaction, prisma);
    await interaction.followUp({ content: 'Apagar ativado.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (autoConfig.punishmentType !== PUNISHMENT.PUNISH_DELETE) {
    await prisma.autoModConfig.update({
      where: { id: autoConfig.id },
      data: { punishmentType: PUNISHMENT.PUNISH_DELETE, punishmentDurationSeconds: autoConfig.punishmentDurationSeconds || 60 },
    });
    invalidateCache();
  }
  return showPunishDetail(interaction, prisma);
}

async function saveDuration(interaction, prisma) {
  const seconds = Number(interaction.values?.[0]);
  if (!seconds || Number.isNaN(seconds)) {
    await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
    return true;
  }
  const { autoConfig } = await ensureAutoModState(prisma);
  await prisma.autoModConfig.update({
    where: { id: autoConfig.id },
    data: { punishmentType: PUNISHMENT.PUNISH_DELETE, punishmentDurationSeconds: seconds },
  });
  invalidateCache();
  const { autoConfig: refreshed } = await ensureAutoModState(prisma);
  await interaction.update({ embeds: [buildPunishDetailEmbed(refreshed)], components: punishDetailComponents() });
  await interaction.followUp({ content: `Tempo definido para ${formatDuration(seconds)}.`, ephemeral: true }).catch(() => {});
  return true;
}

async function handleWordFile(message, ctx) {
  const attachment = message.attachments.find((att) => att.name && att.name.toLowerCase().endsWith('.txt'));
  if (!attachment) {
    await respondAndDelete(message, 'Envie um arquivo .txt válido ou digite cancelar.');
    return true;
  }
  let text;
  try {
    const res = await fetch(attachment.url);
    text = await res.text();
  } catch (err) {
    console.error('[automod] Falha ao baixar arquivo:', err?.message || err);
    await respondAndDelete(message, 'Não consegui ler o arquivo. Tente novamente.');
    return true;
  }
  const words = text
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) {
    await respondAndDelete(message, 'Nenhuma palavra válida encontrada no arquivo.');
    return true;
  }
  const prisma = getPrismaFromCtx(ctx);
  const { autoConfig } = await ensureAutoModState(prisma);
  const existingWords = new Set((autoConfig.blockedWords || []).map((w) => w.word));
  const uniqueWords = Array.from(new Set(words)).filter((word) => !existingWords.has(word));
  if (!uniqueWords.length) {
    await respondAndDelete(message, 'Nenhuma nova palavra para cadastrar.');
    clearWordSession(message.author.id);
    return true;
  }
  await prisma.autoModBlockedWord.createMany({
    data: uniqueWords.map((word) => ({ autoModConfigId: autoConfig.id, word })),
  });
  invalidateCache();
  clearWordSession(message.author.id);
  await respondAndDelete(message, `Importei ${uniqueWords.length} palavra(s).`, { mention: true });
  return true;
}

function clearWordSession(userId) {
  const session = wordUploadSessions.get(userId);
  if (session?.timeout) {
    clearTimeout(session.timeout);
  }
  wordUploadSessions.delete(userId);
}

async function respondAndDelete(message, content, { mention = false } = {}) {
  try {
    const reply = await message.reply({
      content: mention ? `<@${message.author.id}> ${content}` : content,
      allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
    });
    setTimeout(() => reply.delete().catch(() => {}), 8000);
  } catch {}
}

async function handleMessage(message, ctx) {
  if (message.author.bot) return false;
  const pending = wordUploadSessions.get(message.author.id);
  if (pending && pending.channelId === message.channelId) {
    const content = (message.content || '').trim().toLowerCase();
    if (content === 'cancelar') {
      clearWordSession(message.author.id);
      await respondAndDelete(message, 'Operação cancelada.', { mention: true });
      return true;
    }
    return handleWordFile(message, ctx);
  }
  if (!message.guild || !ctx.isGuildAllowed(message.guildId)) return false;
  const prisma = getPrismaFromCtx(ctx);
  const runtime = await fetchAutoModRuntime(prisma);
  if (!runtime.words.length) return false;
  const content = (message.content || '').toLowerCase();
  if (!content) return false;
  const matched = runtime.words.find((word) => word && content.includes(word));
  if (!matched) return false;
  const reason = runtime.reason || DEFAULT_REASON;
  try {
    await message.delete().catch(() => {});
  } catch {}
  if (runtime.punishmentType === PUNISHMENT.PUNISH_DELETE && runtime.punishmentDurationSeconds) {
    try {
      await message.member?.timeout(runtime.punishmentDurationSeconds * 1000, reason);
    } catch (err) {
      console.error('[automod] Falha ao aplicar timeout:', err?.message || err);
    }
  }
  try {
    const warn = await message.channel.send({
      content: `<@${message.author.id}>, sua mensagem foi removida (${reason}).`,
      allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
    });
    setTimeout(() => warn.delete().catch(() => {}), 8000);
  } catch {}
  return true;
}

module.exports = {
  presentMenu,
  handleInteraction,
  handleMessage,
};
