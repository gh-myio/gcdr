# API — GET /rules/:ruleId

> **Audiencia:** Frontend, Integradores, Alarm Orchestrator
> **Data:** 2026-03-06
> **Relacionado:** [RULE-ENTITY.md](./RULE-ENTITY.md), [API-Bundle-Verify.md](./API-Bundle-Verify.md)

---

## Visao Geral

```
GET /api/v1/rules/:ruleId
```

Retorna os detalhes completos de uma rule pelo seu ID, incluindo:

- Configuracao da rule (alarmConfig, slaConfig, etc.)
- Notificacoes por categoria (`alarmNotify`, `alarmReport`, `alarmInsight`) com destinatarios e emailRelay
- `gatewayToken` do customer ao qual a rule pertence

---

## Request

### Path Params

| Param | Tipo | Descricao |
|---|---|---|
| `ruleId` | string (UUID) | ID da rule |

### Headers

| Header | Obrigatorio | Descricao |
|---|---|---|
| `Authorization` | Sim | `Bearer <jwt>` |

### Exemplo

```http
GET /api/v1/rules/rule-uuid-aaa
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Response

**Status:** `200 OK`

### Campos raiz

| Campo | Tipo | Descricao |
|---|---|---|
| `id` | string (UUID) | ID da rule |
| `customerId` | string (UUID) | Customer ao qual a rule pertence |
| `name` | string | Nome da rule |
| `description` | string? | Descricao opcional |
| `type` | string | `ALARM_THRESHOLD \| SLA \| ESCALATION \| MAINTENANCE_WINDOW` |
| `priority` | string | `LOW \| MEDIUM \| HIGH \| CRITICAL` |
| `status` | string | `ACTIVE \| INACTIVE \| SUSPENDED` |
| `enabled` | boolean | Se a rule esta ativa |
| `tags` | string[] | Tags de organizacao |
| `scope` | object | Escopo de aplicacao da rule |
| `alarmConfig` | object? | Configuracao de threshold (somente `ALARM_THRESHOLD`) |
| `slaConfig` | object? | Configuracao de SLA (somente `SLA`) |
| `escalationConfig` | object? | Configuracao de escalacao (somente `ESCALATION`) |
| `maintenanceConfig` | object? | Configuracao de janela de manutencao (somente `MAINTENANCE_WINDOW`) |
| `notifications` | object? | Notificacoes por categoria (ausente se nao configurado) |
| `scopeEntityOverrides` | object? | Overrides de value/valueHigh por device UUID (RFC-0018) |
| `gatewayToken` | string? | Token do gateway do customer (ausente se nao configurado) |
| `lastTriggeredAt` | string? | ISO 8601 — ultima vez que a rule foi disparada |
| `triggerCount` | number? | Total de disparos |
| `createdAt` | string | ISO 8601 |
| `updatedAt` | string | ISO 8601 |

### `scope`

| Campo | Tipo | Descricao |
|---|---|---|
| `type` | string | `GLOBAL \| CUSTOMER \| ASSET \| DEVICE` |
| `entityId` | string? (UUID) | Entidade unica (CUSTOMER ou ASSET) |
| `entityIds` | string[]? | Multiplos devices (scope DEVICE) |
| `inherited` | boolean? | Se aplica a filhos do customer |

### `alarmConfig` (type = ALARM_THRESHOLD)

| Campo | Tipo | Descricao |
|---|---|---|
| `metric` | string | Metrica monitorada (ex: `temperature`, `instantaneous_power`) |
| `operator` | string | `GT \| GTE \| LT \| LTE \| EQ \| NEQ \| BETWEEN \| OUTSIDE` |
| `value` | number | Valor de referencia |
| `valueHigh` | number? | Limite superior (BETWEEN/OUTSIDE) |
| `unit` | string? | Unidade da metrica (ex: `°C`, `W`) |
| `hysteresis` | number? | Tolerancia para evitar flapping |
| `hysteresisType` | string? | `PERCENTAGE \| ABSOLUTE` |
| `duration` | number? | Tempo em segundos que a condicao deve persistir |
| `aggregation` | string? | `AVG \| MIN \| MAX \| SUM \| COUNT \| LAST` |
| `aggregationWindow` | number? | Janela de agregacao em segundos |
| `startAt` | string? | Hora de inicio da vigencia (HH:mm) |
| `endAt` | string? | Hora de fim da vigencia (HH:mm) |
| `daysOfWeek` | number[]? | Dias ativos: 0=Dom ... 6=Sab |
| `channelId` | number? | Canal do device OUTLET |
| `keyMulti` | number? | Multiplicador de unidade de energia |
| `offset` | object? | Calibracao por metrica (ex: `{ "temp": -0.5 }`) |
| `dedup` | object? | Guard de deduplicacao |
| `cooldown` | object? | Guard de cooldown entre notificacoes |
| `hysteresisGuard` | object? | Guard de supressao por transicoes rapidas |
| `digest` | object? | Guard de digest acumulado |

### `notifications`

Cada categoria e independente — lista de destinatarios e configuracao SMTP propria.

```ts
{
  alarmNotify?: RuleNotificationChannel;  // Alarme disparado
  alarmReport?: RuleNotificationChannel;  // Relatorio periodico
  alarmInsight?: RuleNotificationChannel; // Insights e analises
}
```

#### `RuleNotificationChannel`

| Campo | Tipo | Descricao |
|---|---|---|
| `enabled` | boolean | Se a categoria esta ativa |
| `recipients` | array | Lista de destinatarios |
| `emailRelay` | object? | Configuracao SMTP para envio |

#### `NotificationRecipient`

| Campo | Tipo | Descricao |
|---|---|---|
| `name` | string | Nome do destinatario |
| `email` | string | Email do destinatario |
| `sourceType` | string | `USER \| GROUP_MEMBER \| MANUAL` |
| `userId` | string? (UUID) | ID do usuario (USER ou GROUP_MEMBER) |
| `groupId` | string? (UUID) | ID do grupo de origem (GROUP_MEMBER) |

#### `NotificationEmailRelay` (SMTP)

| Campo | Tipo | Descricao |
|---|---|---|
| `host` | string | Host SMTP (ex: `smtp.sendgrid.net`) |
| `port` | number | Porta (ex: `465` ou `587`) |
| `secure` | boolean | `true` = TLS/SSL, `false` = STARTTLS |
| `user` | string? | Usuario de autenticacao SMTP |
| `from` | string | Remetente (ex: `"Alertas MYIO <noreply@empresa.com.br>"`) |

---

## Exemplo de Response

```json
{
  "id": "rule-uuid-aaa",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "name": "Temperatura Alta Sala 01",
  "description": "Alarme quando temperatura ultrapassar 30 graus por mais de 1 minuto",
  "type": "ALARM_THRESHOLD",
  "priority": "HIGH",
  "status": "ACTIVE",
  "enabled": true,
  "tags": ["temperatura", "sala-01"],
  "scope": {
    "type": "DEVICE",
    "entityIds": [
      "d1a2b3c4-0000-0000-0000-000000000001",
      "d1a2b3c4-0000-0000-0000-000000000002"
    ],
    "inherited": false
  },
  "alarmConfig": {
    "metric": "temperature",
    "operator": "GT",
    "value": 30,
    "unit": "C",
    "hysteresis": 1,
    "hysteresisType": "ABSOLUTE",
    "duration": 60,
    "aggregation": "AVG",
    "aggregationWindow": 60,
    "startAt": "08:00",
    "endAt": "18:00",
    "daysOfWeek": [1, 2, 3, 4, 5],
    "offset": { "temp": -0.5 },
    "dedup": { "enabled": true, "ttlSeconds": 300 },
    "cooldown": { "enabled": true, "seconds": 120, "perChannel": false }
  },
  "notifications": {
    "alarmNotify": {
      "enabled": true,
      "recipients": [
        {
          "name": "Joao Silva",
          "email": "joao@empresa.com",
          "sourceType": "USER",
          "userId": "usr-uuid-001"
        },
        {
          "name": "Equipe NOC",
          "email": "noc@empresa.com",
          "sourceType": "GROUP_MEMBER",
          "userId": "usr-uuid-002",
          "groupId": "grp-uuid-abc"
        }
      ],
      "emailRelay": {
        "host": "smtp.sendgrid.net",
        "port": 587,
        "secure": false,
        "user": "apikey",
        "from": "Alertas MYIO <noreply@empresa.com.br>"
      }
    },
    "alarmReport": {
      "enabled": true,
      "recipients": [
        {
          "name": "Gerente",
          "email": "gerente@empresa.com",
          "sourceType": "MANUAL"
        }
      ]
    },
    "alarmInsight": {
      "enabled": false,
      "recipients": []
    }
  },
  "scopeEntityOverrides": {
    "d1a2b3c4-0000-0000-0000-000000000002": {
      "value": 28
    }
  },
  "gatewayToken": "gw_tok_moxuara_2026_xYzK9...",
  "lastTriggeredAt": "2026-03-06T08:42:00.000Z",
  "triggerCount": 14,
  "createdAt": "2026-01-15T12:00:00.000Z",
  "updatedAt": "2026-03-05T17:30:00.000Z"
}
```

---

## Campos enriquecidos (nao persistidos na rule)

| Campo | Origem | Descricao |
|---|---|---|
| `gatewayToken` | `customer.config.gatewayToken` | Token do gateway; ausente se o customer nao tiver configurado |

---

## Erros

| Status | Codigo | Descricao |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `ruleId` invalido (nao e UUID) |
| `404` | `NOT_FOUND` | Rule nao encontrada |
| `401` | `UNAUTHORIZED` | Token ausente ou invalido |
| `403` | `FORBIDDEN` | Sem permissao para acessar a rule |

---

## Ver tambem

- `PATCH /api/v1/rules/:ruleId` — atualizar rule (incluindo `notifications`)
- `GET /api/v1/customers/:customerId/alarm-rules/bundle/verify` — bundle enriquecido com `gatewayToken` e `notifications` de todas as rules
- `GET /api/v1/rules/notification-categories` — categorias de notificacao disponiveis
