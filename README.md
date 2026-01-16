# Bot de Manutenção (Discord)

Bot Discord em JavaScript com Prisma (SQLite) e permissões dinâmicas por comando.

## 📚 Documentação

- **[🐳 Tutorial Docker (Iniciantes)](./TUTORIAL_DOCKER.md)** - Guia completo passo a passo para rodar com Docker
- **[🛡️ Sistema de Proteções](./docs/PROTECTIONS_SYSTEM.md)** - Documentação técnica completa dos 11 módulos de proteção, backup/restore e whitelist
- **Sistema de Verificação** - Ver seção abaixo
- **Restrições de Voz** - Ver seção abaixo

## Requisitos
- Node.js 18+
- Token e Client ID do bot no Discord
- ID da Guild de desenvolvimento

## 🐳 Execução com Docker (Recomendado)

**Para um tutorial completo e detalhado, veja: [TUTORIAL_DOCKER.md](./TUTORIAL_DOCKER.md)**

### Início Rápido

1. **Configure o arquivo `.env`:**
```powershell
Copy-Item .env.example .env
# Edite o .env com suas credenciais
```

2. **Prepare o banco de dados:**
```powershell
docker compose run --rm bot npx prisma migrate deploy
```

3. **Inicie o bot:**
```powershell
docker compose up -d
```

4. **Veja os logs:**
```powershell
docker compose logs -f bot
```

### Comandos Úteis

```powershell
# Parar o bot
docker compose down

# Reiniciar
docker compose restart

# Reconstruir após mudanças
docker compose up -d --build

# Ver status
docker compose ps
```

---

## 💻 Execução Local (Desenvolvimento)

### 1. Configure o ambiente
Copie `.env.example` para `.env` e preencha:
```
DISCORD_TOKEN=seu_token
DISCORD_CLIENT_ID=seu_client_id
DEV_GUILD_ID=sua_guild_dev
DATABASE_URL="file:./dev.db"
ALLOWED_GUILD_IDS=ID_GUILD_1,ID_GUILD_2
```

### 2. Instale as dependências

```powershell
npm install
```

### 3. Prepare o banco de dados

```powershell
npm run prisma:generate
npm run prisma:migrate
```

### 4. Execute o bot

```powershell
npm run dev
```

Os comandos serão sincronizados automaticamente ao iniciar.

---

## Permissões dinâmicas
- No `/menu`, escolha **Configurar Permissões** para definir quais cargos podem usar cada comando (exceto os que já possuem painel dedicado, como `/ban` e `/castigo`).
- Apenas cargos listados (e o usuário posse configurado via `POSSE_USER_ID`) conseguem executar o comando correspondente; permissões administrativas do Discord não concedem acesso automático.
- Enquanto nenhum cargo estiver associado a um comando, somente o usuário posse poderá executá-lo. Configure ao menos um cargo para liberar o uso.
- As escolhas são armazenadas em `CommandPermissionGlobal` (ligado ao `GlobalConfig`). O painel mostra o resumo atual e permite adicionar/remover cargos a partir de selects nativos.
- Além dos slash commands, o painel agora inclui os prefix commands `!verificado` e `!remover_verificado`. Já o `!info` permanece liberado para todos os usuários e não aparece na lista.

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
- `!info <id/menção>` — mostra status de verificação, estatísticas de mensagens/voz e lista de cargos do usuário.
- `!remover_verificado <id/menção>` — abre confirmação com botões para remover o registro e o cargo de verificado.
- `!verificado <id/menção>` — exibe embed com quem verificou, status atual e foto arquivada (somente cargos autorizados).

### Verificação de usuários

Fluxo:
- O botão do painel continua abrindo um tópico privado com embed "Verificação" e apenas o botão **Encerrar**.
- Somente o InstaMod pode executar o comando `/verificar usuario:<usuário> sexo:<Masculino/Feminino> imagem:<anexo>` dentro desse tópico para concluir o atendimento.
- O comando envia automaticamente a imagem para o canal de fotos correspondente (masculino ou feminino), salva o registro no banco e aplica o cargo de verificado.
- O botão **Encerrar** permanece disponível para fechar o atendimento após o comando.
- Usuários já verificados recebem aviso ao tentar abrir novo ticket e contam com o botão "Cargo Verificado" para reaplicar o cargo caso esteja faltando.
- Se o cargo de verificado for adicionado manualmente em alguém não registrado, o bot remove automaticamente.

