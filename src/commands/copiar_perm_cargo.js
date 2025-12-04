const { SlashCommandBuilder } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('copiar_perm_cargo')
    .setDescription('Copia as permissões de um cargo para outro')
    .addRoleOption(opt => opt.setName('origem').setDescription('Cargo origem').setRequired(true))
    .addRoleOption(opt => opt.setName('destino').setDescription('Cargo destino').setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_cargo'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getRole('origem');
    const destino = interaction.options.getRole('destino');
    if (!origem || !destino) return interaction.reply({ content: 'Cargos inválidos.', ephemeral: true });
    try {
      await destino.setPermissions(origem.permissions, `Copiar permissões de ${origem.name}`);
      await interaction.reply({ content: `Permissões copiadas de ${origem.name} para ${destino.name}.`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Erro ao copiar permissões.', ephemeral: true });
    }
  }
};
