const { SlashCommandBuilder } = require('discord.js');
const { checkAccess } = require('../permissions');
const { disconnectFromGuild } = require('../voice');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('desconectar')
    .setDescription('Desconecta o bot do canal de voz atual nesta guild'),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'desconectar'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const conn = getVoiceConnection(interaction.guildId);
    const me = interaction.guild.members.me;
    const inVoice = !!me?.voice?.channelId;

    try {
      if (conn) {
        disconnectFromGuild(interaction.guildId);
      } else if (inVoice) {
        await me.voice.disconnect();
      } else {
        return interaction.reply({ content: 'O bot não está conectado a nenhum canal de voz nesta guild.', ephemeral: true });
      }
      await interaction.reply({ content: 'Desconectado do canal de voz.', ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Não foi possível desconectar.', ephemeral: true });
    }
  }
};