Requisitos mínimos:
- Sempre que qualquer parte do sistema de Insta é utilizada (botão do painel, `/verificar`, reaplicar cargo etc.), o bot valida se os campos **Insta Boys**, **Insta Girls**, **Fotos Masculino**, **Fotos Feminino**, **InstaMod**, **Cargo Verificado** e **Painel Verifique-se** estão configurados. Caso falte algo, ele responde "Você precisa configurar o ..." indicando o item ausente (os cargos notificados continuam opcionais).

### Sistema de suporte
- Acesse `/menu` e escolha **Configurar Suporte** para definir:
	- **Canal Suporte**: onde o painel será publicado; é ali que os tópicos privados serão criados.
	- **Cargos Suporte**: quem pode encerrar atendimentos.
	- **Canal Log Suporte**: destino das transcrições e embeds de auditoria.
- Após configurar, use o botão **Enviar/Atualizar** para publicar o painel com embed “Insônia - Suporte” e o botão cinza “Abrir Ticket”.
- Usuários só conseguem ter 1 ticket aberto; ao clicar, o bot cria um tópico privado e menciona quem abriu + cargos de suporte.
- Dentro do tópico há um embed “Insônia Suporte” e o botão **Encerrar atendimento** (somente cargos de suporte).
- Ao encerrar, o bot envia mensagem ephemeral “Encerrando Ticket”, gera uma transcrição HTML com `discord-html-transcripts`, publica no canal de log e remove o tópico.
- O embed no log é vermelho, com título “:Planilha: | Ticket suporte”, lista quem abriu/fechou e traz o horário nativo do Discord no rodapé.

### Insta boys/girls
- Configure tudo pelo `/menu` em **Configurar Insta**: escolha os canais boys/girls, publique o painel e execute as rotinas de reset direto pelos botões do painel (com confirmação visual antes de limpar os canais).

Uso:
- Nos canais configurados, somente usuários verificados podem postar mídia. O bot apaga mensagens de mídia de não verificados.
- Para verificados, o bot reenviará via webhook com botões:
	- ❤️ (N) curtir/descurtir (toggle)
	- 💬 (N) comentar (coleta sua próxima mensagem e apaga, mantendo organizado)
	- 📃 listar curtidas (ephemeral, com paginação)
	- 📝 listar comentários (ephemeral, com paginação)
	- 🗑️ excluir (apenas o autor)

### AutoMod
- Dentro do `/menu`, escolha **Configurar AutoMod** para abrir o painel principal. A mensagem continua sendo **uma única interação ephemeral** e agora traz um select para escolher o módulo desejado (Anti-Palavras ou Anti-Spam).
- **Anti-Palavras**:
	- Em "Palavras Bloqueadas", o botão **Inserir palavras** guia o envio de um arquivo `.txt` com termos separados por vírgula (ex.: `palavra1, palavra2`). Digitar **cancelar** aborta o processo. Termos duplicados são ignorados automaticamente.
	- Em "Tipo de Punição", escolha entre **Apagar** (remove apenas a mensagem) ou **Castigar e apagar** (remove e aplica timeout). Ao ativar castigo, clique em **Definir tempo** para selecionar rapidamente 60s, 5m, 10m, 1h, 1d ou 1 semana. O motivo aplicado permanece **"Palavra Proibida"**.
- **Anti-Spam**:
	- O painel mostra status atual, limite configurado (mensagens por janela), punição ativa, cargo de mute configurado em `/menu mute`, além das listas de canais ignorados e cargos isentos.
	- Botões dedicados permitem **Ativar/Desativar**, abrir modal para **Configurar limite** (1–100 mensagens em até 600 segundos), **Configurar punição** (modo Mute ou Castigo com tempos próprios) e **Restaurar padrão**.
	- Os Channel/Role Selects permitem escolher até 25 canais e 25 cargos de exceção, sempre respeitando a filosofia de “uma mensagem, vários estados”.
	- Ao detectar spam, o bot aplica automaticamente mute no chat (usando o cargo já definido) ou timeout, registra o embed no mesmo formato do comando manual `!mute`, envia log no canal configurado e remove a mensagem de aviso após alguns segundos.

