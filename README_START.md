# 🚀 Guia Rápido de Inicialização

Este guia complementa o `README.md` oficial com um passo a passo enxuto para colocar o bot em funcionamento o mais rápido possível, tanto com Docker quanto em execução direta no host.

## 1. Pré-requisitos

- **Git** instalado.
- **Docker** (e Docker Compose v2) para seguir o caminho containerizado.
- **Node.js 20+** e **npm** caso deseje rodar localmente sem Docker.
- Token/Client ID do bot, guild de desenvolvimento e demais chaves preenchidas em `.env`.

---

## 2. Clonar o repositório

```powershell
# Windows PowerShell
cd C:\pasta\onde\quer\salvar
git clone https://github.com/Ducifer01/BotCore.git
cd BotCore
```

No Linux/macOS basta adaptar o caminho final:

```bash
cd ~/projetos
git clone https://github.com/Ducifer01/BotCore.git
cd BotCore
```

Crie seu `.env` (copie de `.env.example`) antes de iniciar qualquer modo.

---

## 3. Executar com Docker (recomendado para produção)

### 3.1 Preparar o ambiente

```powershell
# Criar pasta de dados persistente
mkdir data
# (Opcional) Copiar banco existente
copy prisma\dev.db data\dev.db
```

> No Linux: `mkdir -p data && cp prisma/dev.db data/dev.db`

### 3.2 Build e dependências

```powershell
docker compose down
# Build completo sem cache
docker compose build --no-cache
# Instalar dependências e gerar Prisma dentro do container
docker compose run --rm bot npm ci --only=production
docker compose run --rm bot npx prisma generate
docker compose run --rm bot npx prisma migrate deploy
```

### 3.3 Subir/parar/observar

```powershell
# Subir em segundo plano
docker compose up -d
# Ver logs em tempo real
docker compose logs -f bot
# Parar tudo
docker compose down
```

### 3.4 Comandos básicos de Docker

| Comando | O que faz |
| --- | --- |
| `docker compose build` | Constrói a imagem usando o `Dockerfile`. |
| `docker compose up -d` | Cria/inicia containers em background. |
| `docker compose down` | Para e remove containers, rede e volumes anônimos. |
| `docker compose logs -f bot` | Segue os logs do serviço `bot`. |
| `docker compose run --rm bot <comando>` | Executa um comando pontual dentro do serviço e remove o container temporário. |

**Benefícios do Docker**
- Ambiente padronizado (Node, OpenSSL, Prisma) independente do host.
- Atualizações/Rebuild reproduzíveis com um único comando.
- Volume `./data` preserva o SQLite entre reinícios do container.
- Facilita deploy em servidores limpos (basta instalar Docker/Compose).

---

## 4. Executar localmente (sem Docker)

### 4.1 Instalar dependências

```powershell
npm install
```

### 4.2 Banco de dados com Prisma

```powershell
npm run prisma:generate
npm run prisma:migrate
```

### 4.3 Rodar bot

```powershell
npm run dev
```

> Para produção fora do Docker, prefira `npm run start` (necessita build/config conforme seu processo).

### 4.4 Scripts úteis

| Script | Descrição |
| --- | --- |
| `npm run prisma:generate` | Gera o cliente Prisma. |
| `npm run prisma:migrate` | Aplica migrações locais em modo interativo. |
| `npm run dev` | Inicia o bot com nodemon (hot reload). |
| `npm run start` | Inicia o bot com Node puro (ideal para produção). |
| `npm run commands:deploy` | Sincroniza slash commands manualmente. |
| `npm run commands:cleanup` | Limpa comandos antigos (global ou guild). |

---

## 5. Troubleshooting rápido

- **Erro `Unable to open the database file`**: verifique se `./data/dev.db` existe no host e tem permissão de escrita; sincronize o caminho com `DATABASE_URL`.
- **Erro de engines Prisma**: confirme que o build usa `node:20-bookworm-slim` (ou superior) e que `binaryTargets` em `schema.prisma` contém `"debian-openssl-3.0.x"`.
- **Aviso `@discordjs/voice`**: recomenda-se usar Node 22+ ao habilitar recursos avançados de voz.

---

## 6. Fluxo sugerido para atualizações em produção

1. **Pull** do repositório: `git pull`.
2. **Build** e dependências:
   ```bash
   docker compose build
   docker compose run --rm bot npm ci --only=production
   docker compose run --rm bot npx prisma migrate deploy
   ```
3. **Restart controlado**:
   ```bash
   docker compose up -d
   docker compose logs -f bot
   ```
4. **Rollback rápido**: mantenha a imagem anterior (tag como `bot-manutencao:previous`) e troque em `docker-compose.yml` caso precise reverter.

---

## 7. Checklist final

- [ ] `.env` preenchido com tokens/IDs corretos.
- [ ] `./data/dev.db` criado/copied antes do deploy Docker.
- [ ] Prisma gerado/migrado dentro do ambiente onde o bot roda.
- [ ] `CLEAR_GLOBAL_COMMANDS=true` apenas quando quiser limpar comandos antigos (desligue depois para evitar delays).
- [ ] Logs monitorados após cada deploy (`docker compose logs -f bot`).

Siga este guia sempre que precisar preparar máquinas novas ou entregar a outra pessoa. Para detalhes sobre cada funcionalidade do bot, consulte o `README.md` completo.
