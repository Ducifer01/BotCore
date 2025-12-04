const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess, ensureGuild } = require('../permissions');
const { getPrisma } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config_insta')
    .setDescription('Configura canais de insta boys e insta girls')
    .addChannelOption(o => o.setName('boys').setDescription('Canal insta boys').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addChannelOption(o => o.setName('girls').setDescription('Canal insta girls').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const allowed = await checkAccess(interaction, 'config_insta');
    if (!allowed && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
    }
    await ensureGuild(interaction.guild);
    const prisma = getPrisma();
    const boys = interaction.options.getChannel('boys');
    const girls = interaction.options.getChannel('girls');

    await prisma.guildConfig.upsert({
      where: { guildId: interaction.guildId },
      update: {
        instaBoysChannelId: boys?.id || undefined,
        instaGirlsChannelId: girls?.id || undefined,
      },
      create: {
        guildId: interaction.guildId,
        instaBoysChannelId: boys?.id || null,
        instaGirlsChannelId: girls?.id || null,
      },
    });

    const msg = [
      boys ? `Boys: <#${boys.id}>` : null,
      girls ? `Girls: <#${girls.id}>` : null,
    ].filter(Boolean).join('\n') || 'Configuração atualizada (sem alterações explícitas).';
    await interaction.reply({ content: msg, ephemeral: true });
  }
};
