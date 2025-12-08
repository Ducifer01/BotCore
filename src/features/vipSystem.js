const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const {
  ensureVipConfig,
  getVipConfig,
  createMembership,
  getMembershipByUser,
  adjustMembershipDays,
  deleteMembership,
  saveVipTag,
  saveVipChannel,
  listExpiringMemberships,
} = require('../services/vip');
const { getPrisma } = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_COLOR = 0xffffff;
const ERROR_COLOR = 0xff4d4d;
const CHECK_INTERVAL = 60_000;
const INPUT_TIMEOUT = 120_000;
let intervalRef = null;
const promptCollectors = new Map();

async function ensureInteractionAck(interaction) {
  if (!interaction || interaction.deferred || interaction.replied) return;
  if (typeof interaction.deferUpdate === 'function') {
    await interaction.deferUpdate().catch(() => {});
  } else if (typeof interaction.deferReply === 'function') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function updateVipPanel(interaction, payload) {
  if (!interaction) return;
  await ensureInteractionAck(interaction);
  await interaction.editReply(payload).catch(() => {});
}

function cloneComponentRows(rows = []) {
  return rows.map((row) => ActionRowBuilder.from(row));
}

function buildNoticePayload(interaction, message, { isError = false, includeExisting = true, keepComponents = true } = {}) {
  const embeds = [buildInfoEmbed(message, isError)];
  if (includeExisting && interaction?.message?.embeds?.length) {
    const existing = interaction.message.embeds.slice(0, 9).map((embed) => EmbedBuilder.from(embed));
    embeds.push(...existing);
  }
  return {
    embeds: embeds.slice(0, 10),
    components: keepComponents ? cloneComponentRows(interaction?.message?.components || []) : [],
  };
}

async function ensureMemberHasTag(guild, membership, roleId) {
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(membership.userId).catch(() => null);
    if (!member) return;
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId).catch(() => {});
    }
  } catch {
    // ignore failures silently
  }
}

async function ensureMemberHasTag(guild, membership, roleId) {
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(membership.userId).catch(() => null);
    if (!member) return;
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId).catch(() => {});
    }
  } catch {
    // ignore assignment failures silently
  }
}

function registerVipFeature(client) {
  if (intervalRef) {
    clearInterval(intervalRef);
  }
  intervalRef = setInterval(() => sweepExpirations(client).catch(console.error), CHECK_INTERVAL);
  client.on('voiceStateUpdate', (oldState, newState) => handleVoiceStateUpdate(oldState, newState).catch(() => {}));
}

async function sweepExpirations(client) {
  const prisma = getPrisma();
  const expired = await listExpiringMemberships(prisma);
  for (const membership of expired) {
    const guild = client.guilds.cache.get(membership.guildId);
    if (!guild) continue;
    await cleanupMembership(guild, membership, 'system').catch(() => {});
  }
}

async function cleanupMembership(guild, membership, actorId) {
  const prisma = getPrisma();
  const member = await guild.members.fetch(membership.userId).catch(() => null);
  const vipRoleId = membership.plan?.vipRoleId || membership.vipRoleId;
  if (member) {
    if (vipRoleId) {
      await member.roles.remove(vipRoleId).catch(() => {});
    }
    if (membership.bonusRoleId) {
      await member.roles.remove(membership.bonusRoleId).catch(() => {});
    }
  }
  if (membership.tag?.roleId) {
    const role = guild.roles.cache.get(membership.tag.roleId) || (await guild.roles.fetch(membership.tag.roleId).catch(() => null));
    if (role) await role.delete('VIP expirado').catch(() => {});
    await prisma.vipTag.deleteMany({ where: { membershipId: membership.id } }).catch(() => {});
  }
  if (membership.channel?.channelId) {
    const channel = guild.channels.cache.get(membership.channel.channelId) || (await guild.channels.fetch(membership.channel.channelId).catch(() => null));
    if (channel) await channel.delete('VIP expirado').catch(() => {});
    await prisma.vipChannel.deleteMany({ where: { membershipId: membership.id } }).catch(() => {});
  }
  await deleteMembership(membership.id, prisma, actorId).catch(() => {});
}

async function handleVoiceStateUpdate(oldState, newState) {
  const channel = newState.channel || oldState.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  const prisma = getPrisma();
  const vipChannel = await prisma.vipChannel.findFirst({ where: { channelId: channel.id }, include: { membership: { include: { plan: { include: { config: true } } } } } });
  if (!vipChannel) return;
  const cfg = await getVipConfig(prisma);
  const everyone = channel.guild.roles.everyone;
  if (cfg?.hideEmptyChannels === false) {
    await channel.permissionOverwrites.edit(everyone, { ViewChannel: true, Connect: false }).catch(() => {});
    return;
  }
  const isEmpty = channel.members.filter((m) => !m.user.bot).size === 0;
  if (isEmpty) {
    await channel.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(() => {});
  } else {
    await channel.permissionOverwrites.edit(everyone, { ViewChannel: true, Connect: false }).catch(() => {});
  }
}

function formatTimestamp(date, style = 'F') {
  const ts = Math.floor(date.getTime() / 1000);
  return `<t:${ts}:${style}>`;
}

