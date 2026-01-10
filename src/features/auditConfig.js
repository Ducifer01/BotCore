const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { ensureGlobalConfig } = require('../services/globalConfig');

function buildRootEmbed(cfg) {
  const channelValue = cfg?.auditManualMuteLogChannelId ? `<#${cfg.auditManualMuteLogChannelId}>` : 'não configurado';
  return new EmbedBuilder()
    .setTitle('Configurar Auditoria')
    .setDescription('Selecione uma auditoria para configurar.')
    .addFields({ name: 'Log de mute no dedo', value: `Canal: ${channelValue}` })
    .setColor(0x5865F2);
}

function buildAuditSelect() {
  return new StringSelectMenuBuilder()
    .setCustomId('audit:root:select')
    .setPlaceholder('Escolha uma auditoria...')
    .addOptions([
      { label: 'Log de mute no dedo', value: 'manual-voice-mute', description: 'Monitora mutes realizados no dedo' },
    ]);
}

function buildRootComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(buildAuditSelect()),
  ];
}

async function presentMenu(interaction, ctx) {
  const prisma = ctx.getPrisma();
  const cfg = await ensureGlobalConfig(prisma);
  await interaction.editReply({ embeds: [buildRootEmbed(cfg)], components: buildRootComponents() }).catch(() => {});
  return true;
}

async function handleInteraction(interaction, ctx) {
  const id = interaction.customId;
  if (!id || !id.startsWith('audit:')) return false;
  const { POSSE_USER_ID } = ctx;
  if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
    await interaction.reply({ content: 'Apenas o usuário posse pode acessar esta seção.', ephemeral: true });
    return true;
  }
  const prisma = ctx.getPrisma();

  if (interaction.isStringSelectMenu() && id === 'audit:root:select') {
    await interaction.deferUpdate().catch(() => {});
    const choice = interaction.values?.[0];
    if (choice === 'manual-voice-mute') {
      return showManualVoiceMuteConfig(interaction, prisma);
    }
    // futuras opções
    const cfg = await ensureGlobalConfig(prisma);
    await interaction.editReply({ embeds: [buildRootEmbed(cfg)], components: buildRootComponents() }).catch(() => {});
    return true;
  }

  if (interaction.isButton() && id === 'audit:manual-voice-mute:channel') {
    await interaction.deferUpdate().catch(() => {});
    return showManualVoiceMuteChannelSelector(interaction, prisma);
  }

  if (interaction.isChannelSelectMenu() && id === 'audit:manual-voice-mute:channel:set') {
    await interaction.deferUpdate().catch(() => {});
    const cfg = await ensureGlobalConfig(prisma);
    const value = interaction.values?.[0];
    if (!value) {
      await interaction.followUp({ content: 'Seleção inválida.', ephemeral: true }).catch(() => {});
      return true;
    }
    await prisma.globalConfig.update({ where: { id: cfg.id }, data: { auditManualMuteLogChannelId: value } });
    const updated = await ensureGlobalConfig(prisma);
    await interaction.editReply({ embeds: [buildManualVoiceMuteEmbed(updated)], components: buildManualVoiceMuteComponents() }).catch(() => {});
    await interaction.followUp({ content: `Canal de log definido: <#${value}>`, ephemeral: true }).catch(() => {});
    return true;
  }

  return false;
}

function buildManualVoiceMuteEmbed(cfg) {
  const channelValue = cfg?.auditManualMuteLogChannelId ? `<#${cfg.auditManualMuteLogChannelId}>` : 'não configurado';
  return new EmbedBuilder()
    .setTitle('Auditoria: Mute no dedo (voz)')
    .setDescription('Monitora mutes e desmutes realizados manualmente em canais de voz.')
    .addFields({ name: 'Canal de log', value: channelValue })
    .setColor(0x5865F2);
}

function buildManualVoiceMuteComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('audit:manual-voice-mute:channel').setLabel('Definir canal').setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function showManualVoiceMuteConfig(interaction, prisma) {
  const cfg = await ensureGlobalConfig(prisma);
  await interaction.editReply({ embeds: [buildManualVoiceMuteEmbed(cfg)], components: buildManualVoiceMuteComponents() }).catch(() => {});
  return true;
}

async function showManualVoiceMuteChannelSelector(interaction, prisma) {
  const cfg = await ensureGlobalConfig(prisma);
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('audit:manual-voice-mute:channel:set')
    .setPlaceholder('Selecione um canal de texto para logs')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (cfg?.auditManualMuteLogChannelId && typeof select.setDefaultChannels === 'function') {
    select.setDefaultChannels(cfg.auditManualMuteLogChannelId);
  }
  const embed = new EmbedBuilder()
    .setTitle('Selecionar canal de log (mute no dedo)')
    .setColor(0x5865F2);
  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary))],
  }).catch(() => {});
  return true;
}

module.exports = {
  presentMenu,
  handleInteraction,
};
