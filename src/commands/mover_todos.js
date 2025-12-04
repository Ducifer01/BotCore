const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mover_todos')
    .setDescription('Move todos os usuários do seu canal de voz atual para o canal de destino')
    .addChannelOption(opt =>
      opt.setName('destino')
        .setDescription('Canal de voz destino')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'mover_todos'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: 'O bot precisa da permissão "Move Members" para mover usuários.', ephemeral: true });
    }

    const src = interaction.member.voice?.channel;
    const dest = interaction.options.getChannel('destino');

    if (!src || (src.type !== ChannelType.GuildVoice && src.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({ content: 'Você precisa estar conectado a um canal de voz.', ephemeral: true });
    }
    if (!dest || (dest.type !== ChannelType.GuildVoice && dest.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({ content: 'Selecione um canal de voz válido como destino.', ephemeral: true });
    }

    try {
      const members = [...src.members.values()];
      let moved = 0, failed = 0;
      for (const m of members) {
        try {
          await m.voice.setChannel(dest);
          moved++;
        } catch (e) {
          failed++;
        }
      }
      await interaction.reply({ content: `Movidos ${moved} usuários para ${dest.name}.${failed ? ` Falhas: ${failed}.` : ''}`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Erro ao mover usuários.', ephemeral: true });
    }
  }
};
