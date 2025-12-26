const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add_cargo_all')
    .setDescription('Adiciona um cargo a todos os membros da guild, com exclusões opcionais')
    .addRoleOption(opt => opt
      .setName('cargo')
      .setDescription('Cargo a ser adicionado')
      .setRequired(true))
    .addRoleOption(opt => opt
      .setName('excluir_cargo_1')
      .setDescription('Ignorar membros que possuem este cargo (não receberão o novo)')
      .setRequired(false))
    .addRoleOption(opt => opt
      .setName('excluir_cargo_2')
      .setDescription('Ignorar membros que possuem este cargo (não receberão o novo)')
      .setRequired(false))
    .addRoleOption(opt => opt
      .setName('excluir_cargo_3')
      .setDescription('Ignorar membros que possuem este cargo (não receberão o novo)')
      .setRequired(false)),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'add_cargo_all'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }
    const role = interaction.options.getRole('cargo', true);
    const exclude = [
      interaction.options.getRole('excluir_cargo_1'),
      interaction.options.getRole('excluir_cargo_2'),
      interaction.options.getRole('excluir_cargo_3'),
    ].filter(Boolean).map(r => r.id);

    const exclusionInfo = exclude.length
      ? exclude.map(id => `<@&${id}>`).join(', ')
      : 'Nenhum cargo será usado como exclusão (todos receberão o novo cargo).';

    const embed = new EmbedBuilder()
      .setTitle('Adicionar cargo em massa')
      .setDescription([
        `Cargo alvo: <@&${role.id}>`,
        `Ignorar (não receberão): ${exclusionInfo}`,
        '',
        '**Atenção:** os membros que possuírem qualquer cargo listado em "Ignorar" serão pulados e não receberão o cargo selecionado.',
        'Tem certeza que deseja adicionar este cargo a todos os demais membros?',
      ].join('\n'))
      .setColor(0x2ecc71);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bulkrole_confirm:add:${role.id}:${exclude.join('|') || 'none'}`)
        .setLabel('Sim')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bulkrole_cancel')
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};
