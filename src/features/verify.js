const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, Routes, RESTJSONErrorCodes } = require('discord.js');
const { getPrisma } = require('../db');
const { getGlobalConfig } = require('../services/globalConfig');
const { markBotVerifiedRoleAction } = require('../services/verifiedRoleBypass');

const verifyThreads = new Map(); // threadId -> { targetUserId }
const pendingVerifyImage = new Map(); // `${threadId}:${verifierId}` -> { buffer, name }
const pendingVerifySex = new Map(); // `${threadId}:${targetUserId}` -> 'male' | 'female'
const pendingPreviewMessages = new Map(); // `${threadId}:${verifierId}` -> { embedMessageId, imageMessageId }

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPreviewKey(threadId, verifierId) {
  return `${threadId}:${verifierId}`;
}

async function deletePreviewMessage(thread, key) {
  const record = pendingPreviewMessages.get(key);
  if (!record || !thread) {
    pendingPreviewMessages.delete(key);
    return;
  }
  const messageIds = [];
  if (typeof record === 'string') {
    messageIds.push(record);
  } else if (record && typeof record === 'object') {
    if (record.embedMessageId) messageIds.push(record.embedMessageId);
    if (record.imageMessageId) messageIds.push(record.imageMessageId);
  }
  try {
    for (const id of messageIds) {
      if (!id) continue;
      const existing = await thread.messages.fetch(id).catch(() => null);
      if (existing) {
        await existing.delete().catch(() => {});
      }
    }
  } finally {
    pendingPreviewMessages.delete(key);
  }
}

async function publishPreviewMessage(thread, key, payload) {
  if (!thread) return null;
  await deletePreviewMessage(thread, key);
  const { embeds = [], components = [], files = [] } = payload || {};
  const embedMessage = await thread.send({ embeds, components });
  let imageMessage = null;
  if (files.length) {
    imageMessage = await thread.send({ files, allowedMentions: { parse: [] } });
  }
  pendingPreviewMessages.set(key, {
    embedMessageId: embedMessage.id,
    imageMessageId: imageMessage?.id || null,
  });
  return embedMessage;
}

function cloneDisabledComponents(rows = []) {
  return rows.map((row) => {
    const actionRow = new ActionRowBuilder();
    for (const component of row.components) {
      actionRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
    }
    return actionRow;
  });
}

function buildVerifyThreadName(user) {
  const safeUsername = user.username.replace(/[^\w\- ]/g, '').trim() || 'usuario';
  return `verif-${user.id}-${safeUsername}`.slice(0, 90);
}

function threadBelongsToUser(thread, userId) {
  if (!thread?.name) return false;
  return thread.name.startsWith(`verif-${userId}`);
}

function cacheThreadTargetUser(threadId, userId) {
  if (!threadId || !userId || userId === 'unknown') return null;
  const existing = verifyThreads.get(threadId);
  if (!existing || existing.targetUserId !== userId) {
    verifyThreads.set(threadId, { targetUserId: userId });
  }
  return userId;
}

function extractUserIdFromThreadName(name) {
  if (!name) return null;
  const match = /^verif-(\d{5,25})/i.exec(name);
  return match?.[1] || null;
}

async function resolveThreadTargetUserId(threadId, fallbackUserId, guild) {
  const cached = verifyThreads.get(threadId)?.targetUserId;
  if (cached) return cached;
  if (fallbackUserId && fallbackUserId !== 'unknown') {
    return cacheThreadTargetUser(threadId, fallbackUserId);
  }
  if (guild) {
    const thread = await guild.channels.fetch(threadId).catch(() => null);
    const derived = extractUserIdFromThreadName(thread?.name);
    if (derived) {
      return cacheThreadTargetUser(threadId, derived);
    }
  }
  return null;
}

async function fetchMemberSafe(guild, userId) {
  if (!guild || !userId) return null;
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (err?.code !== RESTJSONErrorCodes.UnknownMember) {
      console.debug('[verify] fetchMemberSafe falhou:', err?.message || err);
    }
    return null;
  }
}