function buildVipHomePayload(user, membership) {
  const embed = new EmbedBuilder()
    .setTitle(`VIP - ${user.username}`)
    .setColor(0xffffff)
    .setDescription(`Seu VIP encerra em ${formatTimestamp(membership.expiresAt)}`)
    .addFields(
      {
        name: 'Tag',
        value: membership.tag?.roleId ? `<@&${membership.tag.roleId}>` : 'Nenhuma tag criada.',
        inline: true,
      },
      {
        name: 'Canal',
        value: membership.channel?.channelId ? `<#${membership.channel.channelId}>` : 'Nenhum canal configurado.',
        inline: true,
      },
      {
        name: 'Comandos',
        value: '• /addvip\n• /removevip\n• /addvipc\n• /removevipc',
        inline: false,
      },
  )
  .setFooter({ text: 'Atualizado' })
  .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vipuser:tag').setLabel('Editar tag').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vipuser:channel').setLabel('Editar canal').setEmoji('🔊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vipuser:close').setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function formatVipTagEmoji(tag) {
  if (tag?.iconHash && tag?.emoji) {
    return `<:${tag.emoji}:${tag.iconHash}>`;
  }
  if (tag?.emoji) {
    return `:${tag.emoji}:`;
  }
  return 'Nenhum emoji configurado.';
}

