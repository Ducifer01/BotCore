const selectionCache = new Map(); // Map<messageId:userId, Set<userIds>>

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('move-some:')) {
    const key = `${interaction.message.id}:${interaction.user.id}`;
    const selected = new Set(interaction.values);
    selectionCache.set(key, selected);
    await interaction.reply({ content: `Selecionados: ${[...selected].map((id) => `<@${id}>`).join(', ') || 'nenhum'}`, ephemeral: true });
    return true;
  }
  if (!interaction.isButton()) return false;
  const customId = interaction.customId;
  if (customId.startsWith('move-some-go:')) {
    return handleMove(interaction);
  }
  if (customId.startsWith('move-some-cancel:')) {
    const key = `${interaction.message.id}:${interaction.user.id}`;
    selectionCache.delete(key);
    await interaction.reply({ content: 'Operação cancelada.', ephemeral: true });
    return true;
  }
  return false;
}

async function handleMove(interaction) {
  const params = {};
  const parts = interaction.customId.split(':').slice(1);
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value) params[key] = value;
  }
  const destId = params.dest;
  const srcId = params.src;
  let dest = interaction.guild.channels.cache.get(destId) || await interaction.guild.channels.fetch(destId).catch(() => null);
  let src = interaction.guild.channels.cache.get(srcId) || await interaction.guild.channels.fetch(srcId).catch(() => null);
  if (!dest || !src) {
    await interaction.reply({ content: 'Canais não encontrados.', ephemeral: true });
    return true;
  }
  const key = `${interaction.message.id}:${interaction.user.id}`;
  const selected = selectionCache.get(key);
  if (!selected || selected.size === 0) {
    await interaction.reply({ content: 'Nenhum usuário selecionado.', ephemeral: true });
    return true;
  }
  let moved = 0;
  let failed = 0;
  for (const uid of selected) {
    const member = src.members?.get(uid) || interaction.guild.members.cache.get(uid) || await interaction.guild.members.fetch(uid).catch(() => null);
    if (!member) {
      failed++;
      continue;
    }
    try {
      await member.voice.setChannel(dest);
      moved++;
    } catch {
      failed++;
    }
  }
  selectionCache.delete(key);
  await interaction.reply({ content: `Movidos ${moved}. Falharam ${failed}.`, ephemeral: true });
  return true;
}

module.exports = { handleInteraction };
