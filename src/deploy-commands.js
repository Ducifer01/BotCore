require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { DISABLED_COMMAND_FILES } = require('./constants/disabledCommands');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const disabledCommands = new Set(DISABLED_COMMAND_FILES);
for (const file of commandFiles) {
  if (disabledCommands.has(file)) {
    console.log(`[deploy] Ignorando ${file} (desativado)`);
    continue;
  }
  const command = require(path.join(commandsPath, file));
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registrando comandos (guild dev)...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID),
      { body: commands }
    );
    console.log('Comandos registrados.');
  } catch (error) {
    console.error(error);
  }
})();
