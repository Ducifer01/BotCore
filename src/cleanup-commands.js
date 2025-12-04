require('dotenv').config();
const { REST, Routes } = require('discord.js');

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId) {
    console.error('DISCORD_CLIENT_ID ausente no .env');
    process.exit(1);
  }

  try {
    const doClearGlobal = String(process.env.CLEAR_GLOBAL_COMMANDS || '').toLowerCase() === 'true';
    const guildIdsEnv = process.env.CLEAR_GUILD_IDS || '';
    const guildIds = guildIdsEnv.split(',').map(s => s.trim()).filter(Boolean);

    if (doClearGlobal) {
      console.log('[cleanup] Limpando comandos globais...');
      await rest.put(Routes.applicationCommands(appId), { body: [] });
      console.log('[cleanup] Comandos globais removidos.');
    }

    for (const gid of guildIds) {
      console.log(`[cleanup] Limpando comandos da guild ${gid}...`);
      await rest.put(Routes.applicationGuildCommands(appId, gid), { body: [] });
      console.log(`[cleanup] Comandos removidos da guild ${gid}.`);
    }

    console.log('[cleanup] Finalizado.');
  } catch (err) {
    console.error('[cleanup] Falhou:', err);
    process.exit(1);
  }
})();
