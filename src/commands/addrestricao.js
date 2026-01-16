const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkAccessForMember } = require('../permissions');
const { addRestriction, getVoiceRestrictionsConfig } = require('../services/voiceRestrictions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addrestricao')
    .setDescription('Adiciona uma restrição de voz entre dois usuários')
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
        .setDescription('Motivo da restrição')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const prisma = interaction.client.prisma;
    const hasAccess = await checkAccessForMember(interaction.member, 'addrestricao', prisma);
    if (!hasAccess) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const user1 = interaction.options.getUser('usuario1');
    const user2 = interaction.options.getUser('usuario2');
    const reason = interaction.options.getString('razao');

    if (user1.id === user2.id) {
      return interaction.reply({ content: 'Não é possível criar restrição entre o mesmo usuário.', ephemeral: true });
    }

    await addRestriction(prisma, user1.id, user2.id, { reason, authorId: interaction.user.id });
    
    await interaction.reply({ content: `✅ Restrição adicionada entre <@${user1.id}> e <@${user2.id}>.`, ephemeral: true });

    const cfg = await getVoiceRestrictionsConfig(prisma);
    const logChannelId = cfg.commandLogChannelId;
    if (logChannelId) {
      const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      if (logChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🚫 Restrição Adicionada')
          .setColor(0xe74c3c)
          .addFields(
            { name: 'Usuário 1', value: `<@${user1.id}>`, inline: true },
            { name: 'Usuário 2', value: `<@${user2.id}>`, inline: true },
            { name: 'Razão', value: reason, inline: false },
            { name: 'Por', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};
