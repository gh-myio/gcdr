# RFC-0024 — Frontend Alignment Guide

> Contexto de exemplo: Grupo *Manutenção Escadas Rolantes* — Mestre Álvaro
> - `group_id`: `eeee0001-0001-0001-0001-000000000010`
> - Base URL: `/api/v1`
> - Headers obrigatórios: `Authorization: Bearer <jwt>`, `X-Tenant-Id: <tenantId>`

---

## Breaking Changes

### 1. `escalationDelayMinutes` → `escalationDelayMs`

Campo renomeado e unidade alterada para **milissegundos** em `GroupNotificationSettings`.

```diff
- "escalationDelayMinutes": 5
+ "escalationDelayMs": 300000
```

### 2. `gatewayToken` removido

Não existe mais em nenhuma response da API. Era `customer.config.gatewayToken` — agora as credenciais do canal EMAIL_RELAY vivem em `customer_channels`.

Afeta:
- `GET /rules/:id` — campo removido da response
- `GET /customers/:id/alarm-rules/bundle/verify` — `meta.gatewayToken` removido

---

## Novos Valores de Enum

### `GroupPurpose` — 5 novos valores

| Valor | Label |
|-------|-------|
| `ALARMS_NOTIFY` | Alarmes - Notificação |
| `ALARMS_REPORT` | Alarmes - Relatório |
| `ALARMS_INSIGHT` | Alarmes - Insights |
| `WELCOME_USER` | Boas-vindas / Reset de Senha |
| `RELEASE_NOTE` | Comunicado de Nova Feature |

### Canal `EMAIL_RELAY` adicionado

Válido em todos os endpoints de channels: `EMAIL`, `EMAIL_RELAY`, `TELEGRAM`, `WHATSAPP`, `WEBHOOK`, `SLACK`, `SMS`, `TEAMS`, `CUSTOM`.

---

## Novos Endpoints — Catálogos

### `GET /groups/purposes`

```json
{
  "data": {
    "count": 12,
    "items": [
      { "value": "ALARMS_NOTIFY",  "label": "Alarmes - Notificação",        "description": "Recebe notificações em tempo real quando alarmes abrem ou fecham" },
      { "value": "ALARMS_REPORT",  "label": "Alarmes - Relatório",          "description": "Recebe relatórios periódicos consolidados de alarmes" },
      { "value": "ALARMS_INSIGHT", "label": "Alarmes - Insights",           "description": "Recebe métricas e análises sobre padrões de alarmes" },
      { "value": "WELCOME_USER",   "label": "Boas-vindas / Reset de Senha", "description": "Recebe e-mails de boas-vindas e recuperação de acesso" },
      { "value": "RELEASE_NOTE",   "label": "Comunicado de Nova Feature",   "description": "Recebe comunicados sobre novas funcionalidades do sistema" },
      { "value": "NOTIFICATION",   "label": "Notificação",                  "description": "Grupo genérico para envio de notificações operacionais" },
      { "value": "ESCALATION",     "label": "Escalonamento",                "description": "Cadeia de escalonamento para alarmes não reconhecidos" },
      { "value": "ACCESS_CONTROL", "label": "Controle de Acesso",           "description": "Gerenciamento de permissões e acessos" },
      { "value": "REPORTING",      "label": "Relatórios",                   "description": "Agrupamento para geração de relatórios" },
      { "value": "MAINTENANCE",    "label": "Manutenção",                   "description": "Equipes e responsáveis por manutenção programada" },
      { "value": "MONITORING",     "label": "Monitoramento",                "description": "Painéis e dashboards de monitoramento" },
      { "value": "CUSTOM",         "label": "Personalizado",                "description": "Finalidade livre definida pelo cliente" }
    ]
  }
}
```

### `GET /groups/channels`

```json
{
  "data": {
    "count": 9,
    "items": [
      { "value": "EMAIL",       "label": "E-mail",           "description": "Envio via SMTP configurado no cliente" },
      { "value": "EMAIL_RELAY", "label": "E-mail Relay",     "description": "Envio via servidor relay compartilhado da plataforma" },
      { "value": "TELEGRAM",    "label": "Telegram",         "description": "Mensagem para grupo ou usuário via bot Telegram" },
      { "value": "WHATSAPP",    "label": "WhatsApp",         "description": "Mensagem via API WhatsApp Business" },
      { "value": "SMS",         "label": "SMS",              "description": "Mensagem de texto para número de telefone" },
      { "value": "SLACK",       "label": "Slack",            "description": "Mensagem para canal ou usuário via webhook Slack" },
      { "value": "TEAMS",       "label": "Microsoft Teams",  "description": "Mensagem para canal via webhook Teams" },
      { "value": "WEBHOOK",     "label": "Webhook",          "description": "HTTP POST para URL configurada pelo cliente" },
      { "value": "CUSTOM",      "label": "Personalizado",    "description": "Canal customizado definido pelo cliente" }
    ]
  }
}
```

---

## Novos Endpoints — Group Members

### `GET /groups/:groupId/members`

```json
{
  "success": true,
  "data": {
    "count": 2,
    "items": [
      { "id": "eeee0001-0001-0001-0001-000000000001", "type": "USER", "name": "João Silva",  "addedAt": "2026-03-16T00:00:00.000Z" },
      { "id": "eeee0001-0001-0001-0001-000000000002", "type": "USER", "name": "Maria Souza", "addedAt": "2026-03-16T00:00:00.000Z" }
    ]
  }
}
```

---

