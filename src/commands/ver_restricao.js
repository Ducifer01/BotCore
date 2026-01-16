const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkVoiceRestrictionPermission } = require('../services/voiceRestrictionPermissions');
const { getUserRestrictions } = require('../services/voiceRestrictions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ver_restricao')
    .setDescription('Verifica se um usuário possui restrições de voz ativas')
    .addUserOption((opt) =>
      opt.setName('usuario')
        .setDescription('Usuário para verificar')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const prisma = interaction.client.prisma;
    const hasAccess = await checkVoiceRestrictionPermission(interaction.member, prisma);
    if (!hasAccess) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const user = interaction.options.getUser('usuario');
    const restrictions = await getUserRestrictions(prisma, user.id);

    if (restrictions.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Sem Restrições')
        .setColor(0x2ecc71)
        .setDescription(`O usuário <@${user.id}> não possui restrições de voz ativas.`)
        .setTimestamp();
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const restrictionsList = restrictions.map((r) => {
      const otherUserId = r.a === user.id ? r.b : r.a;
      const createdDate = new Date(r.createdAt).toLocaleString('pt-BR');
      return [
        `**Restrito com:** <@${otherUserId}>`,
        `**Criado por:** <@${r.createdBy}>`,
        `**Data:** ${createdDate}`,
        `**Motivo:**\n\`\`\`${r.reason || 'Sem motivo especificado'}\`\`\``,
        '─────────────────────────'
      ].join('\n');
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('🚫 Restrições de Voz')
      .setColor(0xe74c3c)
      .setDescription(`**Usuário:** <@${user.id}> (${user.username})\n**ID:** \`${user.id}\`\n\n**Total:** ${restrictions.length} restrição(ões)\n\n${restrictionsList}`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
