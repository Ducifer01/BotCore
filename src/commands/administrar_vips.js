const { SlashCommandBuilder } = require('discord.js');
const { buildVipAdminHomePayload } = require('../features/vipSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('administrar_vips')
    .setDescription('Gerencie usuários e planos de VIP (administradores)'),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has('Administrator')) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', ephemeral: true });
    }

    const payload = buildVipAdminHomePayload();
    await interaction.reply({ ...payload, ephemeral: true });
  },
};
