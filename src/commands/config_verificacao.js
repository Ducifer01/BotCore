const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { checkAccess, ensureGuild } = require('../permissions');
const { getPrisma } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config_verificacao')
    .setDescription('Configura cargos e canal do sistema de verificação')
    .addRoleOption(o => o.setName('cargo_principal').setDescription('Cargo que pode verificar/encerrar').setRequired(false))
    .addRoleOption(o => o.setName('cargo_verificado').setDescription('Cargo de verificado').setRequired(false))
    .addChannelOption(o => o.setName('canal_painel').setDescription('Canal onde ficará o painel').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addRoleOption(o => o.setName('mencionar_1').setDescription('Cargo a mencionar ao abrir ticket').setRequired(false))
    .addRoleOption(o => o.setName('mencionar_2').setDescription('Cargo a mencionar ao abrir ticket').setRequired(false))
    .addRoleOption(o => o.setName('mencionar_3').setDescription('Cargo a mencionar ao abrir ticket').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    // Usa sistema de permissões existente; se não configurado, fallback a ManageGuild
    const allowed = await checkAccess(interaction, 'config_verificacao');
    if (!allowed && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Sem permissão.', ephemeral: true });
    }
    await ensureGuild(interaction.guild);
    const prisma = getPrisma();

    const mainRole = interaction.options.getRole('cargo_principal');
    const verifiedRole = interaction.options.getRole('cargo_verificado');
    const panelChannel = interaction.options.getChannel('canal_painel');
    const roles = [
      interaction.options.getRole('mencionar_1'),
      interaction.options.getRole('mencionar_2'),
      interaction.options.getRole('mencionar_3'),
    ].filter(Boolean);

    // upsert GuildConfig
    const cfg = await prisma.guildConfig.upsert({
      where: { guildId: interaction.guildId },
      update: {
        mainRoleId: mainRole?.id || undefined,
        verifiedRoleId: verifiedRole?.id || undefined,
        verifyPanelChannelId: panelChannel?.id || undefined,
      },
      create: {
        guildId: interaction.guildId,
        mainRoleId: mainRole?.id || null,
        verifiedRoleId: verifiedRole?.id || null,
        verifyPanelChannelId: panelChannel?.id || null,
      },
      include: { ticketPingRoles: true },
    });

    // Atualiza lista de cargos a mencionar (substitui os passados, mantém os demais)
    if (roles.length) {
      // Remover duplicatas que já existem
      const candidates = [...new Set(roles.map(r => r.id))];
      const toAdd = candidates.filter(id => !cfg.ticketPingRoles.some(pr => pr.roleId === id));
      if (toAdd.length) {
        await prisma.ticketPingRole.createMany({ data: toAdd.map(roleId => ({ guildConfigId: cfg.id, roleId })) });
      }
    }

    const parts = [];
    if (mainRole) parts.push(`Cargo principal: <@&${mainRole.id}>`);
    if (verifiedRole) parts.push(`Cargo verificado: <@&${verifiedRole.id}>`);
    if (panelChannel) parts.push(`Canal painel: <#${panelChannel.id}>`);
    if (roles.length) parts.push(`Mencionar: ${roles.map(r => `<@&${r.id}>`).join(', ')}`);
    await interaction.reply({ content: parts.length ? parts.join('\n') : 'Configuração atualizada (sem alterações explícitas).', ephemeral: true });
  }
};