async function applyVerifiedRole(guild, roleId, userId, reason) {
  if (!guild || !roleId || !userId) {
    return { ok: false, error: 'missing_params' };
  }
  const member = await fetchMemberSafe(guild, userId);
  const markAction = () => markBotVerifiedRoleAction(guild.id, userId);
  if (member) {
    if (member.roles.cache.has(roleId)) {
      return { ok: true, already: true };
    }
    markAction();
    await member.roles.add(roleId, reason);
    return { ok: true };
  }
  const rest = guild?.client?.rest;
  if (!rest) {
    return { ok: false, error: 'no_rest_client' };
  }
  try {
    markAction();
    await rest.put(
      Routes.guildMemberRole(guild.id, userId, roleId),
      { body: {}, reason },
    );
    return { ok: true, viaRest: true };
  } catch (err) {
    if (err?.code === RESTJSONErrorCodes.UnknownMember) {
      return { ok: false, error: 'unknown_member' };
    }
    console.error('[verify] Falha ao aplicar cargo (REST):', err?.message || err);
    return { ok: false, error: 'rest_failed' };
  }
}

async function removeVerifiedRole(guild, roleId, userId, reason) {
  if (!guild || !roleId || !userId) {
    return { ok: false, error: 'missing_params' };
  }
  const member = await fetchMemberSafe(guild, userId);
  if (member) {
    if (!member.roles.cache.has(roleId)) {
      return { ok: true, alreadyMissing: true };
    }
    await member.roles.remove(roleId, reason);
    return { ok: true };
  }
  const rest = guild?.client?.rest;
  if (!rest) {
    return { ok: false, error: 'no_rest_client' };
  }
  try {
    await rest.delete(
      Routes.guildMemberRole(guild.id, userId, roleId),
      { reason },
    );
    return { ok: true, viaRest: true };
  } catch (err) {
    if (err?.code === RESTJSONErrorCodes.UnknownMember) {
      return { ok: false, error: 'unknown_member' };
    }
    console.error('[verify] Falha ao remover cargo (REST):', err?.message || err);
    return { ok: false, error: 'rest_failed' };
  }
}

