# Frontend Guide — Usuários, Grupos e Roles

> **Para:** Time de Frontend
> **Status da API:** Implementado e disponível
> **Base URL (local):** `http://localhost:3015/api/v1`
> **Base URL (prod):** `https://gcdr-server.apps.myio-bas.com/api/v1`
> **Auth:** Todas as rotas exigem `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`

---

## 1. Visão Geral do Modelo

```
customers (hierarquia)
    └── users  (1 user → 1 customer)
          └── role_assignments  (N roles por user, com scope)
                └── roles
                      └── policies[]  (JSONB de permissões)

customers
    └── groups  (pertence a 1 customer)
          └── members[]  (JSONB: users, devices ou assets)
```

Três conceitos independentes que o frontend precisa gerenciar:

| Conceito | O que define | Onde está no banco |
|---|---|---|
| **Perfil do usuário** | Quem é (nome, email, cargo, preferências) | `users.profile`, `users.preferences` |
| **Role Assignment** | O que pode fazer (permissões via role + scope) | tabela `role_assignments` |
| **Group** | Agrupamento lógico para notificações, escalação, acesso | tabela `groups`, membros em JSONB |

---

## 2. Usuário

### 2.1 Tipos de usuário

| type | customerId | Quem é |
|---|---|---|
| `CUSTOMER` | preenchido | Operador/gestor do customer final |
| `INTERNAL` | `null` | Funcionário MYIO |
| `PARTNER` | `null` | Parceiro de integração (usa `partnerId`) |
| `SERVICE_ACCOUNT` | opcional | Conta técnica M2M |

### 2.2 Status e ciclo de vida

```
UNVERIFIED  ──email verificado──▶  PENDING_APPROVAL  ──aprovado──▶  ACTIVE
                                                      ──rejeitado──▶  INACTIVE

ACTIVE  ──desativado──▶  INACTIVE
ACTIVE  ──muitas tentativas de login──▶  LOCKED
```

### 2.3 Perfil (campos JSONB)

O perfil de um usuário é dividido em três objetos:

#### `profile` — dados pessoais

```ts
{
  firstName:    string
  lastName:     string
  displayName?: string
  avatarUrl?:   string
  phone?:       string
  phoneVerified?: boolean
  department?:  string      // ex: "TI", "Manutenção"
  jobTitle?:    string      // ex: "Técnico de Campo"
  bio?:         string
}
```

#### `preferences` — configurações do usuário

```ts
{
  language:    string        // "pt-BR"
  timezone:    string        // "America/Sao_Paulo"
  dateFormat:  string        // "DD/MM/YYYY"
  timeFormat:  '12h' | '24h'
  theme:       'light' | 'dark' | 'system'
  notifications: {
    email:  boolean
    push:   boolean
    sms:    boolean
    inApp:  boolean
  }
  dashboardLayout?: Record<string, unknown>  // configuração de widgets
}
```

#### `security` — **nunca expor ao frontend**

Contém `passwordHash`, tokens de reset, dados de MFA, histórico de login e lockout.
A API nunca retorna este campo em respostas públicas.

### 2.4 Endpoints de usuário

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/users` | Lista usuários do tenant |
| `GET` | `/users/:id` | Detalhe do usuário |
| `POST` | `/users` | Cria usuário |
| `PUT` | `/users/:id` | Atualiza usuário |
| `DELETE` | `/users/:id` | Remove usuário |
| `PATCH` | `/users/:id/status` | Muda status (approve, reject, lock, unlock) |
| `GET` | `/customers/:id/users` | Lista usuários de um customer |
| `GET` | `/authorization/users/:id/assignments` | Lista roles do usuário |

---

## 3. Roles e Permissões (RBAC)

### 3.1 Estrutura

```
Role
  ├── key           string único por tenant  (ex: "operator", "admin")
  ├── displayName   string  (ex: "Operador de Manutenção")
  ├── policies      string[]  → lista de policy keys
  ├── riskLevel     low | medium | high | critical
  └── isSystem      boolean  (roles do sistema não são editáveis)

Policy
  ├── key           string único por tenant
  ├── allow         string[]  → permissões concedidas
  ├── deny          string[]  → permissões bloqueadas (DENY vence ALLOW)
  └── conditions    { requiresMFA, onlyBusinessHours, ipAllowlist, ... }
```

### 3.2 Formato de permissão

```
{domínio}.{função}.{ação}

Exemplos:
  energy.dashboard.read
  alarms.rules.write
  users.profile.update
  devices.*.*           ← wildcard: tudo em devices
  *.*.*                 ← super admin
```

### 3.3 Role Assignment — vinculando role ao usuário

O vínculo **user → role** não fica no cadastro do usuário. Fica em `role_assignments`:

```ts
{
  userId:    string     // quem recebe a role
  roleKey:   string     // qual role (ex: "operator")
  scope:     string     // onde essa role vale (ver seção 3.4)
  status:    'active' | 'inactive' | 'expired'
  expiresAt?: string    // optional — role com prazo
  reason?:   string     // justificativa do grant
  grantedBy: string     // userId de quem concedeu
  grantedAt: string
}
```

Um usuário pode ter **múltiplas assignments** — cada uma com scope diferente:

```
userId=carlos
  ├── role=viewer   scope=*                       → vê tudo no tenant
  ├── role=operator scope=customer:e04046d4-...   → opera só no Mestre Álvaro
  └── role=admin    scope=customer:84e0370e-...   → admin no Moxuara
