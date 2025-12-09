require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('./db');
const { ensureGuild } = require('./permissions');
const { registerMuteFeature } = require('./features/mute');
const { handleSupportInteraction } = require('./features/support');
const { createMenuHandler } = require('./features/menu');
const instaFeature = require('./features/insta');
const muteConfig = require('./features/muteConfig');
const supportConfig = require('./features/supportConfig');
const verifyFeature = require('./features/verify');
const moveFeature = require('./features/moveSome');
const roleEditorFeature = require('./features/roleEditor');
const bulkRoleFeature = require('./features/bulkRole');
const syncFeature = require('./features/categorySync');
const autoModFeature = require('./features/autoMod');
const moderationConfig = require('./features/moderationConfig');
const moderationCommands = require('./features/moderationCommands');
const muteCommands = require('./features/muteCommands');
const inviteTrackerFeature = require('./features/inviteTracker');
const { ALLOWED_GUILD_IDS, isGuildAllowed } = require('./config');

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  }
}

try {
  registerMuteFeature(client);
} catch (e) {
  console.warn('[init] Mute feature não carregada:', e?.message || e);
}

try {
  inviteTrackerFeature.registerInviteTracker(client, { isGuildAllowed });
} catch (e) {
  console.warn('[init] Invite tracker não carregado:', e?.message || e);
}

const menuHandler = createMenuHandler({
  insta: { presentMenu: instaFeature.presentMenu },
  mute: { presentMenu: muteConfig.presentMenu },
  support: { presentMenu: supportConfig.presentMenu },
  automod: { presentMenu: autoModFeature.presentMenu },
  moderation: { presentMenu: moderationConfig.presentMenu },
  invites: { presentMenu: inviteTrackerFeature.presentMenu },
});

const interactionFeatures = [
  menuHandler,
  muteConfig,
  supportConfig,
  instaFeature,
  verifyFeature,
  moveFeature,
  roleEditorFeature,
  bulkRoleFeature,
  syncFeature,
  autoModFeature,
  moderationConfig,
  inviteTrackerFeature,
  { handleInteraction: handleSupportInteraction },
];

const messageFeatures = [autoModFeature, roleEditorFeature, instaFeature, moderationCommands, muteCommands];
const guildUpdateFeatures = [instaFeature];

function buildHandlerContext() {
  return {
    getPrisma,
    POSSE_USER_ID: String(process.env.POSSE_USER_ID || '').trim(),
    ALLOWED_GUILD_IDS,
    isGuildAllowed,
  };
}

async function syncSlashCommands() {
  try {
    const commandData = [...client.commands.values()].map(c => c.data.toJSON());
    const devGuildId = process.env.DEV_GUILD_ID;
    const allowGlobalFallback = String(process.env.SYNC_GLOBAL_FALLBACK || '').toLowerCase() === 'true';
    const clearGlobalOnStart = String(process.env.CLEAR_GLOBAL_COMMANDS || '').toLowerCase() === 'true';

    // Se houver uma lista de guilds permitidas, sincroniza comandos em cada uma
    if (ALLOWED_GUILD_IDS.length > 0) {
      if (clearGlobalOnStart) {
        try {
          await client.application.commands.set([]);
          console.log('[sync] Comandos globais limpos por CLEAR_GLOBAL_COMMANDS=true.');
        } catch (e) {
          console.warn('[sync] Falha ao limpar comandos globais:', e?.message || e);
        }
      }
      for (const gid of ALLOWED_GUILD_IDS) {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) {
          console.warn(`[sync] Guild ${gid} não encontrada ou sem acesso.`);
          continue;
        }
        await guild.commands.set(commandData);
        console.log(`[sync] Comandos sincronizados na guild ${guild.name} (${guild.id}).`);
      }
      return;
    }

    // Comportamento anterior: registra em DEV_GUILD_ID ou global fallback
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

// v15 renomeia 'ready' para 'clientReady'; já usamos o novo para evitar o warning
client.once('clientReady', async () => {
  console.log(`Logado como ${client.user.tag}`);
  await syncSlashCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.guildId && !isGuildAllowed(interaction.guildId)) {
      return;
    }
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await ensureGuild(interaction.guild);
      await command.execute(interaction);
      return;
    }
    const ctx = buildHandlerContext();
    for (const feature of interactionFeatures) {
      if (typeof feature.handleInteraction !== 'function') continue;
      const handled = await feature.handleInteraction(interaction, ctx);
      if (handled) return;
    }
  } catch (err) {
    console.error(err);
    try {
      const payload = { content: 'Ocorreu um erro.', flags: 64 };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else if (interaction.isRepliable()) {
        await interaction.reply(payload);
      }
    } catch (replyErr) {
      console.warn('Falha ao responder erro (talvez interação expirada):', replyErr?.code || replyErr?.message || replyErr);
    }
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return;
    if (!isGuildAllowed(message.guildId)) return;
    const ctx = buildHandlerContext();
    for (const feature of messageFeatures) {
      if (typeof feature.handleMessage !== 'function') continue;
      const handled = await feature.handleMessage(message, ctx);
      if (handled) break;
    }
  } catch (err) {
    console.error(err);
  }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (!isGuildAllowed(newMember.guild.id)) return;
    const ctx = buildHandlerContext();
    for (const feature of guildUpdateFeatures) {
      if (typeof feature.handleGuildMemberUpdate !== 'function') continue;
      await feature.handleGuildMemberUpdate(oldMember, newMember, ctx);
    }
  } catch (err) {
    console.error(err);
  }
});

client.on('error', (err) => {
  console.error('[client error]', err);
});

const token = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN ou DISCORD_TOKEN não configurado no ambiente.');
}
client.login(token);
