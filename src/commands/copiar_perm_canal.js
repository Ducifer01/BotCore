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
    .setName('copiar_perm_canal')
    .setDescription('Copia permissões de um canal para outro')
    .addChannelOption(opt => opt.setName('origem').setDescription('Canal origem').setRequired(true))
    .addStringOption(opt => opt
      .setName('destinos')
      .setDescription('Indique um ou mais canais destino (menções ou IDs separados por espaço)')
      .setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_canal'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getChannel('origem');
    const destinoRaw = interaction.options.getString('destinos');
    const destinoIds = extractIds(destinoRaw);

    if (!origem) {
      return interaction.reply({ content: 'Selecione um canal de origem válido.', ephemeral: true });
    }
    if (!destinoIds.length) {
      return interaction.reply({ content: 'Informe ao menos um canal de destino válido.', ephemeral: true });
    }

    const destinos = destinoIds
      .map((id) => interaction.guild.channels.cache.get(id))
      .filter((channel) => Boolean(channel) && channel.id !== origem.id);

    if (!destinos.length) {
      return interaction.reply({ content: 'Nenhum canal destino válido encontrado.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const overwrites = origem.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield,
        deny: ow.deny.bitfield,
      }));

      const sucesso = [];
      const falhas = [];
      for (const destino of destinos) {
        try {
          await destino.permissionOverwrites.set(overwrites);
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
