const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('copiar_perm_categoria')
    .setDescription('Copia permissões de uma categoria para outra')
    .addChannelOption(opt => opt.setName('origem').setDescription('Categoria origem').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addChannelOption(opt => opt.setName('destino').setDescription('Categoria destino').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_categoria'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getChannel('origem');
    const destino = interaction.options.getChannel('destino');

    if (origem.type !== ChannelType.GuildCategory || destino.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: 'Selecione categorias válidas.', ephemeral: true });
    }

    try {
      const overwrites = origem.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield,
        deny: ow.deny.bitfield,
      }));

      await destino.permissionOverwrites.set(overwrites);

      await interaction.reply({ content: `Permissões copiadas da categoria ${origem.name} para ${destino.name}.`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Erro ao copiar permissões.', ephemeral: true });
    }
  }
};
