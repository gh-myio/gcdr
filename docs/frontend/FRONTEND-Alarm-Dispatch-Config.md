# FRONTEND — Alarm Dispatch Configuration (RFC-0024)

Guia de integração frontend para o sistema de despacho de notificações de alarme em dois níveis.
Baseado em: [RFC-0024](./RFC-0024-Alarm-Dispatch-Config.md)

---

## Visão Geral

O dispatch de alarmes opera em três camadas ortogonais:

```
LAYER 1 — Customer Channel Registry
  "O customer tem EMAIL_RELAY configurado e ativo globalmente?"

LAYER 2 — Group Dispatch Matrix
  "Para o Grupo A, EMAIL_RELAY dispara em eventos OPEN?"

LAYER 3 — Rule Notifications
  "Para esta rule específica, quem são os destinatários de eventos OPEN?"
```

Uma notificação é enviada **somente quando todas as três camadas estão ativas**.

---

## Autenticação

Todos os endpoints exigem JWT Bearer:

```
Authorization: Bearer <jwt>
X-Tenant-Id: <tenantId>
```

---

## Parte 1 — Customer Channels

### `GET /api/v1/customers/:customerId/channels`

Lista todos os canais de despacho configurados para o customer.

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id":         "a1b2c3d4-...",
        "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
        "channel":    "EMAIL_RELAY",
        "active":     true,
        "config": {
          "host":        "smtp.office365.com",
          "port":        587,
          "secure":      false,
          "user":        "alertas@moxuara.com.br",
          "from":        "Alertas MYIO <alertas@moxuara.com.br>",
          "displayName": "Alertas MYIO"
        },
        "createdAt": "2026-03-12T15:00:00.000Z",
        "updatedAt": "2026-03-12T15:00:00.000Z"
      },
      {
        "id":         "b2c3d4e5-...",
        "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
        "channel":    "TELEGRAM",
        "active":     true,
        "config": {
          "botToken":      "7123456789:AAF...",
          "defaultChatId": "-100123456789"
        },
        "createdAt": "2026-03-12T15:01:00.000Z",
        "updatedAt": "2026-03-12T15:01:00.000Z"
      },
      {
        "id":         "c3d4e5f6-...",
        "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
        "channel":    "WHATSAPP",
        "active":     false,
        "config": {
          "apiUrl":    "https://api.z-api.io/instances/XXX/token/YYY",
          "apiToken":  "bearer-token",
          "fromNumber": "+5531900000000"
        },
        "createdAt": "2026-03-12T15:02:00.000Z",
        "updatedAt": "2026-03-12T15:02:00.000Z"
      }
    ],
    "count": 3
  }
}
```

---

### `POST /api/v1/customers/:customerId/channels`

Adiciona um novo canal ao customer.

#### Request Body

```json
{
  "channel": "EMAIL_RELAY",
  "active":  true,
  "config": {
    "host":        "smtp.office365.com",
    "port":        587,
    "secure":      false,
    "user":        "alertas@moxuara.com.br",
    "from":        "Alertas MYIO <alertas@moxuara.com.br>",
    "displayName": "Alertas MYIO"
  }
}
```

#### Campos do `channel`

| Valor | Campos esperados em `config` |
|-------|------------------------------|
| `EMAIL_RELAY` | `host`, `port`, `secure`, `user`, `from`, `displayName` |
| `TELEGRAM` | `botToken`, `defaultChatId` |
| `WHATSAPP` | `apiUrl`, `apiToken`, `fromNumber` |
| `WEBHOOK` | `url`, `method`, `headers`, `secret` |
| `SMS` | `provider`, `apiKey`, `fromNumber` |
| `SLACK` | `webhookUrl`, `defaultChannel` |
| `TEAMS` | `webhookUrl` |
| `CUSTOM` | livre |

#### Response `201 Created`

```json
{
  "success": true,
  "data": {
    "id":         "a1b2c3d4-...",
    "customerId": "84e0370e-...",
    "channel":    "EMAIL_RELAY",
    "active":     true,
    "config":     { "..." },
    "createdAt":  "2026-03-12T15:00:00.000Z",
    "updatedAt":  "2026-03-12T15:00:00.000Z"
  }
}
```

#### Erros

```json
// 409 — canal já existe para este customer
{
  "success": false,
  "error": { "code": "CONFLICT", "message": "Channel \"EMAIL_RELAY\" already exists for this customer" }
}