```

### 3.4 Scope — onde a role vale

| Scope | Formato | Significa |
|---|---|---|
| Global | `*` | Todos os recursos do tenant |
| Customer | `customer:{uuid}` | Esse customer e todos os filhos |
| Asset | `asset:{uuid}` | Apenas esse asset |
| Device | `device:{uuid}` | Apenas esse device |

**Herança de scope:** uma role com `scope=customer:empresaX` automaticamente vale para todos os customers filhos, assets e devices abaixo de `empresaX`.

```
scope=customer:holding-uuid
  └── vale para company1, company2 e todos os seus assets e devices
```

### 3.5 Endpoints de autorização

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/roles` | Lista roles do tenant |
| `POST` | `/roles` | Cria role customizada |
| `PUT` | `/roles/:id` | Atualiza role |
| `DELETE` | `/roles/:id` | Remove role (se não for system) |
| `GET` | `/policies` | Lista policies do tenant |
| `POST` | `/policies` | Cria policy |
| `POST` | `/authorization/assignments` | Atribui role a usuário |
| `DELETE` | `/authorization/assignments/:id` | Revoga assignment |
| `GET` | `/authorization/assignments` | Lista assignments (filtrar por scope) |
| `GET` | `/authorization/users/:userId/assignments` | Roles de um usuário específico |
| `POST` | `/authorization/evaluate` | Verifica se user tem permissão |
| `POST` | `/authorization/evaluate/batch` | Verifica múltiplas permissões de uma vez |

### 3.6 Exemplos de chamadas

**Atribuir role a um usuário:**
```http
POST /api/v1/authorization/assignments
{
  "userId":  "f2a1b3c4-...",
  "roleKey": "operator",
  "scope":   "customer:e04046d4-baa4-44e9-a378-4dfebe4140f1",
  "reason":  "Operador de campo Mestre Álvaro"
}
```

**Verificar se usuário pode fazer algo:**
```http
POST /api/v1/authorization/evaluate
{
  "userId":        "f2a1b3c4-...",
  "permission":    "alarms.rules.write",
  "resourceScope": "customer:e04046d4-baa4-44e9-a378-4dfebe4140f1"
}
```
Resposta: `{ "allowed": true, "reason": "Granted via role 'operator'" }`

**Verificar múltiplas permissões de uma vez (UI de menu/botões):**
```http
POST /api/v1/authorization/evaluate/batch
{
  "userId":        "f2a1b3c4-...",
  "resourceScope": "customer:e04046d4-...",
  "permissions": [
    "alarms.rules.read",
    "alarms.rules.write",
    "devices.data.export"
  ]
}
```

---

## 4. Grupos

### 4.1 O que é um grupo

Um grupo pertence a **um customer** e pode agrupar usuários, devices ou assets para um propósito específico.

```ts
Group {
  customerId: string        // customer dono do grupo
  type:       GroupType     // USER | DEVICE | ASSET | MIXED
  purposes:   GroupPurpose[]
  members:    GroupMember[] // JSONB — lista embutida
  memberCount: number       // denormalizado
  hierarchy?:  GroupHierarchy  // grupos podem ser aninhados
  notificationSettings?: GroupNotificationSettings
  visibleToChildCustomers: boolean
  editableByChildCustomers: boolean
}
```

### 4.2 Tipos de grupo (`type`)

| type | Pode conter |
|---|---|
| `USER` | Apenas usuários |
| `DEVICE` | Apenas devices |
| `ASSET` | Apenas assets |
| `MIXED` | Qualquer combinação |

### 4.3 Propósitos (`purposes`)

Um grupo pode ter múltiplos propósitos simultaneamente:

| purpose | Uso |
|---|---|
| `NOTIFICATION` | Lista de destinatários de alarmes/notificações |
| `ESCALATION` | Cadeia de escalonamento (quem acionar se não responder) |
| `ACCESS_CONTROL` | Controle de acesso a recursos |
| `REPORTING` | Agrupamento para relatórios |
| `MAINTENANCE` | Agenda de manutenção |
| `MONITORING` | Dashboard de monitoramento |
| `CUSTOM` | Uso livre |

### 4.4 Membros (GroupMember)

```ts
GroupMember {
  id:        string                   // UUID do user/device/asset
  type:      'USER' | 'DEVICE' | 'ASSET'
  name?:     string                   // denormalizado para display
  addedAt:   string
  addedBy?:  string
  metadata?: Record<string, unknown>
}
```

> **Atenção:** membros ficam em JSONB dentro da tabela `groups`. Não há FK — não há integridade referencial automática. Se um usuário for deletado, ele **não sai** automaticamente dos grupos.

### 4.5 Configuração de notificação (`notificationSettings`)

