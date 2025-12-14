const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { getGlobalConfig } = require('../services/globalConfig');
const { requireInstaConfig } = require('../services/instaGuard');
const { applyVerifiedRole, extractUserIdFromThreadName, cacheThreadTargetUser } = require('../features/verify');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verificar')
    .setDescription('Concluir a verificação de um usuário dentro do tópico do verifique-se')
    .addUserOption((opt) => opt
      .setName('usuario')
      .setDescription('Usuário a ser verificado')
      .setRequired(true))
    .addStringOption((opt) => opt
      .setName('sexo')
      .setDescription('Sexo informado no momento da verificação')
      .addChoices(
        { name: 'Masculino', value: 'male' },
        { name: 'Feminino', value: 'female' },
      )
      .setRequired(true))
    .addAttachmentOption((opt) => opt
      .setName('imagem')
      .setDescription('Foto enviada pelo usuário (obrigatória)')
      .setRequired(true)),
  async execute(interaction) {
    const prisma = getPrisma();
    const cfg = await getGlobalConfig(prisma);
    const instaCheck = requireInstaConfig(cfg);
    if (!instaCheck.ok) {
      await interaction.reply({ content: instaCheck.message, ephemeral: true });
      return;
    }
    if (!interaction.member.roles.cache.has(cfg.mainRoleId)) {
      await interaction.reply({ content: 'Apenas o cargo InstaMod pode usar este comando.', ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel?.isThread?.() || channel.parentId !== cfg.verifyPanelChannelId) {
      await interaction.reply({ content: 'Use este comando dentro do tópico privado criado pelo painel verifique-se.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('usuario', true);
    const sex = interaction.options.getString('sexo', true);
    const attachment = interaction.options.getAttachment('imagem', true);
    const threadUserId = extractUserIdFromThreadName(channel.name);
    if (threadUserId && threadUserId !== targetUser.id) {
      await interaction.reply({ content: `Este tópico pertence a <@${threadUserId}>. Escolha o usuário correspondente ou use o comando no tópico correto.`, ephemeral: true });
      return;
    }

    const existingRecord = await prisma.verifiedUserGlobal.findUnique({ where: { userId: targetUser.id } });
    if (existingRecord) {
      await interaction.reply({ content: 'Esse usuário já está verificado. Use !remover_verificado para remover antes de cadastrar novamente.', ephemeral: true });
      return;
    }

    if (attachment.size > 1024 * 1024 * 20) {
      await interaction.reply({ content: 'A imagem precisa ter até 20MB.', ephemeral: true });
      return;
    }

    if (attachment.contentType && !attachment.contentType.startsWith('image/')) {
      await interaction.reply({ content: 'Envie uma imagem válida.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: false });

    cacheThreadTargetUser(channel.id, targetUser.id);

    let buffer;
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error('http_error');
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('[verify:/verificar] Falha ao baixar imagem:', error?.message || error);
      await interaction.editReply({ content: 'Não consegui baixar a imagem. Tente novamente.' });
      return;
    }
    const imageName = attachment.name || `verificacao-${Date.now()}.png`;

    const targetChannelId = sex === 'male'
      ? (cfg.photosMaleChannelId || cfg.photosChannelId)
      : (cfg.photosFemaleChannelId || cfg.photosChannelId);
    const photosChannel = targetChannelId
      ? await interaction.client.channels.fetch(targetChannelId).catch(() => null)
      : null;
    if (!photosChannel || !photosChannel.isTextBased()) {
      await interaction.editReply({ content: 'Canal de fotos não configurado ou inacessível.' });
      return;
    }

    const file = new AttachmentBuilder(buffer, { name: imageName });
    const content = [
      `Usuario: <@${targetUser.id}> | ${targetUser.id}`,
      `Verificado por: <@${interaction.user.id}> | ${interaction.user.id}`,
      `Sexo: ${sex === 'male' ? 'Masculino' : 'Feminino'}`,
    ].join('\n');
    const sent = await photosChannel.send({ content, files: [file] });
    const attachmentUrl = sent.attachments?.first()?.url || null;

    await prisma.verifiedUserGlobal.upsert({
      where: { userId: targetUser.id },
      update: {
        verifiedBy: interaction.user.id,
        sex,
        photoUrl: attachmentUrl,
        photoMessageId: sent.id,
        photoChannelId: photosChannel.id,
        verifiedAt: new Date(),
      },
      create: {
        userId: targetUser.id,
        verifiedBy: interaction.user.id,
        sex,
        photoUrl: attachmentUrl,
        photoMessageId: sent.id,
        photoChannelId: photosChannel.id,
        verifiedAt: new Date(),
      },
    });

    let roleResult = null;
    try {
      roleResult = await applyVerifiedRole(
        interaction.guild,
        cfg.verifiedRoleId,
        targetUser.id,
        `Verificação aprovada por ${interaction.user.tag || interaction.user.id}`,
      );
    } catch (error) {
      console.error('[verify:/verificar] Falha ao aplicar cargo:', error?.message || error);
      roleResult = { ok: false, error: 'exception' };
    }

    const responseLines = [
      `✅ Verificação concluída para <@${targetUser.id}>.`,
    ];
    if (roleResult?.ok) {
      responseLines.push(roleResult.already
        ? 'O usuário já possuía o cargo de verificado.'
        : `Cargo <@&${cfg.verifiedRoleId}> aplicado com sucesso.`);
    } else {
      responseLines.push('Não consegui aplicar o cargo automaticamente. Verifique minhas permissões.');
    }

    await interaction.editReply({ content: responseLines.join('\n') });
  },
};
