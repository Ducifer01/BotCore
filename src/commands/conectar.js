const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess } = require('../permissions');
const { connectToChannel } = require('../voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('conectar')
    .setDescription('Conecta o bot a um canal de voz especificado')
    .addChannelOption(opt =>
      opt.setName('canal')
        .setDescription('Canal de voz para conectar')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'conectar'))) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.Connect)) {
      return interaction.reply({ content: 'O bot precisa da permissão "Connect" para entrar no canal.', ephemeral: true });
    }

    const canal = interaction.options.getChannel('canal');
    if (!canal || (canal.type !== ChannelType.GuildVoice && canal.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({ content: 'Selecione um canal de voz válido.', ephemeral: true });
    }

    try {
      await connectToChannel(canal);
      await interaction.reply({ content: `Conectado em ${canal.name}.`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Não foi possível conectar ao canal.', ephemeral: true });
    }
  }
};