function buildSexButtons(threadId, targetUserId, selected) {
  const maleBtn = new ButtonBuilder()
    .setCustomId(`verify:sex:male:${threadId}:${targetUserId}`)
    .setLabel('Sexo Masculino')
    .setStyle(selected === 'male' ? ButtonStyle.Success : ButtonStyle.Secondary);
  const femaleBtn = new ButtonBuilder()
    .setCustomId(`verify:sex:female:${threadId}:${targetUserId}`)
    .setLabel('Sexo Feminino')
    .setStyle(selected === 'female' ? ButtonStyle.Success : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(maleBtn, femaleBtn);
}

function buildConfirmRow(threadId, targetUserId, selected) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:confirm:${threadId}:${targetUserId}`)
      .setLabel('Perfeito')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!selected),
    new ButtonBuilder().setCustomId(`verify:update:${threadId}`).setLabel('Atualizar').setStyle(ButtonStyle.Primary),
  );
}

function buildPreviewEmbed(targetUserId, verifierId, selectedSex) {
  const sexLabel = selectedSex === 'male' ? 'Masculino'
    : selectedSex === 'female' ? 'Feminino'
      : 'Não definido';
  const color = selectedSex === 'male' ? 0x3498DB : selectedSex === 'female' ? 0xE91E63 : 0x2C2F33;
  const targetText = targetUserId && targetUserId !== 'unknown' ? `<@${targetUserId}>` : 'Desconhecido';
  const embed = new EmbedBuilder()
    .setTitle('Pré-visualização da Verificação')
    .setDescription([
      `• Usuário: ${targetText}`,
      `• Verificador: <@${verifierId}>`,
      `• Sexo selecionado: **${sexLabel}**`,
      '',
      'Selecione o sexo correto antes de concluir.',
      'A imagem enviada aparece logo abaixo desta prévia.',
    ].join('\n'))
    .setColor(color);
  return embed;
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;
  if (!customId.startsWith('verify:')) return false;
  const prisma = getPrisma();
  const cfg = await getGlobalConfig(prisma);
  if (!cfg?.mainRoleId) {
    await interaction.reply({ content: 'Sistema de verificação não configurado.', ephemeral: true });
    return true;
  }
  if (!interaction.member.roles.cache.has(cfg.mainRoleId)) {
    const isSelfGrant = customId.startsWith('verify:grantrole:');
    if (!isSelfGrant && customId !== 'verify:open') {
      await interaction.reply({ content: 'Apenas o cargo principal pode usar este botão.', ephemeral: true });
      return true;
    }
  }

  if (customId === 'verify:open') {
    return openThread(interaction, cfg, prisma);
  }
  if (customId.startsWith('verify:start:')) {
    return handleStart(interaction, cfg, prisma);
  }
  if (customId.startsWith('verify:sex:')) {
    return handleSexSelection(interaction, cfg);
  }
  if (customId.startsWith('verify:confirm:')) {
    return handleConfirm(interaction, cfg, prisma);
  }
  if (customId.startsWith('verify:update:')) {
    return handleUpdate(interaction, cfg);
  }
  if (customId.startsWith('verify:close:')) {
    return handleClose(interaction, cfg);
  }
  if (customId.startsWith('verify:grantrole:')) {
    return handleGrantRole(interaction, cfg);
  }
  if (customId.startsWith('verify:remove:')) {
    return handleRemoveVerificationButtons(interaction, cfg, prisma);
  }
  return false;
}

async function openThread(interaction, cfg, prisma) {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'Este botão deve ser usado em um canal de texto.', ephemeral: true });
    return true;
  }

  const alreadyVerified = await prisma.verifiedUserGlobal.findUnique({ where: { userId: interaction.user.id } }).catch(() => null);
  if (alreadyVerified) {
    let ensuredRole = false;
    if (cfg?.verifiedRoleId) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member && !member.roles.cache.has(cfg.verifiedRoleId)) {
        try {
          await member.roles.add(cfg.verifiedRoleId, 'Reaplicar cargo ao abrir painel verifique-se');
          ensuredRole = true;
        } catch (err) {
          console.warn('[verify] Falha ao reaplicar cargo automaticamente:', err?.message || err);
        }
      }
    }
    const components = [];
    if (cfg?.verifiedRoleId) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`verify:grantrole:${interaction.user.id}`)
          .setLabel('Cargo Verificado')
          .setStyle(ButtonStyle.Success),
      );
      components.push(row);
    }
    const baseMessage = ensuredRole
      ? 'Você já está verificado e o cargo foi reaplicado automaticamente.'
      : 'Nosso sistema indica que você já está verificado. Caso precise de ajuda, abra um ticket no canal de suporte.';
    await interaction.reply({
      content: baseMessage,
      components: components.length ? components : undefined,
      ephemeral: true,
    });
    return true;
  }
  try {
    const active = await channel.threads.fetchActive();
    let existing = null;
    for (const [, th] of active.threads) {
      const tracked = verifyThreads.get(th.id)?.targetUserId;
      if (tracked === interaction.user.id || threadBelongsToUser(th, interaction.user.id)) {
        existing = th;
        break;
      }
    }
    if (existing) {
      await interaction.reply({ content: `Você já possui um ticket aberto: <#${existing.id}>`, ephemeral: true });
      return true;
    }
  } catch {}

  const verifyThreadName = buildVerifyThreadName(interaction.user);
  const thread = await channel.threads.create({
    name: verifyThreadName,
    autoArchiveDuration: 1440,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  cacheThreadTargetUser(thread.id, interaction.user.id);
  const mentionRoles = cfg?.ticketPingRolesGlobal?.map((r) => `<@&${r.roleId}>`) || [];
  const mainRoleMention = cfg?.mainRoleId ? `<@&${cfg.mainRoleId}>` : null;
  const ping = [mainRoleMention, ...mentionRoles, `<@${interaction.user.id}>`].filter(Boolean).join(' ');
  const embed = new EmbedBuilder()
    .setTitle('Verificação')
    .setDescription('Aguarde um responsável pela verificação. Use os botões abaixo quando estiver atendendo.')
    .setColor(0x2ECC71);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`verify:start:${thread.id}:${interaction.user.id}`).setLabel('Verificar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`verify:close:${thread.id}`).setLabel('Encerrar').setStyle(ButtonStyle.Danger),
  );
  await thread.send({
    content: ping || undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      users: [interaction.user.id],
      roles: cfg?.ticketPingRoles?.map((r) => r.roleId) || (cfg?.mainRoleId ? [cfg.mainRoleId] : []),
      repliedUser: false,
    },
  });
  await interaction.reply({ content: `Seu tópico foi aberto: <#${thread.id}>`, ephemeral: true });
  return true;
}