// 404 — customer não encontrado
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Customer \"84e0370e-...\" not found" }
}
```

---

### `PATCH /api/v1/customers/:customerId/channels/:channelId`

Atualiza o `active` (kill switch global) e/ou `config` de um canal.

#### Request Body

```json
{
  "active": false
}
```

ou

```json
{
  "config": {
    "botToken": "novo-token",
    "defaultChatId": "-100123456789"
  }
}
```

#### Response `200 OK` — objeto canal atualizado.

---

### `DELETE /api/v1/customers/:customerId/channels/:channelId`

Remove o canal. Retorna `204 No Content`.

---

## Parte 2 — Group Dispatch Matrix

### `GET /api/v1/groups/:groupId/dispatch`

Retorna a matriz completa `canal × ação × ativo` de um grupo.

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "OPEN",          "active": true },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "ACK",           "active": true },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "ESCALATE",      "active": true },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "SNOOZE",        "active": false },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "CLOSE",         "active": true },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "EMAIL_RELAY", "action": "STATE_HISTORY", "active": false },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "TELEGRAM",    "action": "OPEN",          "active": true },
      { "id": "...", "groupId": "grp-operacoes-uuid", "channel": "TELEGRAM",    "action": "ESCALATE",      "active": true }
    ],
    "count": 8
  }
}
```

---

### `PUT /api/v1/groups/:groupId/dispatch`

**Substitui toda a matriz** do grupo (operação idempotente — DELETE + INSERT).

Use para salvar o estado completo de uma tela de configuração de dispatch.

#### Request Body

```json
{
  "entries": [
    { "channel": "EMAIL_RELAY", "action": "OPEN",          "active": true  },
    { "channel": "EMAIL_RELAY", "action": "ACK",           "active": true  },
    { "channel": "EMAIL_RELAY", "action": "ESCALATE",      "active": true  },
    { "channel": "EMAIL_RELAY", "action": "SNOOZE",        "active": false },
    { "channel": "EMAIL_RELAY", "action": "CLOSE",         "active": true  },
    { "channel": "EMAIL_RELAY", "action": "STATE_HISTORY", "active": false },
    { "channel": "TELEGRAM",    "action": "OPEN",          "active": true  },
    { "channel": "TELEGRAM",    "action": "ESCALATE",      "active": true  }
  ]
}
```

#### Response `200 OK` — array de entradas salvas.

---

### `PATCH /api/v1/groups/:groupId/dispatch`

Atualiza pontualmente entradas específicas (sem apagar as demais).

#### Request Body

```json
{
  "entries": [
    { "channel": "TELEGRAM", "action": "OPEN", "active": false }
  ]
}
```

#### Response `200 OK` — array das entradas modificadas.

---

## Parte 3 — Rule Notifications (aba Notifications da rule)

O campo `notifications` na rule agora é um mapa keyed por `AlarmAction`.

### Estrutura

```json
{
  "OPEN": {
    "enabled": true,
    "recipients": [
      {
        "sourceType": "GROUP",
        "groupId":    "grp-operacoes-uuid",
        "name":       "Operações"
      },
      {
        "sourceType": "USER",
        "userId":     "usr-supervisor-uuid",
        "name":       "Ana Lima",
        "email":      "ana@moxuara.com.br"
      },
      {
        "sourceType":     "MANUAL",
        "name":           "Carlos Terceirizado",
        "channel":        "WHATSAPP",
        "whatsappNumber": "+5531988880000"
      }
    ]
  },
  "ESCALATE": {
    "enabled": true,
    "recipients": [
      { "sourceType": "GROUP", "groupId": "grp-gerencia-uuid", "name": "Gerência" },
      { "sourceType": "MANUAL", "name": "Planta Manager", "channel": "EMAIL", "email": "manager@moxuara.com" }
    ]
  },
  "ACK":           { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid", "name": "Operações" }] },
  "SNOOZE":        { "enabled": false, "recipients": [] },
  "CLOSE":         { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid", "name": "Operações" }] },
  "STATE_HISTORY": { "enabled": false, "recipients": [] }
}
```

### Tipos de destinatários

| `sourceType` | Campos obrigatórios | Descrição |
|--------------|---------------------|-----------|
| `USER` | `userId`, `name` | Usuário do customer — dados pré-preenchidos da listagem de users |
| `GROUP` | `groupId`, `name` | Referência a um grupo — membros expandidos no momento do disparo |
| `MANUAL` | `name`, `channel` + campo do canal | Contato externo sem conta no sistema |

**Campos por `channel` em `MANUAL`:**

| `channel` | Campo adicional | Exemplo |
|-----------|-----------------|---------|
| `EMAIL` | `email` | `"ops@cliente.com"` |
| `TELEGRAM` | `telegramHandle` | `"@carlosops"` |
| `WHATSAPP` | `whatsappNumber` | `"+5531988880000"` |

### AlarmActions disponíveis

