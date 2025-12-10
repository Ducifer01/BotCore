const { SlashCommandBuilder, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPrisma } = require('../db');
const { checkAccess, ensureGuild } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup_verifique_se')
    .setDescription('Publica o painel de verificação com botão Verifique-se')
    .addChannelOption(o => o.setName('canal').setDescription('Canal alvo').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'setup_verifique_se'))) {
      return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
    }
    await ensureGuild(interaction.guild);
    const prisma = getPrisma();
    const channel = interaction.options.getChannel('canal') || interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: 'Selecione um canal de texto.', ephemeral: true });
    }

    await prisma.guildConfig.upsert({
      where: { guildId: interaction.guildId },
      update: { verifyPanelChannelId: channel.id },
      create: { guildId: interaction.guildId, verifyPanelChannelId: channel.id },
    });

    const embed = new EmbedBuilder()
      .setTitle('Verifique-se')
      .setDescription('Clique no botão abaixo para abrir um tópico privado com nossa equipe de verificação. Aguarde um responsável responder.')
      .setColor(0x2ECC71);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:open').setLabel('Verifique-se').setStyle(ButtonStyle.Success)
    );
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `Painel publicado em <#${channel.id}>`, ephemeral: true });
  }
};