async function handleStart(interaction, cfg, prisma) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode usar este botão.', ephemeral: true });
    return true;
  }
  const [, , threadId, targetUserId] = interaction.customId.split(':');
  cacheThreadTargetUser(threadId, targetUserId);
  const existingRecord = await prisma.verifiedUserGlobal.findUnique({ where: { userId: targetUserId } }).catch(() => null);
  if (existingRecord) {
    await interaction.reply({ content: 'Esse usuário já está verificado. Para remover, use o comando: !remover_verificado <id/menção>.', ephemeral: true });
    return true;
  }
  if (interaction.channelId !== threadId) {
    try {
      const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
      if (thread) await thread.send({ content: `<@${interaction.user.id}> iniciou verificação.` });
    } catch {}
  }
  await interaction.reply({ content: 'Envie uma imagem nesta conversa (tópico). Assim que você enviar, vou mostrar uma prévia e pedir confirmação.', ephemeral: true });
  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!thread) return true;
  const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
  const collector = thread.createMessageCollector({ filter, time: 5 * 60 * 1000, max: 1 });
  collector.on('collect', async (m) => {
    try {
      const att = m.attachments.first();
      const res = await fetch(att.url);
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      const imageName = att.name || 'imagem.png';
      pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: imageName });
      pendingVerifySex.delete(`${threadId}:${targetUserId}`);
      await m.delete().catch(() => {});
  const previewEmbed = buildPreviewEmbed(targetUserId, interaction.user.id, null);
      const components = [
        buildSexButtons(threadId, targetUserId, null),
        buildConfirmRow(threadId, targetUserId, null),
      ];
      const key = buildPreviewKey(threadId, interaction.user.id);
      const attachment = new AttachmentBuilder(buf, { name: imageName });
      await publishPreviewMessage(thread, key, {
        embeds: [previewEmbed],
        files: [attachment],
        components,
      });
    } catch (e) {
      await interaction.followUp({ content: 'Falha ao processar a imagem, tente novamente.', ephemeral: true });
    }
  });
  return true;
}

async function handleSexSelection(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode definir o sexo do usuário.', ephemeral: true });
    return true;
  }
  const [, , sex, threadId, targetUserId] = interaction.customId.split(':');
  if (!['male', 'female'].includes(sex)) {
    await interaction.reply({ content: 'Opção inválida.', ephemeral: true });
    return true;
  }
  const key = `${threadId}:${targetUserId}`;
  pendingVerifySex.set(key, sex);
  try {
    await interaction.deferUpdate().catch(() => {});
    const embed = buildPreviewEmbed(targetUserId, interaction.user.id, sex);
    const components = [
      buildSexButtons(threadId, targetUserId, sex),
      buildConfirmRow(threadId, targetUserId, sex),
    ];
    await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
  } catch {}
  return true;
}

async function handleConfirm(interaction, cfg, prisma) {
  await interaction.deferUpdate().catch(() => {});
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.followUp({ content: 'Apenas o cargo principal pode confirmar.', ephemeral: true });
    return true;
  }
  const [, , threadId, targetUserIdFromCustom] = interaction.customId.split(':');
  const targetUserId = await resolveThreadTargetUserId(threadId, targetUserIdFromCustom, interaction.guild);
  if (!targetUserId) {
    await interaction.followUp({ content: 'Não consegui identificar o usuário do ticket. Reabra o fluxo.', ephemeral: true });
    return true;
  }
  cacheThreadTargetUser(threadId, targetUserId);
  const key = `${threadId}:${interaction.user.id}`;
  const img = pendingVerifyImage.get(key);
  if (!img) {
    await interaction.followUp({ content: 'Nenhuma imagem em espera. Clique em Verificar e envie uma imagem.', ephemeral: true });
    return true;
  }
  const sexKey = `${threadId}:${targetUserId}`;
  const selectedSex = pendingVerifySex.get(sexKey);
  if (!selectedSex) {
    await interaction.followUp({ content: 'Selecione se o usuário é masculino ou feminino antes de confirmar.', ephemeral: true });
    return true;
  }
  await wait(3000);
  let roleResult = null;
  if (cfg?.verifiedRoleId) {
    try {
      roleResult = await applyVerifiedRole(
        interaction.guild,
        cfg.verifiedRoleId,
        targetUserId,
        `Verificação aprovada por ${interaction.user.tag || interaction.user.id}`,
      );
    } catch (err) {
      console.error('[verify] applyVerifiedRole falhou:', err?.message || err);
      roleResult = { ok: false, error: 'exception' };
    }
  }
  let photoMeta = { url: null, messageId: null, channelId: null };
  try {
    const targetChannelId = selectedSex === 'male'
      ? cfg?.photosMaleChannelId || cfg?.photosChannelId
      : cfg?.photosFemaleChannelId || cfg?.photosChannelId;
    if (targetChannelId) {
      const photosChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
      if (photosChannel && photosChannel.isTextBased()) {
        const content = [
          `Usuario: <@${targetUserId}> | ${targetUserId}`,
          `Verificado Por: <@${interaction.user.id}> | ${interaction.user.id}`,
          `Sexo: ${selectedSex === 'male' ? 'Masculino' : 'Feminino'}`,
        ].join('\n');
        const file = new AttachmentBuilder(img.buffer, { name: img.name });
        const sent = await photosChannel.send({ content, files: [file] });
        const attachment = sent.attachments?.first();
        photoMeta = {
          url: attachment?.url || null,
          messageId: sent.id,
          channelId: photosChannel.id,
        };
      }
    }
  } catch {}
  await prisma.verifiedUserGlobal.upsert({
    where: { userId: targetUserId },
    update: {
      verifiedBy: interaction.user.id,
      sex: selectedSex,
      photoUrl: photoMeta.url,
      photoMessageId: photoMeta.messageId,
      photoChannelId: photoMeta.channelId,
      verifiedAt: new Date(),
    },
    create: {
      userId: targetUserId,
      verifiedBy: interaction.user.id,
      sex: selectedSex,
      photoUrl: photoMeta.url,
      photoMessageId: photoMeta.messageId,
      photoChannelId: photoMeta.channelId,
    },
  });
  pendingVerifyImage.delete(key);
  pendingVerifySex.delete(sexKey);
  const previewKey = buildPreviewKey(threadId, interaction.user.id);
  await deletePreviewMessage(interaction.channel, previewKey);
  const followUpMessages = [];
  followUpMessages.push(`Verificação concluída para <@${targetUserId}>.`);
  if (cfg?.verifiedRoleId) {
    if (roleResult?.ok) {
      if (roleResult?.already) {
        followUpMessages.push('Este usuário já possuía o cargo de verificado.');
      } else {
        followUpMessages.push(`Cargo <@&${cfg.verifiedRoleId}> aplicado com sucesso.`);
      }
    } else {
      followUpMessages.push('Não consegui aplicar o cargo automaticamente. Verifique minhas permissões ou reaplique manualmente.');
    }
  }
  await interaction.followUp({ content: followUpMessages.join('\n'), ephemeral: true });
  return true;
}

