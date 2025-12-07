const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { ensureGuild } = require('../permissions');
const { getPrisma } = require('../db');

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

    const baseEmbed = new EmbedBuilder()
      .setTitle('Menu de Configuração')
  .setDescription('Selecione uma seção para configurar.')
      .setColor(0x5865F2);
    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu:root')
      .setPlaceholder('Escolha uma seção...')
      .addOptions([
        { label: 'Configurar Insta', value: 'insta', description: 'Canais e opções do Instagram' },
  { label: 'Configurar Mute', value: 'mute', description: 'Cargos, logs e permissões para mute de voz/chat' },
        { label: 'Configurar Suporte', value: 'support', description: 'Painel, cargos e logs do suporte' },
        { label: 'Configurar AutoMod', value: 'automod', description: 'Palavras bloqueadas e punições automáticas' },
        { label: 'Configurar Moderação', value: 'moderation', description: 'Banimentos, castigos e permissões' }
      ]);
    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.editReply({ embeds: [baseEmbed], components: [row] });
  }
};
