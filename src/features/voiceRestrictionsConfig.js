const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder } = require('discord.js');
const { getProtectionsConfig, saveProtectionsConfig } = require('../services/protectionsConfig');

const CUSTOM_IDS = {
  TOGGLE: 'vr:toggle',
  CATS: 'vr:cats',
  CHS: 'vr:chs',
  LOG_CMD: 'vr:logcmd',
  LOG_ACT: 'vr:logact',
  BACK: 'menu:back',
};

function buildEmbed(cfg) {
  const vr = cfg.voiceRestrictions || {};
  return new EmbedBuilder()
    .setTitle('Restrições de Voz')
    .setDescription('Configure categorias/canais monitorados e logs.')
    .setColor(vr.enabled ? 0x2ecc71 : 0xe67e22)
    .addFields(
      { name: 'Status', value: vr.enabled ? 'Ativado' : 'Desativado', inline: true },
      { name: 'Categorias monitoradas', value: (vr.monitoredCategories || []).length ? vr.monitoredCategories.map((id) => `<#${id}>`).join('\n') : 'Nenhuma', inline: false },
      { name: 'Canais monitorados', value: (vr.monitoredChannels || []).length ? vr.monitoredChannels.map((id) => `<#${id}>`).join('\n') : 'Nenhum', inline: false },
      { name: 'Log comandos', value: vr.commandLogChannelId ? `<#${vr.commandLogChannelId}>` : '—', inline: true },
      { name: 'Log ações', value: vr.actionLogChannelId ? `<#${vr.actionLogChannelId}>` : '—', inline: true },
      { name: 'Restrições ativas', value: String((vr.restrictions || []).filter((r) => !r.removedAt).length), inline: true },
    );
}

function buildComponents(cfg) {
  const vr = cfg.voiceRestrictions || {};
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CUSTOM_IDS.TOGGLE).setLabel(vr.enabled ? 'Desativar' : 'Ativar').setStyle(vr.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.CATS)
        .setPlaceholder('Categorias monitoradas')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes([4])
        .setDefaultChannels(vr.monitoredCategories || []),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.CHS)
        .setPlaceholder('Canais de voz monitorados')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes([2, 13])
        .setDefaultChannels(vr.monitoredChannels || []),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.LOG_CMD)
        .setPlaceholder('Canal de log de comandos')
        .setMinValues(0)
        .setMaxValues(1)
        .setChannelTypes([0, 5, 15])
        .setDefaultChannels(vr.commandLogChannelId ? [vr.commandLogChannelId] : []),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.LOG_ACT)
        .setPlaceholder('Canal de log de ações')
        .setMinValues(0)
        .setMaxValues(1)
        .setChannelTypes([0, 5, 15])
        .setDefaultChannels(vr.actionLogChannelId ? [vr.actionLogChannelId] : []),
    ),
  ];
}

async function presentMenu(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const prisma = ctx.getPrisma();
  const cfg = await getProtectionsConfig(prisma);
  const embed = buildEmbed(cfg);
  const components = buildComponents(cfg);
  await interaction.editReply({ embeds: [embed], components }).catch(() => {});
  return true;
}

async function handleInteraction(interaction, ctx) {
  const cid = interaction.customId || '';
  if (!cid.startsWith('vr:') && cid !== 'menu:back') return false;
  const prisma = ctx.getPrisma();

  const refresh = async () => {
    const cfg = await getProtectionsConfig(prisma);
    const embed = buildEmbed(cfg);
    const components = buildComponents(cfg);
    await interaction.editReply({ embeds: [embed], components }).catch(() => {});
  };
  if (cid === CUSTOM_IDS.TOGGLE) {
    await interaction.deferUpdate().catch(() => {});
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = cfg.voiceRestrictions || {};
    cfg.voiceRestrictions.enabled = !cfg.voiceRestrictions.enabled;
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  if (cid === CUSTOM_IDS.CATS && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    const ids = interaction.values || [];
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = { ...(cfg.voiceRestrictions || {}), monitoredCategories: ids };
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  if (cid === CUSTOM_IDS.CHS && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    const ids = interaction.values || [];
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = { ...(cfg.voiceRestrictions || {}), monitoredChannels: ids };
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  if (cid === CUSTOM_IDS.LOG_CMD && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    const id = interaction.values?.[0] || null;
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = { ...(cfg.voiceRestrictions || {}), commandLogChannelId: id };
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  if (cid === CUSTOM_IDS.LOG_ACT && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    const id = interaction.values?.[0] || null;
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = { ...(cfg.voiceRestrictions || {}), actionLogChannelId: id };
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  return false;
}

module.exports = { presentMenu, handleInteraction };
