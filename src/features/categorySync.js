async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('sync:')) return false;
  const categoryId = interaction.customId.split(':')[1];
  const category = interaction.guild.channels.cache.get(categoryId) || interaction.guild.channels.fetch(categoryId).catch(() => null);
  const categoria = await category;
  if (!categoria) {
    await interaction.reply({ content: 'Categoria não encontrada.', ephemeral: true });
    return true;
  }
  const catOverwrites = categoria.permissionOverwrites.cache.map((ow) => ({
    id: ow.id,
    type: ow.type,
    allow: ow.allow.bitfield,
    deny: ow.deny.bitfield,
  }));
  const channels = interaction.guild.channels.cache.filter((c) => c.parentId === categoria.id);
  let synced = 0;
  for (const channel of channels.values()) {
    const chanOverwrites = channel.permissionOverwrites.cache.map((ow) => ({
      id: ow.id,
      type: ow.type,
      allow: ow.allow.bitfield,
      deny: ow.deny.bitfield,
    }));
    const sameLength = chanOverwrites.length === catOverwrites.length;
    const sameSets = sameLength && chanOverwrites.every((co) => catOverwrites.some((ao) => ao.id === co.id && ao.type === co.type && ao.allow === co.allow && ao.deny === co.deny));
    if (!sameSets) {
      await channel.permissionOverwrites.set(catOverwrites);
      synced++;
    }
  }
  await interaction.reply({ content: `Sincronização concluída. ${synced} canais atualizados.`, ephemeral: true });
  return true;
}

module.exports = { handleInteraction };
