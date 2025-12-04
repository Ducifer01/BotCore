const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editar_cargo')
    .setDescription('Abre painel para editar nome/emoji de um cargo')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('ID do cargo a editar')
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'editar_cargo'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const roleId = interaction.options.getString('id');
    const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });

  const embed = new EmbedBuilder().setTitle(`Editar cargo: ${role.name}`).setDescription('Escolha o que deseja editar. Obs: Apenas ações de quem iniciou serão aceitas.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`role-edit:name:${role.id}`).setLabel('Editar nome').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`role-edit:emoji:${role.id}`).setLabel('Editar emoji').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};
