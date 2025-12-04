require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('./db');
const { ensureGuild } = require('./permissions');

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] });
client.commands = new Collection();

// Cache simples para selections do /mover_alguns: Map<messageId:userId, Set<userIds>>
const selectionCache = new Map();
// Tarefas de cargo em massa serão executadas direto no botão de confirmação; cache opcional se evoluirmos para etapas.
// Awaiting role edits: Map<userId, { roleId: string, type: 'name'|'emoji', channelId: string }>
const awaitingRoleEdit = new Map();

// Verificação: estado temporário
// Map<threadId, { targetUserId: string }>
const verifyThreads = new Map();
// Map<threadId:userId, { buffer: Buffer, name: string }>
const pendingVerifyImage = new Map();

// Cache de webhooks por canal para insta
// Map<channelId, { id, token }>
const webhookCache = new Map();

async function getGuildConfig(prisma, guildId) {
  const cfg = await prisma.guildConfig.findUnique({ where: { guildId }, include: { ticketPingRoles: true } });
  return cfg || null;
}

async function getOrCreateWebhook(channel) {
  if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.owner?.id === channel.client.user.id && h.name === 'Insta Relay');
  if (!hook) {
    hook = await channel.createWebhook({ name: 'Insta Relay' });
  }
  const data = { id: hook.id, token: hook.token };
  webhookCache.set(channel.id, data);
  return data;
}

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  }
}

async function syncSlashCommands() {
  try {
    const commandData = [...client.commands.values()].map(c => c.data.toJSON());
    const devGuildId = process.env.DEV_GUILD_ID;
    const allowGlobalFallback = String(process.env.SYNC_GLOBAL_FALLBACK || '').toLowerCase() === 'true';
    const clearGlobalOnStart = String(process.env.CLEAR_GLOBAL_COMMANDS || '').toLowerCase() === 'true';

    if (devGuildId) {
      const guild = client.guilds.cache.get(devGuildId) || await client.guilds.fetch(devGuildId).catch(() => null);
      if (guild) {
        if (clearGlobalOnStart) {
          try {
            await client.application.commands.set([]);
            console.log('[sync] Comandos globais limpos por CLEAR_GLOBAL_COMMANDS=true.');
          } catch (e) {
            console.warn('[sync] Falha ao limpar comandos globais:', e?.message || e);
          }
        }
        await guild.commands.set(commandData);
        console.log(`[sync] Comandos sincronizados na guild ${guild.name} (${guild.id}).`);
        return;
      } else {
        if (allowGlobalFallback) {
          console.warn(`[sync] DEV_GUILD_ID=${devGuildId} não encontrado. Fallback global habilitado.`);
        } else {
          console.warn(`[sync] DEV_GUILD_ID=${devGuildId} não encontrado e fallback global desabilitado. Nenhuma sincronização feita.`);
          return;
        }
      }
    }

    if (allowGlobalFallback) {
      // Fallback global: pode levar até 1h para propagar
      await client.application.commands.set(commandData);
      console.log('[sync] Comandos sincronizados globalmente (pode demorar para aparecer).');
    }
  } catch (err) {
    console.error('[sync] Falha ao sincronizar comandos:', err);
  }
}

