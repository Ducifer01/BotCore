const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const { getGlobalConfig, ensureGlobalConfig } = require('../services/globalConfig');
const { getPrisma } = require('../db');

const webhookCache = new Map();
const instaWebhookBlock = new Map();

function buildInstaEmbed(cfg) {
  const lines = [
    `• Insta Boys: ${cfg?.instaBoysChannelId ? `<#${cfg.instaBoysChannelId}>` : 'não definido'}`,
    `• Insta Girls: ${cfg?.instaGirlsChannelId ? `<#${cfg.instaGirlsChannelId}>` : 'não definido'}`,
    `• Canal de Fotos: ${cfg?.photosChannelId ? `<#${cfg.photosChannelId}>` : 'não definido'}`,
    `• Cargo Principal: ${cfg?.mainRoleId ? `<@&${cfg.mainRoleId}>` : 'não definido'}`,
    `• Cargo Verificado: ${cfg?.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : 'não definido'}`,
    `• Painel Verifique-se: ${cfg?.verifyPanelChannelId ? `<#${cfg.verifyPanelChannelId}>` : 'não definido'}`,
  ].join('\n');
  return new EmbedBuilder()
    .setTitle('Configurar Insta')
    .setDescription(`Ajuste as configurações abaixo.\n\n${lines}`)
    .setColor(0x2c2f33);
}

function buildInstaMenuRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:boys').setLabel('InstaBoy').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:insta:girls').setLabel('InstaGirl').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu:insta:pings').setLabel('Cargos Notificados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:photos').setLabel('Canal de Fotos').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu:insta:mainrole').setLabel('Cargo Principal').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifiedrole').setLabel('Cargo Verificado').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:verifypanel').setLabel('Painel Verifique-se').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu:insta:unverify').setLabel('Cancelar Verificação').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
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
    if (id.startsWith('reset:')) {
      return handleReset(interaction);
    }
  }
  return false;
}

async function handleConfigButtons(interaction, ctx) {
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    return true;
  }
  const action = interaction.customId.split(':')[2];
  let components;
  if (action === 'boys' || action === 'girls') {
    const label = action === 'boys' ? 'Definir InstaBoy' : 'Definir InstaGirl';
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`menu:insta:set:${action}`)
      .setPlaceholder('Selecione um canal de texto')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText);
    components = [new ActionRowBuilder().addComponents(select)];
    const embed = new EmbedBuilder().setTitle(label).setDescription('Selecione o canal para este modo.').setColor(0x2c2f33);
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
    return true;
  }
  if (action === 'pings') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId('menu:insta:pings:set')
      .setPlaceholder('Selecione até 10 cargos')
      .setMinValues(0)
      .setMaxValues(10);
    const embed = new EmbedBuilder().setTitle('Cargos Notificados').setDescription('Selecione cargos que serão mencionados ao abrir o ticket de verificação.').setColor(0x2c2f33);
    components = [new ActionRowBuilder().addComponents(select)];
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
    return true;
  }
  if (action === 'photos') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('menu:insta:photos:set')
      .setPlaceholder('Selecione um canal de texto')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText);
    const embed = new EmbedBuilder().setTitle('Canal de Fotos de Verificação').setDescription('Selecione o canal onde o bot enviará as fotos com resumo de verificação.').setColor(0x2c2f33);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (action === 'mainrole') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId('menu:insta:mainrole:set')
      .setPlaceholder('Selecione 1 cargo')
      .setMinValues(1)
      .setMaxValues(1);
    const embed = new EmbedBuilder().setTitle('Cargo Principal').setDescription('Selecione o cargo que pode verificar/encerrar.').setColor(0x2c2f33);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (action === 'verifiedrole') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId('menu:insta:verifiedrole:set')
      .setPlaceholder('Selecione 1 cargo')
      .setMinValues(1)
      .setMaxValues(1);
    const embed = new EmbedBuilder().setTitle('Cargo Verificado').setDescription('Selecione o cargo que representa usuários verificados.').setColor(0x2c2f33);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (action === 'verifypanel') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('menu:insta:verifypanel:set')
      .setPlaceholder('Selecione um canal de texto')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText);
    const embed = new EmbedBuilder().setTitle('Painel Verifique-se').setDescription('Selecione o canal onde ficará o painel de verificação.').setColor(0x2c2f33);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  if (action === 'unverify') {
    const select = new UserSelectMenuBuilder()
      .setCustomId('menu:insta:unverify:set')
      .setPlaceholder('Selecione 1 usuário')
      .setMinValues(1)
      .setMaxValues(1);
    const embed = new EmbedBuilder().setTitle('Cancelar Verificação').setDescription('Selecione o usuário verificado para cancelar a verificação.').setColor(0xED4245);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return true;
  }
  return false;
}

