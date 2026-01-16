# 🐳 Tutorial: Como Executar o Bot com Docker (Para Iniciantes)

## 📋 Índice
1. [O que você precisa instalar](#-pré-requisitos)
2. [Obter o código do projeto](#-passo-1-obter-o-código-do-projeto)
3. [Configurar suas credenciais](#-passo-2-configurar-credenciais-do-discord)
4. [Executar com Docker](#-passo-3-executar-com-docker)
5. [Comandos úteis](#-comandos-úteis)
6. [Solução de problemas](#-solução-de-problemas)

---

## 🔧 Pré-requisitos

Antes de começar, você precisa instalar 3 programas no seu computador:

### 1. **Git** (para baixar o código)
- **Windows**: Baixe em https://git-scm.com/download/win
- **Linux**: `sudo apt install git` (Ubuntu/Debian) ou `sudo yum install git` (CentOS/Fedora)
- **Mac**: `brew install git` (se tiver Homebrew) ou baixe em https://git-scm.com/download/mac

**Como verificar se instalou corretamente:**
```bash
git --version
```
Deve aparecer algo como: `git version 2.x.x`

### 2. **Docker** (para criar o container do bot)
- **Windows/Mac**: Baixe Docker Desktop em https://www.docker.com/products/docker-desktop
- **Linux**: Siga o guia oficial → https://docs.docker.com/engine/install/

**Como verificar se instalou corretamente:**
```bash
docker --version
docker compose version
```
Deve aparecer as versões instaladas.

### 3. **Conta no Discord Developer Portal**
- Acesse: https://discord.com/developers/applications
- Crie uma nova aplicação (será seu bot)
- Anote o **TOKEN** e o **CLIENT ID** (vamos usar depois)

---

## 📥 Passo 1: Obter o código do projeto

### Opção A: Usando Git (Recomendado)

1. **Abra o terminal/prompt de comando**
   - Windows: Pressione `Win + R`, digite `cmd` e Enter
   - Mac: Pressione `Cmd + Space`, digite `terminal` e Enter
   - Linux: Pressione `Ctrl + Alt + T`

2. **Navegue até onde quer salvar o projeto**
   ```bash
   # Exemplo: ir para a pasta Documents
   cd Documents
   ```

3. **Clone (baixe) o repositório**
   ```bash
   git clone https://github.com/Ducifer01/BotCore.git
   ```
   
   Substitua `Ducifer01/BotCore` pela URL correta do seu repositório se for diferente.

4. **Entre na pasta do projeto**
   ```bash
   cd BotCore
   ```

### Opção B: Download manual (alternativa)

1. Acesse o repositório no GitHub
2. Clique no botão verde **"Code"**
3. Clique em **"Download ZIP"**
4. Extraia o arquivo ZIP
5. Abra o terminal na pasta extraída

---

## 🔑 Passo 2: Configurar credenciais do Discord

### 1. **Copie o arquivo de exemplo**

No terminal, dentro da pasta do projeto:

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**Windows (CMD):**
```cmd
copy .env.example .env
```

**Linux/Mac:**
```bash
cp .env.example .env
```

### 2. **Edite o arquivo `.env`**

Abra o arquivo `.env` com qualquer editor de texto (Bloco de Notas, VS Code, etc).

**Substitua os valores vazios:**

```bash
# ⚠️ OBRIGATÓRIO - Pegue no Discord Developer Portal
DISCORD_TOKEN=SEU_TOKEN_AQUI
DISCORD_CLIENT_ID=SEU_CLIENT_ID_AQUI

# ID do servidor de teste (pegue clicando com botão direito no servidor)
DEV_GUILD_ID=123456789012345678

# Caminho do banco de dados (DEIXE ASSIM para Docker)
DATABASE_URL="file:./data/dev.db"

# Lista de servidores permitidos (separados por vírgula)
ALLOWED_GUILD_IDS=123456789012345678,987654321098765432

# ID do usuário dono do bot
POSSE_USER_ID=SEU_USER_ID_AQUI

# Limpar comandos antigos ao iniciar (true ou false)
CLEAR_GLOBAL_COMMANDS=true
```

### 3. **Como obter cada valor:**

#### 🔹 **DISCORD_TOKEN**
1. Vá em https://discord.com/developers/applications
2. Clique na sua aplicação
3. Vá em **"Bot"** no menu lateral
4. Clique em **"Reset Token"** ou **"Copy"**
5. ⚠️ **NUNCA compartilhe esse token!**

#### 🔹 **DISCORD_CLIENT_ID**
1. No mesmo portal, vá em **"General Information"**
2. Copie o **"Application ID"**

#### 🔹 **DEV_GUILD_ID**
1. No Discord, ative o **Modo Desenvolvedor**:
   - Configurações → Avançado → Modo Desenvolvedor (Ativar)
2. Clique com botão direito no seu servidor
3. Clique em **"Copiar ID do Servidor"**

#### 🔹 **POSSE_USER_ID**
1. Com Modo Desenvolvedor ativo
2. Clique com botão direito no seu usuário
3. Clique em **"Copiar ID do Usuário"**

---

## 🚀 Passo 3: Executar com Docker

### 1. **Preparar o banco de dados**

Crie a pasta para o banco de dados:

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path data
```

**Windows (CMD):**
```cmd
mkdir data
```

**Linux/Mac:**
```bash
mkdir -p data
```

### 2. **Executar as migrações do banco**

Este comando prepara o banco de dados pela primeira vez:

```bash
docker compose run --rm bot npx prisma migrate deploy
```

**O que esse comando faz:**
- `docker compose run`: Executa um comando dentro do container
- `--rm`: Remove o container após executar (economiza espaço)
- `bot`: Nome do serviço (definido no docker-compose.yml)
- `npx prisma migrate deploy`: Cria as tabelas no banco de dados

⏱️ Aguarde alguns minutos na primeira vez (Docker vai baixar a imagem do Node.js).

### 3. **Iniciar o bot**

```bash
docker compose up -d
```

**Explicando:**
- `docker compose up`: Inicia os containers
- `-d`: Modo "detached" (roda em segundo plano)

✅ **Pronto! Seu bot está rodando!**

### 4. **Ver os logs (verificar se está funcionando)**

```bash
docker compose logs -f bot
```

**Pressione `Ctrl + C` para sair dos logs** (o bot continua rodando).

Você deve ver algo como:
```
[INFO] Bot conectado como: SeuBot#1234
[INFO] Comandos sincronizados com sucesso
```

---

## 🎮 Comandos Úteis

### Ver se o bot está rodando
```bash
docker compose ps
```

### Ver logs em tempo real
```bash
docker compose logs -f bot
```

### Parar o bot
```bash
docker compose down
```

### Reiniciar o bot (após mudanças no `.env`)
```bash
docker compose restart
```

### Parar, reconstruir e iniciar (após mudanças no código)
```bash
docker compose down
docker compose up -d --build
```

### Executar comandos dentro do container
```bash
docker compose exec bot sh
```
(Digite `exit` para sair)

### Limpar tudo (cuidado: apaga o banco de dados!)
```bash
docker compose down -v
rm -rf data
```

---

## 🔍 Solução de Problemas

### ❌ Erro: "Cannot find module"
**Solução:** Reconstrua a imagem
```bash
docker compose down
docker compose up -d --build
```

### ❌ Erro: "Invalid token"
**Causa:** Token do Discord incorreto no `.env`

**Solução:**
1. Verifique se copiou o token completo (sem espaços extras)
2. Gere um novo token no Discord Developer Portal
3. Atualize o `.env`
4. Reinicie: `docker compose restart`

### ❌ Erro: "Port is already allocated"
**Causa:** Outra aplicação está usando a porta

**Solução:**
- O bot não usa portas por padrão, então isso não deve acontecer
- Se acontecer, verifique se já tem outro bot rodando

### ❌ Bot não responde aos comandos
**Possíveis causas:**

1. **Comandos não sincronizados**
   ```bash
   docker compose restart
   ```

2. **Bot sem permissões no servidor**
   - Verifique se o bot tem permissão de "Usar Comandos de Aplicativos"
   - Convite o bot com este link:
     ```
     https://discord.com/api/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=8&scope=bot%20applications.commands
     ```
     (Substitua `SEU_CLIENT_ID`)

3. **DEV_GUILD_ID errado**
   - Verifique se o ID no `.env` corresponde ao servidor onde está testando

### ❌ Erro de permissão no Linux
**Solução:** Execute com `sudo` ou adicione seu usuário ao grupo docker
```bash
sudo usermod -aG docker $USER
```
(Faça logout e login novamente)

### ❌ Banco de dados corrompido
**Solução:** Recriar do zero
```bash
docker compose down
rm -rf data
mkdir data
docker compose run --rm bot npx prisma migrate deploy
docker compose up -d
```

---

## 📂 Estrutura do Projeto (Resumo)

```
BotCore/
├── src/                    # Código-fonte do bot
│   ├── bot.js             # Arquivo principal
│   ├── commands/          # Comandos slash (/)
│   ├── features/          # Sistemas (pontos, proteções, etc)
│   └── services/          # Lógica de negócio
├── prisma/                # Configuração do banco de dados
│   ├── schema.prisma      # Estrutura das tabelas
│   └── migrations/        # Histórico de mudanças no banco
├── data/                  # Banco de dados SQLite (criado automaticamente)
├── docker-compose.yml     # Configuração do Docker
├── Dockerfile             # Receita para construir a imagem
├── .env                   # Suas credenciais (NÃO COMITE!)
└── .env.example           # Exemplo de credenciais
```

---

## 🔄 Atualizando o Bot

### 1. **Parar o bot**
```bash
docker compose down
```

### 2. **Baixar atualizações**
```bash
git pull origin main
```
(Ou baixe o ZIP novamente e substitua os arquivos)

### 3. **Atualizar banco de dados** (se houver novas migrações)
```bash
docker compose run --rm bot npx prisma migrate deploy
```

### 4. **Reconstruir e iniciar**
```bash
docker compose up -d --build
```

---

## 🛡️ Segurança

### ⚠️ NUNCA faça isso:
- ❌ Compartilhar seu arquivo `.env`
- ❌ Comitar (enviar para Git) o arquivo `.env`
- ❌ Mostrar seu TOKEN em prints/vídeos
- ❌ Compartilhar o arquivo `data/dev.db` (contém dados sensíveis)

### ✅ Boas práticas:
- ✅ Use `.gitignore` (já configurado para ignorar `.env` e `data/`)
- ✅ Se o token vazar, regenere imediatamente no Discord Developer Portal
- ✅ Faça backup da pasta `data/` periodicamente

---

## 📚 Links Úteis

- **Discord.js Documentação**: https://discord.js.org/
- **Docker Documentação**: https://docs.docker.com/
- **Prisma Documentação**: https://www.prisma.io/docs
- **Git Tutorial**: https://git-scm.com/book/pt-br/v2

---

## 💬 Precisa de Ajuda?

1. Verifique a seção [Solução de Problemas](#-solução-de-problemas)
2. Leia o `README.md` do projeto
3. Verifique os logs: `docker compose logs -f bot`
4. Abra uma issue no GitHub (se aplicável)

---

## ✅ Checklist Final

Antes de executar, certifique-se de que:

- [ ] Docker e Docker Compose estão instalados
- [ ] Arquivo `.env` foi criado e preenchido corretamente
- [ ] `DISCORD_TOKEN` está correto e não vazou
- [ ] `DEV_GUILD_ID` corresponde ao seu servidor de teste
- [ ] Pasta `data/` foi criada
- [ ] Migrações foram executadas (`prisma migrate deploy`)
- [ ] Bot foi convidado para o servidor com permissões corretas

---

**🎉 Parabéns! Seu bot está rodando com Docker!**

Se tudo funcionou, você verá o bot online no Discord e poderá usar os comandos slash (`/`).