client.once('ready', async () => {
  console.log(`Logado como ${client.user.tag}`);
  await syncSlashCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await ensureGuild(interaction.guild);
      await command.execute(interaction);
    } else if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      if (customId.startsWith('move-some:')) {
        const key = `${interaction.message.id}:${interaction.user.id}`;
        const selected = new Set(interaction.values);
        selectionCache.set(key, selected);
        await interaction.reply({ content: `Selecionados: ${[...selected].map(id => `<@${id}>`).join(', ') || 'nenhum'}`, ephemeral: true });
      }
    } else if (interaction.isButton()) {
      const customId = interaction.customId;
      const prisma = getPrisma();
      if (customId.startsWith('sync:')) {
        const categoryId = customId.split(':')[1];
        const categoria = interaction.guild.channels.cache.get(categoryId);
        if (!categoria) return interaction.reply({ content: 'Categoria não encontrada.', ephemeral: true });

        const catOverwrites = categoria.permissionOverwrites.cache.map(ow => ({ id: ow.id, type: ow.type, allow: ow.allow.bitfield, deny: ow.deny.bitfield }));
        const canais = interaction.guild.channels.cache.filter(c => c.parentId === categoria.id);
        let synced = 0;
        for (const c of canais.values()) {
          const chanOverwrites = c.permissionOverwrites.cache.map(ow => ({ id: ow.id, type: ow.type, allow: ow.allow.bitfield, deny: ow.deny.bitfield }));
          const sameLength = chanOverwrites.length === catOverwrites.length;
          const sameSets = sameLength && chanOverwrites.every(co => catOverwrites.some(ao => ao.id === co.id && ao.type === co.type && ao.allow === co.allow && ao.deny === co.deny));
          if (!sameSets) {
            await c.permissionOverwrites.set(catOverwrites);
            synced++;
          }
        }
        await interaction.reply({ content: `Sincronização concluída. ${synced} canais atualizados.`, ephemeral: true });
  } else if (customId.startsWith('move-some-go:')) {
        // customId = move-some-go:dest=DEST:src=SRC
        const parts = customId.split(':').slice(1); // [ 'dest=...', 'src=...' ]
        const params = {};
        for (const part of parts) {
          const eq = part.indexOf('=');
          if (eq > -1) params[part.slice(0, eq)] = part.slice(eq + 1);
        }
        const destId = params.dest;
        const srcId = params.src;
        let dest = interaction.guild.channels.cache.get(destId) || await interaction.guild.channels.fetch(destId).catch(() => null);
        let src = interaction.guild.channels.cache.get(srcId) || await interaction.guild.channels.fetch(srcId).catch(() => null);
        if (!dest || !src) return interaction.reply({ content: 'Canais não encontrados.', ephemeral: true });
        const key = `${interaction.message.id}:${interaction.user.id}`;
        const selected = selectionCache.get(key);
        if (!selected || selected.size === 0) return interaction.reply({ content: 'Nenhum usuário selecionado.', ephemeral: true });
        let moved = 0, failed = 0;
        for (const uid of selected) {
          const member = src.members?.get(uid) || interaction.guild.members.cache.get(uid) || await interaction.guild.members.fetch(uid).catch(() => null);
          if (!member) { failed++; continue; }
          try {
            await member.voice.setChannel(dest);
            moved++;
          } catch (e) {
            failed++;
          }
        }
        selectionCache.delete(key);
        await interaction.reply({ content: `Movidos ${moved}. Falharam ${failed}.`, ephemeral: true });
      } else if (customId.startsWith('move-some-cancel:')) {
        const key = `${interaction.message.id}:${interaction.user.id}`;
        selectionCache.delete(key);
        await interaction.reply({ content: 'Operação cancelada.', ephemeral: true });
      } else if (customId.startsWith('role-edit:')) {
        // role-edit:name:ROLEID or role-edit:emoji:ROLEID or role-edit:back:ROLEID
        const parts = customId.split(':');
        const action = parts[1];
        const roleId = parts[2];
        if (!roleId) return interaction.reply({ content: 'Requisição inválida.', ephemeral: true });
        const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });

        if (action === 'back') {
          const embed = new EmbedBuilder().setTitle(`Editar cargo: ${role.name}`).setDescription('Escolha o que deseja editar.');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`role-edit:name:${role.id}`).setLabel('Editar nome').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`role-edit:emoji:${role.id}`).setLabel('Editar emoji').setStyle(ButtonStyle.Secondary)
          );
          return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (action === 'name') {
          awaitingRoleEdit.set(interaction.user.id, { roleId, type: 'name', channelId: interaction.channelId });
          const embed = new EmbedBuilder().setTitle('Editar nome do cargo').setDescription('Digite o novo nome neste canal.');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`role-edit:back:${role.id}`).setLabel('Voltar').setStyle(ButtonStyle.Danger)
          );
          return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
        if (action === 'emoji') {
          awaitingRoleEdit.set(interaction.user.id, { roleId, type: 'emoji', channelId: interaction.channelId });
          const embed = new EmbedBuilder().setTitle('Editar emoji do cargo').setDescription('Envie um emoji de servidor (custom) neste canal.');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`role-edit:back:${role.id}`).setLabel('Voltar').setStyle(ButtonStyle.Danger)
          );
          return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
      } else if (customId.startsWith('bulkrole_confirm:')) {
        // bulkrole_confirm:ACTION:add|remove:ROLEID:excludeIds(|-separado ou 'none')
        const parts = customId.split(':');
        const action = parts[1];
        const roleId = parts[2];
        const excludeStr = parts[3] || 'none';
        const excludeIds = (excludeStr && excludeStr !== 'none') ? excludeStr.split('|') : [];
        // Apenas o autor que iniciou pode confirmar (mensagem ephemeral tem interaction info)
        const original = interaction.message?.interaction;
        if (original && original.user?.id !== interaction.user.id) {
          return interaction.reply({ content: 'Apenas quem iniciou pode confirmar.', ephemeral: true });
        }
        await interaction.update({ components: [] }).catch(() => {});
        const guild = interaction.guild;
        if (!guild) return interaction.followUp({ content: 'Guild não encontrada.', ephemeral: true });
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!role) return interaction.followUp({ content: 'Cargo não encontrado.', ephemeral: true });
        // Buscar todos os membros
        const members = await guild.members.fetch();
        let processed = 0, changed = 0, skipped = 0, failed = 0;
        for (const [, member] of members) {
          processed++;
          try {
            const hasExcluded = excludeIds.some(rid => member.roles.cache.has(rid));
            if (hasExcluded) { skipped++; continue; }
            if (action === 'add') {
              if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId);
                changed++;
              } else { skipped++; }
            } else if (action === 'remove') {
              if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
                changed++;
              } else { skipped++; }
            }
          } catch (e) {
            failed++;
          }
        }
        return interaction.followUp({ content: `Concluído: ${action === 'add' ? 'adicionados' : 'removidos'}: ${changed} | pulados: ${skipped} | falhas: ${failed} | total: ${processed}`, ephemeral: true });
      } else if (customId === 'bulkrole_cancel') {
        await interaction.update({ components: [] }).catch(() => {});
        return interaction.followUp({ content: 'Operação cancelada.', ephemeral: true });
      } else if (customId === 'verify:open') {
        // Abrir tópico privado
        const cfg = await getGuildConfig(prisma, interaction.guildId);
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.reply({ content: 'Este botão deve ser usado em um canal de texto.', ephemeral: true });
        }
        const thread = await channel.threads.create({
          name: `${interaction.user.username}`.slice(0, 90),
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          invitable: false,
        });
        // adiciona autor ao tópico
        await thread.members.add(interaction.user.id).catch(() => {});
        verifyThreads.set(thread.id, { targetUserId: interaction.user.id });
        const mentionRoles = cfg?.ticketPingRoles?.map(r => `<@&${r.roleId}>`) || [];
        const mainRoleMention = cfg?.mainRoleId ? `<@&${cfg.mainRoleId}>` : null;
        const ping = [mainRoleMention, ...mentionRoles, `<@${interaction.user.id}>`].filter(Boolean).join(' ');
        const embed = new EmbedBuilder()
          .setTitle('Verificação')
          .setDescription('Aguarde um responsável pela verificação. Use os botões abaixo quando estiver atendendo.')
          .setColor(0x2ECC71);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`verify:start:${thread.id}:${interaction.user.id}`).setLabel('Verificar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`verify:close:${thread.id}`).setLabel('Encerrar').setStyle(ButtonStyle.Danger)
        );
        await thread.send({ content: ping || undefined, embeds: [embed], components: [row], allowedMentions: { users: [interaction.user.id], roles: cfg?.ticketPingRoles?.map(r => r.roleId) || (cfg?.mainRoleId ? [cfg.mainRoleId] : []), repliedUser: false } });
        await interaction.reply({ content: `Seu tópico foi aberto: <#${thread.id}>`, ephemeral: true });
  } else if (customId.startsWith('verify:start:')) {
        // Apenas quem possui cargo principal pode operar
        const cfg = await getGuildConfig(prisma, interaction.guildId);
        if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
          return interaction.reply({ content: 'Apenas o cargo principal pode usar este botão.', ephemeral: true });
        }
        const parts = customId.split(':');
        const threadId = parts[2];
        const targetUserId = parts[3];
        if (interaction.channelId !== threadId) {
          // garantir que execute dentro do tópico
          try {
            const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
            if (thread) await thread.send({ content: `<@${interaction.user.id}> iniciou verificação.` });
          } catch {}
        }
        await interaction.reply({ content: 'Envie uma imagem nesta conversa (tópico). Assim que você enviar, vou mostrar uma prévia e pedir confirmação.', ephemeral: true });
        const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
        if (!thread) return;
        const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = thread.createMessageCollector({ filter, time: 5 * 60 * 1000, max: 1 });
        collector.on('collect', async (m) => {
          try {
            const att = m.attachments.first();
            const res = await fetch(att.url);
            const arr = await res.arrayBuffer();
            const buf = Buffer.from(arr);
            pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: att.name || 'imagem.png' });
            await m.delete().catch(() => {});
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`verify:confirm:${threadId}:${targetUserId}`).setLabel('Perfeito').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`verify:update:${threadId}`).setLabel('Atualizar').setStyle(ButtonStyle.Primary)
            );
            await interaction.followUp({ content: 'Confira a imagem e confirme:', files: [{ attachment: buf, name: att.name || 'imagem.png' }], components: [row], ephemeral: true });
          } catch (e) {
            await interaction.followUp({ content: 'Falha ao processar a imagem, tente novamente.', ephemeral: true });
          }
        });
      } else if (customId.startsWith('verify:confirm:')) {
        const cfg = await getGuildConfig(prisma, interaction.guildId);
        if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
          return interaction.reply({ content: 'Apenas o cargo principal pode confirmar.', ephemeral: true });
        }
        const parts = customId.split(':');
        const threadId = parts[2];
        const targetUserId = parts[3];
        const key = `${threadId}:${interaction.user.id}`;
        const img = pendingVerifyImage.get(key);
        if (!img) return interaction.reply({ content: 'Nenhuma imagem em espera. Clique em Verificar e envie uma imagem.', ephemeral: true });

        // Dar cargo verificado e registrar no BD
        if (cfg.verifiedRoleId) {
          const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
          if (member && !member.roles.cache.has(cfg.verifiedRoleId)) {
            await member.roles.add(cfg.verifiedRoleId).catch(() => {});
          }
        }
        await prisma.verifiedUser.upsert({
          where: { guildId_userId: { guildId: interaction.guildId, userId: targetUserId } },
          update: { verifiedBy: interaction.user.id },
          create: { guildId: interaction.guildId, userId: targetUserId, verifiedBy: interaction.user.id },
        });

        // Envia resumo no tópico
        try {
          const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
          if (thread) {
            const lines = [
              `<@${targetUserId}> | ${targetUserId}`,
              `<@${interaction.user.id}> | ${interaction.user.id}`,
            ];
            const file = new AttachmentBuilder(img.buffer, { name: img.name });
            await thread.send({ content: lines.join('\n'), files: [file] });
          }
        } catch {}
        pendingVerifyImage.delete(key);
        return interaction.reply({ content: 'Verificação concluída.', ephemeral: true });
  } else if (customId.startsWith('verify:update:')) {
        const cfg = await getGuildConfig(prisma, interaction.guildId);
        if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
          return interaction.reply({ content: 'Apenas o cargo principal pode atualizar.', ephemeral: true });
        }
        const parts = customId.split(':');
        const threadId = parts[2];
        // Limpa imagem pendente e pede outra
        pendingVerifyImage.delete(`${threadId}:${interaction.user.id}`);
        await interaction.reply({ content: 'Envie outra imagem nesta conversa. Vou substituir a prévia.', ephemeral: true });
        const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
        if (!thread) return;
        const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = thread.createMessageCollector({ filter, time: 5 * 60 * 1000, max: 1 });
        collector.on('collect', async (m) => {
          try {
            const att = m.attachments.first();
            const res = await fetch(att.url);
            const arr = await res.arrayBuffer();
            const buf = Buffer.from(arr);
            pendingVerifyImage.set(`${threadId}:${interaction.user.id}`, { buffer: buf, name: att.name || 'imagem.png' });
            await m.delete().catch(() => {});
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`verify:confirm:${threadId}:${verifyThreads.get(threadId)?.targetUserId || 'unknown'}`).setLabel('Perfeito').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`verify:update:${threadId}`).setLabel('Atualizar').setStyle(ButtonStyle.Primary)
            );
            await interaction.followUp({ content: 'Imagem atualizada. Confira e confirme:', files: [{ attachment: buf, name: att.name || 'imagem.png' }], components: [row], ephemeral: true });
          } catch (e) {
            await interaction.followUp({ content: 'Falha ao processar a imagem, tente novamente.', ephemeral: true });
          }
        });
      } else if (customId.startsWith('verify:close:')) {
        const cfg = await getGuildConfig(prisma, interaction.guildId);
        if (!cfg?.mainRoleId || !interaction.member.roles.cache.has(cfg.mainRoleId)) {
          return interaction.reply({ content: 'Apenas o cargo principal pode encerrar.', ephemeral: true });
        }
        const threadId = customId.split(':')[2];
        const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
        if (!thread) return interaction.reply({ content: 'Tópico não encontrado.', ephemeral: true });
        try {
          await thread.setArchived(true, 'Encerrado pelo verificador');
          await thread.setLocked(true).catch(() => {});
          await interaction.reply({ content: 'Tópico encerrado.', ephemeral: true });
        } catch (e) {
          await interaction.reply({ content: 'Falha ao encerrar tópico.', ephemeral: true });
        }
      } else if (customId.startsWith('insta:')) {
        // Botões do sistema insta
        const parts = customId.split(':');
        const action = parts[1];
        const postId = parts[2];
        const prisma = getPrisma();
        const post = await prisma.instaPost.findUnique({ where: { id: postId } });
        if (!post) return interaction.reply({ content: 'Post não encontrado.', ephemeral: true });

        if (action === 'like') {
          // toggle
          const existing = await prisma.instaLike.findUnique({ where: { postId_userId: { postId, userId: interaction.user.id } } }).catch(() => null);
          if (existing) {
            await prisma.instaLike.delete({ where: { postId_userId: { postId, userId: interaction.user.id } } });
          } else {
            await prisma.instaLike.create({ data: { postId, userId: interaction.user.id } });
          }
          const count = await prisma.instaLike.count({ where: { postId } });
          await prisma.instaPost.update({ where: { id: postId }, data: { likeCount: count } });
          // Atualiza rótulo do botão
          try {
            const row = ActionRowBuilder.from(interaction.message.components[0]);
            const btns = row.components.map(c => ButtonBuilder.from(c));
            // botão 0 = like
            btns[0].setLabel(`❤️ (${count})`);
            const newRow = new ActionRowBuilder().addComponents(btns);
            await interaction.update({ components: [newRow] });
          } catch {
            await interaction.reply({ content: 'Curtida atualizada.', ephemeral: true });
          }
        } else if (action === 'comment') {
          await interaction.reply({ content: 'Envie sua mensagem como comentário (60s).', ephemeral: true });
          const filter = (m) => m.author.id === interaction.user.id && m.channelId === interaction.channelId;
          const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
          collector.on('collect', async (m) => {
            const content = (m.content || '').trim();
            if (content) {
              await prisma.instaComment.create({ data: { postId, userId: m.author.id, content } });
              const count = await prisma.instaComment.count({ where: { postId } });
              await prisma.instaPost.update({ where: { id: postId }, data: { commentCount: count } });
              // atualiza botão 1 (comentário)
              try {
                const row = ActionRowBuilder.from(interaction.message.components[0]);
                const btns = row.components.map(c => ButtonBuilder.from(c));
                btns[1].setLabel(`💬 (${count})`);
                const newRow = new ActionRowBuilder().addComponents(btns);
                await interaction.followUp({ content: 'Comentário adicionado.', ephemeral: true });
                await interaction.message.edit({ components: [newRow] }).catch(() => {});
              } catch {}
            }
            await m.delete().catch(() => {});
          });
        } else if (action === 'listlikes') {
          const page = parseInt(parts[3] || '1', 10);
          const take = 10;
          const skip = (page - 1) * take;
          const total = await prisma.instaLike.count({ where: { postId } });
          const likes = await prisma.instaLike.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, skip, take });
          const totalPages = Math.max(1, Math.ceil(total / take));
          const embed = new EmbedBuilder().setTitle(`Likes do post de <@${post.authorId}>`).setColor(0xFFFFFF)
            .setDescription(likes.map(l => `<@${l.userId}>`).join('\n') || 'Sem curtidas ainda.')
            .setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} likes` });
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`insta:listlikes:${postId}:${Math.max(1, page - 1)}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
            new ButtonBuilder().setCustomId(`insta:listlikes:${postId}:${Math.min(totalPages, page + 1)}`).setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
          );
          const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
          await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
        } else if (action === 'listcomments') {
          const page = parseInt(parts[3] || '1', 10);
          const take = 5;
          const skip = (page - 1) * take;
          const total = await prisma.instaComment.count({ where: { postId } });
          const comments = await prisma.instaComment.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, skip, take });
          const totalPages = Math.max(1, Math.ceil(total / take));
          const desc = comments.map(c => `<@${c.userId}>: ${c.content}`).join('\n') || 'Sem comentários ainda.';
          const embed = new EmbedBuilder().setTitle(`Comentários do post de <@${post.authorId}>`).setColor(0xFFFFFF)
            .setDescription(desc).setFooter({ text: `Página ${page}/${totalPages} - Total: ${total} comentários` });
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`insta:listcomments:${postId}:${Math.max(1, page - 1)}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
            new ButtonBuilder().setCustomId(`insta:listcomments:${postId}:${Math.min(totalPages, page + 1)}`).setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
          );
          const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
          await interaction[method]({ embeds: [embed], components: [row], ephemeral: true });
        } else if (action === 'delete') {
          if (interaction.user.id !== post.authorId) {
            return interaction.reply({ content: 'Apenas o autor pode excluir este post.', ephemeral: true });
          }
          await prisma.instaLike.deleteMany({ where: { postId } });
          await prisma.instaComment.deleteMany({ where: { postId } });
          await prisma.instaPost.delete({ where: { id: postId } });
          await interaction.message.delete().catch(() => {});
        }
      } else if (customId.startsWith('reset:')) {
        const action = customId.split(':')[1];
        if (action === 'cancel') {
          if (interaction.deferred || interaction.replied) return interaction.followUp({ content: 'Cancelado.', ephemeral: true });
          return interaction.reply({ content: 'Cancelado.', ephemeral: true });
        }
        if (action === 'confirm') {
          const requesterId = customId.split(':')[2];
          if (requesterId !== interaction.user.id) {
            return interaction.reply({ content: 'Apenas quem solicitou pode confirmar.', ephemeral: true });
          }
          const prisma = getPrisma();
          const cfg = await getGuildConfig(prisma, interaction.guildId);
          if (!cfg?.instaBoysChannelId && !cfg?.instaGirlsChannelId) {
            return interaction.reply({ content: 'Canais de insta não configurados.', ephemeral: true });
          }
          const channels = [cfg.instaBoysChannelId, cfg.instaGirlsChannelId].filter(Boolean);
          for (const chId of channels) {
            const posts = await prisma.instaPost.findMany({ where: { guildId: interaction.guildId, channelId: chId }, orderBy: { likeCount: 'desc' } });
            const winner = posts[0];
            const channel = await interaction.guild.channels.fetch(chId).catch(() => null);
            if (!channel) continue;
            if (winner) {
              // Envia anúncio do ganhador
              const userMention = `<@${winner.authorId}>`;
              const text = `Ganhador da semana\n${userMention}\n${winner.likeCount} curtidas`;
              const isImage = winner.mediaType === 'image' || winner.mediaType === 'gif';
              const embed = new EmbedBuilder().setDescription(text).setColor(0x2ECC71);
              if (isImage) embed.setImage(winner.mediaUrl);
              let msg;
              if (isImage) {
                msg = await channel.send({ embeds: [embed] });
              } else {
                msg = await channel.send({ content: text, files: [{ attachment: winner.mediaUrl, name: 'midia' }] });
              }
              await prisma.instaWinner.create({ data: { guildId: interaction.guildId, channelId: chId, postId: winner.id, winnerUserId: winner.authorId, likeCount: winner.likeCount, winnerMessageId: msg.id } });
            }
            // Apaga demais posts (mensagens do webhook) e limpa BD
            for (const p of posts) {
              if (winner && p.id === winner.id) continue;
              await prisma.instaLike.deleteMany({ where: { postId: p.id } });
              await prisma.instaComment.deleteMany({ where: { postId: p.id } });
              await prisma.instaPost.delete({ where: { id: p.id } });
              await channel.messages.delete(p.id).catch(() => {});
            }
          }
          return interaction.reply({ content: 'Reset concluído.', ephemeral: true });
        }
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Ocorreu um erro.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Ocorreu um erro.', ephemeral: true });
    }
  }
});

// Captura mensagens para editar cargo (nome/emoji) do próprio autor
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const prisma = getPrisma();
    // Fluxo de edição de cargo (existente)
    const pending = awaitingRoleEdit.get(message.author.id);
    if (!pending) return;
    if (pending.channelId !== message.channel.id) return; // segurança: só no canal onde iniciou

    const role = message.guild.roles.cache.get(pending.roleId) || await message.guild.roles.fetch(pending.roleId).catch(() => null);
    if (!role) {
      awaitingRoleEdit.delete(message.author.id);
      return message.reply({ content: 'Cargo não encontrado.', allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    if (pending.type === 'name') {
      const newName = message.content?.trim();
      if (!newName) return;
      try {
        await role.setName(newName, `Edit name by ${message.author.tag}`);
        awaitingRoleEdit.delete(message.author.id);
        return message.reply({ content: `Nome do cargo atualizado para: ${newName}`, allowedMentions: { repliedUser: false } }).catch(() => {});
      } catch (e) {
        awaitingRoleEdit.delete(message.author.id);
        return message.reply({ content: 'Falha ao atualizar o nome.', allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    } else if (pending.type === 'emoji') {
      // Espera um emoji custom do servidor: formato <:{name}:{id}> ou <:name:id>
      const match = message.content?.match(/<a?:\w+:(\d+)>/);
      if (!match) return; // ignora mensagens sem emoji
      const emojiId = match[1];
      const isAnimated = /<a:/.test(message.content);
      const ext = isAnimated ? 'gif' : 'png';
      const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=128&quality=lossless`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Falha ao baixar imagem do emoji (${res.status})`);
        const arr = await res.arrayBuffer();
        const buf = Buffer.from(arr);
        await role.setIcon(buf);
        awaitingRoleEdit.delete(message.author.id);
        return message.reply({ content: 'Ícone do cargo atualizado a partir do emoji.', allowedMentions: { repliedUser: false } }).catch(() => {});
      } catch (e) {
        awaitingRoleEdit.delete(message.author.id);
        return message.reply({ content: 'Falha ao atualizar o ícone. Verifique se o servidor suporta ícone de cargo e tente outro emoji.', allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    }
  } catch (err) {
    console.error(err);
  }
});

// (removido) coleta de imagem de verificação agora acontece dentro do handler de interação

// Monitorar mensagens nos canais insta
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const prisma = getPrisma();
    const cfg = await getGuildConfig(prisma, message.guildId);
    if (!cfg) return;
    const isInsta = message.channelId === cfg.instaBoysChannelId || message.channelId === cfg.instaGirlsChannelId;
    if (!isInsta) return;

    const att = message.attachments?.first();
    if (!att) return; // apenas mídias
    // verificação obrigatória
    const isVerified = !!(await prisma.verifiedUser.findUnique({ where: { guildId_userId: { guildId: message.guildId, userId: message.author.id } } }));
    if (!isVerified) {
      await message.delete().catch(() => {});
      return;
    }
    // Repost via webhook
    const webhookInfo = await getOrCreateWebhook(message.channel);
    const mediaType = (att.contentType || '').startsWith('image/') ? 'image' : ((att.contentType || '').startsWith('video/') ? 'video' : (att.name?.toLowerCase().endsWith('.gif') ? 'gif' : 'other'));
    const likeBtn = new ButtonBuilder().setCustomId(`insta:like:PENDING`).setLabel('❤️ (0)').setStyle(ButtonStyle.Secondary);
    const commentBtn = new ButtonBuilder().setCustomId(`insta:comment:PENDING`).setLabel('💬 (0)').setStyle(ButtonStyle.Secondary);
    const listLikesBtn = new ButtonBuilder().setCustomId(`insta:listlikes:PENDING:1`).setEmoji('📃').setStyle(ButtonStyle.Secondary);
    const listCommentsBtn = new ButtonBuilder().setCustomId(`insta:listcomments:PENDING:1`).setEmoji('📝').setStyle(ButtonStyle.Secondary);
    const deleteBtn = new ButtonBuilder().setCustomId(`insta:delete:PENDING`).setEmoji('🗑️').setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(likeBtn, commentBtn, listLikesBtn, listCommentsBtn, deleteBtn);
    const embed = new EmbedBuilder().setColor(0x2c2f33).setFooter({ text: `Autor: ${message.author.username}` });
    if (mediaType === 'image' || mediaType === 'gif') embed.setImage(att.url);
    // Envia pelo webhook
    const { id, token } = webhookInfo;
    const hook = await message.client.fetchWebhook(id, token).catch(() => null);
    if (!hook) return;
    const sent = await hook.send({
      username: message.member?.nickname || message.author.username,
      avatarURL: message.author.displayAvatarURL?.({ size: 128 }) || undefined,
      embeds: mediaType === 'image' || mediaType === 'gif' ? [embed] : [],
      files: mediaType === 'video' || mediaType === 'other' ? [{ attachment: att.url, name: att.name }] : [],
      components: [row],
    });
    await message.delete().catch(() => {});
    // Persistir post no BD e atualizar customIds com postId
    await prisma.instaPost.create({ data: {
      id: sent.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      mediaUrl: att.url,
      mediaType,
    }});
    const newRow = new ActionRowBuilder().addComponents(
      likeBtn.setCustomId(`insta:like:${sent.id}`),
      commentBtn.setCustomId(`insta:comment:${sent.id}`),
      listLikesBtn.setCustomId(`insta:listlikes:${sent.id}:1`),
      listCommentsBtn.setCustomId(`insta:listcomments:${sent.id}:1`),
      deleteBtn.setCustomId(`insta:delete:${sent.id}`),
    );
    // Edita a mensagem do webhook para fixar IDs
    await sent.edit({ components: [newRow] }).catch(() => {});
  } catch (e) {
    console.error(e);
  }
});

// Remover cargo Verificado dado manualmente a não verificados
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const prisma = getPrisma();
    const cfg = await getGuildConfig(prisma, newMember.guild.id);
    if (!cfg?.verifiedRoleId) return;
    const had = oldMember.roles.cache.has(cfg.verifiedRoleId);
    const has = newMember.roles.cache.has(cfg.verifiedRoleId);
    if (!had && has) {
      const exists = await prisma.verifiedUser.findUnique({ where: { guildId_userId: { guildId: newMember.guild.id, userId: newMember.id } } });
      if (!exists) {
        await newMember.roles.remove(cfg.verifiedRoleId).catch(() => {});
      }
    }
  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.DISCORD_TOKEN);
