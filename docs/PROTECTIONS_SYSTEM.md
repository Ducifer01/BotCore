# 📚 Sistema de Proteções - Documentação Técnica

## 📋 Visão Geral

Sistema completo de proteção contra ações maliciosas no servidor Discord, com 11 módulos independentes, sistema de backup/restore e whitelist hierárquica (global + per-module).

**Arquivos principais:**
- `src/features/protections.js` (1446 linhas) - UI/handlers
- `src/services/protectionsConfig.js` - Configuração e defaults
- `src/services/backups.js` - CRUD de backups
- `src/services/snapshots.js` - Snapshots de canais

---

## 🛡️ Módulos de Proteção

### 1. **antiRoleHierarchy**
Protege contra edição de cargos acima de cargo limite.

**Configurações:**
- `limitRoleId`: Cargo limite (usuário não pode editar cargos acima deste)
- `protectPermissions`: Bloquear edição de permissões em cargos protegidos
- `preventProtectedRoleGive`: Impedir atribuição de cargos protegidos
- `punishment`: STRIP_ROLES | KICK
- `logChannelId`: Canal para logs
- `whitelistUsers`: Usuários isentos (IDs)
- `whitelistRoles`: Cargos isentos (IDs)

**UI Especial:**
- 3 botões toggle: Ativar/Desativar, Proteger permissões, Anti-set cargos
- RoleSelectMenu para escolha de cargo limite


### 2. **antiBotAdd**
Bloqueia adição de bots não autorizados.

**Configurações:**
- `botAction`: 'KICK' | 'BAN' (ação no bot adicionado)
- `punishment`: STRIP_ROLES | KICK (punição ao membro que adicionou)
- `whitelistUsers`, `whitelistRoles`


### 3. **antiCriticalPerms**
Bloqueia permissões críticas específicas (Administrator, ManageGuild, etc).

**12 Permissões:**
1. Administrator
2. ManageGuild
3. ManageRoles
4. ManageChannels
5. ViewAuditLog
6. ViewGuildInsights
7. ManageWebhooks
8. BanMembers
9. ModerateMembers
10. MuteMembers
11. DeafenMembers
12. MoveMembers

**UI Especial:**
- **Paginação**: 10 perms/página (2 rows x 5 buttons)
- **Toggle individual**: Click em botão alterna bloqueio (Verde = bloqueada, Vermelho = liberada)
- **Navigation**: ◀️ Prev | Whitelist | Voltar módulo | Next ▶️ | Voltar menu
- **Page info button**: "Página 1/2" (disabled, informativo)

**Configurações:**
- `blockedPerms`: Array de permissions bloqueadas
- `whitelistUsers`, `whitelistRoles`


### 4. **antiAlt**
Bloqueia contas muito novas (alt accounts).

**Configurações:**
- `minAccountDays`: Idade mínima em dias (default: 7)
- `punishment`: STRIP_ROLES | KICK
- **Sem whitelist** (proteção universal)

**UI Especial:**
- Modal para editar `minAccountDays` com validação (0-365 dias)


### 5-8. **Mass Actions (massBanKick, massTimeout, massChannelDelete, massRoleDelete)**
Proteção contra ações em massa.

**Configurações (todas iguais):**
- `limit`: `{ count: number, seconds: number }` (ex: 3 ações em 30 segundos)
- `punishment`: STRIP_ROLES | KICK
- `logChannelId`
- **Sem whitelist** (admin global bypass automático)

**UI Especial:**
- Modal "Limite X em Y segundos" com pre-fill de valores atuais
- Validação: count (1-100), seconds (1-3600)


### 9. **blockedRoles**
Bloqueia atribuição de cargos específicos.

**Configurações:**
- `roles`: Array de role IDs bloqueados (máx 25)
- `enabled`: Auto-ativado quando roles selecionadas
- `logChannelId`
- **Sem whitelist**

**UI Especial:**
- RoleSelectMenu com multi-select (1-25 cargos)
- Display: Mentions dos cargos bloqueados no embed


### 10-11. **massDisconnect / massMuteDeafen**
Proteção contra desconexões e mute/deafen em massa.

**Configurações:**
- `limit`: `{ count: 5, seconds: 30 }` (default mais permissivo)
- `punishment`: STRIP_ROLES | KICK
- `logChannelId`

---

## 🌐 Sistema de Whitelist

### Hierarquia
1. **Global Whitelist** → Isenta de TODOS os módulos
2. **Per-Module Whitelist** → Isenta apenas daquele módulo
3. **Admin/Owner bypass** → Sempre isento (hardcoded)

### Implementação
```javascript
// globalConfig.protectionsConfigJson
{
  globalWhitelistUsers: ['userId1', 'userId2'],
  globalWhitelistRoles: ['roleId1', 'roleId2'],
  antiRoleHierarchy: {
    whitelistUsers: ['userId3'],
    whitelistRoles: ['roleId3']
  }
}
```

