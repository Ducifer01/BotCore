const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createTranscript } = require('discord-html-transcripts');
const { getPrisma } = require('../db');

const SUPPORT_EMBED_COLOR = 0xFFFFFF;
const SUPPORT_THREAD_ARCHIVE_MINUTES = 1440;

function buildSupportConfigEmbed(cfg) {
  const lines = [
    `• Canal do painel: ${cfg?.supportPanelChannelId ? `<#${cfg.supportPanelChannelId}>` : 'não definido'}`,
    `• Canal de logs: ${cfg?.supportLogChannelId ? `<#${cfg.supportLogChannelId}>` : 'não definido'}`,
    `• Cargos de suporte: ${cfg?.supportRolesGlobal?.length ? cfg.supportRolesGlobal.map(r => `<@&${r.roleId}>`).join(', ') : 'nenhum configurado'}`,
  ].join('\n');
  return new EmbedBuilder()
    .setTitle('Configurar Suporte')
    .setDescription(`Gerencie painel, cargos e canal de logs.\n\n${lines}`)
    .setColor(SUPPORT_EMBED_COLOR);
}

function getSupportPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('Sistema de Suporte')
    .setDescription('Alguém no servidor está te incomodando? Utilize esse sistema para reportar um membro.')
    .setColor(SUPPORT_EMBED_COLOR);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('support:open')
      .setLabel('Abrir Ticket')
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function buildTicketThreadEmbed() {
  return new EmbedBuilder()
    .setTitle('Ticket | Suporte')
    .setDescription('Em breve nossa equipe de suporte irá te ajudar. Você pode adiantar explicando o caso abaixo e já adiantando provas. OBS: Nossas punições são baseadas em provas, e nem sempre testemunhas bastam.')
    .setColor(SUPPORT_EMBED_COLOR);
}

function buildTicketButtons(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`support:close:${threadId}`).setLabel('Encerrar atendimento').setStyle(ButtonStyle.Danger)
  );
}

function extractSupportRoleIds(cfg) {
  return cfg?.supportRolesGlobal?.map(r => r.roleId) || [];
}

function hasSupportPermission(member, cfg) {
  if (!member) return false;
  const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
  if (POSSE_USER_ID && member.id === POSSE_USER_ID) {
    return true;
  }
  const roleIds = extractSupportRoleIds(cfg);
  if (!roleIds.length) return false;
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

async function safeEphemeral(interaction, payload) {
  const message = { ...payload, ephemeral: payload?.ephemeral ?? true };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(message).catch(() => {});
  }
  return interaction.reply(message).catch(() => {});
}

async function ensureSupportConfig(prisma) {
  const cfg = await prisma.globalConfig.findFirst({ include: { supportRolesGlobal: true } });
  return cfg || null;
}

async function handleSupportOpen(interaction) {
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const prisma = getPrisma();
  const cfg = await ensureSupportConfig(prisma);
  if (!cfg?.supportPanelChannelId) {
    await interaction.editReply({ content: 'O sistema de suporte não está configurado ainda.' }).catch(() => {});
    return true;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: 'Esta ação só pode ser usada no servidor.' }).catch(() => {});
    return true;
  }

  const panelChannel = guild.channels.cache.get(cfg.supportPanelChannelId)
    || await guild.channels.fetch(cfg.supportPanelChannelId).catch(() => null);
  if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({ content: 'O canal de suporte configurado é inválido ou inacessível.' }).catch(() => {});
    return true;
  }

  if (interaction.channelId !== panelChannel.id) {
    await interaction.editReply({ content: 'Use o painel oficial para abrir o ticket.' }).catch(() => {});
    return true;
  }

  const userId = interaction.user.id;
  let existing = await prisma.supportTicket.findFirst({
    where: {
      guildId: guild.id,
      openerId: userId,
      closedAt: null,
    },
  });
  if (existing) {
    const previousThread = await guild.channels.fetch(existing.threadId).catch(() => null);
    if (previousThread) {
      await interaction.editReply({ content: `Você já possui um ticket aberto: <#${existing.threadId}>` }).catch(() => {});
      return true;
    }
    await prisma.supportTicket.update({ where: { id: existing.id }, data: { closedAt: new Date(), closedBy: 'system' } });
    existing = null;
  }

  const threadName = `suporte-${interaction.user.username}`.substring(0, 90);
  const thread = await panelChannel.threads.create({
    name: threadName,
    autoArchiveDuration: SUPPORT_THREAD_ARCHIVE_MINUTES,
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: 'Ticket de suporte aberto pelo painel',
  });

  const supportRoleIds = extractSupportRoleIds(cfg);
  const mentions = [...supportRoleIds.map(id => `<@&${id}>`), `<@${userId}>`].filter(Boolean).join(' ') || undefined;
  const embed = buildTicketThreadEmbed();
  const buttons = buildTicketButtons(thread.id);

  await thread.send({
    content: mentions,
    embeds: [embed],
    components: [buttons],
    allowedMentions: {
      roles: supportRoleIds,
      users: [userId],
      repliedUser: false,
    },
  });

  await prisma.supportTicket.create({
    data: {
      threadId: thread.id,
      channelId: panelChannel.id,
      guildId: guild.id,
      openerId: userId,
      openerTag: interaction.user.tag,
    },
  });

  await interaction.editReply({ content: `Ticket aberto: <#${thread.id}>` }).catch(() => {});
  return true;
}