function buildVipTagView(membership, { status, isError } = {}) {
  const hasTag = Boolean(membership.tag?.roleId);
  const lines = [];
  if (membership.tag?.roleId) {
    lines.push(`• Cargo: <@&${membership.tag.roleId}>`);
  }
  if (membership.tag?.name) {
    lines.push(`• Nome: ${membership.tag.name}`);
  }
  if (membership.tag?.color) {
    lines.push(`• Cor: ${membership.tag.color}`);
  }
  const emojiValue = formatVipTagEmoji(membership.tag);
  const embed = new EmbedBuilder()
    .setTitle('Editar tag')
    .setColor(isError ? ERROR_COLOR : 0xffffff)
    .setDescription(lines.length ? lines.join('\n') : 'Nenhuma tag criada.')
    .addFields({ name: 'Emoji', value: emojiValue, inline: true })
    .setFooter({ text: membership.tag?.roleId ? 'Tag ativa' : 'Crie sua tag para começar' });

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('viptag:create').setLabel('Criar tag').setEmoji('🆕').setStyle(ButtonStyle.Success).setDisabled(hasTag),
    new ButtonBuilder().setCustomId('viptag:name').setLabel('Editar nome').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
    new ButtonBuilder().setCustomId('viptag:color').setLabel('Editar cor').setEmoji('🎨').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
    new ButtonBuilder().setCustomId('viptag:emoji').setLabel('Editar emoji').setEmoji('😀').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
    new ButtonBuilder().setCustomId('viptag:back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function formatVipChannelLimit(value) {
  if (value === null || value === undefined) return 'Ilimitado';
  if (Number(value) === 0) return 'Ilimitado';
  return `${value}`;
}

function buildVipChannelView(membership, { status, isError } = {}) {
  const hasChannel = Boolean(membership.channel?.channelId);
  const description = hasChannel
    ? [
        `• Canal: <#${membership.channel.channelId}>`,
        membership.channel.name ? `• Nome: ${membership.channel.name}` : null,
        `• Limite: ${formatVipChannelLimit(membership.channel.userLimit)}`,
      ]
        .filter(Boolean)
        .join('\n')
    : 'Nenhum canal criado.';

  const embed = new EmbedBuilder()
    .setTitle('Editar canal VIP')
    .setColor(isError ? ERROR_COLOR : 0xffffff)
    .setDescription(description)
    .setFooter({ text: hasChannel ? 'Canal pronto' : 'Crie seu canal para começar' });

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vipchan:create').setLabel('Criar canal').setEmoji('🆕').setStyle(ButtonStyle.Success).setDisabled(hasChannel),
    new ButtonBuilder().setCustomId('vipchan:name').setLabel('Editar nome').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(!hasChannel),
    new ButtonBuilder().setCustomId('vipchan:limit').setLabel('Editar limite').setEmoji('👥').setStyle(ButtonStyle.Secondary).setDisabled(!hasChannel),
    new ButtonBuilder().setCustomId('vipchan:fix').setLabel('Desbugar').setEmoji('🔧').setStyle(ButtonStyle.Danger).setDisabled(!hasChannel),
    new ButtonBuilder().setCustomId('vipchan:back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function buildVipChannelPromptPayload(membership, { promptKey, title, instructions, status, isError } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(isError ? ERROR_COLOR : 0xffffff)
    .setDescription(`${instructions}\n\nDigite sua resposta neste chat. Para cancelar, escreva **cancelar** ou use o botão abaixo.`)
    .addFields(
      { name: 'Canal', value: membership.channel?.channelId ? `<#${membership.channel.channelId}>` : 'Nenhum canal criado.', inline: true },
      { name: 'Nome atual', value: membership.channel?.name || '—', inline: true },
      { name: 'Limite atual', value: formatVipChannelLimit(membership.channel?.userLimit), inline: true },
    )
    .setFooter({ text: 'Entrada expira em 2 minutos' })
    .setTimestamp(new Date());

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vipchan:cancel:${promptKey}`).setLabel('Cancelar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

async function promptVipChannelInput(interaction, membership, { promptKey, title, instructions, onSubmit }) {
  if (!interaction.channel) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Abra este painel em um canal de texto para enviar respostas.', { isError: true, includeExisting: false }));
    return;
  }
  const render = (state = {}) =>
    buildVipChannelPromptPayload(membership, {
      promptKey,
      title,
      instructions,
      status: state.status,
      isError: state.isError,
    });

  await updateVipPanel(interaction, render());
  const key = getPromptKey(interaction.user.id, promptKey, interaction.guildId);
  const filter = (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId;
  const collector = interaction.channel.createMessageCollector({ filter, time: INPUT_TIMEOUT });
  registerCollector(key, collector);

  collector.on('collect', async (msg) => {
    try {
      const content = (msg.content || '').trim();
      if (!content) return;
      if (content.toLowerCase() === 'cancelar') {
        collector.stop('cancelled');
        await refreshChannelView(interaction, membership, { status: 'Operação cancelada.', isError: true });
        return;
      }
      try {
        const result = await onSubmit(content);
        collector.stop('handled');
        const successMessage = typeof result === 'string' ? result : result?.status;
        await refreshChannelView(interaction, membership, successMessage ? { status: successMessage } : undefined);
        return;
      } catch (err) {
        await updateVipPanel(
          interaction,
          render({ status: err.message || 'Não foi possível processar sua resposta.', isError: true }),
        );
      }
      collector.resetTimer();
    } finally {
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (['handled', 'cancelled', 'replaced'].includes(reason)) return;
    await refreshChannelView(interaction, membership, { status: 'Tempo esgotado para responder.', isError: true });
  });
}

function buildVipAdminPromptPayload({ promptKey, title, instructions, status, isError } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(isError ? ERROR_COLOR : 0xffffff)
    .setDescription(`${instructions}\n\nDigite sua resposta neste chat. Para cancelar, escreva **cancelar** ou use o botão abaixo.`)
    .setFooter({ text: 'Entrada expira em 2 minutos' })
    .setTimestamp(new Date());

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vipadmin:cancel:${promptKey || 'vipadmin-view'}`).setLabel('Cancelar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

async function promptVipAdminInput(interaction, { promptKey, title, instructions, onSubmit }) {
  const resolvedPromptKey = promptKey || 'vipadmin-view';
  if (!interaction.channel) {
    await updateVipPanel(
      interaction,
      buildNoticePayload(interaction, 'Abra este painel em um canal de texto para enviar respostas.', {
        isError: true,
        includeExisting: false,
      }),
    );
    return;
  }

  const render = (state = {}) =>
    buildVipAdminPromptPayload({
      promptKey: resolvedPromptKey,
      title,
      instructions,
      status: state.status,
      isError: state.isError,
    });

  await updateVipPanel(interaction, render());
  const key = getPromptKey(interaction.user.id, resolvedPromptKey, interaction.guildId);
  const filter = (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId;
  const collector = interaction.channel.createMessageCollector({ filter, time: INPUT_TIMEOUT });
  registerCollector(key, collector);

  collector.on('collect', async (msg) => {
    try {
      const content = (msg.content || '').trim();
      if (!content) return;
      if (content.toLowerCase() === 'cancelar') {
        collector.stop('cancelled');
        await updateVipPanel(interaction, buildVipAdminHomePayload());
        return;
      }
      try {
        const result = await onSubmit(content);
        collector.stop('handled');
        if (result?.payload) {
          await updateVipPanel(interaction, result.payload);
        } else if (result?.status) {
          await updateVipPanel(
            interaction,
            buildVipAdminPromptPayload({
              promptKey: resolvedPromptKey,
              title,
              instructions,
              status: result.status,
              isError: result.isError,
            }),
          );
        } else {
          await updateVipPanel(interaction, buildVipAdminHomePayload());
        }
        return;
      } catch (err) {
        await updateVipPanel(
          interaction,
          render({ status: err.message || 'Não foi possível processar sua resposta.', isError: true }),
        );
      }
      collector.resetTimer();
    } finally {
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (['handled', 'cancelled', 'replaced'].includes(reason)) return;
    await updateVipPanel(interaction, buildVipAdminHomePayload());
    await interaction
      .followUp({ embeds: [buildInfoEmbed('Tempo esgotado para responder.', true)], ephemeral: true })
      .catch(() => {});
  });
}

function buildVipTagPromptPayload(membership, { promptKey, title, instructions, status, isError } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(isError ? ERROR_COLOR : 0xffffff)
    .setDescription(`${instructions}\n\nDigite sua resposta neste chat. Para cancelar, escreva **cancelar** ou use o botão abaixo.`)
    .addFields(
      { name: 'Cargo', value: membership.tag?.roleId ? `<@&${membership.tag.roleId}>` : 'Nenhuma tag criada.', inline: true },
      { name: 'Nome atual', value: membership.tag?.name || '—', inline: true },
      { name: 'Cor atual', value: membership.tag?.color || '—', inline: true },
      { name: 'Emoji', value: formatVipTagEmoji(membership.tag), inline: true },
    )
    .setFooter({ text: 'Entrada expira em 2 minutos' })
    .setTimestamp(new Date());

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`viptag:cancel:${promptKey}`).setLabel('Cancelar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function stopPrompt(interaction, actionKey, reason = 'cancelled') {
  if (!interaction) return;
  const key = getPromptKey(interaction.user.id, actionKey, interaction.guildId);
  const collector = promptCollectors.get(key);
  if (collector) {
    try {
      collector.stop(reason);
    } catch {
      // ignore
    }
  }
}

async function promptVipTagInput(interaction, membership, { promptKey, title, instructions, onSubmit }) {
  if (!interaction.channel) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Abra este painel em um canal de texto para enviar respostas.', { isError: true, includeExisting: false }));
    return;
  }
  const render = (state = {}) =>
    buildVipTagPromptPayload(membership, {
      promptKey,
      title,
      instructions,
      status: state.status,
      isError: state.isError,
    });

  await updateVipPanel(interaction, render());
  const key = getPromptKey(interaction.user.id, promptKey, interaction.guildId);
  const filter = (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId;
  const collector = interaction.channel.createMessageCollector({ filter, time: INPUT_TIMEOUT });
  registerCollector(key, collector);

  collector.on('collect', async (msg) => {
    try {
      const content = (msg.content || '').trim();
      if (!content) return;
      if (content.toLowerCase() === 'cancelar') {
        collector.stop('cancelled');
        await refreshTagView(interaction, membership, { status: 'Operação cancelada.', isError: true });
        return;
      }
      try {
        const result = await onSubmit(content);
        collector.stop('handled');
        const successMessage = typeof result === 'string' ? result : result?.status;
        await refreshTagView(interaction, membership, successMessage ? { status: successMessage } : undefined);
        return;
      } catch (err) {
        await updateVipPanel(
          interaction,
          render({ status: err.message || 'Não foi possível processar sua resposta.', isError: true }),
        );
      }
      collector.resetTimer();
    } finally {
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (['handled', 'cancelled', 'replaced'].includes(reason)) return;
    await refreshTagView(interaction, membership, { status: 'Tempo esgotado para responder.', isError: true });
  });
}

async function refreshTagView(interaction, membership, options) {
  if (!interaction) return;
  await updateVipPanel(interaction, buildVipTagView(membership, options));
}

async function refreshChannelView(interaction, membership, options) {
  if (!interaction) return;
  await updateVipPanel(interaction, buildVipChannelView(membership, options));
}

function buildInfoEmbed(message, isError = false) {
  return new EmbedBuilder().setColor(isError ? ERROR_COLOR : SUCCESS_COLOR).setDescription(message);
}

function buildVipAdminHomePayload() {
  const embed = new EmbedBuilder()
    .setTitle('Administração de VIPs')
    .setDescription('Escolha uma ação para gerenciar membros VIP.')
    .setColor(0xffffff);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vipadmin:list:1').setLabel('Listar usuários').setEmoji('📋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vipadmin:prompt-view').setLabel('Ver VIP').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function getPromptKey(userId, action, guildId) {
  return `${userId}:${guildId}:${action}`;
}

function registerCollector(key, collector) {
  if (promptCollectors.has(key)) {
    try {
      promptCollectors.get(key).stop('replaced');
    } catch {
      // ignore
    }
  }
  promptCollectors.set(key, collector);
  collector.on('end', () => {
    if (promptCollectors.get(key) === collector) {
      promptCollectors.delete(key);
    }
  });
}

async function promptText(interaction, action, question, handler) {
  if (!interaction.channel) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Abra este painel em um canal de texto para enviar respostas.', { isError: true, includeExisting: false }));
    return;
  }
  await ensureInteractionAck(interaction);
  await interaction.followUp({ content: question, ephemeral: true });
  const key = getPromptKey(interaction.user.id, action, interaction.guildId);
  const filter = (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId;
  const collector = interaction.channel.createMessageCollector({ filter, time: INPUT_TIMEOUT, max: 1 });
  registerCollector(key, collector);

  collector.on('collect', async (msg) => {
    try {
      const content = (msg.content || '').trim();
      if (!content) return;
      if (content.toLowerCase() === 'cancelar') {
        await msg.reply({ content: 'Operação cancelada.', allowedMentions: { repliedUser: false } });
        return;
      }
      await handler(content, msg);
    } catch (err) {
      await msg.reply({ content: `Erro: ${err.message}`, allowedMentions: { repliedUser: false } }).catch(() => {});
    } finally {
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'limit' && reason !== 'replaced') {
      interaction.followUp({ embeds: [buildInfoEmbed('Tempo esgotado para responder.', true)], ephemeral: true }).catch(() => {});
    }
  });
}

async function ensureVipTagRole(interaction, membership, prisma, { createIfMissing = false } = {}) {
  if (membership.tag?.roleId) {
    const existing = interaction.guild.roles.cache.get(membership.tag.roleId) || (await interaction.guild.roles.fetch(membership.tag.roleId).catch(() => null));
    if (existing) {
      if (membership.tag.iconData) {
        await existing.setIcon(membership.tag.iconData).catch(() => {});
      }
      await ensureMemberHasTag(interaction.guild, membership, existing.id);
      return { role: existing, record: membership.tag };
    }
    membership.tag = await saveVipTag(membership.id, { roleId: null }, prisma);
  }

  if (!createIfMissing) {
    throw new Error('Nenhuma tag encontrada. Use o botão "Criar tag".');
  }

  const baseName = (membership.tag?.name || `VIP ${interaction.user.username}`).slice(0, 90);
  const color = membership.tag?.color || '#ffffff';
  const role = await interaction.guild.roles.create({
    name: baseName,
    color,
    mentionable: true,
    permissions: [],
    reason: 'Tag VIP criada automaticamente',
  });
  if (membership.plan?.tagSeparatorRoleId) {
    const separator = interaction.guild.roles.cache.get(membership.plan.tagSeparatorRoleId) || (await interaction.guild.roles.fetch(membership.plan.tagSeparatorRoleId).catch(() => null));
    if (separator) {
      await role.setPosition(Math.max(separator.position - 1, 1)).catch(() => {});
    }
  }
  const record = await saveVipTag(membership.id, { roleId: role.id, name: role.name, color }, prisma);
  membership.tag = record;
  if (membership.tag?.iconData) {
    await role.setIcon(membership.tag.iconData).catch(() => {});
  }
  await ensureMemberHasTag(interaction.guild, membership, role.id);
  return { role, record };
}

async function applyBaseChannelPermissions(channel, membership) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false, Connect: false }).catch(() => {});
  if (membership.plan?.vipRoleId) {
    await channel.permissionOverwrites.edit(membership.plan.vipRoleId, { ViewChannel: true, Connect: true }).catch(() => {});
  }
  await channel.permissionOverwrites.edit(membership.userId, {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    Stream: true,
  }).catch(() => {});
}

async function syncChannelShares(channel, membership) {
  if (!membership.channel?.permissions?.length) return;
  for (const perm of membership.channel.permissions) {
    await channel.permissionOverwrites
      .edit(perm.targetUserId, {
        ViewChannel: perm.allowView,
        Connect: perm.allowConnect,
      })
      .catch(() => {});
  }
}

async function ensureVipChannel(interaction, membership, prisma, { createIfMissing = false } = {}) {
  if (membership.channel?.channelId) {
    const existing = interaction.guild.channels.cache.get(membership.channel.channelId) || (await interaction.guild.channels.fetch(membership.channel.channelId).catch(() => null));
    if (existing) {
      await applyBaseChannelPermissions(existing, membership);
      await syncChannelShares(existing, membership);
      return { channel: existing, record: membership.channel };
    }
    membership.channel = await saveVipChannel(
      membership.id,
      { channelId: null, name: null, userLimit: null, categoryId: null },
      prisma,
    );
  }

  if (!createIfMissing) {
    throw new Error('Nenhum canal VIP encontrado. Use o botão "Criar canal".');
  }

  const baseName = (membership.channel?.name || `${interaction.user.username}-vip`).toLowerCase().slice(0, 32);
  const overwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
  ];
  if (membership.plan?.vipRoleId) {
    overwrites.push({ id: membership.plan.vipRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] });
  }
  overwrites.push({
    id: membership.userId,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream],
  });

  const channel = await interaction.guild.channels.create({
    name: baseName,
    type: ChannelType.GuildVoice,
    parent: membership.plan?.callCategoryId || null,
    reason: 'Canal VIP criado automaticamente',
    permissionOverwrites: overwrites,
  });

  const record = await saveVipChannel(
    membership.id,
    {
      channelId: channel.id,
      name: channel.name,
      userLimit: channel.userLimit ?? null,
      categoryId: membership.plan?.callCategoryId || null,
    },
    prisma,
  );
  membership.channel = record;
  await applyBaseChannelPermissions(channel, membership);
  await syncChannelShares(channel, membership);
  return { channel, record };
}

