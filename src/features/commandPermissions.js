const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');
const {
  getAllCommandPermissions,
  getAllowedRolesForCommand,
  addRolesToCommand,
  removeRolesFromCommand,
  clearRolesForCommand,
  normalizeCommandName,
  isCommandManaged,
} = require('../services/commandPermissions');

const CUSTOM_IDS = {
  SELECT: 'commandperms:select',
  OVERVIEW: 'commandperms:overview',
};

function getManagedCommands(ctx) {
  const listFn = ctx?.listRegisteredCommands;
  const commands = typeof listFn === 'function' ? listFn() : [];
  return commands
    .filter((cmd) => isCommandManaged(cmd.name))
    .map((cmd) => ({
      key: normalizeCommandName(cmd.name),
      label: `/${cmd.name}`,
      description: cmd?.description || 'Sem descrição',
      rawName: cmd.name,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function formatRoleMentions(roleIds = [], guild) {
  if (!roleIds.length) {
    return 'Nenhum cargo definido (apenas o usuário posse pode usar).';
  }
  return roleIds
    .map((roleId) => {
      const role = guild?.roles.cache.get(roleId);
      return role ? `<@&${roleId}>` : `\`${roleId}\``;
    })
    .join(', ');
}

function chunkLines(lines) {
  if (!lines.length) {
    return [{ name: 'Resumo', value: 'Nenhum comando disponível.' }];
  }
  const fields = [];
  let buffer = '';
  for (const line of lines) {
    if ((buffer + line + '\n').length > 1024) {
      fields.push({ name: fields.length ? '\u200b' : 'Resumo', value: buffer.trim() || '—' });
      buffer = '';
    }
    buffer += `${line}\n`;
  }
  if (buffer) {
    fields.push({ name: fields.length ? '\u200b' : 'Resumo', value: buffer.trim() });
  }
  return fields;
}

function buildOverviewEmbed(commands, permsMap, guild) {
  const embed = new EmbedBuilder()
    .setTitle('Permissões de Comandos')
    .setDescription('Escolha um comando para definir quais cargos têm acesso. O usuário posse sempre possui permissão.')
    .setColor(0x5865F2);
  const lines = commands.map((cmd) => {
    const roles = Array.from(permsMap.get(cmd.key) || []);
    const mentionList = formatRoleMentions(roles, guild);
    return `• \`${cmd.label}\`: ${mentionList}`;
  });
  const fields = chunkLines(lines);
  fields.forEach((field) => embed.addFields(field));
  return embed;
}

function buildOverviewComponents(commands) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
  ];
  const select = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.SELECT)
    .setPlaceholder(commands.length ? 'Selecione um comando' : 'Nenhum comando disponível')
    .setDisabled(!commands.length);
  if (commands.length) {
    const options = commands.slice(0, 25).map((cmd) => ({
      label: cmd.label,
      value: cmd.key,
      description: cmd.description.slice(0, 100),
    }));
    select.addOptions(options);
  } else {
    select.addOptions([{ label: 'Indisponível', value: 'none', description: 'Nenhum comando compatível' }]);
  }
  rows.push(new ActionRowBuilder().addComponents(select));
  return rows;
}

function buildCommandDetailEmbed(command, roleIds, guild) {
  return new EmbedBuilder()
    .setTitle(`Permissões de ${command.label}`)
    .setDescription(command.description)
    .addFields({
      name: 'Cargos com acesso',
      value: formatRoleMentions(roleIds, guild),
    })
    .setColor(0x5865F2);
}

function buildCommandDetailComponents(command, roleIds, guild) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.OVERVIEW).setLabel('Voltar ao resumo').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`commandperms:clear:${command.key}`)
      .setLabel('Limpar cargos')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!roleIds.length),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`commandperms:add:${command.key}`)
      .setPlaceholder('Adicionar cargos permitidos')
      .setMinValues(1)
      .setMaxValues(25),
  ));

  if (roleIds.length) {
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`commandperms:remove:${command.key}`)
      .setPlaceholder('Selecione cargos para remover')
      .setMinValues(1)
      .setMaxValues(Math.min(roleIds.length, 25))
      .addOptions(roleIds.slice(0, 25).map((roleId) => ({
        label: guildRoleLabel(roleId, guild),
        value: roleId,
        description: guild ? `ID: ${roleId}` : undefined,
      })));
    rows.push(new ActionRowBuilder().addComponents(removeSelect));
  }

  return rows;
}

