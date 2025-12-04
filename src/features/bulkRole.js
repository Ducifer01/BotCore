async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const customId = interaction.customId;
  if (customId.startsWith('bulkrole_confirm:')) {
    await handleConfirm(interaction);
    return true;
  }
  if (customId === 'bulkrole_cancel') {
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.followUp({ content: 'Operação cancelada.', ephemeral: true });
    return true;
  }
  return false;
}

async function handleConfirm(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const roleId = parts[2];
  const excludeStr = parts[3] || 'none';
  const excludeIds = excludeStr !== 'none' ? excludeStr.split('|') : [];
  const original = interaction.message?.interaction;
  if (original && original.user?.id !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas quem iniciou pode confirmar.', ephemeral: true });
    return;
  }
  await interaction.update({ components: [] }).catch(() => {});
  const guild = interaction.guild;
  if (!guild) {
    await interaction.followUp({ content: 'Guild não encontrada.', ephemeral: true });
    return;
  }
  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.followUp({ content: 'Cargo não encontrado.', ephemeral: true });
    return;
  }
  const members = await guild.members.fetch();
  let processed = 0;
  let changed = 0;
  let skipped = 0;
  let failed = 0;
  for (const [, member] of members) {
    processed++;
    try {
      const hasExcluded = excludeIds.some((rid) => member.roles.cache.has(rid));
      if (hasExcluded) {
        skipped++;
        continue;
      }
      if (action === 'add') {
        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId);
          changed++;
        } else {
          skipped++;
        }
      } else if (action === 'remove') {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          changed++;
        } else {
          skipped++;
        }
      }
    } catch {
      failed++;
    }
  }
  await interaction.followUp({ content: `Concluído: ${action === 'add' ? 'adicionados' : 'removidos'}: ${changed} | pulados: ${skipped} | falhas: ${failed} | total: ${processed}`, ephemeral: true });
}

module.exports = { handleInteraction };
