const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');

const webhookCache = new Map();
const instaWebhookBlock = new Map();

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
    `• Canal de Fotos: ${cfg?.photosChannelId ? `<#${cfg.photosChannelId}>` : 'não definido'}`,
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
    new ButtonBuilder().setCustomId('menu:insta:photos').setLabel('Canal de Fotos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifypanel').setLabel('Painel Verifique-se').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:insta:mainrole').setLabel('Cargo Principal').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifiedrole').setLabel('Cargo Verificado').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:pings').setLabel('Cargos Notificados').setStyle(ButtonStyle.Secondary),
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
  if (action === 'photos') {
    return showChannelPrompt(interaction, {
      title: 'Canal de Fotos da Verificação',
      description: 'Escolha o canal onde o bot registrará as fotos aprovadas.',
      customId: 'menu:insta:select:photos',
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

  if (target === 'photos') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      return renderHome(interaction, prisma, { type: 'error', message: 'Seleção inválida.' });
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { photosChannelId: channelId } });
    return renderHome(interaction, prisma, { type: 'success', message: `Canal de fotos definido: <#${channelId}>` });
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
    const winner = posts[0];
    if (winner) {
      const text = `Ganhador da semana\n<@${winner.authorId}>\n${winner.likeCount} curtidas`;
      const isImage = winner.mediaType === 'image' || winner.mediaType === 'gif';
      const embed = new EmbedBuilder().setDescription(text).setColor(0x2ECC71);
      if (isImage) embed.setImage(winner.mediaUrl);
      let msg;
      if (isImage) {
        msg = await channel.send({ embeds: [embed] });
      } else {
        msg = await channel.send({ content: text, files: [{ attachment: winner.mediaUrl, name: 'midia' }] });
      }
      await prisma.instaWinnerGlobal.create({
        data: {
          channelId: chId,
          postId: winner.id,
          winnerUserId: winner.authorId,
          likeCount: winner.likeCount,
          winnerMessageId: msg.id,
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
  }

  const message = summaries.length ? summaries.join(' ') : 'Reset concluído.';
  return renderHome(interaction, prisma, { type: 'success', message });
}

async function handlePostButtons(interaction) {
  const prisma = getPrisma();
  const [_, action, postId, pageRaw] = interaction.customId.split(':');
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
    await prisma.instaPostGlobal.update({ where: { id: postId }, data: { likeCount: count } });
    try {
      const row = ActionRowBuilder.from(interaction.message.components[0]);
      const btns = row.components.map((c) => ButtonBuilder.from(c));
      btns[0].setLabel(String(count));
      const newRow = new ActionRowBuilder().addComponents(btns);
      await interaction.update({ components: [newRow] });
    } catch {
      await interaction.reply({ content: 'Curtida atualizada.', ephemeral: true });
    }
    return true;
  }
  if (action === 'comment') {
    await interaction.reply({ content: 'Envie sua mensagem como comentário (60s).', ephemeral: true });
    const filter = (m) => m.author.id === interaction.user.id && m.channelId === interaction.channelId;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
    collector.on('collect', async (m) => {
      const content = (m.content || '').trim();
      if (content) {
        await prisma.instaCommentGlobal.create({ data: { postId, userId: m.author.id, content } });
        const count = await prisma.instaCommentGlobal.count({ where: { postId } });
        await prisma.instaPostGlobal.update({ where: { id: postId }, data: { commentCount: count } });
        try {
          const row = ActionRowBuilder.from(interaction.message.components[0]);
          const btns = row.components.map((c) => ButtonBuilder.from(c));
          btns[1].setLabel(String(count));
          const newRow = new ActionRowBuilder().addComponents(btns);
          await interaction.followUp({ content: 'Comentário adicionado.', ephemeral: true });
          await interaction.message.edit({ components: [newRow] }).catch(() => {});
        } catch {}
      }
      await m.delete().catch(() => {});
    });
    return true;
  }
  if (action === 'listlikes') {
    const page = parseInt(pageRaw || '1', 10);
    const take = 10;
    const skip = (page - 1) * take;
    const total = await prisma.instaLikeGlobal.count({ where: { postId } });
    const likes = await prisma.instaLikeGlobal.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, skip, take });
    const totalPages = Math.max(1, Math.ceil(total / take));
    const embed = new EmbedBuilder()
      .setTitle(`Likes do post de <@${post.authorId}>`)
      .setColor(0xFFFFFF)
      .setDescription(likes.map((l) => `<@${l.userId}>`).join('\n') || 'Sem curtidas ainda.')
      .setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} likes` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`insta:listlikes:${postId}:${Math.max(1, page - 1)}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`insta:listlikes:${postId}:${Math.min(totalPages, page + 1)}`).setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
    );
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
    const desc = comments.map((c) => `<@${c.userId}>: ${c.content}`).join('\n') || 'Sem comentários ainda.';
    const embed = new EmbedBuilder()
      .setTitle(`Comentários do post de <@${post.authorId}>`)
      .setColor(0xFFFFFF)
      .setDescription(desc)
      .setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} comentários` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`insta:listcomments:${postId}:${Math.max(1, page - 1)}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`insta:listcomments:${postId}:${Math.min(totalPages, page + 1)}`).setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
    );
    const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  if (action === 'delete') {
    if (interaction.user.id !== post.authorId) {
      await interaction.reply({ content: 'Apenas o autor pode excluir este post.', ephemeral: true });
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
  const isVerified = !!(await prisma.verifiedUserGlobal.findUnique({ where: { userId: message.author.id } }));
  if (!isVerified) {
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

  const mediaType = (att.contentType || '').startsWith('image/')
    ? 'image'
    : (att.contentType || '').startsWith('video/')
      ? 'video'
      : att.name?.toLowerCase().endsWith('.gif')
        ? 'gif'
        : 'other';

  const likeBtn = new ButtonBuilder().setCustomId('insta:like:PENDING').setEmoji('❤️').setLabel('0').setStyle(ButtonStyle.Secondary);
  const commentBtn = new ButtonBuilder().setCustomId('insta:comment:PENDING').setEmoji('💬').setLabel('0').setStyle(ButtonStyle.Secondary);
  const listLikesBtn = new ButtonBuilder().setCustomId('insta:listlikes:PENDING:1').setEmoji('📃').setStyle(ButtonStyle.Secondary);
  const listCommentsBtn = new ButtonBuilder().setCustomId('insta:listcomments:PENDING:1').setEmoji('📝').setStyle(ButtonStyle.Secondary);
  const deleteBtn = new ButtonBuilder().setCustomId('insta:delete:PENDING').setEmoji('🗑️').setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(likeBtn, commentBtn, listLikesBtn, listCommentsBtn, deleteBtn);
  const embed = new EmbedBuilder().setColor(0x2c2f33).setFooter({ text: `Autor: ${message.author.username}` });
  if (mediaType === 'image' || mediaType === 'gif') {
    embed.setImage(att.url);
  }

  const { id, token } = await getOrCreateWebhook(message.channel);
  const hook = await message.client.fetchWebhook(id, token).catch(() => null);
  if (!hook) return true;
  const sent = await hook.send({
    username: message.member?.nickname || message.author.username,
    avatarURL: message.author.displayAvatarURL?.({ size: 128 }) || undefined,
    embeds: mediaType === 'image' || mediaType === 'gif' ? [embed] : [],
    files: mediaType === 'video' || mediaType === 'other' ? [{ attachment: att.url, name: att.name }] : [],
    components: [row],
  });
  await message.delete().catch(() => {});

  await prisma.instaPostGlobal.create({
    data: {
      id: sent.id,
      channelId: message.channelId,
      authorId: message.author.id,
      mediaUrl: att.url,
      mediaType,
    },
  });
  const newRow = new ActionRowBuilder().addComponents(
    likeBtn.setCustomId(`insta:like:${sent.id}`),
    commentBtn.setCustomId(`insta:comment:${sent.id}`),
    listLikesBtn.setCustomId(`insta:listlikes:${sent.id}:1`),
    listCommentsBtn.setCustomId(`insta:listcomments:${sent.id}:1`),
    deleteBtn.setCustomId(`insta:delete:${sent.id}`),
  );
  await sent.edit({ components: [newRow] }).catch(() => {});
  return true;
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  const prisma = getPrisma();
  const cfg = await getGlobalConfig(prisma);
  if (!cfg?.verifiedRoleId) return false;
  const had = oldMember.roles.cache.has(cfg.verifiedRoleId);
  const has = newMember.roles.cache.has(cfg.verifiedRoleId);
  if (!had && has) {
    const exists = await prisma.verifiedUserGlobal.findUnique({ where: { userId: newMember.id } });
    if (!exists) {
      await newMember.roles.remove(cfg.verifiedRoleId).catch(() => {});
    }
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