function guildRoleLabel(roleId, guild) {
  const role = guild?.roles.cache.get(roleId);
  if (!role) return roleId.slice(0, 100);
  return role.name.slice(0, 100);
}

async function buildOverviewPayload(interaction, ctx, prismaOverride) {
  const prisma = prismaOverride || ctx.getPrisma();
  const commands = getManagedCommands(ctx);
  const permsMap = await getAllCommandPermissions(prisma);
  const embed = buildOverviewEmbed(commands, permsMap, interaction.guild);
  const components = buildOverviewComponents(commands);
  return { embeds: [embed], components };
}

async function buildDetailPayload(interaction, ctx, commandKey, prismaOverride) {
  const prisma = prismaOverride || ctx.getPrisma();
  const commands = getManagedCommands(ctx);
  const target = commands.find((cmd) => cmd.key === commandKey);
  if (!target) {
    return buildOverviewPayload(interaction, ctx, prisma);
  }
  const roles = await getAllowedRolesForCommand(commandKey, prisma);
  const embed = buildCommandDetailEmbed(target, roles, interaction.guild);
  const components = buildCommandDetailComponents(target, roles, interaction.guild);
  return { embeds: [embed], components };
}

async function presentMenu(interaction, ctx) {
  const payload = await buildOverviewPayload(interaction, ctx);
  await interaction.update(payload);
  return true;
}

async function ensurePosse(interaction, ctx) {
  const posseId = String(ctx?.POSSE_USER_ID || '').trim();
  if (posseId && posseId !== interaction.user.id) {
    const response = { content: 'Apenas o usuário posse pode alterar permissões.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
    return false;
  }
  return true;
}

async function handleInteraction(interaction, ctx) {
  const id = interaction.customId;
  if (!id || !id.startsWith('commandperms')) return false;
  if (!(await ensurePosse(interaction, ctx))) {
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    return handleStringSelect(interaction, ctx);
  }
  if (interaction.isRoleSelectMenu()) {
    return handleRoleSelect(interaction, ctx);
  }
  if (interaction.isButton()) {
    return handleButton(interaction, ctx);
  }
  return false;
}

async function handleStringSelect(interaction, ctx) {
  const id = interaction.customId;
  const [prefix, action, commandKey] = id.split(':');
  if (id === CUSTOM_IDS.SELECT) {
    const selected = interaction.values?.[0];
    if (!selected) {
      await interaction.deferUpdate().catch(() => {});
      const payload = await buildOverviewPayload(interaction, ctx);
      await interaction.editReply(payload).catch(() => {});
      return true;
    }
    await interaction.deferUpdate().catch(() => {});
    const payload = await buildDetailPayload(interaction, ctx, selected);
    await interaction.editReply(payload).catch(() => {});
    return true;
  }
  if (prefix === 'commandperms' && action === 'remove' && commandKey) {
    const values = interaction.values || [];
    await interaction.deferUpdate().catch(() => {});
    if (values.length) {
      await removeRolesFromCommand(commandKey, values, ctx.getPrisma());
    }
    const payload = await buildDetailPayload(interaction, ctx, commandKey);
    await interaction.editReply(payload).catch(() => {});
    return true;
  }
  return false;
}

async function handleRoleSelect(interaction, ctx) {
  const [, action, commandKey] = interaction.customId.split(':');
  if (action !== 'add' || !commandKey) return false;
  const values = interaction.values || [];
  await interaction.deferUpdate().catch(() => {});
  if (values.length) {
    await addRolesToCommand(commandKey, values, ctx.getPrisma());
  }
  const payload = await buildDetailPayload(interaction, ctx, commandKey);
  await interaction.editReply(payload).catch(() => {});
  return true;
}

async function handleButton(interaction, ctx) {
  const id = interaction.customId;
  if (id === CUSTOM_IDS.OVERVIEW) {
    await interaction.deferUpdate().catch(() => {});
    const payload = await buildOverviewPayload(interaction, ctx);
    await interaction.editReply(payload).catch(() => {});
    return true;
  }
  const [, action, commandKey] = id.split(':');
  if (action === 'clear' && commandKey) {
    await interaction.deferUpdate().catch(() => {});
    await clearRolesForCommand(commandKey, ctx.getPrisma());
    const payload = await buildDetailPayload(interaction, ctx, commandKey);
    await interaction.editReply(payload).catch(() => {});
    return true;
  }
  return false;
}

module.exports = {
  presentMenu,
  handleInteraction,
};
