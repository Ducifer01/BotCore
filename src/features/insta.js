const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AuditLogEvent } = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');
const { consumeBotVerifiedRoleAction } = require('../services/verifiedRoleBypass');

const webhookCache = new Map();
const instaWebhookBlock = new Map();

function buildPostActionRow(postId, likeCount = '0', commentCount = '0') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`insta:like:${postId}`).setEmoji('❤️').setLabel(likeCount).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`insta:comment:${postId}`).setEmoji('💬').setLabel(commentCount).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`insta:listlikes:${postId}:1`).setEmoji('📃').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`insta:listcomments:${postId}:1`).setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`insta:delete:${postId}`).setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

function buildPaginationRow(type, postId, page, totalPages) {
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`insta:${type}:${postId}:prev:${prevPage}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`insta:${type}:${postId}:next:${nextPage}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}


function guessAttachmentExtension(contentType) {
  if (!contentType) return '.png';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('webp')) return '.webp';
  return '.dat';
}

function extractFilenameFromUrl(url, fallbackName = 'ganhador.png') {
  if (!url) return fallbackName;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    if (lastSegment && lastSegment.includes('.')) {
      return lastSegment;
    }
  } catch (_) {
    // ignore parsing errors
  }
  return fallbackName;
}

async function downloadAttachment(attachment) {
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Failed to fetch attachment');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const name = attachment.name || `insta-${Date.now()}${guessAttachmentExtension(attachment.contentType || '')}`;
    return { buffer, name };
  } catch (error) {
    console.warn('[insta] Falha ao baixar anexo para repostagem:', error.message);
    return null;
  }
}

async function ensurePosse(interaction, ctx) {
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.followUp({ content: 'Apenas o usuário posse pode usar este painel.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

async function ensureDeferred(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    if (typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate().catch(() => {});
    }
  }
}

async function editPanel(interaction, payload) {
  await ensureDeferred(interaction);
  await interaction.editReply(payload).catch(() => {});
}

async function renderHome(interaction, prisma, status) {
  await ensureDeferred(interaction);
  const cfg = await getGlobalConfig(prisma);
  const payload = { embeds: [buildInstaEmbed(cfg, status)], components: buildInstaMenuRows() };
  await interaction.editReply(payload).catch(() => {});
  return true;
}

async function showChannelPrompt(interaction, { title, description, customId, channelTypes = [ChannelType.GuildText] }) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Selecione um canal')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(...channelTypes);
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x2c2f33);
  const components = [new ActionRowBuilder().addComponents(select), buildBackRow()];
  await editPanel(interaction, { embeds: [embed], components });
  return true;
}

async function showRolePrompt(interaction, { title, description, customId, min = 1, max = 1 }) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Selecione cargos')
    .setMinValues(min)
    .setMaxValues(max);
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x2c2f33);
  const components = [new ActionRowBuilder().addComponents(select), buildBackRow()];
  await editPanel(interaction, { embeds: [embed], components });
  return true;
}

async function showUserPrompt(interaction, { title, description, customId }) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Selecione um usuário')
    .setMinValues(1)
    .setMaxValues(1);
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0xED4245);
  const components = [new ActionRowBuilder().addComponents(select), buildBackRow()];
  await editPanel(interaction, { embeds: [embed], components });
  return true;
}

async function showResetConfirm(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Resetar canais de Insta')
    .setDescription('Isso vai anunciar o ganhador da semana e limpar todos os posts de InstaBoy/InstaGirl. Deseja continuar?')
    .setColor(0xE74C3C);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`menu:insta:reset:confirm:${interaction.user.id}`).setLabel('Sim, resetar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('menu:insta:reset:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  await editPanel(interaction, { embeds: [embed], components: [row] });
  return true;
}

