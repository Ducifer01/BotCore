# Guia de Comandos

> Notas:
> - Comandos marcados com `[Permissao: ...]` dependem da configuracao em `/menu -> Permissoes`; associe os cargos correspondentes ao nome do comando.
> - "POSSE" e o usuario configurado em `POSSE_USER_ID`, com acesso administrativo total independentemente das regras acima.

## Prefixos (`!`)

### Moderacao
- `!ban <@usuario|id> <motivo>` — Bane o alvo e registra log ou DM conforme configuracao. [Permissao: /menu -> Config Ban]
- `!unban <id> <motivo>` — Remove banimentos respeitando blacklist e gera log. [Permissao: /menu -> Config Ban]
- `!castigo <@usuario|id> <tempo> [motivo]` — Aplica timeout usando formatos como `30s`, `5m`, `1h` ou `1d`. [Permissao: /menu -> Config Castigo]
- `!removercastigo <@usuario|id> [motivo]` — Encerra o timeout ativo e registra nos logs configurados. [Permissao: /menu -> Config Castigo]
- `!addblacklist <@usuario|id> <motivo>` — Grava o usuario na blacklist e orienta banimento manual. [Permissao: /menu -> Permissoes > addblacklist]
- `!removeblacklist <@usuario|id>` — Remove da blacklist e avisa sobre ban vigente. [Permissao: /menu -> Permissoes > removeblacklist]
- `!verblacklist` — Lista ate 50 registros em embed temporario. [Permissao: /menu -> Permissoes > verblacklist]

### Mutes
- `!mutecall <@usuario|id> <tempo> [motivo]` — Aplica server mute e cargo de voz pelo periodo informado. [Permissao: /menu -> Config Mute (Mute Voz)]
- `!unmutecall <@usuario|id> [motivo]` — Remove mute de voz ativo e atualiza o historico. [Permissao: /menu -> Config Mute (Mute Voz)]
- `!mute <@usuario|id> <tempo> [motivo]` — Adiciona o cargo de mute de chat com expiracao controlada. [Permissao: /menu -> Config Mute (Mute Chat)]
- `!unmute <@usuario|id> [motivo]` — Libera o usuario do mute de chat e registra log. [Permissao: /menu -> Config Mute (Mute Chat)]

### Verificacao
- `!remover_verificado <@usuario|id>` — Abre confirmacao com botoes para remover registro e cargo de verificado. [Permissao: /menu -> Permissoes > remover_verificado]

### Utilidades
- `!info <@usuario|id>` — Mostra estatisticas de mensagens, voz, cargos e status de verificacao do membro. (Livre)
- `!ping` — Exibe latencia da mensagem e ping da API em embed auto apagado (cooldown de 10s por canal). (Livre)

## Slash (`/`)

### Staff (POSSE)
- `/menu` — Abre o painel principal de configuracoes do bot em resposta ephemeral. [Permissao: POSSE]
- `/adicionar_pontos usuario:<usuario> quantidade:<numero> [motivo]` — Ajusta pontos manualmente e registra log administrativo. [Permissao: POSSE]
- `/remover_pontos usuario:<usuario> quantidade:<numero> [motivo]` — Remove pontos manualmente e envia logs ao canal configurado. [Permissao: POSSE]
- `/punir usuario:<usuario> dias:<numero> [motivo]` — Congela ganhos de pontos por N dias (0 = permanente). [Permissao: POSSE]
- `/despunir usuario:<usuario>` — Remove o congelamento de pontos ativo. [Permissao: POSSE]
- `/resetar_pontos` — Dispara confirmacao para zerar toda a pontuacao da guild. [Permissao: POSSE]
- `/painel_pontos canal:<texto> [refresh_minutos]` — Registra ou atualiza painel de leaderboard com refresh automatico. [Permissao: POSSE]