async function handleUpdate(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode atualizar.', ephemeral: true });
    return true;
  }
  const [, , threadId] = interaction.customId.split(':');
  pendingVerifyImage.delete(`${threadId}:${interaction.user.id}`);
  await interaction.deferUpdate().catch(() => {});
  await interaction.followUp({ content: 'Envie outra imagem nesta conversa. Vou substituir a prévia.', ephemeral: true });
  const thread = interaction.channel || (await interaction.guild.channels.fetch(threadId).catch(() => null));
  if (!thread) return true;
  const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
  const collector = thread.createMessageCollector({ filter, time: 5 * 60 * 1000, max: 1 });
  collector.on('collect', async (m) => {
    try {
      const att = m.attachments.first();
      const res = await fetch(att.url);
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: att.name || 'imagem.png' });
      await m.delete().catch(() => {});
      const cached = verifyThreads.get(threadId)?.targetUserId || null;
      const targetUserId = (await resolveThreadTargetUserId(threadId, cached, interaction.guild)) || 'unknown';
      const sexKey = targetUserId === 'unknown' ? null : `${threadId}:${targetUserId}`;
      const selectedSex = sexKey ? pendingVerifySex.get(sexKey) || null : null;
      const components = [
        buildSexButtons(threadId, targetUserId, selectedSex),
        buildConfirmRow(threadId, targetUserId, selectedSex),
      ];
      const previewEmbed = buildPreviewEmbed(targetUserId, interaction.user.id, selectedSex);
      const key = buildPreviewKey(threadId, interaction.user.id);
      const attachment = new AttachmentBuilder(buf, { name: att.name || 'imagem.png' });
      await publishPreviewMessage(thread, key, {
        embeds: [previewEmbed],
        files: [attachment],
        components,
      });
    } catch (e) {
      await interaction.followUp({ content: 'Falha ao processar a imagem, tente novamente.', ephemeral: true });
    }
  });
  return true;
}

