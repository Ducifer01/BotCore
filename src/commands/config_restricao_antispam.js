const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getProtectionsConfig, saveProtectionsConfig } = require('../services/protectionsConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config_restricao_antispam')
    .setDescription('Configura parâmetros anti-spam do sistema de restrições')
    .addIntegerOption((opt) =>
      opt.setName('tentativas')
        .setDescription('Número máximo de tentativas antes do castigo (padrão: 3)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addIntegerOption((opt) =>
      opt.setName('janela')
        .setDescription('Janela de tempo em segundos para contar tentativas (padrão: 60)')
        .setRequired(false)
        .setMinValue(10)
        .setMaxValue(300)
    )
    .addIntegerOption((opt) =>
      opt.setName('castigo')
        .setDescription('Tempo de castigo em minutos (padrão: 5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(60)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { POSSE_USER_ID } = process.env;
    if (POSSE_USER_ID && interaction.user.id !== POSSE_USER_ID) {
      return interaction.reply({ content: 'Apenas o usuário posse pode configurar isso.', ephemeral: true });
    }

    const prisma = interaction.client.prisma;
    const cfg = await getProtectionsConfig(prisma);

    const tentativas = interaction.options.getInteger('tentativas');
    const janela = interaction.options.getInteger('janela');
    const castigo = interaction.options.getInteger('castigo');

    if (!tentativas && !janela && !castigo) {
      const current = cfg.voiceRestrictions?.antiSpam || {};
      return interaction.reply({
        content: `**Configuração atual:**\n` +
          `Tentativas: **${current.maxAttempts || 3}**\n` +
          `Janela: **${current.windowSeconds || 60}s**\n` +
          `Castigo: **${current.punishmentMinutes || 5}min**`,
        ephemeral: true
      });
    }

    cfg.voiceRestrictions = cfg.voiceRestrictions || {};
    cfg.voiceRestrictions.antiSpam = cfg.voiceRestrictions.antiSpam || {};

    if (tentativas) cfg.voiceRestrictions.antiSpam.maxAttempts = tentativas;
    if (janela) cfg.voiceRestrictions.antiSpam.windowSeconds = janela;
    if (castigo) cfg.voiceRestrictions.antiSpam.punishmentMinutes = castigo;

    await saveProtectionsConfig(prisma, cfg);

    const updates = [];
    if (tentativas) updates.push(`Tentativas: **${tentativas}**`);
    if (janela) updates.push(`Janela: **${janela}s**`);
    if (castigo) updates.push(`Castigo: **${castigo}min**`);

    await interaction.reply({
      content: `✅ Anti-spam atualizado:\n${updates.join('\n')}`,
      ephemeral: true
    });
  },
};
