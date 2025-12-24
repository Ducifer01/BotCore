const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verificado')
    .setDescription('Consulta o status de verificação de um usuário')
    .addUserOption((opt) => opt
      .setName('usuario')
      .setDescription('Usuário a consultar')
      .setRequired(true)),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Este comando só pode ser usado em servidores.', ephemeral: true });
      return;
    }

    const hasAccess = await checkAccess(interaction, 'verificado');
    if (!hasAccess) {
      await interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('usuario', true);
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'Não consegui localizar este usuário no servidor.', ephemeral: true });
      return;
    }

    const prisma = getPrisma();
    const record = await prisma.verifiedUserGlobal.findUnique({ where: { userId: member.id } }).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(member.user.username)
      .setDescription(`Informações sobre o usuário ${member.user.username}`)
      .addFields(
        { name: 'Membro', value: `<@${member.id}> | ${member.id}`, inline: false },
        { name: 'Status', value: record ? 'Verificado' : 'Não verificado', inline: false },
        { name: 'Verificado por', value: record?.verifiedBy ? `<@${record.verifiedBy}> | ${record.verifiedBy}` : '—', inline: false },
      )
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .setColor(record ? 0x2ECC71 : 0xE74C3C);

    if (record?.photoUrl) {
      embed.setImage(record.photoUrl);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