function parseHexColor(input) {
  const value = String(input || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('Informe uma cor em HEX (ex: #FF0000).');
  }
  return `#${value.toUpperCase()}`;
}

function parseCustomEmoji(input) {
  const match = String(input || '').trim().match(/^<a?:(\w+):(\d+)>$/);
  if (!match) return null;
  if (input.startsWith('<a:')) {
    throw new Error('Não é permitido usar emoji animado.');
  }
  return { name: match[1] || 'emoji', id: match[2] };
}

async function resolveEmojiAsset(input) {
  const parsed = parseCustomEmoji(input);
  if (!parsed) return null;
  const url = `https://cdn.discordapp.com/emojis/${parsed.id}.png?size=64&quality=lossless`;
  const response = await fetch(url).catch(() => null);
  if (!response || !response.ok) {
    throw new Error('Não foi possível carregar o emoji informado.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { ...parsed, buffer };
}

function extractUserId(value) {
  const text = String(value || '').trim();
  const mention = text.match(/^<@!?([0-9]+)>$/);
  if (mention) return mention[1];
  if (/^[0-9]+$/.test(text)) {
    return text;
  }
  return null;
}

async function handleInteraction(interaction, ctx) {
  const id = interaction.customId;
  if (!id) return false;
  if (id.startsWith('vipset')) {
    await handleSetVip(interaction, ctx);
    return true;
  }
  if (id.startsWith('vipuser')) {
    await handleVipUser(interaction, ctx);
    return true;
  }
  if (id.startsWith('viptag')) {
    await handleVipTag(interaction, ctx);
    return true;
  }
  if (id.startsWith('vipchan')) {
    await handleVipChannel(interaction, ctx);
    return true;
  }
  if (id.startsWith('vipadmin')) {
    await handleVipAdmin(interaction, ctx);
    return true;
  }
  return false;
}

async function handleSetVip(interaction, ctx) {
  const [, planIdRaw, userId] = interaction.customId.split(':');
  const planId = Number(planIdRaw);
  const prisma = ctx.getPrisma();
  const vipCfg = await ensureVipConfig(prisma);
  const hasPermission = vipCfg.setPermissions.length
    ? vipCfg.setPermissions.some((perm) => interaction.member.roles.cache.has(perm.roleId))
    : interaction.member.permissions.has('ManageGuild');
  if (!hasPermission) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Você não pode usar este botão.', { isError: true }));
    return;
  }
  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!targetMember) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Usuário não encontrado.', { isError: true }));
    return;
  }
  try {
    const membership = await createMembership({
      planId,
      userId: targetMember.id,
      executorId: interaction.user.id,
      guildId: interaction.guildId,
      bonusRoleId: vipCfg.bonusRoleId || null,
    }, prisma);
    if (membership.plan?.vipRoleId) {
      await targetMember.roles.add(membership.plan.vipRoleId).catch(() => {});
    }
    if (vipCfg.bonusRoleId) {
      await targetMember.roles.add(vipCfg.bonusRoleId).catch(() => {});
    }
    await updateVipPanel(
      interaction,
      buildNoticePayload(interaction, `${targetMember} recebeu o VIP ${membership.plan?.name || planId}.`, {
        includeExisting: false,
        keepComponents: false,
      }),
    );
  } catch (err) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, `Erro: ${err.message}`, { isError: true }));
  }
}