async function disableInteractionComponents(interaction) {
  try {
    if (!interaction?.message?.components?.length) return;
    const disabledRows = interaction.message.components.map((row) => {
      const actionRow = new ActionRowBuilder();
      for (const component of row.components) {
        const btn = ButtonBuilder.from(component).setDisabled(true);
        actionRow.addComponents(btn);
      }
      return actionRow;
    });
    await interaction.message.edit({ components: disabledRows }).catch(() => {});
  } catch {}
}

async function closeTicket(interaction, threadId, { allowAuthor = false } = {}) {
  const prisma = getPrisma();
  const cfg = await ensureSupportConfig(prisma);
  if (!cfg) {
    await safeEphemeral(interaction, { content: 'O sistema de suporte não está configurado.' });
    return true;
  }
  const ticket = await prisma.supportTicket.findFirst({ where: { threadId, guildId: interaction.guildId } });
  if (!ticket) {
    await safeEphemeral(interaction, { content: 'Ticket não encontrado ou já encerrado. Use o painel para abrir um novo atendimento.' });
    return true;
  }
  if (ticket.closedAt) {
    await safeEphemeral(interaction, { content: 'Este ticket já foi encerrado. Use o painel para abrir um novo atendimento.' });
    return true;
  }

  const member = interaction.member;
  const isOwner = interaction.user.id === ticket.openerId;
  if (!allowAuthor) {
    if (!hasSupportPermission(member, cfg)) {
      await safeEphemeral(interaction, { content: 'Apenas cargos de suporte podem encerrar este ticket.' });
      return true;
    }
  } else if (!isOwner && !hasSupportPermission(member, cfg)) {
    await safeEphemeral(interaction, { content: 'Somente o autor do ticket pode usar este botão.' });
    return true;
  }

  await interaction.deferUpdate().catch(() => {});
  await safeEphemeral(interaction, { content: 'Encerrando ticket...' });

  await disableInteractionComponents(interaction);

  const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
  let transcriptAttachment = null;
  let transcriptFilename = `ticket-${ticket.id}.html`;
  if (thread) {
    try {
      transcriptAttachment = await createTranscript(thread, {
        limit: -1,
        returnBuffer: false,
        returnAttachment: true,
        filename: transcriptFilename,
        saveImages: true,
        poweredBy: false,
      });
    } catch (err) {
      console.error('[support] Falha ao gerar transcrição:', err);
      transcriptAttachment = null;
    }
  }

  let logMessage = null;
  if (cfg.supportLogChannelId) {
    const logChannel = await interaction.client.channels.fetch(cfg.supportLogChannelId).catch(() => null);
    if (logChannel && logChannel.isTextBased()) {
      const logEmbed = new EmbedBuilder()
        .setTitle('LOG | Ticket suporte')
        .setDescription(`Quem abriu: <@${ticket.openerId}>\nQuem fechou: <@${interaction.user.id}>`)
        .setColor(0xED4245)
        .setFooter({ text: 'Horário do encerramento' })
        .setTimestamp(new Date());
      const files = [];
      if (transcriptAttachment) {
        files.push(transcriptAttachment);
      }
      try {
        logMessage = await logChannel.send({ embeds: [logEmbed], files });
      } catch (err) {
        console.error('[support] Falha ao enviar log de suporte:', err);
      }
    }
  }

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      closedAt: new Date(),
      closedBy: interaction.user.id,
      transcriptUrl: logMessage?.attachments?.first()?.url || null,
      logMessageId: logMessage?.id || null,
    },
  });

  if (thread) {
    try {
      await thread.delete('Ticket de suporte encerrado');
    } catch (err) {
      console.error('[support] Falha ao excluir tópico de suporte:', err);
    }
  }

  await safeEphemeral(interaction, { content: 'Ticket encerrado com sucesso.' });
  return true;
}

async function handleSupportClose(interaction, threadId) {
  return closeTicket(interaction, threadId, { allowAuthor: false });
}

async function handleSupportInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const customId = interaction.customId;
  if (customId === 'support:open') {
    return handleSupportOpen(interaction);
  }
  if (customId.startsWith('support:close:')) {
    const threadId = customId.split(':')[2];
    if (!threadId) {
      await safeEphemeral(interaction, { content: 'Ticket inválido.', ephemeral: true });
      return true;
    }
    return handleSupportClose(interaction, threadId);
  }
  return false;
}

module.exports = {
  buildSupportConfigEmbed,
  getSupportPanelPayload,
  handleSupportOpen,
  handleSupportClose,
  handleSupportInteraction,
};
