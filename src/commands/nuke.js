const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Apaga e reconstrói o canal especificado (mesmo nome e permissões)')
    .addChannelOption(opt =>
      opt.setName('canal')
        .setDescription('Canal a ser reiniciado')
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'nuke'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'O bot precisa da permissão "Manage Channels".', ephemeral: true });
    }

    const canal = interaction.options.getChannel('canal');
    if (!canal) {
      return interaction.reply({ content: 'Canal inválido.', ephemeral: true });
    }

    try {
      const parentId = canal.parentId || null;
      const position = canal.position;
      const type = canal.type;
      const name = canal.name;
      const topic = canal.topic;
      const rateLimitPerUser = canal.rateLimitPerUser;
      const nsfw = canal.nsfw;
      const bitrate = canal.bitrate;
      const userLimit = canal.userLimit;
      const rtcRegion = canal.rtcRegion;
      const videoQualityMode = canal.videoQualityMode;
      const permissionOverwrites = canal.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield,
        deny: ow.deny.bitfield,
      }));

      await interaction.reply({ content: `Recriando canal #${name}...`, ephemeral: true });

      // Cria o clone primeiro
      const clone = await interaction.guild.channels.create({
        name,
        type,
        parent: parentId,
        topic,
        nsfw,
        rateLimitPerUser,
        bitrate,
        userLimit,
        rtcRegion,
        videoQualityMode,
        permissionOverwrites,
        reason: `Nuke by ${interaction.user.tag}`,
      });

      // Ajusta posição (se aplicável)
      if (position != null) {
        try { await clone.setPosition(position); } catch {}
      }

      // Remove o original
      await canal.delete(`Nuke by ${interaction.user.tag}`);

      await interaction.followUp({ content: `Canal recriado: #${clone.name}.`, ephemeral: true });
    } catch (err) {
      console.error(err);
      const msg = typeof err?.message === 'string' ? err.message : 'Erro ao recriar o canal.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  }
};