Use `GET /api/v1/rules/notification-categories` para buscar a lista de actions com labels e ícones:

```json
[
  { "id": "OPEN",          "label": "Alarme Disparado",    "icon": "bell-alert",    "templateType": "EMAIL_ALARM"  },
  { "id": "ACK",           "label": "Alarme Reconhecido",  "icon": "check-circle",  "templateType": "EMAIL_ALARM"  },
  { "id": "ESCALATE",      "label": "Alarme Escalado",     "icon": "arrow-up-circle","templateType": "EMAIL_ALARM" },
  { "id": "SNOOZE",        "label": "Alarme Sonecado",     "icon": "clock",         "templateType": "EMAIL_ALARM"  },
  { "id": "CLOSE",         "label": "Alarme Fechado",      "icon": "x-circle",      "templateType": "EMAIL_ALARM"  },
  { "id": "STATE_HISTORY", "label": "Histórico de Estado", "icon": "chart-bar",     "templateType": "EMAIL_REPORT" }
]
```

---

## UX Sugerida

### Tela: Customer → Aba "Canais de Notificação"

```
Canais de Despacho                        [+ Adicionar Canal]

┌─ EMAIL_RELAY ────────────────────── ● ativo ─ [⚙] [🗑] ─┐
│  smtp.office365.com:587 · alertas@moxuara.com.br         │
└──────────────────────────────────────────────────────────┘

┌─ TELEGRAM ───────────────────────── ● ativo ─ [⚙] [🗑] ─┐
│  Bot token configurado · Chat: -100123456789              │
└──────────────────────────────────────────────────────────┘

┌─ WHATSAPP ───────────────────────── ○ inativo ─ [⚙] [🗑] ┐
│  z-api.io · +5531900000000                                │
└──────────────────────────────────────────────────────────┘
```

O toggle `ativo/inativo` faz `PATCH /customers/:id/channels/:channelId { "active": false }`.

---

### Tela: Group → Aba "Dispatch de Alarmes"

Matriz de checkboxes `canal × ação`. Botão **Salvar** faz `PUT /groups/:id/dispatch` com toda a matriz:

```
                 OPEN   ACK   ESCALATE   SNOOZE   CLOSE   STATE_HISTORY
EMAIL_RELAY       ✓      ✓       ✓         —        ✓          —
TELEGRAM          ✓      —       ✓         —        —          —
WHATSAPP          —      —       —         —        —          —
```

---

### Tela: Rule → Aba "Notificações"

Uma seção expansível por `AlarmAction`. Cada seção tem:
- Toggle `ativo/inativo`
- Lista de destinatários (chip com ícone por tipo)
- Botão `[+ Adicionar destinatário]` que abre o wizard

```
OPEN    [● ativo]
  [👥 Operações]   [👤 Ana Lima]   [📱 Carlos Terceirizado]   [+ Add]

ESCALATE  [● ativo]
  [👥 Gerência]   [✉️ Planta Manager]   [+ Add]

ACK   [● ativo]    SNOOZE  [○ inativo]    CLOSE  [● ativo]    STATE_HISTORY  [○ inativo]
```

#### Wizard "Adicionar Destinatário" (3 passos)

**Passo 1 — Tipo**
```
○ Usuário do sistema   (busca na lista de users do customer)
○ Grupo                (referência — membros expandidos no disparo)
○ Contato manual       (externo, sem conta)
```

**Passo 2 — Detalhes** (apenas para `MANUAL`)
```
Canal:  [ EMAIL ]  [ TELEGRAM ]  [ WHATSAPP ]

→ EMAIL:     Nome completo  +  Endereço de email
→ TELEGRAM:  Nome           +  @handle
→ WHATSAPP:  Nome           +  Número (+CC DDD NNNNN-NNNN)
```

**Passo 3 — Confirmar e salvar**

Salvar chama `PATCH /rules/:id` com o campo `notifications` atualizado.

---

## Fluxo de Configuração Completo

```
1. Customer → Aba "Canais de Notificação"
   POST /customers/:customerId/channels  (criar EMAIL_RELAY, TELEGRAM, etc.)

2. Group → Aba "Dispatch de Alarmes"
   PUT /groups/:groupId/dispatch  (definir matriz canal × ação)

3. Rule → Aba "Notificações"
   PATCH /rules/:ruleId  (atualizar campo notifications com destinatários por ação)
```

---

## Referências

- [RFC-0024 — Alarm Dispatch Configuration](./RFC-0024-Alarm-Dispatch-Config.md)
- [RULES-FRONTEND-GUIDE](./RULES-FRONTEND-GUIDE.md)
- [FRONTEND-Users-Groups-Roles](./FRONTEND-Users-Groups-Roles.md)
