const { SlashCommandBuilder, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verificar_perm_canais')
    .setDescription('Verifica se os canais de uma categoria estão sincronizados com as permissões da categoria')
    .addChannelOption(opt => opt.setName('categoria').setDescription('Categoria a verificar').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'verificar_perm_canais'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const categoria = interaction.options.getChannel('categoria');
    if (!categoria || categoria.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: 'Selecione uma categoria válida.', ephemeral: true });
    }

    const catOverwrites = categoria.permissionOverwrites.cache.map(ow => ({ id: ow.id, type: ow.type, allow: ow.allow.bitfield, deny: ow.deny.bitfield }));

    const canais = interaction.guild.channels.cache.filter(c => c.parentId === categoria.id);
    const divergentes = [];
    canais.forEach(c => {
      const chanOverwrites = c.permissionOverwrites.cache.map(ow => ({ id: ow.id, type: ow.type, allow: ow.allow.bitfield, deny: ow.deny.bitfield }));
      const sameLength = chanOverwrites.length === catOverwrites.length;
      const sameSets = sameLength && chanOverwrites.every(co => catOverwrites.some(ao => ao.id === co.id && ao.type === co.type && ao.allow === co.allow && ao.deny === co.deny));
      if (!sameSets) divergentes.push(c);
    });

    const embed = new EmbedBuilder()
      .setTitle('Verificação de Permissões da Categoria')
      .addFields(
        { name: 'Categoria', value: categoria.name, inline: true },
        { name: 'Total de canais', value: String(canais.size), inline: true },
        { name: 'Canais divergentes', value: divergentes.length ? divergentes.map(c => `#${c.name}`).join(', ') : 'Todos sincronizados', inline: false }
      )
      .setColor(divergentes.length ? 0xFF9900 : 0x00AA00);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sync:${categoria.id}`).setLabel('Sincronizar').setStyle(ButtonStyle.Primary).setDisabled(divergentes.length === 0)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};
