const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('copiar_perm_canal')
    .setDescription('Copia permissões de um canal para outro')
    .addChannelOption(opt => opt.setName('origem').setDescription('Canal origem').setRequired(true))
    .addChannelOption(opt => opt.setName('destino').setDescription('Canal destino').setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_canal'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getChannel('origem');
    const destino = interaction.options.getChannel('destino');

    if (!origem || !destino) {
      return interaction.reply({ content: 'Selecione canais válidos.', ephemeral: true });
    }

    try {
      const overwrites = origem.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield,
        deny: ow.deny.bitfield,
      }));

      await destino.permissionOverwrites.set(overwrites);

      await interaction.reply({ content: `Permissões copiadas de ${origem.name} para ${destino.name}.`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Erro ao copiar permissões.', ephemeral: true });
    }
  }
};