function buildInstaEmbed(cfg, status) {
  const lines = [
    `• Insta Boys: ${cfg?.instaBoysChannelId ? `<#${cfg.instaBoysChannelId}>` : 'não definido'}`,
    `• Insta Girls: ${cfg?.instaGirlsChannelId ? `<#${cfg.instaGirlsChannelId}>` : 'não definido'}`,
    `• Fotos Masculino: ${cfg?.photosMaleChannelId ? `<#${cfg.photosMaleChannelId}>` : 'não definido'}`,
    `• Fotos Feminino: ${cfg?.photosFemaleChannelId ? `<#${cfg.photosFemaleChannelId}>` : 'não definido'}`,
    `• Cargo Principal: ${cfg?.mainRoleId ? `<@&${cfg.mainRoleId}>` : 'não definido'}`,
    `• Cargo Verificado: ${cfg?.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : 'não definido'}`,
    `• Painel Verifique-se: ${cfg?.verifyPanelChannelId ? `<#${cfg.verifyPanelChannelId}>` : 'não definido'}`,
    `• Cargos Notificados: ${cfg?.ticketPingRolesGlobal?.length ? cfg.ticketPingRolesGlobal.map((r) => `<@&${r.roleId}>`).join(', ') : 'nenhum definido'}`,
  ].join('\n');
  const prefix = status ? `${getStatusEmoji(status.type)} ${status.message}\n\n` : '';
  return new EmbedBuilder()
    .setTitle('Configurar Insta')
    .setDescription(`${prefix}Ajuste as configurações abaixo.\n\n${lines}`)
    .setColor(0x2c2f33);
}

function buildInstaMenuRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:boys').setLabel('InstaBoy').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:insta:girls').setLabel('InstaGirl').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:insta:photos_male').setLabel('Fotos Masculino').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:photos_female').setLabel('Fotos Feminino').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:insta:mainrole').setLabel('Cargo Principal').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifiedrole').setLabel('Cargo Verificado').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:pings').setLabel('Cargos Notificados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifypanel').setLabel('Painel Verifique-se').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:unverify').setLabel('Cancelar Verificação').setStyle(ButtonStyle.Danger),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:insta:sendpanel').setLabel('Enviar Painel').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:insta:reset').setLabel('Resetar Insta').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2, row3];
}

function buildBackRow(label = 'Voltar') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:insta:home').setLabel(label).setStyle(ButtonStyle.Secondary),
  );
}

function getStatusEmoji(type) {
  if (type === 'success') return '✅';
  if (type === 'error') return '⚠️';
  return 'ℹ️';
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await getGlobalConfig(prisma);
  const embed = buildInstaEmbed(cfg);
  const rows = buildInstaMenuRows();
  await interaction.update({ embeds: [embed], components: rows });
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (interaction.isModalSubmit() && interaction.customId.startsWith('insta:commentModal:')) {
    return handleCommentModal(interaction);
  }
  if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()) {
    if (interaction.customId.startsWith('menu:insta:')) {
      return handleConfigSelect(interaction, ctx);
    }
  }
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id.startsWith('menu:insta:')) {
      return handleConfigButtons(interaction, ctx);
    }
    if (id.startsWith('insta:')) {
      return handlePostButtons(interaction);
    }
  }
  return false;
}

