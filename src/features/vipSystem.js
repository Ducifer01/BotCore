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
    await interaction.reply({ content: 'Abra este painel em um canal de texto para enviar respostas.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: question, ephemeral: true });
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

function extractEmojiId(input) {
  const match = String(input || '').match(/^<a?:\w+:(\d+)>$/);
  if (!match) return null;
  if (input.startsWith('<a:')) {
    throw new Error('Não é permitido usar emoji animado.');
  }
  return match[1];
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
    await interaction.reply({ embeds: [buildInfoEmbed('Você não pode usar este botão.', true)], ephemeral: true });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ embeds: [buildInfoEmbed('Usuário não encontrado.', true)], ephemeral: true });
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
    await interaction.reply({ embeds: [buildInfoEmbed(`${targetMember} recebeu o VIP ${membership.plan?.name || planId}.`)], ephemeral: true });
  } catch (err) {
    await interaction.reply({ embeds: [buildInfoEmbed(`Erro: ${err.message}`, true)], ephemeral: true });
  }
}

async function handleVipUser(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await interaction.reply({ embeds: [buildInfoEmbed('VIP não encontrado.', true)], ephemeral: true });
    return;
  }
  if (interaction.customId === 'vipuser:close') {
    await interaction.update({ components: [], embeds: [] }).catch(() => {});
    return;
  }
  if (interaction.customId === 'vipuser:back') {
    const payload = buildVipHomePayload(interaction.user, membership);
    await interaction.update(payload).catch(() => {});
    return;
  }
  if (interaction.customId === 'vipuser:tag') {
    const hasTag = Boolean(membership.tag?.roleId);
    const embed = new EmbedBuilder()
      .setTitle('Editar tag')
      .setColor(0xffffff)
      .setDescription(membership.tag?.roleId ? `Tag atual: <@&${membership.tag.roleId}>` : 'Nenhuma tag criada.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('viptag:create').setLabel('Criar tag').setEmoji('🆕').setStyle(ButtonStyle.Success).setDisabled(hasTag),
      new ButtonBuilder().setCustomId('viptag:name').setLabel('Editar nome').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
      new ButtonBuilder().setCustomId('viptag:color').setLabel('Editar cor').setEmoji('🎨').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
      new ButtonBuilder().setCustomId('viptag:emoji').setLabel('Editar emoji').setEmoji('😀').setStyle(ButtonStyle.Secondary).setDisabled(!hasTag),
      new ButtonBuilder().setCustomId('viptag:back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }
  if (interaction.customId === 'vipuser:channel') {
    const hasChannel = Boolean(membership.channel?.channelId);
    const embed = new EmbedBuilder()
      .setTitle('Editar canal VIP')
      .setColor(0xffffff)
      .setDescription(membership.channel?.channelId ? `Canal atual: <#${membership.channel.channelId}>` : 'Nenhum canal criado.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vipchan:create').setLabel('Criar canal').setEmoji('🆕').setStyle(ButtonStyle.Success).setDisabled(hasChannel),
      new ButtonBuilder().setCustomId('vipchan:name').setLabel('Editar nome').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(!hasChannel),
      new ButtonBuilder().setCustomId('vipchan:limit').setLabel('Editar limite').setEmoji('👥').setStyle(ButtonStyle.Secondary).setDisabled(!hasChannel),
      new ButtonBuilder().setCustomId('vipchan:fix').setLabel('Desbugar').setEmoji('🔧').setStyle(ButtonStyle.Danger).setDisabled(!hasChannel),
      new ButtonBuilder().setCustomId('vipchan:back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }
  // fallback: rebuild painel principal
  const payload = buildVipHomePayload(interaction.user, membership);
  await interaction.update(payload).catch(() => {});
}

async function handleVipTag(interaction, ctx) {
  const prisma = ctx.getPrisma();
  let membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await interaction.reply({ embeds: [buildInfoEmbed('VIP não encontrado.', true)], ephemeral: true });
    return;
  }
  const [, action] = interaction.customId.split(':');
  if (action === 'back') {
    const payload = buildVipHomePayload(interaction.user, membership);
    await interaction.update(payload).catch(() => {});
    return;
  }
  if (action === 'create') {
    try {
      if (membership.tag?.roleId) {
        const existing = interaction.guild.roles.cache.get(membership.tag.roleId) || (await interaction.guild.roles.fetch(membership.tag.roleId).catch(() => null));
        if (existing) {
          await interaction.reply({ embeds: [buildInfoEmbed(`Você já possui uma tag: <@&${existing.id}>.`)], ephemeral: true });
          return;
        }
      }
      const { role } = await ensureVipTagRole(interaction, membership, prisma, { createIfMissing: true });
      await interaction.reply({ embeds: [buildInfoEmbed(`Tag criada com sucesso: <@&${role.id}>.`)], ephemeral: true });
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível criar a tag.', true)], ephemeral: true }).catch(() => {});
    }
    return;
  }

  const useTagRole = async (handler) => {
    try {
      const { role } = await ensureVipTagRole(interaction, membership, prisma);
      await handler(role);
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível acessar a tag.', true)], ephemeral: true }).catch(() => {});
    }
  };

  if (action === 'name') {
    await useTagRole(async (role) => {
      await promptText(interaction, 'viptag-name', 'Digite o novo nome da tag. Para cancelar, escreva **cancelar**.', async (value) => {
        if (value.length < 2 || value.length > 32) {
          throw new Error('O nome deve ter entre 2 e 32 caracteres.');
        }
        await role.setName(value).catch(() => {
          throw new Error('Não consegui atualizar o nome da tag.');
        });
        await saveVipTag(membership.id, { name: value }, prisma);
        await interaction.followUp({ embeds: [buildInfoEmbed('Nome da tag atualizado.')], ephemeral: true });
      });
    });
    return;
  }
  if (action === 'color') {
    await useTagRole(async (role) => {
      await promptText(interaction, 'viptag-color', 'Envie uma cor em HEX (ex: #FF0000).', async (value) => {
        const hex = parseHexColor(value);
        await role.setColor(hex).catch(() => {
          throw new Error('Não consegui aplicar a cor.');
        });
        await saveVipTag(membership.id, { color: hex }, prisma);
        await interaction.followUp({ embeds: [buildInfoEmbed('Cor da tag atualizada.')], ephemeral: true });
      });
    });
    return;
  }
  if (action === 'emoji') {
    await useTagRole(async (role) => {
      await promptText(interaction, 'viptag-emoji', 'Envie um emoji do servidor (formato <:nome:id>).', async (value) => {
        const emojiId = extractEmojiId(value);
        if (!emojiId) {
          throw new Error('Formato inválido. Use <:nome:id>.');
        }
        const emoji = interaction.guild.emojis.cache.get(emojiId) || (await interaction.guild.emojis.fetch(emojiId).catch(() => null));
        if (!emoji) {
          throw new Error('Emoji não encontrado neste servidor.');
        }
        const iconUrl = emoji.imageURL({ extension: 'png', size: 64 });
        try {
          await role.setIcon(iconUrl);
        } catch (err) {
          throw new Error('Não foi possível aplicar o emoji (verifique se o servidor permite ícones em cargos).');
        }
        await saveVipTag(membership.id, { emoji: emoji.name, iconHash: emojiId }, prisma);
        await interaction.followUp({ embeds: [buildInfoEmbed('Emoji aplicado à tag.')], ephemeral: true });
      });
    });
    return;
  }
}

async function handleVipChannel(interaction, ctx) {
  const prisma = ctx.getPrisma();
  let membership = await getMembershipByUser(interaction.user.id, prisma);
  if (!membership || !membership.active || membership.guildId !== interaction.guildId) {
    await interaction.reply({ embeds: [buildInfoEmbed('VIP não encontrado.', true)], ephemeral: true });
    return;
  }
  const [, action] = interaction.customId.split(':');
  if (action === 'back') {
    const payload = buildVipHomePayload(interaction.user, membership);
    await interaction.update(payload).catch(() => {});
    return;
  }
  if (action === 'fix') {
    try {
      const { channel } = await ensureVipChannel(interaction, membership, prisma);
      await applyBaseChannelPermissions(channel, membership);
      await syncChannelShares(channel, membership);
      await interaction.reply({ embeds: [buildInfoEmbed('Canal verificado e sincronizado.')], ephemeral: true });
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível verificar o canal.', true)], ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (action === 'create') {
    try {
      const existingChannel = membership.channel?.channelId
        ? interaction.guild.channels.cache.get(membership.channel.channelId) || (await interaction.guild.channels.fetch(membership.channel.channelId).catch(() => null))
        : null;
      if (existingChannel) {
        await interaction.reply({ embeds: [buildInfoEmbed(`Você já possui um canal: ${existingChannel}.`)], ephemeral: true });
        return;
      }
      const { channel } = await ensureVipChannel(interaction, membership, prisma, { createIfMissing: true });
      await interaction.reply({ embeds: [buildInfoEmbed(`Canal criado com sucesso: ${channel}.`)], ephemeral: true });
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível criar o canal.', true)], ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (action === 'name') {
    try {
      const { channel } = await ensureVipChannel(interaction, membership, prisma);
      await promptText(interaction, 'vipchan-name', 'Digite o novo nome do canal.', async (value) => {
        const safeName = value.slice(0, 32);
        await channel.setName(safeName).catch(() => {
          throw new Error('Não consegui renomear o canal.');
        });
        await saveVipChannel(
          membership.id,
          {
            channelId: channel.id,
            name: safeName,
            userLimit: channel.userLimit ?? null,
            categoryId: channel.parentId || null,
          },
          prisma,
        );
        await interaction.followUp({ embeds: [buildInfoEmbed('Nome do canal atualizado.')], ephemeral: true });
      });
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível acessar o canal.', true)], ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (action === 'limit') {
    try {
      const { channel } = await ensureVipChannel(interaction, membership, prisma);
      await promptText(interaction, 'vipchan-limit', 'Informe o limite de usuários (0 = ilimitado, máximo 99).', async (value) => {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 99) {
          throw new Error('Informe um número entre 0 e 99.');
        }
        await channel.setUserLimit(parsed === 0 ? null : parsed).catch(() => {
          throw new Error('Não consegui atualizar o limite.');
        });
        await saveVipChannel(
          membership.id,
          {
            channelId: channel.id,
            name: channel.name,
            userLimit: parsed === 0 ? null : parsed,
            categoryId: channel.parentId || null,
          },
          prisma,
        );
        await interaction.followUp({ embeds: [buildInfoEmbed('Limite atualizado.')], ephemeral: true });
      });
    } catch (err) {
      await interaction.reply({ embeds: [buildInfoEmbed(err.message || 'Não foi possível acessar o canal.', true)], ephemeral: true }).catch(() => {});
    }
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

  await interaction.update({ embeds: [embed], components: [row] });
}

async function sendVipDetail(interaction, membership) {
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
  );

  await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
}

async function handleVipAdmin(interaction, ctx) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ embeds: [buildInfoEmbed('Apenas administradores podem usar este painel.', true)], ephemeral: true });
    return;
  }
  const prisma = ctx.getPrisma();
  const [, action, value] = interaction.customId.split(':');

  if (action === 'home') {
    const payload = buildVipAdminHomePayload();
    await interaction.update(payload);
    return;
  }

  if (action === 'list') {
    const page = Number(value || '1');
    await showVipList(interaction, ctx, Number.isNaN(page) ? 1 : page);
    return;
  }

  if (action === 'prompt-view') {
    await promptText(interaction, 'vipadmin-view', 'Informe o ID ou menção do usuário.', async (input) => {
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
      await sendVipDetail(interaction, membership);
    });
    return;
  }

  if (action === 'adddays' || action === 'removedays') {
    const membershipId = Number(value);
    if (!membershipId) {
      await interaction.reply({ embeds: [buildInfoEmbed('VIP inválido.', true)], ephemeral: true });
      return;
    }
    const membership = await prisma.vipMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.guildId !== interaction.guildId || !membership.active) {
      await interaction.reply({ embeds: [buildInfoEmbed('VIP não encontrado.', true)], ephemeral: true });
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
      await interaction.reply({ embeds: [buildInfoEmbed('VIP inválido.', true)], ephemeral: true });
      return;
    }
    const membership = await prisma.vipMembership.findUnique({
      where: { id: membershipId },
      include: { plan: true, tag: true, channel: true },
    });
    if (!membership || membership.guildId !== interaction.guildId || !membership.active) {
      await interaction.reply({ embeds: [buildInfoEmbed('VIP não encontrado ou já removido.', true)], ephemeral: true });
      return;
    }
    await cleanupMembership(interaction.guild, membership, interaction.user.id);
    await interaction.reply({ embeds: [buildInfoEmbed('VIP removido e recursos limpos.')], ephemeral: true });
    return;
  }

  await interaction.reply({ embeds: [buildInfoEmbed('Ação desconhecida.', true)], ephemeral: true });
}

module.exports = {
  registerVipFeature,
  handleInteraction,
  buildVipHomePayload,
  buildVipAdminHomePayload,
};