async function handleVipUser(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP não encontrado.', { isError: true, includeExisting: false, keepComponents: false }));
    return;
  }
  if (interaction.customId === 'vipuser:close') {
    await updateVipPanel(interaction, { components: [], embeds: [] });
    return;
  }
  if (interaction.customId === 'vipuser:back') {
    const payload = buildVipHomePayload(interaction.user, membership);
    await updateVipPanel(interaction, payload);
    return;
  }
  if (interaction.customId === 'vipuser:tag') {
    await updateVipPanel(interaction, buildVipTagView(membership));
    return;
  }
  if (interaction.customId === 'vipuser:channel') {
    await updateVipPanel(interaction, buildVipChannelView(membership));
    return;
  }
  // fallback: rebuild painel principal
  const payload = buildVipHomePayload(interaction.user, membership);
  await updateVipPanel(interaction, payload);
}

async function handleVipTag(interaction, ctx) {
  const prisma = ctx.getPrisma();
  let membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP não encontrado.', { isError: true, includeExisting: false, keepComponents: false }));
    return;
  }
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const targetKey = parts[2];
  if (action === 'back') {
    stopPrompt(interaction, 'viptag-name');
    stopPrompt(interaction, 'viptag-color');
    stopPrompt(interaction, 'viptag-emoji');
    const payload = buildVipHomePayload(interaction.user, membership);
    await updateVipPanel(interaction, payload);
    return;
  }
  if (action === 'cancel') {
    if (targetKey) {
      stopPrompt(interaction, targetKey);
    }
    await refreshTagView(interaction, membership, { status: 'Operação cancelada.' });
    return;
  }
  await ensureInteractionAck(interaction);
  const persistTag = async (data) => {
    const record = await saveVipTag(membership.id, data, prisma);
    membership.tag = record;
  };
  const showError = async (message) => refreshTagView(interaction, membership, { status: message, isError: true });

  if (action === 'create') {
    try {
      if (membership.tag?.roleId) {
        const existing = interaction.guild.roles.cache.get(membership.tag.roleId) || (await interaction.guild.roles.fetch(membership.tag.roleId).catch(() => null));
        if (existing) {
          await refreshTagView(interaction, membership, { status: `Você já possui uma tag: <@&${existing.id}>.`, isError: true });
          return;
        }
      }
      const { role } = await ensureVipTagRole(interaction, membership, prisma, { createIfMissing: true });
      await refreshTagView(interaction, membership, { status: `Tag criada com sucesso: <@&${role.id}>.` });
    } catch (err) {
      await refreshTagView(interaction, membership, { status: err.message || 'Não foi possível criar a tag.', isError: true });
    }
    return;
  }

  const useTagRole = async (handler) => {
    try {
      const { role } = await ensureVipTagRole(interaction, membership, prisma);
      await handler(role);
    } catch (err) {
      await showError(err.message || 'Não foi possível acessar a tag.');
    }
  };

  if (action === 'name') {
    await useTagRole(async (role) => {
      await promptVipTagInput(interaction, membership, {
        promptKey: 'viptag-name',
        title: 'Editar nome da tag',
        instructions: 'Digite o novo nome da tag (2 a 32 caracteres).',
        onSubmit: async (value) => {
          if (value.length < 2 || value.length > 32) {
            throw new Error('O nome deve ter entre 2 e 32 caracteres.');
          }
          await role.setName(value).catch(() => {
            throw new Error('Não consegui atualizar o nome da tag.');
          });
          await persistTag({ name: value });
          return 'Nome da tag atualizado.';
        },
      });
    });
    return;
  }
  if (action === 'color') {
    await useTagRole(async (role) => {
      await promptVipTagInput(interaction, membership, {
        promptKey: 'viptag-color',
        title: 'Editar cor da tag',
        instructions: 'Envie uma cor em HEX (ex: #FF0000).',
        onSubmit: async (value) => {
          const hex = parseHexColor(value);
          await role.setColor(hex).catch(() => {
            throw new Error('Não consegui aplicar a cor.');
          });
          await persistTag({ color: hex });
          return 'Cor da tag atualizada.';
        },
      });
    });
    return;
  }
  if (action === 'emoji') {
    await useTagRole(async (role) => {
      await promptVipTagInput(interaction, membership, {
        promptKey: 'viptag-emoji',
        title: 'Editar emoji da tag',
        instructions: 'Envie um emoji estático no formato <:nome:id>.',
        onSubmit: async (value) => {
          const emojiData = await resolveEmojiAsset(value);
          if (!emojiData) {
            throw new Error('Formato inválido. Use <:nome:id>.');
          }
          try {
            await role.setIcon(emojiData.buffer);
          } catch (err) {
            throw new Error('Não foi possível aplicar o emoji (verifique se o servidor permite ícones em cargos).');
          }
          await persistTag({ emoji: emojiData.name, iconHash: emojiData.id, iconData: emojiData.buffer });
          return 'Emoji aplicado à tag.';
        },
      });
    });
    return;
  }
}