async function handleConfigButtons(interaction, ctx) {
  await ensureDeferred(interaction);
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const parts = interaction.customId.split(':');
  const action = parts[2];
  const subaction = parts[3];

  if (action === 'home') {
    return renderHome(interaction, prisma);
  }
  if (action === 'boys' || action === 'girls') {
    const isBoys = action === 'boys';
    return showChannelPrompt(interaction, {
      title: isBoys ? 'Definir InstaBoy' : 'Definir InstaGirl',
      description: 'Selecione o canal de texto onde os usuários enviarão as fotos.',
      customId: `menu:insta:select:${isBoys ? 'boys' : 'girls'}`,
    });
  }
  if (action === 'photos_male' || action === 'photos_female') {
    const isMale = action === 'photos_male';
    return showChannelPrompt(interaction, {
      title: isMale ? 'Canal de Fotos (Masculino)' : 'Canal de Fotos (Feminino)',
      description: isMale
        ? 'Escolha o canal onde registraremos as fotos aprovadas dos usuários masculinos.'
        : 'Escolha o canal onde registraremos as fotos aprovadas das usuárias femininas.',
      customId: `menu:insta:select:${isMale ? 'photos_male' : 'photos_female'}`,
    });
  }
  if (action === 'verifypanel') {
    return showChannelPrompt(interaction, {
      title: 'Canal do Painel Verifique-se',
      description: 'Defina o canal onde ficará o painel principal de verificação.',
      customId: 'menu:insta:select:verifypanel',
    });
  }
  if (action === 'mainrole' || action === 'verifiedrole') {
    const isMain = action === 'mainrole';
    return showRolePrompt(interaction, {
      title: isMain ? 'Cargo Principal' : 'Cargo Verificado',
      description: isMain
        ? 'Escolha o cargo que pode verificar, encerrar e operar o sistema.'
        : 'Escolha o cargo aplicado aos usuários verificados.',
      customId: `menu:insta:select:${isMain ? 'mainrole' : 'verifiedrole'}`,
      min: 1,
      max: 1,
    });
  }
  if (action === 'pings') {
    return showRolePrompt(interaction, {
      title: 'Cargos Notificados',
      description: 'Selecione até 10 cargos que serão mencionados quando um usuário abrir o ticket de verificação.',
      customId: 'menu:insta:select:pings',
      min: 0,
      max: 10,
    });
  }
  if (action === 'unverify') {
    return showUserPrompt(interaction, {
      title: 'Cancelar Verificação',
      description: 'Selecione o usuário que terá o status de verificado removido em todos os servidores permitidos.',
      customId: 'menu:insta:select:unverify',
    });
  }
  if (action === 'sendpanel') {
    return showChannelPrompt(interaction, {
      title: 'Enviar Painel Verifique-se',
      description: 'Escolha o canal onde publicaremos o painel com o botão Verifique-se. Assim que selecionar, enviarei e voltarei ao menu.',
      customId: 'menu:insta:select:sendpanel',
    });
  }
  if (action === 'reset') {
    if (subaction === 'cancel') {
      return renderHome(interaction, prisma, { type: 'info', message: 'Reset cancelado.' });
    }
    if (subaction === 'confirm') {
      const ownerId = parts[4];
      if (ownerId && ownerId !== interaction.user.id) {
        await interaction.followUp({ content: 'Apenas quem solicitou pode confirmar.', ephemeral: true }).catch(() => {});
        return true;
      }
      return performInstaReset(interaction, prisma);
    }
    return showResetConfirm(interaction);
  }
  return false;
}

