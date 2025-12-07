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
const pendingTextInputs = new Map();

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

async function presentMenu(interaction, ctx) {
  const payload = await buildRootPayload(interaction, ctx);
  if (interaction.isMessageComponent()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.update(payload);
    }
  } else {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }
    await interaction.editReply(payload);
  }
  return true;
}

async function buildRootPayload(interaction, ctx) {
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
      .setMaxValues(1),
  );
  components.unshift(bonusRow);

  const permissionRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('vipcfg:set-setviproles')
      .setPlaceholder('Cargos autorizados no /setvip')
      .setMinValues(0)
      .setMaxValues(25),
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

async function buildPlanPayload(interaction, planId, ctx) {
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
        .setMaxValues(1),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`vipcfg:set-tagrole:${plan.id}`)
        .setPlaceholder('Separador de tag')
        .setMinValues(0)
        .setMaxValues(1),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`vipcfg:set-category:${plan.id}`)
        .addChannelTypes(ChannelType.GuildCategory)
        .setPlaceholder('Categoria para calls')
        .setMinValues(0)
        .setMaxValues(1),
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

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isStringSelectMenu()) {
    return false;
  }
  const id = interaction.customId || '';
  if (!id.startsWith('vipcfg')) return false;

  const prisma = ctx.getPrisma();

  if (interaction.isStringSelectMenu()) {
    if (id === 'vipcfg:planselect') {
      const planId = interaction.values[0];
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.update(payload);
      return true;
    }
  }

  if (interaction.isRoleSelectMenu()) {
    if (id === 'vipcfg:setbonus') {
      const value = interaction.values[0];
      await updateVipSettings({ bonusRoleId: value || null }, prisma);
      const payload = await buildRootPayload(interaction, ctx);
      await interaction.update(payload);
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
      const payload = await buildRootPayload(interaction, ctx);
      await interaction.update(payload);
      return true;
    }
    if (id.startsWith('vipcfg:set-viprole:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { vipRoleId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.update(payload);
      return true;
    }
    if (id.startsWith('vipcfg:set-tagrole:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { tagSeparatorRoleId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.update(payload);
      return true;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    if (id.startsWith('vipcfg:set-category:')) {
      const planId = Number(id.split(':')[2]);
      const value = interaction.values[0] || null;
      await updateVipPlan(planId, { callCategoryId: value }, prisma);
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.update(payload);
      return true;
    }
  }

  if (interaction.isButton()) {
    const [, action, extra, extra2] = id.split(':');
    if (action === 'toggle') {
      if (extra === 'hideempty') {
        const cfg = await ensureVipConfig(prisma);
        await updateVipSettings({ hideEmptyChannels: !cfg.hideEmptyChannels }, prisma);
      } else if (extra === 'manualtags') {
        const cfg = await ensureVipConfig(prisma);
        await updateVipSettings({ allowManualTags: !cfg.allowManualTags }, prisma);
      }
      const payload = await buildRootPayload(interaction, ctx);
      await interaction.update(payload);
      return true;
    }
    if (action === 'createplan') {
  const plan = await createVipPlanDraft({ createdById: interaction.user.id, guildId: interaction.guildId }, prisma);
      const payload = await buildPlanPayload(interaction, plan.id, ctx);
      await interaction.update(payload);
      return true;
    }
    if (action === 'back') {
      const payload = await buildRootPayload(interaction, ctx);
      await interaction.update(payload);
      return true;
    }
    if (action === 'editname' || action === 'editduration') {
      const planId = Number(extra);
      await interaction.reply({
        content: action === 'editname' ? 'Digite o novo nome do VIP (ou escreva **cancelar**).' : 'Digite a nova duração em dias (número inteiro). Escreva **cancelar** para abortar.',
        ephemeral: true,
      });
      await awaitTextInput(interaction, planId, action === 'editname' ? 'name' : 'duration', ctx);
      return true;
    }
    if (action === 'publish') {
      const planId = Number(extra);
      try {
        await publishVipPlan(planId, prisma);
        await interaction.reply({ content: 'Plano publicado com sucesso.', ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: `Erro: ${err.message}`, ephemeral: true });
      }
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.message.edit(payload).catch(() => {});
      return true;
    }
    if (action === 'delete') {
      const planId = Number(extra);
      await deleteVipPlan(planId, prisma).catch(() => {});
      const payload = await buildRootPayload(interaction, ctx);
      await interaction.update(payload);
      return true;
    }
  }

  return false;
}

async function awaitTextInput(interaction, planId, field, ctx) {
  const key = `${interaction.user.id}:${interaction.channelId}`;
  if (pendingTextInputs.has(key)) {
    const collector = pendingTextInputs.get(key);
    collector.stop('replaced');
  }
  const filter = (msg) => msg.author.id === interaction.user.id && msg.channelId === interaction.channelId;
  const collector = interaction.channel.createMessageCollector({ filter, time: INPUT_TIMEOUT, max: 1 });
  pendingTextInputs.set(key, collector);

  collector.on('collect', async (msg) => {
    try {
      const content = (msg.content || '').trim();
      if (content.toLowerCase() === 'cancelar') {
        await msg.reply({ content: 'Operação cancelada.', allowedMentions: { repliedUser: false } });
        return;
      }
      if (field === 'name') {
        await updateVipPlan(planId, { name: content, updatedById: interaction.user.id }, ctx.getPrisma());
      } else if (field === 'duration') {
        const value = parseInt(content, 10);
        if (Number.isNaN(value) || value <= 0) {
          await msg.reply({ content: 'Informe um número válido em dias.', allowedMentions: { repliedUser: false } });
          return;
        }
        await updateVipPlan(planId, { durationDays: value, updatedById: interaction.user.id }, ctx.getPrisma());
      }
      const payload = await buildPlanPayload(interaction, planId, ctx);
      await interaction.message.edit(payload).catch(() => {});
      await msg.reply({ content: 'Atualizado!', allowedMentions: { repliedUser: false } });
    } catch (err) {
      await msg.reply({ content: `Erro: ${err.message}`, allowedMentions: { repliedUser: false } });
    } finally {
      pendingTextInputs.delete(key);
      await msg.delete().catch(() => {});
    }
  });

  collector.on('end', (_, reason) => {
    if (reason !== 'limit' && reason !== 'replaced') {
      interaction.followUp({ content: 'Tempo esgotado para atualizar.', ephemeral: true }).catch(() => {});
    }
    pendingTextInputs.delete(key);
  });
}

module.exports = {
  presentMenu,
  handleInteraction,
};
