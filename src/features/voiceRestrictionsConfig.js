const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getProtectionsConfig, saveProtectionsConfig } = require('../services/protectionsConfig');

const CUSTOM_IDS = {
  TOGGLE: 'vr:toggle',
  CATS: 'vr:cats',
  CHS: 'vr:chs',
  LOG_CMD: 'vr:logcmd',
  LOG_ACT: 'vr:logact',
  SUPPORT: 'vr:support',
  CONFIG_ANTISPAM: 'vr:configantispam',
  MODAL_ANTISPAM: 'vr:modal_antispam',
  BACK: 'menu:back',
};

function buildEmbed(cfg) {
  const vr = cfg.voiceRestrictions || {};
  const antiSpam = vr.antiSpam || {};
  
  const monitoringText = (vr.monitoredCategories?.length > 0 || vr.monitoredChannels?.length > 0)
    ? 'Monitorando selecionados'
    : '**Monitorando TODOS os canais do servidor**';
  
  return new EmbedBuilder()
    .setTitle('⚙️ Restrições de Voz')
    .setDescription('Configure categorias/canais monitorados, logs e anti-spam.')
    .setColor(vr.enabled ? 0x2ecc71 : 0xe67e22)
    .addFields(
      { name: 'Status', value: vr.enabled ? '✅ Ativado' : '❌ Desativado', inline: true },
      { name: 'Restrições ativas', value: String((vr.restrictions || []).filter((r) => !r.removedAt).length), inline: true },
      { name: 'Modo', value: monitoringText, inline: true },
      { name: 'Categorias monitoradas', value: (vr.monitoredCategories || []).length ? vr.monitoredCategories.map((id) => `<#${id}>`).join(', ') : 'Nenhuma (monitora tudo)', inline: false },
      { name: 'Canais monitorados', value: (vr.monitoredChannels || []).length ? vr.monitoredChannels.map((id) => `<#${id}>`).join(', ') : 'Nenhum (monitora tudo)', inline: false },
      { name: 'Log comandos', value: vr.commandLogChannelId ? `<#${vr.commandLogChannelId}>` : '—', inline: true },
      { name: 'Log ações', value: vr.actionLogChannelId ? `<#${vr.actionLogChannelId}>` : '—', inline: true },
      { name: 'Canal de suporte', value: vr.supportChannelId ? `<#${vr.supportChannelId}>` : '—', inline: true },
      { name: '🚫 Anti-Spam & Castigo', value: `**${antiSpam.maxAttempts || 3}** tentativas em **${antiSpam.windowSeconds || 60}s** → Castigo de **${antiSpam.punishmentMinutes || 5}min**`, inline: false },
    );
}

function buildComponents(cfg) {
  const vr = cfg.voiceRestrictions || {};
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CUSTOM_IDS.TOGGLE).setLabel(vr.enabled ? 'Desativar' : 'Ativar').setStyle(vr.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CUSTOM_IDS.CONFIG_ANTISPAM).setLabel('⚙️ Configurar Anti-Spam').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.CATS)
        .setPlaceholder('Categorias monitoradas (vazio = todas)')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes([4])
        .setDefaultChannels(vr.monitoredCategories || []),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.CHS)
        .setPlaceholder('Canais de voz monitorados (vazio = todos)')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes([2, 13])
        .setDefaultChannels(vr.monitoredChannels || []),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.SUPPORT)
        .setPlaceholder('Canal de suporte (mencionado no embed)')
        .setMinValues(0)
        .setMaxValues(1)
        .setChannelTypes([0, 5, 15])
        .setDefaultChannels(vr.supportChannelId ? [vr.supportChannelId] : []),
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
  if (cid === CUSTOM_IDS.CONFIG_ANTISPAM && interaction.isButton()) {
    const cfg = await getProtectionsConfig(prisma);
    const antiSpam = cfg.voiceRestrictions?.antiSpam || {};
    
    const modal = new ModalBuilder()
      .setCustomId(CUSTOM_IDS.MODAL_ANTISPAM)
      .setTitle('Configurar Anti-Spam');
    
    const tentativasInput = new TextInputBuilder()
      .setCustomId('tentativas')
      .setLabel('Máx. tentativas antes do castigo')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 3')
      .setValue(String(antiSpam.maxAttempts || 3))
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    
    const janelaInput = new TextInputBuilder()
      .setCustomId('janela')
      .setLabel('Janela de tempo (segundos)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 60')
      .setValue(String(antiSpam.windowSeconds || 60))
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(3);
    
    const castigoInput = new TextInputBuilder()
      .setCustomId('castigo')
      .setLabel('Tempo de castigo (minutos)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 5')
      .setValue(String(antiSpam.punishmentMinutes || 5))
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(tentativasInput),
      new ActionRowBuilder().addComponents(janelaInput),
      new ActionRowBuilder().addComponents(castigoInput)
    );
    
    await interaction.showModal(modal);
    return true;
  }
  if (cid === CUSTOM_IDS.MODAL_ANTISPAM && interaction.isModalSubmit()) {
    await interaction.deferUpdate().catch(() => {});
    const tentativas = parseInt(interaction.fields.getTextInputValue('tentativas'), 10) || 3;
    const janela = parseInt(interaction.fields.getTextInputValue('janela'), 10) || 60;
    const castigo = parseInt(interaction.fields.getTextInputValue('castigo'), 10) || 5;
    
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = cfg.voiceRestrictions || {};
    cfg.voiceRestrictions.antiSpam = {
      maxAttempts: Math.max(1, Math.min(10, tentativas)),
      windowSeconds: Math.max(10, Math.min(300, janela)),
      punishmentMinutes: Math.max(1, Math.min(60, castigo)),
    };
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
  if (cid === CUSTOM_IDS.SUPPORT && interaction.isChannelSelectMenu()) {
    await interaction.deferUpdate().catch(() => {});
    const id = interaction.values?.[0] || null;
    const cfg = await getProtectionsConfig(prisma);
    cfg.voiceRestrictions = { ...(cfg.voiceRestrictions || {}), supportChannelId: id };
    await saveProtectionsConfig(prisma, cfg);
    await refresh();
    return true;
  }
  return false;
}

module.exports = { presentMenu, handleInteraction };
