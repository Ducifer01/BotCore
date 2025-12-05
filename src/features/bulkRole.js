const { EmbedBuilder } = require('discord.js');

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
  let progressMessage = null;
  const loadingEmbed = new EmbedBuilder()
    .setTitle('Aplicando cargo em massa')
    .setDescription([
      `Estou ${action === 'add' ? 'adicionando' : 'removendo'} o cargo <@&${roleId}> em todos os membros permitidos.`,
      'Isso pode levar um tempo, aguarde enquanto concluo a operação (carregamento infinito ♾️).',
    ].join('\n'))
    .setColor(0xFEE75C);
  try {
    progressMessage = await interaction.followUp({ embeds: [loadingEmbed], ephemeral: true });
  } catch {}
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
  const finalEmbed = new EmbedBuilder()
    .setTitle('Operação de cargos concluída')
    .setDescription(action === 'add'
      ? 'Processo finalizado. Veja abaixo o resultado da adição em massa:'
      : 'Processo finalizado. Veja abaixo o resultado da remoção em massa:')
    .addFields(
      { name: 'Cargo alvo', value: `<@&${roleId}>`, inline: true },
      { name: 'Ignorados (não alterados)', value: excludeIds.length ? excludeIds.map((id) => `<@&${id}>`).join(', ') : 'Nenhum', inline: true },
      { name: 'Processados', value: String(processed), inline: true },
      { name: action === 'add' ? 'Adicionados' : 'Removidos', value: String(changed), inline: true },
      { name: 'Ignorados (já tinham ou excluídos)', value: String(skipped), inline: true },
      { name: 'Falhas', value: String(failed), inline: true }
    )
    .setColor(0x57F287)
    .setTimestamp();

  if (progressMessage?.editable) {
    await progressMessage.edit({ embeds: [finalEmbed] }).catch(() => {});
  } else {
    await interaction.followUp({ embeds: [finalEmbed], ephemeral: true }).catch(() => {});
  }
}

module.exports = { handleInteraction };
