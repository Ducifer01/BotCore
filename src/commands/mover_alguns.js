const { SlashCommandBuilder, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { checkAccess } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mover_alguns')
    .setDescription('Selecione usuários do seu canal de voz atual para mover ao canal de destino')
    .addChannelOption(opt =>
      opt.setName('destino')
        .setDescription('Canal de voz destino')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!(await checkAccess(interaction, 'mover_alguns'))) {
      return interaction.reply({ content: 'Você não tem permissão para este comando.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: 'O bot precisa da permissão "Move Members" para mover usuários.', ephemeral: true });
    }

    const src = interaction.member.voice?.channel;
    const dest = interaction.options.getChannel('destino');

    if (!src || (src.type !== ChannelType.GuildVoice && src.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({ content: 'Você precisa estar conectado a um canal de voz.', ephemeral: true });
    }
    if (!dest || (dest.type !== ChannelType.GuildVoice && dest.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({ content: 'Selecione um canal de voz válido como destino.', ephemeral: true });
    }

    const members = [...src.members.values()];
    if (members.length === 0) {
      return interaction.reply({ content: 'Não há usuários no seu canal de voz.', ephemeral: true });
    }

    // Monta opções (máximo 25 por select). Para simplicidade, usamos apenas os 25 primeiros.
    const max = 25;
    const options = members.slice(0, max).map(m => ({ label: m.displayName, value: m.id }));
    const truncated = members.length > max ? ` (e mais ${members.length - max} ocultos)` : '';

    const select = new StringSelectMenuBuilder()
      .setCustomId(`move-some:dest=${dest.id}:src=${src.id}`)
      .setPlaceholder('Selecione usuários...')
      .setMinValues(0)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options);

    const row1 = new ActionRowBuilder().addComponents(select);
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`move-some-go:dest=${dest.id}:src=${src.id}`).setLabel('✅ Mover selecionados').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`move-some-cancel:dest=${dest.id}:src=${src.id}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: `Selecione os usuários que deseja mover para ${dest.name}:${truncated}`,
      components: [row1, row2],
      ephemeral: true,
    });
  }
};