async function handleConfigSelect(interaction, ctx) {
  await ensureDeferred(interaction);
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = await ensureGlobalConfig(prisma);
  const [, , , target] = interaction.customId.split(':');

  if (!target) {
    return false;
  }

  if (target === 'boys' || target === 'girls') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: target === 'boys' ? { instaBoysChannelId: channelId } : { instaGirlsChannelId: channelId },
    });
    return renderHome(interaction, prisma, {
      type: 'success',
      message: `Canal de ${target === 'boys' ? 'InstaBoy' : 'InstaGirl'} definido: <#${channelId}>`,
    });
  }

  if (target === 'photos_male' || target === 'photos_female') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: target === 'photos_male' ? { photosMaleChannelId: channelId } : { photosFemaleChannelId: channelId },
    });
    return renderHome(interaction, prisma, {
      type: 'success',
      message: `${target === 'photos_male' ? 'Canal de fotos masculino' : 'Canal de fotos feminino'} definido: <#${channelId}>`,
    });
  }

  if (target === 'verifypanel') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { verifyPanelChannelId: channelId } });
    return renderHome(interaction, prisma, { type: 'success', message: `Painel definido para <#${channelId}>` });
  }

  if (target === 'mainrole' || target === 'verifiedrole') {
    const roleId = interaction.values?.[0];
    if (!roleId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: target === 'mainrole' ? { mainRoleId: roleId } : { verifiedRoleId: roleId },
    });
    return renderHome(interaction, prisma, {
      type: 'success',
      message: `${target === 'mainrole' ? 'Cargo principal' : 'Cargo verificado'} definido: <@&${roleId}>`,
    });
  }

  if (target === 'pings') {
    const roleIds = [...new Set(interaction.values || [])];
    await prisma.ticketPingRoleGlobal.deleteMany({ where: { globalConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.ticketPingRoleGlobal.createMany({ data: roleIds.map((roleId) => ({ globalConfigId: cfg.id, roleId })) });
    }
    const message = roleIds.length
      ? `Cargos a mencionar: ${roleIds.map((rid) => `<@&${rid}>`).join(', ')}`
      : 'Nenhum cargo será mencionado ao abrir o ticket.';
    return renderHome(interaction, prisma, { type: 'success', message });
  }

  if (target === 'unverify') {
    const userId = interaction.values?.[0];
    if (!userId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    const fullCfg = await getGlobalConfig(prisma);
    await prisma.verifiedUserGlobal.deleteMany({ where: { userId } });
    if (fullCfg?.verifiedRoleId) {
      const allowedGuilds = ctx.ALLOWED_GUILD_IDS || [];
      try {
        const localMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (localMember && localMember.roles.cache.has(fullCfg.verifiedRoleId)) {
          await localMember.roles.remove(fullCfg.verifiedRoleId).catch(() => {});
        }
        for (const gid of allowedGuilds) {
          if (gid === interaction.guild.id) continue;
          const guild = interaction.client.guilds.cache.get(gid) || await interaction.client.guilds.fetch(gid).catch(() => null);
          if (!guild) continue;
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member && member.roles.cache.has(fullCfg.verifiedRoleId)) {
            await member.roles.remove(fullCfg.verifiedRoleId).catch(() => {});
          }
        }
      } catch {}
    }
    return renderHome(interaction, prisma, {
      type: 'success',
      message: `Verificação cancelada para <@${userId}> em todos os servidores configurados.`,
    });
  }

  if (target === 'sendpanel') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Preciso de um canal de texto válido.' });
    }
    const success = await publishVerificationPanel(channel);
    if (!success) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Falha ao publicar o painel. Verifique minhas permissões.' });
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { verifyPanelChannelId: channelId } });
    return renderHome(interaction, prisma, { type: 'success', message: `Painel enviado em <#${channelId}>` });
  }

  return false;
}

async function publishVerificationPanel(channel) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('Verifique-se')
      .setDescription('Clique em **Verifique-se** para abrir um tópico privado com a equipe. Envie suas fotos com calma e aguarde o atendimento.')
      .setColor(0x2ECC71);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:open').setLabel('Verifique-se').setStyle(ButtonStyle.Success),
    );
    await channel.send({ embeds: [embed], components: [row] });
    return true;
  } catch (error) {
    return false;
  }
}

async function performInstaReset(interaction, prisma) {
  await ensureDeferred(interaction);
  const cfg = await getGlobalConfig(prisma);
  const channelIds = [cfg?.instaBoysChannelId, cfg?.instaGirlsChannelId].filter(Boolean);
  if (!channelIds.length) {
    return renderHome(interaction, prisma, { type: 'error', message: 'Configure os canais de Insta antes de resetar.' });
  }

  const summaries = [];
  for (const chId of channelIds) {
    const posts = await prisma.instaPostGlobal.findMany({ where: { channelId: chId }, orderBy: { likeCount: 'desc' } });
    if (!posts.length) {
      summaries.push(`Sem posts novos em <#${chId}>.`);
      continue;
    }
    const channel = await interaction.guild.channels.fetch(chId).catch(() => null);
    if (!channel) {
      summaries.push(`Não consegui acessar <#${chId}>.`);
      continue;
    }
    const keepMessageIds = [];
    const winner = posts[0];
    if (winner) {
      const announcement = await sendWinnerAnnouncement(channel, winner);
      if (announcement) {
        keepMessageIds.push(announcement.id);
      }
      await prisma.instaWinnerGlobal.create({
        data: {
          channelId: chId,
          postId: winner.id,
          winnerUserId: winner.authorId,
          likeCount: winner.likeCount,
          winnerMessageId: announcement?.id,
        },
      });
      summaries.push(`Ganhador anunciado em <#${chId}>.`);
    }
    for (const p of posts) {
      if (winner && p.id === winner.id) continue;
      await prisma.instaLikeGlobal.deleteMany({ where: { postId: p.id } });
      await prisma.instaCommentGlobal.deleteMany({ where: { postId: p.id } });
      await prisma.instaPostGlobal.delete({ where: { id: p.id } });
      await channel.messages.delete(p.id).catch(() => {});
    }
    await purgeInstaChannel(channel, keepMessageIds);
  }

  const message = summaries.length ? summaries.join(' ') : 'Reset concluído.';
  return renderHome(interaction, prisma, { type: 'success', message });
}

