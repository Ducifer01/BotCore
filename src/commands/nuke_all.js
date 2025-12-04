const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nuke_all')
    .setDescription('Apaga e reconstrói todos os canais de uma categoria (mesmo nome e permissões)')
    .addChannelOption(opt =>
      opt.setName('categoria')
        .setDescription('Categoria alvo')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'nuke_all'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'O bot precisa da permissão "Manage Channels".', ephemeral: true });
    }

    const categoria = interaction.options.getChannel('categoria');
    if (!categoria || categoria.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: 'Selecione uma categoria válida.', ephemeral: true });
    }

    const canais = interaction.guild.channels.cache
      .filter(c => c.parentId === categoria.id)
      .sort((a, b) => a.position - b.position);

    if (canais.size === 0) {
      return interaction.reply({ content: 'A categoria não possui canais.', ephemeral: true });
    }

    await interaction.reply({ content: `Iniciando nuke da categoria ${categoria.name} (${canais.size} canais)...`, ephemeral: true });

    let ok = 0, fail = 0;
    for (const canal of canais.values()) {
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
          reason: `Nuke ALL by ${interaction.user.tag}`,
        });
        if (position != null) {
          try { await clone.setPosition(position); } catch {}
        }
        await canal.delete(`Nuke ALL by ${interaction.user.tag}`);
        ok++;
      } catch (err) {
        console.error(err);
        fail++;
      }
    }

    await interaction.followUp({ content: `Concluído. Sucesso: ${ok}, Falhas: ${fail}.`, ephemeral: true });
  }
};