async function handleClose(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode encerrar.', ephemeral: true });
    return true;
  }
  const threadId = interaction.customId.split(':')[2];
  const tracked = verifyThreads.get(threadId);
  if (tracked?.targetUserId) {
    pendingVerifySex.delete(`${threadId}:${tracked.targetUserId}`);
  }
  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!thread) {
    await interaction.reply({ content: 'Tópico não encontrado.', ephemeral: true });
    return true;
  }
  await interaction.deferUpdate().catch(() => {});
  try {
    await thread.send({ content: `Ticket encerrado por <@${interaction.user.id}>, fechando em <t:${Math.floor((Date.now() + 5000) / 1000)}:R>.` }).catch(() => null);
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true, 'Encerrado pelo verificador').catch(() => {});
    setTimeout(async () => {
      try {
        await thread.delete('Encerrado e removido após countdown').catch(() => {});
      } catch {}
    }, 5000);
  } catch (e) {
    await interaction.followUp({ content: 'Falha ao encerrar tópico.', ephemeral: true }).catch(() => {});
  }
  verifyThreads.delete(threadId);
  for (const key of [...pendingVerifyImage.keys()]) {
    if (key.startsWith(`${threadId}:`)) {
      pendingVerifyImage.delete(key);
    }
  }
  for (const key of [...pendingPreviewMessages.keys()]) {
    if (key.startsWith(`${threadId}:`)) {
      await deletePreviewMessage(thread, key);
    }
  }
  return true;
}

async function handleGrantRole(interaction, cfg) {
  const [, , targetUserId] = interaction.customId.split(':');
  await interaction.deferUpdate().catch(() => {});
  if (!targetUserId) {
    await interaction.followUp({ content: 'Requisição inválida.', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== targetUserId) {
    await interaction.followUp({ content: 'Este botão só pode ser usado pelo titular da verificação.', ephemeral: true });
    return true;
  }
  if (!cfg?.verifiedRoleId) {
    await interaction.followUp({ content: 'Cargo de verificado não configurado.', ephemeral: true });
    return true;
  }
  let result;
  try {
    result = await applyVerifiedRole(
      interaction.guild,
      cfg.verifiedRoleId,
      targetUserId,
      'Reaplicar cargo verificado via botão do usuário',
    );
  } catch (err) {
    console.error('[verify] Falha inesperada ao reaplicar cargo verificado:', err?.message || err);
    result = { ok: false, error: 'exception' };
  }
  if (result?.ok) {
    if (result.already) {
      await interaction.followUp({ content: 'Você já possuía o cargo de verificado.', ephemeral: true });
    } else {
      await interaction.followUp({ content: 'Cargo de verificado reaplicado com sucesso.', ephemeral: true });
    }
    return true;
  }
  if (result?.error === 'unknown_member') {
    await interaction.followUp({ content: 'Não consegui localizar você no servidor.', ephemeral: true });
    return true;
  }
  await interaction.followUp({ content: 'Não consegui adicionar o cargo. Verifique minhas permissões.', ephemeral: true });
  return true;
}

async function handleRemoveVerificationButtons(interaction, cfg, prisma) {
  const [, , action, targetUserId, requesterId] = interaction.customId.split(':');
  if (requesterId && requesterId !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas quem solicitou pode usar estes botões.', ephemeral: true });
    return true;
  }
  await interaction.deferUpdate().catch(() => {});
  const disabled = cloneDisabledComponents(interaction.message?.components || []);
  if (action === 'cancel') {
    await interaction.message.edit({ content: 'Remoção cancelada.', components: disabled }).catch(() => {});
    return true;
  }
  if (action !== 'confirm') {
    await interaction.followUp({ content: 'Ação inválida.', ephemeral: true });
    return true;
  }
  if (!targetUserId) {
    await interaction.followUp({ content: 'Solicitação inválida.', ephemeral: true });
    return true;
  }
  const record = await prisma.verifiedUserGlobal.findUnique({ where: { userId: targetUserId } }).catch(() => null);
  if (!record) {
    await interaction.message.edit({ content: 'Este usuário já não está verificado.', components: disabled }).catch(() => {});
    await interaction.followUp({ content: 'Nenhum registro encontrado.', ephemeral: true });
    return true;
  }
  try {
    await prisma.verifiedUserGlobal.delete({ where: { userId: targetUserId } });
  } catch {}
  if (cfg?.verifiedRoleId) {
    await removeVerifiedRole(
      interaction.guild,
      cfg.verifiedRoleId,
      targetUserId,
      'Remoção manual da verificação',
    ).catch(() => null);
  }
  await interaction.message.edit({ content: `Verificação removida de <@${targetUserId}>.`, components: disabled }).catch(() => {});
  await interaction.followUp({ content: 'Verificação removida com sucesso.', ephemeral: true });
  return true;
}

module.exports = {
  handleInteraction,
  handleClose,
  verifyThreads,
  pendingVerifyImage,
  pendingVerifySex,
};