async function sendWinnerAnnouncement(channel, winner) {
  if (!channel) return null;
  const content = `**Ganhador da semana**\n<@${winner.authorId}>\n${winner.likeCount} curtidas`;
  const payload = {
    content,
    allowedMentions: { users: [winner.authorId], roles: [], repliedUser: false },
  };
  if (winner.mediaUrl) {
    const derivedName = extractFilenameFromUrl(winner.mediaUrl);
    payload.files = [{ attachment: winner.mediaUrl, name: derivedName }];
  }
  try {
    return await channel.send(payload);
  } catch (error) {
    console.warn('[insta] Falha ao enviar anúncio de ganhador:', error?.message || error);
    return null;
  }
}

async function purgeInstaChannel(channel, keepMessageIds = []) {
  if (!channel || typeof channel.messages?.fetch !== 'function') return;
  const keepSet = new Set((keepMessageIds || []).filter(Boolean));
  let lastMessageId;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastMessageId }).catch(() => null);
    if (!batch?.size) break;
    for (const [, message] of batch) {
      if (keepSet.has(message.id)) continue;
      if (message.pinned) continue;
      if (isWinnerMessage(message)) continue;
      await message.delete().catch(() => {});
    }
    const last = batch.last();
    if (!last) break;
    lastMessageId = last.id;
  }
}

function isWinnerMessage(message) {
  if (!message) return false;
  const content = (message.content || '').toLowerCase();
  if (content.includes('ganhador da semana')) return true;
  if (Array.isArray(message.embeds)) {
    return message.embeds.some((embed) => (embed?.description || '').toLowerCase().includes('ganhador da semana'));
  }
  return false;
}

async function updatePostComponents(client, post, likeCount, commentCount, options = {}) {
  const { message, channel } = options;
  const payload = {
    components: [buildPostActionRow(post.id, String(likeCount || 0), String(commentCount || 0))],
  };
  if (message) {
    const ok = await message.edit(payload).then(() => true).catch(() => false);
    if (ok) return true;
  }
  const resolvedChannel = channel || await client.channels.fetch(post.channelId).catch(() => null);
  if (!resolvedChannel) return false;
  const fetchedMessage = await resolvedChannel.messages.fetch(post.id).catch(() => null);
  if (fetchedMessage) {
    const ok = await fetchedMessage.edit(payload).then(() => true).catch(() => false);
    if (ok) return true;
  }
  try {
    const { id, token } = await getOrCreateWebhook(resolvedChannel);
    const hook = await client.fetchWebhook(id, token).catch(() => null);
    if (hook) {
      await hook.editMessage(post.id, payload).catch(() => {});
      return true;
    }
  } catch (error) {
    console.warn('[insta] Falha ao atualizar botões do post', error.message);
  }
  return false;
}

