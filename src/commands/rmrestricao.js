const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkAccessForMember } = require('../permissions');
const { removeRestriction, getVoiceRestrictionsConfig } = require('../services/voiceRestrictions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rmrestricao')
    .setDescription('Remove uma restrição de voz entre dois usuários')
    .addUserOption((opt) =>
      opt.setName('usuario1')
        .setDescription('Primeiro usuário')
        .setRequired(true)
    )
    .addUserOption((opt) =>
      opt.setName('usuario2')
        .setDescription('Segundo usuário')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('razao')
        .setDescription('Motivo da remoção (opcional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const prisma = interaction.client.prisma;
    const hasAccess = await checkAccessForMember(interaction.member, 'rmrestricao', prisma);
    if (!hasAccess) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const user1 = interaction.options.getUser('usuario1');
    const user2 = interaction.options.getUser('usuario2');
    const removeReason = interaction.options.getString('razao') || 'Sem motivo especificado';

    const removed = await removeRestriction(prisma, user1.id, user2.id, { reason: removeReason, authorId: interaction.user.id });
    
    if (!removed) {
      return interaction.reply({ content: '❌ Nenhuma restrição ativa encontrada entre esses usuários.', ephemeral: true });
    }

    await interaction.reply({ content: `✅ Restrição removida entre <@${user1.id}> e <@${user2.id}>.`, ephemeral: true });

    const cfg = await getVoiceRestrictionsConfig(prisma);
    const logChannelId = cfg.commandLogChannelId;
    if (logChannelId) {
      const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      if (logChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Restrição Removida')
          .setColor(0x2ecc71)
          .addFields(
            { name: 'Usuário 1', value: `<@${user1.id}>`, inline: true },
            { name: 'Usuário 2', value: `<@${user2.id}>`, inline: true },
            { name: 'Razão da remoção', value: removeReason, inline: false },
            { name: 'Por', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};
