const { SlashCommandBuilder } = require('discord.js');
const { checkAccess } = require('../permissions');

function extractIds(input) {
  return Array.from(new Set(
    String(input || '')
      .split(/[\s,]+/)
      .map((token) => token.replace(/[^0-9]/g, ''))
      .filter((id) => id.length > 4),
  ));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('copiar_perm_cargo')
    .setDescription('Copia as permissões de um cargo para outro')
    .addRoleOption(opt => opt.setName('origem').setDescription('Cargo origem').setRequired(true))
    .addStringOption(opt => opt
      .setName('destinos')
      .setDescription('Indique um ou mais cargos destino (menções ou IDs separados por espaço)')
      .setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_cargo'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getRole('origem');
    const destinoRaw = interaction.options.getString('destinos');
    const destinoIds = extractIds(destinoRaw);

    if (!origem) {
      return interaction.reply({ content: 'Selecione um cargo de origem válido.', ephemeral: true });
    }
    if (!destinoIds.length) {
      return interaction.reply({ content: 'Informe ao menos um cargo de destino válido.', ephemeral: true });
    }

    const destinos = destinoIds
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => Boolean(role) && role.id !== origem.id);

    if (!destinos.length) {
      return interaction.reply({ content: 'Nenhum cargo destino válido encontrado.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const sucesso = [];
      const falhas = [];
      for (const destino of destinos) {
        try {
          await destino.setPermissions(origem.permissions, `Copiar permissões de ${origem.name}`);
          sucesso.push(destino.name);
        } catch (err) {
          console.error(err);
          falhas.push(destino.name);
        }
      }

      let mensagem = `Permissões copiadas de ${origem.name} para ${sucesso.length} destino(s).`;
      if (sucesso.length) {
        mensagem += `\nSucesso: ${sucesso.map((n) => `**${n}**`).join(', ')}.`;
      }
      if (falhas.length) {
        mensagem += `\nFalhou em: ${falhas.map((n) => `**${n}**`).join(', ')}.`;
      }

      await interaction.editReply({ content: mensagem });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: 'Erro ao copiar permissões.' });
    }
  }
};