async function handlePostButtons(interaction) {
  const prisma = getPrisma();
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const postId = parts[2];
  const directionOrPage = parts[3];
  const maybePage = parts[4];
  let pageRaw = directionOrPage;
  if ((action === 'listlikes' || action === 'listcomments') && parts.length >= 5) {
    pageRaw = maybePage;
  }
  const post = await prisma.instaPostGlobal.findUnique({ where: { id: postId } });
  if (!post) {
    await interaction.reply({ content: 'Post não encontrado.', ephemeral: true });
    return true;
  }
  if (action === 'like') {
    const existing = await prisma.instaLikeGlobal.findUnique({ where: { postId_userId: { postId, userId: interaction.user.id } } }).catch(() => null);
    if (existing) {
      await prisma.instaLikeGlobal.delete({ where: { postId_userId: { postId, userId: interaction.user.id } } });
    } else {
      await prisma.instaLikeGlobal.create({ data: { postId, userId: interaction.user.id } });
    }
    const count = await prisma.instaLikeGlobal.count({ where: { postId } });
    const updatedPost = await prisma.instaPostGlobal.update({ where: { id: postId }, data: { likeCount: count } });
    const likeValue = updatedPost.likeCount || 0;
    const commentValue = updatedPost.commentCount || 0;
    const rowPayload = { components: [buildPostActionRow(postId, String(likeValue), String(commentValue))] };
    if (!interaction.deferred && !interaction.replied) {
      const updated = await interaction.update(rowPayload).then(() => true).catch(() => false);
      if (!updated) {
        await updatePostComponents(interaction.client, updatedPost, likeValue, commentValue, { message: interaction.message });
      }
    } else {
      await interaction.followUp({ content: 'Curtida atualizada.', ephemeral: true }).catch(() => {});
      await updatePostComponents(interaction.client, updatedPost, likeValue, commentValue);
    }
    return true;
  }
  if (action === 'comment') {
    const modal = new ModalBuilder()
      .setCustomId(`insta:commentModal:${postId}`)
      .setTitle('Adicionar comentário');
    const input = new TextInputBuilder()
      .setCustomId('insta:comment:text')
      .setLabel('Escreva seu comentário')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'listlikes') {
    const page = parseInt(pageRaw || '1', 10);
    const take = 10;
    const skip = (page - 1) * take;
    const total = await prisma.instaLikeGlobal.count({ where: { postId } });
    const likes = await prisma.instaLikeGlobal.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, skip, take });
    const totalPages = Math.max(1, Math.ceil(total / take));
    
    const author = await interaction.client.users.fetch(post.authorId).catch(() => null);
    const authorName = author?.username || 'Usuário';
    
    const embed = new EmbedBuilder()
      .setTitle(`Likes do post de ${authorName}`)
      .setColor(0xFFFFFF)
      .setDescription(likes.map((l) => `<@${l.userId}>`).join('\n') || 'Sem curtidas ainda.')
      .setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} likes` });
    const row = buildPaginationRow('listlikes', postId, page, totalPages);
    const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  if (action === 'listcomments') {
    const page = parseInt(pageRaw || '1', 10);
    const take = 5;
    const skip = (page - 1) * take;
    const total = await prisma.instaCommentGlobal.count({ where: { postId } });
    const comments = await prisma.instaCommentGlobal.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, skip, take });
    const totalPages = Math.max(1, Math.ceil(total / take));
    
    const author = await interaction.client.users.fetch(post.authorId).catch(() => null);
    const authorName = author?.username || 'Usuário';
    
    const desc = comments.map((c) => `<@${c.userId}>: ${c.content}`).join('\n') || 'Sem comentários ainda.';
    const embed = new EmbedBuilder()
      .setTitle(`Comentários do post de ${authorName}`)
      .setColor(0xFFFFFF)
      .setDescription(desc)
      .setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} comentários` });
    const row = buildPaginationRow('listcomments', postId, page, totalPages);
    const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  if (action === 'delete') {
    await interaction.deferUpdate().catch(() => {});
    if (interaction.user.id !== post.authorId) {
      await interaction.followUp({ content: 'Apenas o autor pode excluir este post.', ephemeral: true }).catch(() => {});
      return true;
    }
    await prisma.instaLikeGlobal.deleteMany({ where: { postId } });
    await prisma.instaCommentGlobal.deleteMany({ where: { postId } });
    await prisma.instaPostGlobal.delete({ where: { id: postId } });
    await interaction.message.delete().catch(() => {});
    return true;
  }
  return false;
}