async function handleVipChannel(interaction, ctx) {
  const prisma = ctx.getPrisma();
  let membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP não encontrado.', { isError: true, includeExisting: false, keepComponents: false }));
    return;
  }
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const promptKey = parts[2];

  const stopChannelPrompts = () => {
    stopPrompt(interaction, 'vipchan-name');
    stopPrompt(interaction, 'vipchan-limit');
  };

  if (!['name', 'limit'].includes(action)) {
    stopChannelPrompts();
  }

  if (action === 'back') {
    stopChannelPrompts();
    const payload = buildVipHomePayload(interaction.user, membership);
    await updateVipPanel(interaction, payload);
    return;
  }

  if (action === 'cancel') {
    if (promptKey) {
      stopPrompt(interaction, promptKey);
    }
    await refreshChannelView(interaction, membership, { status: 'Operação cancelada.' });
    return;
  }

  await ensureInteractionAck(interaction);

  const persistChannel = async (data) => {
    const record = await saveVipChannel(membership.id, data, prisma);
    membership.channel = record;
  };

  const showChannelError = async (message) => refreshChannelView(interaction, membership, { status: message, isError: true });

  const useVipChannel = async (handler) => {
    try {
      const { channel } = await ensureVipChannel(interaction, membership, prisma);
      await handler(channel);
    } catch (err) {
      await showChannelError(err.message || 'Não foi possível acessar o canal.');
    }
  };

  if (action === 'fix') {
    try {
      const { channel } = await ensureVipChannel(interaction, membership, prisma);
      await applyBaseChannelPermissions(channel, membership);
      await syncChannelShares(channel, membership);
      await refreshChannelView(interaction, membership, { status: 'Canal verificado e sincronizado.' });
    } catch (err) {
      await showChannelError(err.message || 'Não foi possível verificar o canal.');
    }
    return;
  }

  if (action === 'create') {
    try {
      const existingChannel = membership.channel?.channelId
        ? interaction.guild.channels.cache.get(membership.channel.channelId) || (await interaction.guild.channels.fetch(membership.channel.channelId).catch(() => null))
        : null;
      if (existingChannel) {
        await refreshChannelView(interaction, membership, { status: `Você já possui um canal: ${existingChannel}.`, isError: true });
        return;
      }
      const { channel } = await ensureVipChannel(interaction, membership, prisma, { createIfMissing: true });
      await refreshChannelView(interaction, membership, { status: `Canal criado com sucesso: ${channel}.` });
    } catch (err) {
      await showChannelError(err.message || 'Não foi possível criar o canal.');
    }
    return;
  }

  if (action === 'name') {
    stopPrompt(interaction, 'vipchan-limit');
    await useVipChannel(async (channel) => {
      await promptVipChannelInput(interaction, membership, {
        promptKey: 'vipchan-name',
        title: 'Editar nome do canal',
        instructions: 'Digite o novo nome do canal (máximo de 32 caracteres).',
        onSubmit: async (value) => {
          const safeName = value.slice(0, 32);
          if (!safeName.trim()) {
            throw new Error('O nome não pode ficar vazio.');
          }
          await channel.setName(safeName).catch(() => {
            throw new Error('Não consegui renomear o canal.');
          });
          await persistChannel({
            channelId: channel.id,
            name: safeName,
            userLimit: channel.userLimit ?? null,
            categoryId: channel.parentId || null,
          });
          return 'Nome do canal atualizado.';
        },
      });
    });
    return;
  }

  if (action === 'limit') {
    stopPrompt(interaction, 'vipchan-name');
    await useVipChannel(async (channel) => {
      await promptVipChannelInput(interaction, membership, {
        promptKey: 'vipchan-limit',
        title: 'Editar limite do canal',
        instructions: 'Informe o limite de usuários (0 = ilimitado, máximo 99).',
        onSubmit: async (value) => {
          const parsed = parseInt(value, 10);
          if (Number.isNaN(parsed) || parsed < 0 || parsed > 99) {
            throw new Error('Informe um número entre 0 e 99.');
          }
          await channel.setUserLimit(parsed === 0 ? null : parsed).catch(() => {
            throw new Error('Não consegui atualizar o limite.');
          });
          await persistChannel({
            channelId: channel.id,
            name: channel.name,
            userLimit: parsed === 0 ? null : parsed,
            categoryId: channel.parentId || null,
          });
          return 'Limite atualizado.';
        },
      });
    });
  }
}

