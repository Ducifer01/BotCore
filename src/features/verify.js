const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getGlobalConfig } = require('../services/globalConfig');

const verifyThreads = new Map(); // threadId -> { targetUserId }
const pendingVerifyImage = new Map(); // `${threadId}:${verifierId}` -> { buffer, name }

function buildVerifyThreadName(user) {
  const safeUsername = user.username.replace(/[^\w\- ]/g, '').trim() || 'usuario';
  return `verif-${user.id}-${safeUsername}`.slice(0, 90);
}

function threadBelongsToUser(thread, userId) {
  if (!thread?.name) return false;
  return thread.name.startsWith(`verif-${userId}`);
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
    if (customId !== 'verify:open') {
      await interaction.reply({ content: 'Apenas o cargo principal pode usar este botão.', ephemeral: true });
      return true;
    }
  }

  if (customId === 'verify:open') {
    return openThread(interaction, cfg);
  }
  if (customId.startsWith('verify:start:')) {
    return handleStart(interaction, cfg);
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
  return false;
}

async function openThread(interaction, cfg) {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'Este botão deve ser usado em um canal de texto.', ephemeral: true });
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
  verifyThreads.set(thread.id, { targetUserId: interaction.user.id });
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

async function handleStart(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode usar este botão.', ephemeral: true });
    return true;
  }
  const [, , threadId, targetUserId] = interaction.customId.split(':');
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
      pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: att.name || 'imagem.png' });
      await m.delete().catch(() => {});
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verify:confirm:${threadId}:${targetUserId}`).setLabel('Perfeito').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`verify:update:${threadId}`).setLabel('Atualizar').setStyle(ButtonStyle.Primary),
      );
      await interaction.followUp({ content: 'Confira a imagem e confirme:', files: [{ attachment: buf, name: att.name || 'imagem.png' }], components: [row], ephemeral: true });
    } catch (e) {
      await interaction.followUp({ content: 'Falha ao processar a imagem, tente novamente.', ephemeral: true });
    }
  });
  return true;
}

async function handleConfirm(interaction, cfg, prisma) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode confirmar.', ephemeral: true });
    return true;
  }
  const [, , threadId, targetUserId] = interaction.customId.split(':');
  const key = `${threadId}:${interaction.user.id}`;
  const img = pendingVerifyImage.get(key);
  if (!img) {
    await interaction.reply({ content: 'Nenhuma imagem em espera. Clique em Verificar e envie uma imagem.', ephemeral: true });
    return true;
  }
  if (cfg.verifiedRoleId) {
    const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
    if (member && !member.roles.cache.has(cfg.verifiedRoleId)) {
      await member.roles.add(cfg.verifiedRoleId).catch(() => {});
    }
  }
  await prisma.verifiedUserGlobal.upsert({
    where: { userId: targetUserId },
    update: { verifiedBy: interaction.user.id },
    create: { userId: targetUserId, verifiedBy: interaction.user.id },
  });
  try {
    if (cfg?.photosChannelId) {
      const photosChannel = await interaction.client.channels.fetch(cfg.photosChannelId).catch(() => null);
      if (photosChannel && photosChannel.isTextBased()) {
        const content = [`Usuario: <@${targetUserId}> | ${targetUserId}`, `VerificadoPor: <@${interaction.user.id}> | ${interaction.user.id}`].join('\n');
        const file = new AttachmentBuilder(img.buffer, { name: img.name });
        await photosChannel.send({ content, files: [file] });
      }
    }
  } catch {}
  pendingVerifyImage.delete(key);
  await interaction.reply({ content: 'Verificação concluída.', ephemeral: true });
  return true;
}

async function handleUpdate(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o cargo principal pode atualizar.', ephemeral: true });
    return true;
  }
  const [, , threadId] = interaction.customId.split(':');
  pendingVerifyImage.delete(`${threadId}:${interaction.user.id}`);
  await interaction.reply({ content: 'Envie outra imagem nesta conversa. Vou substituir a prévia.', ephemeral: true });
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
      pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: att.name || 'imagem.png' });
      await m.delete().catch(() => {});
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verify:confirm:${threadId}:${verifyThreads.get(threadId)?.targetUserId || 'unknown'}`).setLabel('Perfeito').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`verify:update:${threadId}`).setLabel('Atualizar').setStyle(ButtonStyle.Primary),
      );
      await interaction.followUp({ content: 'Imagem atualizada. Confira e confirme:', files: [{ attachment: buf, name: att.name || 'imagem.png' }], components: [row], ephemeral: true });
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
  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!thread) {
    await interaction.reply({ content: 'Tópico não encontrado.', ephemeral: true });
    return true;
  }
  try {
    await interaction.deferReply({ flags: 64 });
  } catch {}
  try {
    await thread.send({ content: `Ticket encerrado por <@${interaction.user.id}>, fechando em <t:${Math.floor((Date.now() + 5000) / 1000)}:R>.` }).catch(() => null);
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true, 'Encerrado pelo verificador').catch(() => {});
    try {
      await interaction.editReply({ content: 'Encerrando o tópico em 5 segundos...' });
    } catch {}
    setTimeout(async () => {
      try {
        await thread.delete('Encerrado e removido após countdown').catch(() => {});
      } catch {}
    }, 5000);
  } catch (e) {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Falha ao encerrar tópico.' }).catch(() => {});
      } else {
        await interaction.reply({ content: 'Falha ao encerrar tópico.', flags: 64 }).catch(() => {});
      }
    } catch {}
  }
  return true;
}

module.exports = {
  handleInteraction,
  handleClose,
  verifyThreads,
  pendingVerifyImage,
};