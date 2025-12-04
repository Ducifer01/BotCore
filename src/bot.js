require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

client.login(process.env.DISCORD_TOKEN);
