const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const awaitingRoleEdit = new Map(); // Map<userId, { roleId, type, channelId }>

async function handleInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('role-edit:')) return false;
  // Select de cargo
  if (interaction.isRoleSelectMenu()) {
    const action = customId.split(':')[1];
    if (action !== 'select') return false;
    await interaction.deferUpdate().catch(() => {});
    const roleId = interaction.values?.[0];
    if (!roleId) {
      await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true }).catch(() => {});
      return true;
    }
    const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await interaction.followUp({ content: 'Cargo não encontrado.', ephemeral: true }).catch(() => {});
      return true;
    }
    const embed = new EmbedBuilder().setTitle(`Editar cargo: ${role.name}`).setDescription('Escolha o que deseja editar. Obs: Apenas ações de quem iniciou serão aceitas.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role-edit:name:${role.id}`).setLabel('Editar nome').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`role-edit:emoji:${role.id}`).setLabel('Editar emoji').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
    return true;
  }
  // Botões
  if (!interaction.isButton()) return false;
  const [, action, roleId] = customId.split(':');
  if (!roleId) {
    await interaction.reply({ content: 'Requisição inválida.', ephemeral: true });
    return true;
  }
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });
    return true;
  }
  if (action === 'back') {
    const embed = new EmbedBuilder().setTitle(`Editar cargo: ${role.name}`).setDescription('Escolha o que deseja editar.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role-edit:name:${role.id}`).setLabel('Editar nome').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`role-edit:emoji:${role.id}`).setLabel('Editar emoji').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  if (action === 'name') {
    awaitingRoleEdit.set(interaction.user.id, { roleId, type: 'name', channelId: interaction.channelId });
    const embed = new EmbedBuilder().setTitle('Editar nome do cargo').setDescription('Digite o novo nome neste canal.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role-edit:back:${role.id}`).setLabel('Voltar').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  if (action === 'emoji') {
    awaitingRoleEdit.set(interaction.user.id, { roleId, type: 'emoji', channelId: interaction.channelId });
    const embed = new EmbedBuilder().setTitle('Editar emoji do cargo').setDescription('Envie um emoji de servidor (custom) neste canal.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role-edit:back:${role.id}`).setLabel('Voltar').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }
  return false;
}

async function handleMessage(message, ctx) {
  if (message.author.bot || !message.guild) return false;
  if (!ctx.isGuildAllowed(message.guildId)) return false;
  const pending = awaitingRoleEdit.get(message.author.id);
  if (!pending) return false;
  if (pending.channelId !== message.channel.id) return false;
  const role = message.guild.roles.cache.get(pending.roleId) || await message.guild.roles.fetch(pending.roleId).catch(() => null);
  if (!role) {
    awaitingRoleEdit.delete(message.author.id);
    await safeReply(message, 'Cargo não encontrado.');
    return true;
  }
  if (pending.type === 'name') {
    const newName = message.content?.trim();
    if (!newName) return true;
    try {
      await role.setName(newName, `Edit name by ${message.author.tag}`);
      awaitingRoleEdit.delete(message.author.id);
      await safeReply(message, `Nome do cargo atualizado para: ${newName}`);
    } catch {
      awaitingRoleEdit.delete(message.author.id);
      await safeReply(message, 'Falha ao atualizar o nome.');
    }
    return true;
  }
  if (pending.type === 'emoji') {
    const match = message.content?.match(/<a?:\w+:(\d+)>/);
    if (!match) return true;
    const emojiId = match[1];
    const isAnimated = /<a:/.test(message.content);
    const ext = isAnimated ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=128&quality=lossless`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('download fail');
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      await role.setIcon(buf);
      awaitingRoleEdit.delete(message.author.id);
      await safeReply(message, 'Ícone do cargo atualizado a partir do emoji.');
    } catch {
      awaitingRoleEdit.delete(message.author.id);
      await safeReply(message, 'Falha ao atualizar o ícone. Verifique se o servidor suporta ícone de cargo e tente outro emoji.');
    }
    return true;
  }
  return false;
}

async function safeReply(message, content) {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch {}
}

module.exports = {
  handleInteraction,
  handleMessage,
};