Quando `purposes` inclui `NOTIFICATION` ou `ESCALATION`:

```ts
{
  channels: [
    { type: 'EMAIL',    enabled: true  },
    { type: 'SMS',      enabled: false },
    { type: 'WEBHOOK',  enabled: true, config: { url: "https://..." } },
    { type: 'SLACK',    enabled: false },
    { type: 'TELEGRAM', enabled: false }
  ],
  schedule: {
    timezone: "America/Sao_Paulo",
    quietHours: {
      start: "22:00",
      end:   "07:00",
      days:  [0, 6]    // 0=domingo, 6=sábado
    },
    businessHoursOnly: false
  },
  escalationDelayMinutes: 15,
  digestEnabled:          false
}
```

### 4.6 Endpoints de grupos

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/groups` | Lista grupos do tenant |
| `POST` | `/groups` | Cria grupo |
| `GET` | `/groups/:id` | Detalhe do grupo |
| `PUT` | `/groups/:id` | Atualiza grupo |
| `DELETE` | `/groups/:id` | Remove grupo (soft delete) |
| `POST` | `/groups/:id/members` | Adiciona membros |
| `DELETE` | `/groups/:id/members` | Remove membros |
| `GET` | `/customers/:id/groups` | Grupos de um customer |
| `POST` | `/groups/:id/move` | Move grupo para outro pai (hierarquia) |

### 4.7 Exemplos de chamadas

**Criar grupo de notificação para Mestre Álvaro:**
```http
POST /api/v1/groups
{
  "customerId":  "e04046d4-baa4-44e9-a378-4dfebe4140f1",
  "name":        "Supervisores de Manutenção",
  "displayName": "Supervisores de Manutenção",
  "type":        "USER",
  "purposes":    ["NOTIFICATION", "ESCALATION"],
  "notificationSettings": {
    "channels": [
      { "type": "EMAIL", "enabled": true },
      { "type": "SMS",   "enabled": true }
    ],
    "escalationDelayMinutes": 10
  }
}
```

**Adicionar membros ao grupo:**
```http
POST /api/v1/groups/:groupId/members
{
  "members": [
    { "id": "user-uuid-1", "type": "USER", "name": "Carlos Ferreira" },
    { "id": "user-uuid-2", "type": "USER", "name": "Ana Souza" }
  ]
}
```

**Listar grupos que um usuário pertence:**
```http
GET /api/v1/groups?memberId=user-uuid&memberType=USER
```

---

## 5. Padrões de Interface

### Tela de cadastro de usuário

1. `POST /users` → cria o usuário
2. `POST /authorization/assignments` → atribui a role inicial com o scope do customer

### Tela de perfil / preferências

- Exibir `user.profile` (nome, cargo, departamento, avatar)
- Exibir `user.preferences` (idioma, timezone, notificações)
- `PUT /users/:id` para salvar alterações

### Tela de permissões de usuário

1. `GET /authorization/users/:userId/assignments` → lista roles atuais
2. `GET /roles` → opções disponíveis para o seletor
3. `POST /authorization/assignments` → atribuir
4. `DELETE /authorization/assignments/:id` → revogar

### Tela de grupos de um customer

1. `GET /customers/:id/groups` → lista grupos
2. Para cada grupo, exibe `type`, `purposes`, `memberCount`
3. `POST /groups/:id/members` / `DELETE /groups/:id/members` → gerenciar membros

### Checar permissões para habilitar/desabilitar botões na UI

```ts
// Verificar múltiplas permissões de uma vez, no carregamento da página
const { data } = await api.post('/authorization/evaluate/batch', {
  userId: currentUser.id,
  resourceScope: `customer:${customerId}`,
  permissions: ['alarms.rules.write', 'devices.config.write', 'users.invite.create']
});

// data.results = { 'alarms.rules.write': true, 'devices.config.write': false, ... }
const canEditAlarms  = data.results['alarms.rules.write'];
const canConfigDevice = data.results['devices.config.write'];
```

---

## 6. Resumo das Relações

```
users
  ├── customerId ──────────────────────────▶ customers
  ├── profile    { firstName, lastName, jobTitle, ... }
  ├── preferences { language, timezone, notifications, ... }
  └── id ─────────────────────┐
                               ▼
                        role_assignments
                          ├── roleKey ───▶ roles ──▶ policies ──▶ permissions
                          └── scope       ("*" | "customer:uuid" | "asset:uuid" | "device:uuid")

groups
  ├── customerId ──────────────────────────▶ customers
  ├── type        USER | DEVICE | ASSET | MIXED
  ├── purposes    NOTIFICATION | ESCALATION | ACCESS_CONTROL | ...
  └── members[]   [{ id, type: USER|DEVICE|ASSET, name, addedAt }]  ← JSONB, sem FK
```

> **Ponto de atenção:** não existe endpoint de "usuários de um grupo" direto — a busca
> é feita via `GET /groups?memberId=uuid&memberType=USER`, que escaneia os JSONB.
> Para grupos grandes, prefira manter o `memberCount` visível na listagem e carregar
> os membros individualmente apenas na tela de detalhe do grupo.
