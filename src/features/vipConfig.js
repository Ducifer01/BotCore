const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, ComponentType } = require('discord.js');
const {
  ensureVipConfig,
  updateVipSettings,
  createVipPlanDraft,
  updateVipPlan,
  publishVipPlan,
  deleteVipPlan,
  getVipPlan,
} = require('../services/vip');

const INPUT_TIMEOUT = 120_000;
const promptCollectors = new Map();

function formatRole(guild, roleId) {
  if (!roleId) return 'Não configurado';
  const role = guild.roles.cache.get(roleId);
  return role ? role.toString() : `\`<@&${roleId}>\``;
}

function formatChannel(guild, channelId) {
  if (!channelId) return 'Não configurado';
  const channel = guild.channels.cache.get(channelId);
  if (channel) {
    return `${channel.name} (${channelId})`;
  }
  return `Canal ${channelId}`;
}

function planLabel(plan) {
  const base = plan.name || `Rascunho #${plan.id}`;
  return plan.isDraft ? `${base} (rascunho)` : base;
}

async function ensureInteractionAck(interaction) {
  if (!interaction || interaction.deferred || interaction.replied) return;
  if (typeof interaction.deferUpdate === 'function' && interaction.isMessageComponent()) {
    await interaction.deferUpdate().catch(() => {});
  } else if (typeof interaction.deferReply === 'function') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function updateConfigPanel(interaction, payload) {
  if (!interaction) return;
  await ensureInteractionAck(interaction);
  await interaction.editReply(payload).catch(() => {});
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

function stopPlanPrompts(interaction, planId) {
  if (!planId) return;
  stopPrompt(interaction, `vipplan-name-${planId}`);
  stopPrompt(interaction, `vipplan-duration-${planId}`);
}

async function presentMenu(interaction, ctx) {
  const payload = await buildRootPayload(interaction, ctx);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  await interaction.editReply(payload).catch(() => {});
  return true;
}

async function buildRootPayload(interaction, ctx, { status, isError } = {}) {
  const prisma = ctx.getPrisma();
  const cfg = await ensureVipConfig(prisma);
  const embed = new EmbedBuilder()
    .setTitle('Configurar sistema de VIP')
    .setColor(0xffffff)
    .setDescription('Gerencie configurações gerais e planos de VIP.');

  embed.addFields(
    {
      name: 'Cargo bônus',
      value: formatRole(interaction.guild, cfg.bonusRoleId),
      inline: true,
    },
    {
      name: 'Esconder canais vazios',
      value: cfg.hideEmptyChannels ? 'Ativado' : 'Desativado',
      inline: true,
    },
    {
      name: 'Adicionar tags manualmente',
      value: cfg.allowManualTags ? 'Permitido' : 'Bloqueado',
      inline: true,
    },
    {
      name: 'Permissões /setvip',
      value: cfg.setPermissions?.length
        ? cfg.setPermissions.map((perm) => formatRole(interaction.guild, perm.roleId)).join(', ')
        : 'Qualquer cargo com Gerenciar Servidor.',
    },
  );

  const plans = (cfg.plans || []).filter((plan) => plan.guildId === interaction.guildId).sort((a, b) => a.id - b.id);
  embed.addFields({
    name: `Planos (${plans.length})`,
    value: plans.map((p) => `• ${planLabel(p)}`).join('\n') || 'Nenhum plano criado.',
  });

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const toggleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vipcfg:toggle:hideempty')
      .setLabel('Esconder canais vazios')
      .setEmoji('🧹')
      .setStyle(cfg.hideEmptyChannels ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vipcfg:toggle:manualtags')
      .setLabel('Tags manuais')
      .setEmoji('🏷️')
      .setStyle(cfg.allowManualTags ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const planRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vipcfg:createplan')
      .setLabel('Criar VIP')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
  );

  const components = [toggleRow, planRow];

  const bonusRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('vipcfg:setbonus')
      .setPlaceholder('Selecione o cargo bônus (opcional)')
      .setMinValues(0)
      .setMaxValues(1)
      .setDefaultRoles(cfg.bonusRoleId ? [cfg.bonusRoleId] : []),
  );
  components.unshift(bonusRow);

  const permissionRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('vipcfg:set-setviproles')
      .setPlaceholder('Cargos autorizados no /setvip')
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultRoles(cfg.setPermissions?.map((perm) => perm.roleId) || []),
  );
  components.splice(1, 0, permissionRow);

  if (plans.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('vipcfg:planselect')
      .setPlaceholder('Selecione um VIP para editar')
      .addOptions(
        plans.slice(0, 25).map((plan) => ({
          label: planLabel(plan).slice(0, 100),
          value: String(plan.id),
          description: plan.isDraft ? 'Rascunho' : 'Publicado',
        })),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  return { embeds: [embed], components };
}

async function buildPlanPayload(interaction, planId, ctx, { status, isError } = {}) {
  const prisma = ctx.getPrisma();
  const plan = await getVipPlan(Number(planId), prisma);
  if (!plan || plan.guildId !== interaction.guildId) {
    return buildRootPayload(interaction, ctx);
  }
  const embed = new EmbedBuilder()
    .setTitle(`Plano VIP • ${planLabel(plan)}`)
    .setColor(plan.isDraft ? 0xffcc00 : 0x57f287)
    .addFields(
      { name: 'Nome', value: plan.name || 'Defina um nome', inline: true },
      { name: 'Duração (dias)', value: plan.durationDays ? `${plan.durationDays}` : 'Defina a duração', inline: true },
      { name: 'Cargo VIP', value: formatRole(interaction.guild, plan.vipRoleId), inline: true },
      { name: 'Separador de tag', value: formatRole(interaction.guild, plan.tagSeparatorRoleId), inline: true },
      { name: 'Categoria de calls', value: formatChannel(interaction.guild, plan.callCategoryId), inline: false },
    )
    .setFooter({ text: plan.isDraft ? 'Rascunho' : 'Publicado' });

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const rows = [];
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vipcfg:editname:${plan.id}`).setLabel('Editar nome').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`vipcfg:editduration:${plan.id}`).setLabel('Editar duração').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`vipcfg:set-viprole:${plan.id}`)
        .setPlaceholder('Cargo do VIP')
        .setMinValues(0)
        .setMaxValues(1)
        .setDefaultRoles(plan.vipRoleId ? [plan.vipRoleId] : []),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`vipcfg:set-tagrole:${plan.id}`)
        .setPlaceholder('Separador de tag')
        .setMinValues(0)
        .setMaxValues(1)
        .setDefaultRoles(plan.tagSeparatorRoleId ? [plan.tagSeparatorRoleId] : []),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`vipcfg:set-category:${plan.id}`)
        .addChannelTypes(ChannelType.GuildCategory)
        .setPlaceholder('Categoria para calls')
        .setMinValues(0)
        .setMaxValues(1)
        .setDefaultChannels(plan.callCategoryId ? [plan.callCategoryId] : []),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vipcfg:back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`vipcfg:publish:${plan.id}`)
        .setLabel(plan.isDraft ? 'Publicar' : 'Re-publicar')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!plan.isDraft),
      new ButtonBuilder().setCustomId(`vipcfg:delete:${plan.id}`).setLabel('Excluir').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
  );

  return { embeds: [embed], components: rows };
}

function buildPlanPromptPayload(plan, { field, title, instructions, status, isError } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(isError ? 0xff4d4d : 0xffffff)
    .setDescription(`${instructions}\n\nDigite sua resposta neste chat. Para cancelar, escreva **cancelar** ou use o botão abaixo.`)
    .addFields(
      { name: 'Plano', value: planLabel(plan), inline: true },
      { name: 'Nome atual', value: plan.name || '—', inline: true },
      { name: 'Duração atual', value: plan.durationDays ? `${plan.durationDays} dias` : '—', inline: true },
    )
    .setFooter({ text: 'Entrada expira em 2 minutos' })
    .setTimestamp(new Date());

  if (status) {
    embed.addFields({ name: isError ? 'Erro' : 'Status', value: status, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vipcfg:prompt-cancel:${field}:${plan.id}`)
      .setLabel('Cancelar')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

async function promptPlanField(interaction, ctx, planId, field) {
  if (!interaction.channel) {
    await updateConfigPanel(
      interaction,
      await buildPlanPayload(interaction, planId, ctx, {
        status: 'Abra este painel em um canal de texto para inserir valores.',
        isError: true,
      }),
    );
    return;
  }

  const prisma = ctx.getPrisma();
  const plan = await getVipPlan(Number(planId), prisma);
  if (!plan || plan.guildId !== interaction.guildId) {
    await updateConfigPanel(interaction, await buildRootPayload(interaction, ctx, { status: 'Plano não encontrado.', isError: true }));
    return;
  }

  const titles = {
    name: 'Editar nome do VIP',
    duration: 'Editar duração do VIP',
  };
  const instructions = {
    name: 'Digite o novo nome (2-32 caracteres).',
    duration: 'Informe a duração em dias (número inteiro, mínimo 1).',
  };

  const promptKey = `vipplan-${field}-${plan.id}`;
  const renderPrompt = (state = {}) =>
    buildPlanPromptPayload(plan, {
      field,
      title: titles[field],
      instructions: instructions[field],
      status: state.status,
      isError: state.isError,
    });

  await updateConfigPanel(interaction, renderPrompt());

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
        await updateConfigPanel(
          interaction,
          await buildPlanPayload(interaction, plan.id, ctx, { status: 'Operação cancelada.', isError: true }),
        );
        return;
      }
      try {
        if (field === 'name') {
          if (content.length < 2 || content.length > 32) {
            throw new Error('O nome deve ter entre 2 e 32 caracteres.');
          }
          await updateVipPlan(plan.id, { name: content, updatedById: interaction.user.id }, prisma);
        } else {
          const value = parseInt(content, 10);
          if (Number.isNaN(value) || value <= 0) {
            throw new Error('Informe um número inteiro maior que zero.');
          }
          await updateVipPlan(plan.id, { durationDays: value, updatedById: interaction.user.id }, prisma);
        }
        collector.stop('handled');
        await updateConfigPanel(
          interaction,
          await buildPlanPayload(interaction, plan.id, ctx, {
            status: field === 'name' ? 'Nome atualizado.' : 'Duração atualizada.',
          }),
        );
      } catch (err) {
        await updateConfigPanel(
          interaction,
          renderPrompt({ status: err.message || 'Não consegui processar sua resposta.', isError: true }),
        );
      }
      collector.resetTimer();
    } finally {
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (['handled', 'cancelled', 'replaced'].includes(reason)) return;
    await updateConfigPanel(
      interaction,
      await buildPlanPayload(interaction, plan.id, ctx, { status: 'Tempo esgotado para responder.', isError: true }),
    );
  });
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isStringSelectMenu()) {
    return false;
  }
  const id = interaction.customId || '';
  if (!id.startsWith('vipcfg')) return false;

  const prisma = ctx.getPrisma();

  if (interaction.isStringSelectMenu()) {
    await ensureInteractionAck(interaction);
    if (id === 'vipcfg:planselect') {
      const planId = interaction.values?.[0];
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await updateConfigPanel(interaction, payload);
      return true;
    }
    return false;
  }

  if (interaction.isRoleSelectMenu()) {
    await ensureInteractionAck(interaction);
    if (id === 'vipcfg:setbonus') {
      const value = interaction.values[0];
      await updateVipSettings({ bonusRoleId: value || null }, prisma);
      const payload = await buildRootPayload(interaction, ctx, { status: 'Cargo bônus atualizado.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    if (id === 'vipcfg:set-setviproles') {
      const vipCfg = await ensureVipConfig(prisma);
      await prisma.vipSetPermission.deleteMany({ where: { vipConfigId: vipCfg.id } });
      if (interaction.values.length) {
        await prisma.vipSetPermission.createMany({
          data: interaction.values.map((roleId) => ({ vipConfigId: vipCfg.id, roleId })),
        });
      }
      const payload = await buildRootPayload(interaction, ctx, { status: 'Permissões do /setvip atualizadas.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    if (id.startsWith('vipcfg:set-viprole:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { vipRoleId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx, { status: 'Cargo VIP atualizado.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    if (id.startsWith('vipcfg:set-tagrole:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { tagSeparatorRoleId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx, { status: 'Separador de tag atualizado.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    return false;
  }

  if (interaction.isChannelSelectMenu()) {
    await ensureInteractionAck(interaction);
    if (id.startsWith('vipcfg:set-category:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { callCategoryId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx, { status: 'Categoria atualizada.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    return false;
  }

  if (!interaction.isButton()) {
    return false;
  }

  await ensureInteractionAck(interaction);
  const [, action, extra, extra2] = id.split(':');

  if (action === 'toggle') {
    const cfg = await ensureVipConfig(prisma);
    if (extra === 'hideempty') {
      await updateVipSettings({ hideEmptyChannels: !cfg.hideEmptyChannels }, prisma);
      const payload = await buildRootPayload(interaction, ctx, { status: cfg.hideEmptyChannels ? 'Canais vazios agora visíveis.' : 'Canais vazios serão ocultados.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
    if (extra === 'manualtags') {
      await updateVipSettings({ allowManualTags: !cfg.allowManualTags }, prisma);
      const payload = await buildRootPayload(interaction, ctx, { status: cfg.allowManualTags ? 'Tags manuais desativadas.' : 'Tags manuais liberadas.' });
      await updateConfigPanel(interaction, payload);
      return true;
    }
  }

  if (action === 'createplan') {
    const plan = await createVipPlanDraft({ createdById: interaction.user.id, guildId: interaction.guildId }, prisma);
    const payload = await buildPlanPayload(interaction, plan.id, ctx, { status: 'Rascunho criado. Configure os campos abaixo.' });
    await updateConfigPanel(interaction, payload);
    return true;
  }

  if (action === 'back') {
    const payload = await buildRootPayload(interaction, ctx);
    await updateConfigPanel(interaction, payload);
    return true;
  }

  if (action === 'editname' || action === 'editduration') {
    const planId = Number(extra);
    stopPlanPrompts(interaction, planId);
    await promptPlanField(interaction, ctx, planId, action === 'editname' ? 'name' : 'duration');
    return true;
  }

  if (action === 'publish') {
    const planId = Number(extra);
    try {
      await publishVipPlan(planId, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx, { status: 'Plano publicado com sucesso.' });
      await updateConfigPanel(interaction, payload);
    } catch (err) {
      const payload = await buildPlanPayload(interaction, planId, ctx, { status: err.message || 'Não foi possível publicar.', isError: true });
      await updateConfigPanel(interaction, payload);
    }
    return true;
  }

  if (action === 'delete') {
    const planId = Number(extra);
    await deleteVipPlan(planId, prisma).catch(() => {});
    const payload = await buildRootPayload(interaction, ctx, { status: 'Plano excluído.' });
    await updateConfigPanel(interaction, payload);
    return true;
  }

  if (action === 'prompt-cancel') {
    const field = extra;
    const planId = Number(extra2);
    stopPrompt(interaction, `vipplan-${field}-${planId}`);
    const payload = await buildPlanPayload(interaction, planId, ctx, { status: 'Operação cancelada.', isError: true });
    await updateConfigPanel(interaction, payload);
    return true;
  }

  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
};
