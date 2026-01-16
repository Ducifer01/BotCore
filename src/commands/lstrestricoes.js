const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkAccessForMember } = require('../permissions');
const { listRestrictions } = require('../services/voiceRestrictions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lstrestricoes')
    .setDescription('Lista todas as restrições de voz ativas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const prisma = interaction.client.prisma;
    const hasAccess = await checkAccessForMember(interaction.member, 'lstrestricoes', prisma);
    if (!hasAccess) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const restrictions = await listRestrictions(prisma);
    
    if (restrictions.length === 0) {
      return interaction.reply({ content: 'Nenhuma restrição ativa no momento.', ephemeral: true });
    }

    const restrictionsList = restrictions.slice(0, 25).map((r) => {
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
      .setDescription(`**Total:** ${restrictions.length} restrição(ões)\n\n${restrictionsList}`)
      .setTimestamp();

    if (restrictions.length > 25) {
      embed.setFooter({ text: `Mostrando 25 de ${restrictions.length} restrições` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