async function showVipList(interaction, ctx, page = 1) {
  const prisma = ctx.getPrisma();
  const take = 10;
  const currentPage = Math.max(1, page);
  const skip = (currentPage - 1) * take;
  const where = { guildId: interaction.guildId, active: true };
  const [total, memberships] = await Promise.all([
    prisma.vipMembership.count({ where }),
    prisma.vipMembership.findMany({ where, orderBy: { expiresAt: 'asc' }, skip, take, include: { plan: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / take));
  const lines = memberships.map((m) => {
    const remaining = Math.max(0, Math.ceil((m.expiresAt.getTime() - Date.now()) / DAY_MS));
    return `• <@${m.userId}> — ${m.plan?.name || 'Sem nome'} — ${remaining}d restantes`;
  });
  const embed = new EmbedBuilder()
    .setTitle('VIPs ativos')
    .setColor(0xffffff)
    .setDescription(lines.join('\n') || 'Nenhum VIP ativo no momento.')
    .setFooter({ text: `Página ${currentPage}/${totalPages}` });

  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevDisabled ? 'vipadmin:list:prev-disabled' : `vipadmin:list:${Math.max(1, currentPage - 1)}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(nextDisabled ? 'vipadmin:list:next-disabled' : `vipadmin:list:${Math.min(totalPages, currentPage + 1)}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled),
    new ButtonBuilder().setCustomId('vipadmin:home').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  await updateVipPanel(interaction, { embeds: [embed], components: [row] });
}

function buildVipDetailPayload(membership) {
  const remaining = Math.max(0, Math.ceil((membership.expiresAt.getTime() - Date.now()) / DAY_MS));
  const embed = new EmbedBuilder()
    .setTitle(`VIP de ${membership.userId}`)
    .setColor(0xffffff)
    .addFields(
      { name: 'Usuário', value: `<@${membership.userId}>`, inline: true },
      { name: 'VIP', value: membership.plan?.name || `Plano #${membership.vipPlanId}`, inline: true },
      { name: 'Dias restantes', value: `${remaining}`, inline: true },
      { name: 'Expira em', value: formatTimestamp(membership.expiresAt), inline: false },
      { name: 'Tag', value: membership.tag?.roleId ? `<@&${membership.tag.roleId}>` : 'Nenhuma', inline: true },
      { name: 'Canal', value: membership.channel?.channelId ? `<#${membership.channel.channelId}>` : 'Nenhum', inline: true },
    )
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vipadmin:adddays:${membership.id}`).setLabel('Adicionar dias').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vipadmin:removedays:${membership.id}`).setLabel('Remover dias').setEmoji('➖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vipadmin:delete:${membership.id}`).setLabel('Deletar VIP').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('vipadmin:home').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

async function handleVipAdmin(interaction, ctx) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    await updateVipPanel(interaction, buildNoticePayload(interaction, 'Apenas administradores podem usar este painel.', { isError: true }));
    return;
  }
  const prisma = ctx.getPrisma();
  const [, action, value] = interaction.customId.split(':');

  if (action !== 'prompt-view') {
    stopPrompt(interaction, 'vipadmin-view');
  }

  if (action === 'cancel') {
    if (value) {
      stopPrompt(interaction, value);
    }
    await updateVipPanel(interaction, buildVipAdminHomePayload());
    return;
  }

  if (action === 'home') {
    const payload = buildVipAdminHomePayload();
    await updateVipPanel(interaction, payload);
    return;
  }

  if (action === 'list') {
    const page = Number(value || '1');
    await showVipList(interaction, ctx, Number.isNaN(page) ? 1 : page);
    return;
  }

  if (action === 'prompt-view') {
    await promptVipAdminInput(interaction, {
      promptKey: 'vipadmin-view',
      title: 'Consultar VIP',
      instructions: 'Envie o ID ou a menção do usuário que deseja visualizar.',
      onSubmit: async (input) => {
        const userId = extractUserId(input);
        if (!userId) {
          throw new Error('Envie um ID ou menção válido.');
        }
        const membership = await prisma.vipMembership.findUnique({
          where: { userId },
          include: { plan: true, tag: true, channel: true },
        });
        if (!membership || membership.guildId !== interaction.guildId || !membership.active) {
          throw new Error('Nenhum VIP ativo para este usuário.');
        }
        return { payload: buildVipDetailPayload(membership) };
      },
    });
    return;
  }

  if (action === 'adddays' || action === 'removedays') {
    const membershipId = Number(value);
    if (!membershipId) {
      await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP inválido.', { isError: true }));
      return;
    }
    const membership = await prisma.vipMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.guildId !== interaction.guildId || !membership.active) {
      await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP não encontrado.', { isError: true }));
      return;
    }
    const promptKey = action === 'adddays' ? 'vipadmin-add' : 'vipadmin-remove';
    await promptText(
      interaction,
      `${promptKey}-${membershipId}`,
      `Informe quantos dias deseja ${action === 'adddays' ? 'adicionar' : 'remover'} (1-365).`,
      async (input) => {
        const amount = parseInt(input, 10);
        if (Number.isNaN(amount) || amount <= 0 || amount > 365) {
          throw new Error('Envie um número entre 1 e 365.');
        }
        const delta = action === 'adddays' ? amount : -amount;
        await adjustMembershipDays({ membershipId, deltaDays: delta, actorId: interaction.user.id }, prisma);
        await interaction.followUp({ embeds: [buildInfoEmbed('Dias atualizados com sucesso.')], ephemeral: true });
      },
    );
    return;
  }

  if (action === 'delete') {
    const membershipId = Number(value);
    if (!membershipId) {
      await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP inválido.', { isError: true }));
      return;
    }
    const membership = await prisma.vipMembership.findUnique({
      where: { id: membershipId },
      include: { plan: true, tag: true, channel: true },
    });
    if (!membership || membership.guildId !== interaction.guildId || !membership.active) {
      await updateVipPanel(interaction, buildNoticePayload(interaction, 'VIP não encontrado ou já removido.', { isError: true }));
      return;
    }
    await cleanupMembership(interaction.guild, membership, interaction.user.id);
    await updateVipPanel(
      interaction,
      buildNoticePayload(interaction, 'VIP removido e recursos limpos.', {
        includeExisting: false,
        keepComponents: false,
      }),
    );
    return;
  }

  await updateVipPanel(interaction, buildNoticePayload(interaction, 'Ação desconhecida.', { isError: true }));
}

module.exports = {
  registerVipFeature,
  handleInteraction,
  buildVipHomePayload,
  buildVipAdminHomePayload,
};