## Novos Endpoints — Group Channels

Arquitetura: o **grupo** guarda o **destino** (chat_id, e-mail, URL). As **credenciais** (bot token, SMTP) ficam em `customer_channels`.

### `PUT /groups/:groupId/channels` — substituição completa

**Request**
```json
{
  "channels": [
    { "channel": "TELEGRAM", "active": true, "target": "-100123456789" },
    { "channel": "EMAIL",    "active": true, "target": "manut-escadas@mestrealvaro.com.br" }
  ]
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "data": {
    "count": 2,
    "items": [
      {
        "id": "a1b2c3d4-0001-0001-0001-000000000001",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "TELEGRAM",
        "active": true,
        "target": "-100123456789",
        "config": {},
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      },
      {
        "id": "a1b2c3d4-0001-0001-0001-000000000002",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "EMAIL",
        "active": true,
        "target": "manut-escadas@mestrealvaro.com.br",
        "config": {},
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      }
    ]
  }
}
```

### `GET /groups/:groupId/channels`

Mesma estrutura da response do PUT acima.

### `PATCH /groups/:groupId/channels/:channel` — atualizar canal individual

**Trocar target**
```json
{ "target": "-100987654321" }
```

**Desativar sem remover**
```json
{ "active": false }
```

**Response `200 OK`**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-0001-0001-0001-000000000001",
    "groupId": "eeee0001-0001-0001-0001-000000000010",
    "channel": "TELEGRAM",
    "active": true,
    "target": "-100987654321",
    "config": {},
    "createdAt": "2026-03-16T00:00:00.000Z",
    "updatedAt": "2026-03-16T12:30:00.000Z"
  }
}
```

### `DELETE /groups/:groupId/channels/:channel`

**Response `200 OK`**
```json
{
  "success": true,
  "data": { "deleted": true, "channel": "TELEGRAM" }
}
```

---

## Novos Endpoints — Group Dispatch

Matriz `canal × ação → active + escalationDelayMs`.

| Canal | Ação | Significado |
|-------|------|-------------|
| EMAIL / qualquer | `OPEN` | Dispara quando alarme **abre** |
| EMAIL / qualquer | `CLOSE` | Dispara quando alarme **fecha** |
| TELEGRAM / qualquer | `ESCALATE` | Re-dispara após `escalationDelayMs` ms sem ACK |

`escalationDelayMs: 0` = sem delay (campo obrigatório, default 0).

### `PUT /groups/:groupId/dispatch` — substituição completa

**Request**
```json
{
  "entries": [
    { "channel": "EMAIL",    "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
    { "channel": "EMAIL",    "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
    { "channel": "TELEGRAM", "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
    { "channel": "TELEGRAM", "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
    { "channel": "TELEGRAM", "action": "ESCALATE", "active": true,  "escalationDelayMs": 5000 }
  ]
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "data": {
    "count": 5,
    "items": [
      { "channel": "EMAIL",    "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
      { "channel": "EMAIL",    "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "ESCALATE", "active": true,  "escalationDelayMs": 5000 }
    ]
  }
}
```

### `GET /groups/:groupId/dispatch`

Mesma estrutura da response do PUT acima.

### `PATCH /groups/:groupId/dispatch` — atualizar entradas parcialmente

Upsert por `canal × ação`. Útil para toggle ou ajuste de delay sem reescrever tudo.

**Desativar EMAIL × CLOSE**
```json
{
  "entries": [
    { "channel": "EMAIL", "action": "CLOSE", "active": false, "escalationDelayMs": 0 }
  ]
}
```

**Aumentar delay de escalação para 30s**
```json
{
  "entries": [
    { "channel": "TELEGRAM", "action": "ESCALATE", "active": true, "escalationDelayMs": 30000 }
  ]
}
```

**Response `200 OK`** — lista completa atualizada
```json
{
  "success": true,
  "data": {
    "count": 5,
    "items": [
      { "channel": "EMAIL",    "action": "OPEN",     "active": true,  "escalationDelayMs": 0     },
      { "channel": "EMAIL",    "action": "CLOSE",    "active": false, "escalationDelayMs": 0     },
      { "channel": "TELEGRAM", "action": "OPEN",     "active": true,  "escalationDelayMs": 0     },
      { "channel": "TELEGRAM", "action": "CLOSE",    "active": true,  "escalationDelayMs": 0     },
      { "channel": "TELEGRAM", "action": "ESCALATE", "active": true,  "escalationDelayMs": 30000 }
    ]
  }
}
```

---

## RuleMeta — Campos Adicionados

`GET /customers/external/:externalId?deep=1` agora retorna em cada rule dentro de `rulesMeta`:

```json
{
  "id": "rule-uuid",
  "name": "Temperatura Alta",
  "description": "Dispara quando temperatura ultrapassa limite",
  "parentRuleId": null
}
```

Para devices com **override de valor específico**, o `id` da rule é sintetizado como `{ruleId}_{deviceId}` e `parentRuleId` aponta para a rule base:

```json
{
  "id": "rule-uuid_device-uuid",
  "name": "Temperatura Alta",
  "description": "Dispara quando temperatura ultrapassa limite",
  "parentRuleId": "rule-uuid"
}
```

---

## Erros Comuns

**`404`** — grupo não encontrado
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Group not found" } }
```

**`400`** — canal inválido
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "channels[0].channel", "message": "Invalid enum value. Expected 'EMAIL' | 'EMAIL_RELAY' | 'TELEGRAM' | ..." }]
  }
}
```