### Ranking de Convites
- Abra `/menu` e selecione **Configurar Convites** para ativar/desativar o rastreamento. O botão de toggle muda entre verde (ativo) e vermelho (desativado) e o painel sempre opera em uma única mensagem ephemeral.
- Defina o **Canal do Ranking** via Channel Select. Assim que ativo, o bot cria (ou reaproveita) uma mensagem única nesse canal com embed paginado (50 usuários por página) e botões Prev/Next. Tudo segue o padrão de máquina de estados: nenhuma mensagem extra é criada.
- Defina também o **Canal de Logs**: cada entrada válida gera um embed verde automático no canal escolhido com `{usuário} entrou usando o convite {código}, criado por {inviter}`. Os nomes são exibidos em texto (sem mencionar) e o log persiste mesmo após reiniciar o bot.
- Ao ligar, o bot faz cache de todos os convites existentes; sempre que alguém entra, ele baixa novamente, compara usos e identifica o invite utilizado + o dono. Cada entrada é salva no banco (`InviteStat` e `InviteEvent`), incluindo código do convite e última pessoa convidada.
- O ranking exibe apenas o **username/texto**, sem mencionar usuários, e mostra o total de convites de cada anfitrião. Quando a lista passar de 50 nomes, os botões de paginação ficam habilitados.
- Um timestamp no embed informa `Ranking atualizará em: <tempo relativo>` usando o recurso nativo do Discord (`<t:...:R>`). O bot atualiza automaticamente a cada 5 minutos e também sempre que um novo convidado é detectado.
- Dentro do painel de convites existe o botão **Resetar Rank**, que pede confirmação explícita com "tem certeza?" antes de apagar o histórico no banco. O ranking no canal é limpo imediatamente após o reset.
- O painel oferece um **Filtro por idade da conta**: ative/desative pelo próprio painel e defina os dias mínimos (ex.: 7). Se o filtro estiver ativo, contas abaixo do limite não entram no ranking nem no banco; o log mostra "Atenção" explicando que não foi contabilizado.

### Moderação (Ban/Castigo)
- No `/menu`, selecione **Configurar Moderação** para abrir o painel principal e siga para **Config Ban** ou **Config Castigo**.
  - Cada painel possui botões para **Ativar/Desativar** o comando, **Config Log** (select com canais já pré-selecionados se houver valor salvo) e **Permissões** (select com cargos da guild marcados conforme banco).
  - **Config DM** permite alternar o envio de DM antes da punição, definir contato (ID/menção) e editar a mensagem enviada; o texto é armazenado no banco e exibido em tempo real.
  - Logs ficam vinculados a canais de texto e podem ser limpos escolhendo "Desativar logs".
- Comandos disponíveis (slash e prefixo):
  - `/ban` / `!ban <id/menção> <motivo>` — envia DM primeiro (se habilitado), registra log vermelho e bane o usuário.
  - `/unban` / `!unban <id> <motivo>` — remove o ban e registra log verde.
  - `/castigo` / `!castigo <id/menção> <motivo> <tempo>` — aplica timeout (tempo no formato `30s`, `5m`, `2h`, `1d`, `1w`).
  - `/removercastigo` / `!removercastigo <id/menção> [motivo]` — remove o timeout.
- Hierarquia sempre é respeitada: nem o executor nem o bot podem agir em alguém com cargo igual/maior.
- Os logs seguem o layout solicitado: título específico (Banimento/Banimento removido/Castigo aplicado/Castigo removido), campos "Membro" e "Moderador" no formato `<@user> (tag)\nID: \\`123\\`` e campo "Motivo" representado dentro de um bloco de código.