async function handleCommentModal(interaction) {
  const prisma = getPrisma();
  const parts = interaction.customId.split(':');
  const postId = parts[2];
  const content = interaction.fields.getTextInputValue('insta:comment:text')?.trim();
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  if (!postId) {
    await interaction.editReply({ content: 'Identificador de post inválido.' }).catch(() => {});
    return true;
  }
  if (!content) {
    await interaction.editReply({ content: 'O comentário não pode estar vazio.' }).catch(() => {});
    return true;
  }
  const post = await prisma.instaPostGlobal.findUnique({ where: { id: postId } });
  if (!post) {
    await interaction.editReply({ content: 'Post não encontrado.' }).catch(() => {});
    return true;
  }
  await prisma.instaCommentGlobal.create({ data: { postId, userId: interaction.user.id, content } });
  const count = await prisma.instaCommentGlobal.count({ where: { postId } });
  const updatedPost = await prisma.instaPostGlobal.update({ where: { id: postId }, data: { commentCount: count } });
  const channel = await interaction.client.channels.fetch(post.channelId).catch(() => null);
  await updatePostComponents(interaction.client, updatedPost, updatedPost.likeCount || 0, count, { channel });
  await interaction.editReply({ content: 'Comentário adicionado com sucesso.' }).catch(() => {});
  return true;
}


async function getOrCreateWebhook(channel) {
  if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((h) => h.owner?.id === channel.client.user.id && h.name === 'Insta Relay');
  if (!hook) {
    hook = await channel.createWebhook({ name: 'Insta Relay' });
  }
  const data = { id: hook.id, token: hook.token };
  webhookCache.set(channel.id, data);
  return data;
}