async function handleConfigSelect(interaction, ctx) {
  const { POSSE_USER_ID, ALLOWED_GUILD_IDS } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    return true;
  }
  const prisma = ctx.getPrisma();
  const cfg = await ensureGlobalConfig(prisma);
  const id = interaction.customId;

  if (id.startsWith('menu:insta:set:')) {
    const mode = id.split(':')[3];
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({
      where: { id: cfg.id },
      data: mode === 'boys' ? { instaBoysChannelId: channelId } : { instaGirlsChannelId: channelId },
    });
    await interaction.update({ content: `Canal de Insta ${mode === 'boys' ? 'Boys' : 'Girls'} definido: <#${channelId}>`, embeds: [], components: [] });
    return true;
  }
  if (id === 'menu:insta:pings:set') {
    const roleIds = [...new Set(interaction.values || [])];
    await prisma.ticketPingRoleGlobal.deleteMany({ where: { globalConfigId: cfg.id } });
    if (roleIds.length) {
      await prisma.ticketPingRoleGlobal.createMany({ data: roleIds.map((roleId) => ({ globalConfigId: cfg.id, roleId })) });
    }
    await interaction.update({ content: `Cargos notificados atualizados: ${roleIds.map((rid) => `<@&${rid}>`).join(', ') || 'nenhum'}`, embeds: [], components: [] });
    return true;
  }
  if (id === 'menu:insta:photos:set') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { photosChannelId: channelId } });
    const refreshed = await getGlobalConfig(prisma);
    await interaction.update({ content: `Canal de fotos definido: <#${channelId}>`, embeds: [buildInstaEmbed(refreshed)], components: buildInstaMenuRows() });
    return true;
  }
  if (id === 'menu:insta:mainrole:set') {
    const roleId = interaction.values?.[0];
    if (!roleId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { mainRoleId: roleId } });
    const refreshed = await getGlobalConfig(prisma);
    await interaction.update({ content: `Cargo principal definido: <@&${roleId}>`, embeds: [buildInstaEmbed(refreshed)], components: buildInstaMenuRows() });
    return true;
  }
  if (id === 'menu:insta:verifiedrole:set') {
    const roleId = interaction.values?.[0];
    if (!roleId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { verifiedRoleId: roleId } });
    const refreshed = await getGlobalConfig(prisma);
    await interaction.update({ content: `Cargo verificado definido: <@&${roleId}>`, embeds: [buildInstaEmbed(refreshed)], components: buildInstaMenuRows() });
    return true;
  }
  if (id === 'menu:insta:verifypanel:set') {
    const channelId = interaction.values?.[0];
    if (!channelId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { verifyPanelChannelId: channelId } });
    const refreshed = await getGlobalConfig(prisma);
    await interaction.update({ content: `Painel de verificação definido: <#${channelId}>`, embeds: [buildInstaEmbed(refreshed)], components: buildInstaMenuRows() });
    return true;
  }
  if (id === 'menu:insta:unverify:set') {
    const userId = interaction.values?.[0];
    if (!userId) {
      await interaction.reply({ content: 'Seleção inválida.', ephemeral: true });
      return true;
    }
    const fullCfg = await getGlobalConfig(prisma);
    await prisma.verifiedUserGlobal.deleteMany({ where: { userId } });
    if (fullCfg?.verifiedRoleId) {
      try {
        const localMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (localMember && localMember.roles.cache.has(fullCfg.verifiedRoleId)) {
          await localMember.roles.remove(fullCfg.verifiedRoleId).catch(() => {});
        }
        for (const gid of ALLOWED_GUILD_IDS) {
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
    await interaction.update({ content: `Verificação cancelada para <@${userId}>. Removido do banco e do cargo verificado (todos servidores permitidos).`, embeds: [], components: [] });
    return true;
  }
  return false;
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

async function handleReset(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'cancel') {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Cancelado.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Cancelado.', ephemeral: true });
    }
    return true;
  }
  if (action === 'confirm') {
    const requesterId = interaction.customId.split(':')[2];
    if (requesterId !== interaction.user.id) {
      await interaction.reply({ content: 'Apenas quem solicitou pode confirmar.', ephemeral: true });
      return true;
    }
    const prisma = getPrisma();
    const cfg = await getGlobalConfig(prisma);
    if (!cfg?.instaBoysChannelId && !cfg?.instaGirlsChannelId) {
      await interaction.reply({ content: 'Canais de insta não configurados.', ephemeral: true });
      return true;
    }
    const channels = [cfg.instaBoysChannelId, cfg.instaGirlsChannelId].filter(Boolean);
    for (const chId of channels) {
      const posts = await prisma.instaPostGlobal.findMany({ where: { channelId: chId }, orderBy: { likeCount: 'desc' } });
      const winner = posts[0];
      const channel = await interaction.guild.channels.fetch(chId).catch(() => null);
      if (!channel) continue;
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
      }
      for (const p of posts) {
        if (winner && p.id === winner.id) continue;
        await prisma.instaLikeGlobal.deleteMany({ where: { postId: p.id } });
        await prisma.instaCommentGlobal.deleteMany({ where: { postId: p.id } });
        await prisma.instaPostGlobal.delete({ where: { id: p.id } });
        await channel.messages.delete(p.id).catch(() => {});
      }
    }
    await interaction.reply({ content: 'Reset concluído.', ephemeral: true });
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
