const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes, RESTJSONErrorCodes } = require('discord.js');
const { getPrisma } = require('../db');
const { getGlobalConfig } = require('../services/globalConfig');
const { requireInstaConfig } = require('../services/instaGuard');
const { markBotVerifiedRoleAction } = require('../services/verifiedRoleBypass');

const verifyThreads = new Map(); // threadId -> { targetUserId }

function cloneDisabledComponents(rows = []) {
  return rows.map((row) => {
    const actionRow = new ActionRowBuilder();
    for (const component of row.components) {
      actionRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
    }
    return actionRow;
  });
}

function normalizeUsernameForThread(username) {
  if (!username || typeof username !== 'string') return 'usuario';
  // Remove acentos e caracteres especiais, permite letras/números/espaços/hífens
  const withoutDiacritics = username.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const cleaned = withoutDiacritics.replace(/[^a-zA-Z0-9\- ]/g, ' ').trim();
  // Substitui espaços por hífen, colapsa múltiplos hífens e deixa minúsculo
  const hyphenated = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-').toLowerCase();
  return hyphenated || 'usuario';
}

function buildVerifyThreadName(user) {
  const safeUsername = normalizeUsernameForThread(user.username);
  return `verifique-${safeUsername}`.slice(0, 90);
}

function threadBelongsToUser(thread, user) {
  if (!thread?.name || !user) return false;
  const safeUsername = normalizeUsernameForThread(user.username);
  return thread.name.startsWith(`verifique-${safeUsername}`);
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
  // Suporta formato legado: verif-<userId>-<username>
  const legacy = /^verif-(\d{5,25})/i.exec(name);
  if (legacy?.[1]) return legacy[1];
  // Novo formato não contém ID no nome (verifique-<username>)
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

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;
  if (!customId.startsWith('verify:')) return false;
  const prisma = getPrisma();
  const cfg = await getGlobalConfig(prisma);
  const instaCheck = requireInstaConfig(cfg);
  if (!instaCheck.ok) {
    await interaction.reply({ content: instaCheck.message, ephemeral: true });
    return true;
  }
  if (!interaction.member.roles.cache.has(cfg.mainRoleId)) {
    const isSelfGrant = customId.startsWith('verify:grantrole:');
    if (!isSelfGrant && customId !== 'verify:open') {
      await interaction.reply({ content: 'Apenas o InstaMod pode usar este botão.', ephemeral: true });
      return true;
    }
  }

  if (customId === 'verify:open') {
    return openThread(interaction, cfg, prisma);
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
      ? `Ei, eu vi aqui no sistema que você já está verificado. Adicionei o cargo no seu perfil. Caso por algum motivo você ainda esteja sem o cargo, clique no botão abaixo para pegá-lo.`
      : 'Nosso sistema indica que você já está verificado. Clique no botão abaixo para pegar o cargo verificado, caso esteja faltando.';
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
      if (tracked === interaction.user.id || threadBelongsToUser(th, interaction.user)) {
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
    .setDescription([
      'Aguarde um responsável pela verificação. Use o botão abaixo apenas quando o atendimento estiver concluído.',
      'InstaMod, use o comando `/verificar` dentro deste tópico para finalizar a análise.',
    ].join('\n\n'))
    .setColor(0x2ECC71);
  const row = new ActionRowBuilder().addComponents(
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

async function handleClose(interaction, cfg) {
  if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
    await interaction.reply({ content: 'Apenas o InstaMod pode encerrar.', ephemeral: true });
    return true;
  }
  const threadId = interaction.customId.split(':')[2];
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
      await interaction.followUp({ content: 'Você já possui o cargo de verificado.', ephemeral: true });
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
  applyVerifiedRole,
  removeVerifiedRole,
  extractUserIdFromThreadName,
  cacheThreadTargetUser,
  buildVerifyThreadName,
  threadBelongsToUser,
};