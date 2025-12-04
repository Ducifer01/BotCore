# Bot de Manutenção (Discord)

Bot Discord em JavaScript com Prisma (SQLite) e permissões dinâmicas por comando.

## Requisitos
- Node.js 18+
- Token e Client ID do bot no Discord
- ID da Guild de desenvolvimento

## Configuração
1. Copie `.env.example` para `.env` e preencha:
```
DISCORD_TOKEN=seu_token
DISCORD_CLIENT_ID=seu_client_id
DEV_GUILD_ID=sua_guild_dev
DATABASE_URL="file:./dev.db"
```

2. Instale dependências:

```powershell
npm install
```

3. Gere o cliente Prisma e migre o banco:

```powershell
npm run prisma:generate
npm run prisma:migrate
```

4. Execute o bot (os comandos serão sincronizados automaticamente ao iniciar):

```powershell
npm run dev
```

## Permissões dinâmicas
- Cada comando possui configuração em `CommandConfig`.
- Se não houver allow-list configurada, o acesso padrão é para quem possui Administrator ou ManageChannels na guild.
- Para permitir usuários/cargos específicos, insira registros em `AllowedUser` e `AllowedRole` (via Prisma Studio ou futuros comandos de administração).

## Comandos
- `/copiar_perm_categoria origem:<categoria> destino:<categoria>` — copia overwrites de uma categoria para outra.
- `/copiar_perm_canal origem:<canal> destino:<canal>` — copia overwrites de um canal para outro.
- `/verificar_perm_canais categoria:<categoria>` — verifica canais que não estão sincronizados com a categoria; retorna embed com botão "Sincronizar" para alinhar.
 - `/mover_todos destino:<voz>` — move todos os usuários do seu canal de voz atual para o destino.
 - `/mover_alguns destino:<voz>` — abre um menu para selecionar alguns usuários do seu canal atual e movê-los para o destino.
 - `/conectar canal:<voz>` — conecta o bot a um canal de voz.
 - `/desconectar` — desconecta o bot do canal de voz atual da guild.
 - `/nuke canal:<canal>` — apaga e recria o canal com mesmo nome e permissões.
 - `/nuke_all categoria:<categoria>` — apaga e recria todos os canais da categoria, um por um, preservando nome e permissões.
 - `/editar_cargo id:<id>` — abre painel para editar nome/emoji de um cargo (somente usuários permitidos pelo banco).
 - `/copiar_perm_cargo origem:<cargo> destino:<cargo>` — copia bitfield de permissões de um cargo para outro.

## Notas
- Ao iniciar, o bot tenta sincronizar os comandos na guild definida por `DEV_GUILD_ID`. Se não encontrar a guild e `SYNC_GLOBAL_FALLBACK=true`, faz fallback para sincronização global (pode levar até ~1h para aparecer).
- Para registro imediato na guild, certifique-se de que o bot está presente na guild e foi convidado com os escopos `applications.commands` e `bot`.
- O script `npm run register:dev` continua disponível como alternativa manual.

## Limpando comandos antigos
- Se comandos antigos permanecerem listados (geralmente por terem sido publicados globalmente antes), você pode:
	- Definir `CLEAR_GLOBAL_COMMANDS=true` no `.env` para limpá-los automaticamente ao iniciar (se o bot logar com sucesso).
	- Rodar o script manual de limpeza:

```powershell
# Limpeza global (usa DISCORD_CLIENT_ID/Token do .env)
$env:CLEAR_GLOBAL_COMMANDS="true"; npm run commands:cleanup

# Limpeza por guild(s)
$env:CLEAR_GUILD_IDS="GUILD_ID_1,GUILD_ID_2"; npm run commands:cleanup
```

Observação: comandos globais podem demorar até ~1 hora para sumirem completamente dos clientes devido ao cache do Discord.