### UI
- **Whitelist Global**: UserSelectMenu + RoleSelectMenu (0-25 cada)
- **Whitelist Per-Module**: Mesma UI, botão "Editar whitelist" em cada módulo
- **Display**: Contadores "X usuários / Y cargos" no embed

---

## 💾 Sistema de Backup/Restore

### 15 Estados
1. **HOME** - Menu inicial (Criar | Ver backups | Criar parcial)
2. **CREATE_SCOPE** - Escolher escopos (channels, roles)
3. **SELECT_CATEGORY** - Escolher categoria para backup parcial
4. **CREATE_NAME** - Modal para nome do backup
5. **CREATING** - Processando criação
6. **DONE_CREATE** - Backup criado com sucesso
7. **SELECT_BACKUP** - Listar backups com paginação (25/page)
8. **VERIFYING** - Calculando diferenças
9. **SHOW_DIFF** - Exibir diff (missing/changed)
10. **CONFIRM_RESTORE** - Confirmação antes de restaurar
11. **SELECT_RESTORE_SCOPE** - Escolher o que restaurar
12. **RESTORING** - Progresso de restauração
13. **DONE_RESTORE** - Restauração concluída
14. **CONFIRM_DELETE** - Confirmação antes de excluir
15. **DONE_DELETE** - Backup excluído
16. **CANCELLED** - Operação cancelada

### Escopos
```javascript
BACKUP_SCOPES = {
  CHANNELS: 'channels',           // Todos os canais/categorias
  CHANNELS_CATEGORY: 'channels_category', // Apenas 1 categoria
  ROLES: 'roles'                   // Todos os cargos não-managed
}
```

### Fluxo de Criação
```
HOME → CREATE_SCOPE → [SELECT_CATEGORY?] → CREATE_NAME (modal) → CREATING → DONE_CREATE
```

### Fluxo de Restore
```
HOME → SELECT_BACKUP (paginado) → VERIFYING → SHOW_DIFF → 
CONFIRM_RESTORE → [SELECT_RESTORE_SCOPE?] → RESTORING → DONE_RESTORE
```

### Diff System
Compara snapshot vs estado atual:
- **Channels**: name, parent, topic, slowmode, nsfw, bitrate, userLimit, overwrites
- **Roles**: name, color, hoist, mentionable, permissions

Retorna:
```javascript
{
  channels: {
    missing: [...],  // Canais no backup mas não no servidor
    changed: [{ channel, diff: ['name', 'topic'] }]
  },
  roles: {
    missing: [...],
    changed: [{ role, diff: ['permissions'] }]
  }
}
```

### Session Management
```javascript
backupSessions = Map<messageId, {
  state: BACKUP_STATES,
  scopes: [],
  name: '',
  page: 0,
  mode: 'home' | 'create' | 'verify' | 'restore',
  selectedBackupId: null,
  categoryId: null,
  diff: null,
  restoreScopes: [],
  restoreStatus: { stage, total, label, percent, message },
  lastBackup: {...}
}>
```

**Session Key**: `interaction.message.id` ou `interaction.id` (fallback)

### Restore Ordem
1. **Roles primeiro** (para garantir permissions existem)
2. **Categorias** (para garantir parents existem)
3. **Outros canais** (text, voice, etc)

### Progress Tracking
```javascript
await updateUI(stage, scope, message);
// Exibe: "Etapas: 1/2 | Etapa atual: Cargos | Progresso: 50%"
```

---

## 🎨 UI/UX Patterns

### Máquina de Estados
**Princípio**: Uma única mensagem, múltiplos estados via `editReply()`

### Component Limits
- **ActionRow**: Máximo 5 por mensagem
- **Buttons**: Máximo 5 por row
- **SelectMenu**: 1 por row, 25 options/values max

### Padrões de Navegação
```
[Ação Principal] [Ação Secundária]
[SelectMenu para escolha]
[Voltar] [Cancelar]
```

### Defer Strategy
```javascript
// Botões/selects SEM modal: defer imediatamente
await ensureDeferred(interaction);

// Botões COM modal: NÃO defer (showModal primeiro)
if (action === 'limit') {
  await interaction.showModal(modal); // Sem defer
  return true;
}
```

### Modals Pre-fill
```javascript
const currentCount = moduleState?.limit?.count;
new TextInputBuilder()
  .setValue(currentCount != null ? String(currentCount) : '')
```

### Error Handling
```javascript
try {
  // handler logic
} catch (error) {
  console.error('[protections] Erro:', error);
  await interaction.followUp({ 
    content: '❌ Erro ao processar. Tente novamente.', 
    ephemeral: true 
  }).catch(() => {});
  return false;
}
```

---

## 🔧 Funções Principais

### `buildModuleEmbed(module, cfg)`
Constrói embed dinâmico com fields baseados em features do módulo.

