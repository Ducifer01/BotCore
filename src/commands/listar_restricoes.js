const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkVoiceRestrictionPermission } = require('../services/voiceRestrictionPermissions');
const { listRestrictions } = require('../services/voiceRestrictions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listar_restricoes')
    .setDescription('Lista todas as restrições de voz ativas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const prisma = interaction.client.prisma;
    const hasAccess = await checkVoiceRestrictionPermission(interaction.member, prisma);
    if (!hasAccess) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const restrictions = await listRestrictions(prisma);
    const activeRestrictions = restrictions.filter((r) => !r.removedAt);
    
    if (activeRestrictions.length === 0) {
      return interaction.reply({ content: 'Nenhuma restrição ativa no momento.', ephemeral: true });
    }

    const restrictionsList = activeRestrictions.slice(0, 25).map((r) => {
      const createdDate = new Date(r.createdAt).toLocaleString('pt-BR');
      return [
        `**Membros:** <@${r.a}> - <@${r.b}>`,
        `**Criado por:** <@${r.createdBy}>`,
        `**Data:** ${createdDate}`,
        `**Razão:** ${r.reason || 'Sem motivo especificado'}`,
        '─────────────────────────'
      ].join('\n');
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('🚫 Restrições de Voz Ativas')
      .setColor(0xe74c3c)
      .setDescription(`**Total:** ${activeRestrictions.length} restrição(ões)\n\n${restrictionsList}`)
      .setTimestamp();

    if (activeRestrictions.length > 25) {
      embed.setFooter({ text: `Mostrando 25 de ${activeRestrictions.length} restrições` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
