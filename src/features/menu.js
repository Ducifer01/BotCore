const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

function buildBaseMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('Menu de Configuração')
    .setDescription('Selecione uma seção para configurar.')
    .setColor(0x5865F2);
}

function buildRootSelect() {
  return new StringSelectMenuBuilder()
    .setCustomId('menu:root')
    .setPlaceholder('Escolha uma seção...')
    .addOptions([
      { label: 'Configurar Insta', value: 'insta', description: 'Canais e opções do Instagram' },
      { label: 'Configurar Mute', value: 'mute', description: 'Cargo mutado, canal de desbloqueio e bot responsável' },
      { label: 'Configurar Suporte', value: 'support', description: 'Painel, cargos e logs do suporte' },
      { label: 'Configurar AutoMod', value: 'automod', description: 'Palavras bloqueadas e punições' },
      { label: 'Configurar Moderação', value: 'moderation', description: 'Banimentos, castigos e permissões' },
      { label: 'Configurar Convites', value: 'invites', description: 'Ranking e monitoramento de convites' },
      { label: 'Configurar Limpeza', value: 'cleaner', description: 'Painéis para limpar mensagens automaticamente' },
      { label: 'Configurar Permissões', value: 'permissions', description: 'Defina quais cargos acessam cada comando' },
      { label: 'Configurar Auditoria', value: 'audit', description: 'Configure logs de auditoria' },
      { label: 'Configurar Pontos', value: 'points', description: 'Sistema de pontos (chat/call/convites)' },
      { label: 'Configurar Proteções e Snapshots', value: 'protections', description: 'Proteções de canais (snapshots)' },
    ]);
}

function createMenuHandler({ insta, mute, support, automod, moderation, invites, cleaner, permissions, audit, points, protections }) {
  async function handleInteraction(interaction, ctx) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'menu:root') {
      return handleRootSelection(interaction, ctx);
    }
    if (interaction.isButton() && interaction.customId === 'menu:back') {
      return handleBack(interaction);
    }
    if (typeof protections?.handleInteraction === 'function') {
      const handled = await protections.handleInteraction(interaction, ctx);
      if (handled) return true;
    }
    return false;
  }

  async function handleRootSelection(interaction, ctx) {
    const { POSSE_USER_ID } = ctx;
    if (!POSSE_USER_ID || POSSE_USER_ID !== interaction.user.id) {
      await interaction.reply({ content: 'Apenas o usuário posse pode usar este comando.', ephemeral: true });
      return true;
    }
    const choice = interaction.values?.[0];
    if (choice === 'insta') {
      return insta.presentMenu(interaction, ctx);
    }
    if (choice === 'mute') {
      return mute.presentMenu(interaction, ctx);
    }
    if (choice === 'support') {
      return support.presentMenu(interaction, ctx);
    }
    if (choice === 'automod') {
      return automod.presentMenu(interaction, ctx);
    }
    if (choice === 'moderation') {
      return moderation.presentMenu(interaction, ctx);
    }
    if (choice === 'invites') {
      return invites.presentMenu(interaction, ctx);
    }
    if (choice === 'cleaner') {
      return cleaner.presentMenu(interaction, ctx);
    }
    if (choice === 'permissions') {
      return permissions.presentMenu(interaction, ctx);
    }
    if (choice === 'audit') {
      return audit.presentMenu(interaction, ctx);
    }
    if (choice === 'points') {
      return points.presentMenu(interaction, ctx);
    }
    if (choice === 'protections') {
      return protections.presentMenu(interaction, ctx);
    }
    return false;
  }

  async function handleBack(interaction) {
    const embed = buildBaseMenuEmbed();
    const row = new ActionRowBuilder().addComponents(buildRootSelect());
    await interaction.update({ embeds: [embed], components: [row] });
    return true;
  }

  return { handleInteraction };
}

module.exports = {
  createMenuHandler,
  buildBaseMenuEmbed,
  buildRootSelect,
};