### Moderacao
- `/ban usuario:<usuario> motivo:<texto>` — Bane o usuario obedecendo hierarquia, DM opcional e logs configurados. [Permissao: /menu -> Config Ban]
- `/unban usuario:<id|mencao> motivo:<texto>` — Revoga banimentos evitando usuarios na blacklist. [Permissao: /menu -> Config Ban]
- `/castigo usuario:<usuario> motivo:<texto> tempo:<30s|5m|...>` — Aplica timeout com registro de log e DM. [Permissao: /menu -> Config Castigo]
- `/removercastigo usuario:<usuario> [motivo]` — Remove timeout registrado e atualiza banco/log. [Permissao: /menu -> Config Castigo]
- `/blacklist` — Abre painel com botoes para adicionar, remover ou listar usuarios na blacklist. [Permissao: /menu -> Permissoes > blacklist]

### Cargos e Gestao
- `/add_cargo_all cargo:<cargo> [excluir_cargo_*]` — Prepara confirmacao para aplicar cargo em massa ignorando exclusoes informadas. [Permissao: /menu -> Permissoes > add_cargo_all]
- `/remove_cargo_all cargo:<cargo> [excluir_cargo_*]` — Prepara confirmacao para remover cargo em massa com exclusoes opcionais. [Permissao: /menu -> Permissoes > remove_cargo_all]
- `/editar_cargo` — Abre painel ephemeral com Role Select para editar nome ou emoji de cargos. [Permissao: /menu -> Permissoes > editar_cargo]

### Canais e Permissoes
- `/permissoes` — Copia overwrites de um canal ou categoria para multiplos destinos via selects e botao Aplicar. [Permissao: /menu -> Permissoes > permissoes]
- `/verificar_perm_canais categoria:<categoria>` — Lista canais divergentes e oferece botao Sincronizar. [Permissao: /menu -> Permissoes > verificar_perm_canais]
- `/nuke canal:<canal>` — Recria o canal preservando configuracao, ordem e permissoes. [Permissao: /menu -> Permissoes > nuke]
- `/nuke_all categoria:<categoria>` — Recria todos os canais da categoria mantendo ordem e overwrites. [Permissao: /menu -> Permissoes > nuke_all]

### Voz e Movimento
- `/mover_todos destino:<voz>` — Move todos os usuarios do seu canal atual para o destino escolhido. [Permissao: /menu -> Permissoes > mover_todos]
- `/mover_alguns destino:<voz>` — Abre select ephemeral para escolher ate 25 usuarios e mover em lote. [Permissao: /menu -> Permissoes > mover_alguns]
- `/conectar canal:<voz>` — Conecta o bot ao canal indicado (checa permissao Connect). [Permissao: /menu -> Permissoes > conectar]
- `/desconectar` — Desconecta o bot do canal de voz atual da guild. [Permissao: /menu -> Permissoes > desconectar]

### Pontos e Engajamento (usuarios)
- `/pontos [usuario:<usuario>]` — Mostra saldo atual e status de elegibilidade na call (ephemeral; valida palavra-chave de bio quando configurada). (Livre)
- `/historico_pontos` — Exibe as ultimas transacoes do usuario em ate 5 paginas com botoes Prev/Next. (Livre)
- `/rank` — Mostra o top 10 de pontos do servidor em embed ephemeral. (Livre)
- `/meus_convites` — Lista convites recentes com status pendente, confirmado ou revogado. (Livre)

### Insta e Verificacao
- `/verificar sexo:<Masculino|Feminino> imagem:<arquivo>` — Conclui verificacao dentro do topico do painel Verifique-se, envia a foto ao canal correto e aplica cargo. [Permissao: cargo InstaMod configurado em /menu -> Configurar Insta]
- `/verificado usuario:<usuario>` — Consulta status de verificacao e foto salva do usuario. [Permissao: /menu -> Permissoes > verificado]
- `/resetar_insta` — Abre confirmacao para limpar canais de Insta e anunciar o ganhador semanal. [Permissao: /menu -> Permissoes > resetar_insta]