async function handleMessage(message, ctx) {
  if (!message.guild || !ctx.isGuildAllowed(message.guildId)) return false;
  const prisma = getPrisma();
  const cfg = await getGlobalConfig(prisma);
  if (!cfg) return false;
  const isInsta = message.channelId === cfg.instaBoysChannelId || message.channelId === cfg.instaGirlsChannelId;
  if (!isInsta) return false;

  if (message.webhookId) {
    const until = instaWebhookBlock.get(message.channelId) || 0;
    if (Date.now() < until) {
      await message.delete().catch(() => {});
    }
    return true;
  }
  if (message.author.bot) {
    const until = instaWebhookBlock.get(message.channelId) || 0;
    if (Date.now() < until && message.author.id !== message.client.user.id) {
      await message.delete().catch(() => {});
    }
    return true;
  }

  const att = message.attachments?.first();
  if (!att) {
    await message.delete().catch(() => {});
    return true;
  }
  const verifiedUser = await prisma.verifiedUserGlobal.findUnique({ where: { userId: message.author.id } });
  if (!verifiedUser) {
    await message.delete().catch(() => {});
    instaWebhookBlock.set(message.channelId, Date.now() + 6000);
    const panelId = cfg.verifyPanelChannelId;
    const notice = panelId
      ? `<@${message.author.id}>, você precisa se verificar primeiro em <#${panelId}>.`
      : `<@${message.author.id}>, você precisa se verificar primeiro. O canal do painel de verificação não está configurado.`;
    try {
      const warn = await message.channel.send({
        content: notice,
        allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
      });
      setTimeout(() => warn.delete().catch(() => {}), 8000);
    } catch {}
    return true;
  }
  const requiredSex = message.channelId === cfg.instaBoysChannelId ? 'male'
    : message.channelId === cfg.instaGirlsChannelId ? 'female'
      : null;
  if (requiredSex && verifiedUser.sex !== requiredSex) {
    await message.delete().catch(() => {});
    instaWebhookBlock.set(message.channelId, Date.now() + 6000);
    const friendly = requiredSex === 'male' ? 'masculino' : 'feminino';
    const channelLabel = requiredSex === 'male' ? 'InstaBoy' : 'InstaGirl';
    const adjust = cfg.verifyPanelChannelId
      ? ` Peça para nossa equipe em <#${cfg.verifyPanelChannelId}> atualizar seu cadastro.`
      : '';
    try {
      const warn = await message.channel.send({
        content: `<@${message.author.id}>, apenas usuários do sexo ${friendly} podem postar no ${channelLabel}. ${adjust}`.trim(),
        allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
      });
      setTimeout(() => warn.delete().catch(() => {}), 8000);
    } catch {}
    return true;
  }

  const mediaType = (att.contentType || '').startsWith('image/')
    ? 'image'
    : (att.contentType || '').startsWith('video/')
      ? 'video'
      : att.name?.toLowerCase().endsWith('.gif')
        ? 'gif'
        : 'other';

  const embed = new EmbedBuilder().setColor(0x2c2f33).setFooter({ text: `Autor: ${message.author.username}` });
  const files = [];
  let downloaded = null;
  if (mediaType === 'image' || mediaType === 'gif') {
    downloaded = await downloadAttachment(att);
    if (downloaded) {
      files.push(new AttachmentBuilder(downloaded.buffer, { name: downloaded.name }));
      // image will be sent as a regular attachment (no embed)
    } else {
      // if we couldn't download, still attach by URL so Discord shows it inline
      files.push({ attachment: att.url, name: att.name || `media-${Date.now()}` });
    }
  } else if (mediaType === 'video' || mediaType === 'other') {
    files.push({ attachment: att.url, name: att.name || `media-${Date.now()}` });
  }

  const initialRow = buildPostActionRow('PENDING');

  const { id, token } = await getOrCreateWebhook(message.channel);
  const hook = await message.client.fetchWebhook(id, token).catch(() => null);
  if (!hook) return true;
  const payload = {
    username: message.member?.nickname || message.author.username,
    avatarURL: message.author.displayAvatarURL?.({ size: 128 }) || undefined,
    files,
    components: [initialRow],
  };
  // send without an embed so Discord shows the attachment(s) normally
  const sent = await hook.send(payload);
  await message.delete().catch(() => {});

  const storedMediaUrl = sent.attachments?.first()?.url || att.url;

  await prisma.instaPostGlobal.create({
    data: {
      id: sent.id,
      channelId: message.channelId,
      authorId: message.author.id,
      mediaUrl: storedMediaUrl,
      mediaType,
    },
  });
  const finalRow = buildPostActionRow(sent.id, '0', '0');
  try {
    await hook.editMessage(sent.id, { components: [finalRow] });
  } catch (error) {
    console.warn('[insta] Não consegui atualizar os botões do post', error.message);
  }
  return true;
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  const prisma = getPrisma();
  const cfg = await getGlobalConfig(prisma);
  if (!cfg?.verifiedRoleId) return false;
  const had = oldMember.roles.cache.has(cfg.verifiedRoleId);
  const has = newMember.roles.cache.has(cfg.verifiedRoleId);
  if (!had && has) {
    if (consumeBotVerifiedRoleAction(newMember.guild.id, newMember.id)) {
      return false;
    }
    if (await wasVerifiedRoleAddByBot(newMember.guild, newMember.id, cfg.verifiedRoleId)) {
      return false;
    }
    const exists = await prisma.verifiedUserGlobal.findUnique({ where: { userId: newMember.id } });
    if (!exists) {
      await newMember.roles.remove(cfg.verifiedRoleId).catch(() => {});
    }
  }
  return false;
}

async function wasVerifiedRoleAddByBot(guild, targetUserId, roleId) {
  if (!guild?.client?.user?.id) return false;
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
    for (const [, entry] of logs.entries) {
      if (entry.executorId !== guild.client.user.id) continue;
      if (entry.target?.id !== targetUserId) continue;
      const addedRoles = entry.changes?.find((change) => change.key === '$add')?.new;
      if (Array.isArray(addedRoles) && addedRoles.some((r) => r.id === roleId)) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[verify-protect] Falha ao consultar audit log para ver cargo verificado:', err?.message || err);
  }
  return false;
}

module.exports = {
  buildInstaEmbed,
  presentMenu,
  handleInteraction,
  handleMessage,
  handleGuildMemberUpdate,
};