**Returns**: `EmbedBuilder` com cor verde (ativado) ou azul (desativado)


### `buildModuleComponents(module, cfg, opts = {})`
Constrói ActionRows com botões/selects baseados em features.

**Special cases**:
- `antiCriticalPerms`: Paginação 10 perms/page
- `antiRoleHierarchy`: 3 toggles + RoleSelectMenu
- `blockedRoles`: RoleSelectMenu multi-select

**Returns**: `Array<ActionRowBuilder>` (máx 5)


### `parseIntSafe(val, fallback, options = {})`
Parse seguro de inteiros com validação de range.

```javascript
parseIntSafe('15', 7, { min: 1, max: 365 })
// Returns: 15
parseIntSafe('abc', 7, { min: 1, max: 365 })
// Returns: 7 (fallback)
parseIntSafe('999', 7, { min: 1, max: 365 })
// Returns: 365 (clamped to max)
```


### `ensureDeferred(interaction)`
Garante que interação foi "deferred" antes de operações longas.

```javascript
if (isComponent(interaction) && !interaction.deferred && !interaction.replied) {
  await interaction.deferUpdate();
}
```


### `respond(interaction, payload)`
Responde interação de forma inteligente (reply, editReply, update, edit).


### `runRestore(backupId, scopes, backup)`
Executa restore com progress tracking e error recovery.

**Returns**: `{ backup, result: { channels: {created, updated}, roles: {created, updated} } }`


### `handleBackupInteraction(interaction, prisma)`
Router principal para todas as interações de backup (buttons, selects, modals).

**Actions**: home, cancel, start, scope, next, back, create, page, select, restore, confirm, delete, etc


### `handleButton(interaction, prisma)`
Handler de botões: toggle, punish, limit (modal), whitelist, protect perms, block perm toggle, pagination


### `handleSelect(interaction, prisma)`
Handler de selects: módulos, whitelist (global/local), log channel, blocked roles, role limit


### `handleModal(interaction, prisma)`
Handler de modals: limit, whitelist (deprecated), mindays, backup name

---

## 📊 Estatísticas

- **Linhas de código**: 1446 (protections.js)
- **Módulos**: 11
- **Estados de backup**: 15
- **Permissões críticas**: 12
- **Max components por UI**: 5 ActionRows
- **Max items em select**: 25
- **Max characters em modal**: ~4000/field

---

## 🧪 Testes Recomendados

### Módulos
1. **antiRoleHierarchy**: Criar cargo limite, testar toggles, whitelist
2. **antiCriticalPerms**: Navegar páginas (1/2), toggle permissions
3. **antiAlt**: Editar dias mínimos (modal), testar validação
4. **Mass actions**: Editar limites (modal), testar X/Y display
5. **blockedRoles**: Selecionar múltiplos cargos, verificar auto-enable

### Backup/Restore
1. **Criar backup completo** (channels + roles)
2. **Criar backup parcial** (1 categoria)
3. **Ver backups** (paginação se >25)
4. **Verificar diff** (SHOW_DIFF state)
5. **Restaurar completo** (ambos scopes)
6. **Restaurar parcial** (SELECT_RESTORE_SCOPE)
7. **Excluir backup** (CONFIRM_DELETE)
8. **Cancelar operações** (CANCELLED state)

### Whitelist
1. **Global whitelist**: Adicionar users/roles, testar em múltiplos módulos
2. **Per-module whitelist**: Adicionar em módulo específico
3. **Hierarquia**: Verificar que global > per-module

### Error Handling
1. **Modal vazio**: Submeter sem preencher campos
2. **Valores inválidos**: Letras em campos numéricos
3. **Ranges**: Números negativos, > max
4. **Canais deletados**: Tentar restaurar backup com canais inexistentes

---

## 🚀 Melhorias Futuras (Opcional)

1. **Backup agendado**: Cronjob diário
2. **Backup incremental**: Apenas mudanças desde último backup
3. **Compression**: Gzip do payload JSON
4. **Export/Import**: Download de backup como arquivo
5. **Rollback rápido**: "Desfazer última restauração"
6. **Audit log parsing**: Detectar quem fez ações maliciosas
7. **Notificações DM**: Avisar admins de ações bloqueadas
8. **Dashboard web**: UI externa para gerenciar proteções

---

## 📝 Notas Importantes

- **Sempre usar defer**: Operações >3s causam timeout
- **Session única**: backupSession por messageId (não por userId)
- **Array.slice(0, 25)**: Discord limit em selects
- **Set para toggles**: Evita duplicatas em blockedPerms/roles
- **Restore order**: Roles → Categorias → Canais (dependências)
- **Error logs**: `console.error('[backup] ...')` para debug
- **Ephemeral messages**: Erros sempre ephemeral para não poluir chat

---

**Última atualização**: 2025-01-09  
**Versão**: 2.0 (Refatoração completa)