### Limpeza automática de canais
- No `/menu`, escolha **Configurar Limpeza** para abrir o painel (apenas uma mensagem) com todos os painéis cadastrados e seus status.
- Clique em **Criar painel** para seguir o fluxo guiado: informe o nome, selecione o canal via Channel Select e digite o intervalo usando `s/m/h` (ex.: `30s`, `5m`, `2h`). O valor mínimo é 10s e o máximo é 6h.
- Opcionalmente informe um ID de mensagem para servir como limite (a limpeza para quando atingir essa mensagem) ou digite **pular** para continuar sem filtro.
- Cada painel tem botões para editar nome/intervalo/filtro, trocar o canal monitorado, ativar/desativar, executar manualmente ou excluir (com confirmação). Também há um botão específico para limpar somente o filtro atual.
- A tarefa automática apaga até 1.000 mensagens por ciclo, utilizando `bulkDelete` quando as mensagens têm até 14 dias e exclusões individuais com pequenos delays para o restante.
- O embed mostra a última execução com `<t:...:R>` e o botão **Atualizar** recarrega os dados sem criar novas mensagens. Os logs das execuções aparecem no console (`[cleaner] Painel ...`).

### Mutes (voz e chat)
- Dentro do `/menu`, escolha **Configurar Mute** para abrir o painel com duas abas:
	- **Mute Voz (!mutecall / !unmutecall)**: define o **Cargo mutado voz**, o **Canal de desbloqueio** (opcional), o **Canal de log** e permissões individuais para os comandos. Os selects já vêm pré-preenchidos com os valores salvos e usam Role/Channel Select com autocomplete.
	- **Mute Chat (!mute / !unmute)**: define o **Cargo mutado chat**, o **Canal de log** e permissões independentes dos demais módulos.
	- Em cada subpainel há botões para abrir sub-embeds de seleção e botões "Permissões" que carregam um select de cargos com opção de limpar (voltando ao padrão posse/Admin).
- Prefix commands disponíveis:
	- `!mutecall <@user/id> <tempo> [motivo]` — aplica server mute + cargo configurado. Tempo aceita `Xs`, `Xm` ou `Xh`. Motivo padrão: "Motivo não especificado".
	- `!unmutecall <@user/id> [motivo]` — remove o mute de voz. Antes de remover o cargo/timeout o bot marca o mute como finalizado no banco e aguarda 2 segundos para evitar re-aplicações indevidas.
	- `!mute <@user/id> <tempo> [motivo]` — adiciona o cargo de mute chat e registra no banco para persistência.
	- `!unmute <@user/id> [motivo]` — remove o cargo de mute chat e encerra o registro.
- Para cada ação o bot envia **somente um embed** no canal onde o comando foi executado (o embed é apagado automaticamente após 5 segundos) e replica o mesmo embed no canal de log correspondente (sem deletar).
- O sistema salva todos os mutes ativos no banco (`VoiceMute` e `ChatMute`) e executa as seguintes proteções automaticamente:
	- Reaplica server mute/cargo sempre que alguém tenta remover manualmente durante um mute ativo.
	- Remove cargos/mutes aplicados manualmente se não houver registro correspondente.
	- Após reiniciar o bot, todos os mutes ativos são restaurados (cargo + estado de voz).
	- Um job periódico verifica expirações e remove mutes vencidos, registrando o log com o bot como executor.
	- Assim que o tempo termina, o bot envia um embed verde no mesmo canal onde o comando foi digitado avisando que o usuário foi liberado automaticamente.

## Notas
- Ao iniciar, o bot tenta sincronizar os comandos na guild definida por `DEV_GUILD_ID`. Se não encontrar a guild e `SYNC_GLOBAL_FALLBACK=true`, faz fallback para sincronização global (pode levar até ~1h para aparecer).
- As DMs usam exatamente o embed do log + a mensagem configurada (e, opcionalmente, uma menção ao contato), e só acontecem antes da ação para garantir entrega.
- Para registro imediato na guild, certifique-se de que o bot está presente na guild e foi convidado com os escopos `applications.commands` e `bot`.
- O script `npm run register:dev` continua disponível como alternativa manual.
- Para restringir o bot a funcionar apenas em alguns servidores (mesmo dono), defina `ALLOWED_GUILD_IDS` no `.env` com os IDs separados por vírgula. Qualquer interação fora dessa lista será negada pelo bot.

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
