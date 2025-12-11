const { SlashCommandBuilder, ChannelType } = require('discord.js');
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
    .setName('copiar_perm_categoria')
    .setDescription('Copia permissões de uma categoria para outra')
    .addChannelOption(opt => opt.setName('origem').setDescription('Categoria origem').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addStringOption(opt => opt
      .setName('destinos')
      .setDescription('Indique uma ou mais categorias destino (menções ou IDs separados por espaço)')
      .setRequired(true)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'copiar_perm_categoria'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const origem = interaction.options.getChannel('origem');
    const destinoRaw = interaction.options.getString('destinos');
    const destinoIds = extractIds(destinoRaw);

    if (origem.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: 'Selecione uma categoria de origem válida.', ephemeral: true });
    }
    if (!destinoIds.length) {
      return interaction.reply({ content: 'Informe ao menos uma categoria de destino válida.', ephemeral: true });
    }

    const destinos = destinoIds
      .map((id) => interaction.guild.channels.cache.get(id))
      .filter((channel) => channel?.type === ChannelType.GuildCategory && channel.id !== origem.id);

    if (!destinos.length) {
      return interaction.reply({ content: 'Nenhuma categoria destino válida encontrada.', ephemeral: true });
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

      let mensagem = `Permissões copiadas da categoria ${origem.name} para ${sucesso.length} destino(s).`;
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
