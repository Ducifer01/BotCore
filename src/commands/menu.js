const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { ensureGuild } = require('../permissions');
const { getPrisma } = require('../db');
const { buildBaseMenuEmbed, buildRootSelect } = require('../features/menu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Painel de configuração do bot (apenas usuário posse)'),
  async execute(interaction) {
    await ensureGuild(interaction.guild);
    const POSSE_USER_ID = String(process.env.POSSE_USER_ID || '').trim();
    const allowedGuilds = String(process.env.ALLOWED_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowedGuilds.length > 0 && !allowedGuilds.includes(String(interaction.guildId))) {
      return; // ignora silenciosamente em guilds não permitidas
    }
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const baseEmbed = buildBaseMenuEmbed();
    const row = new ActionRowBuilder().addComponents(buildRootSelect());
    await interaction.editReply({ embeds: [baseEmbed], components: [row] });
  }
};
