# Group Channels & Dispatch — Payloads de Exemplo

> **RFC-0024 — Alarm Dispatch Configuration**
> Contexto de exemplo: Grupo *Manutenção Escadas Rolantes* do cliente Mestre Álvaro.
>
> - `group_id`: `eeee0001-0001-0001-0001-000000000010`
> - Base URL: `/api/v1`
> - Headers obrigatórios: `Authorization: Bearer <jwt>`, `X-Tenant-Id: <tenantId>`

---

## 1. Group Channels — configurar WHERE enviar por canal

Cada grupo tem seus próprios **targets** (chat_id do Telegram, e-mail destino, webhook URL…).
As **credenciais** (bot token, credenciais SMTP) ficam em `customer_channels` — o grupo só guarda o destino.

---

### `PUT /groups/:groupId/channels` — substituição completa

Substitui todos os canais do grupo de uma vez (idempotente).

**Request body**

```json
{
  "channels": [
    {
      "channel": "TELEGRAM",
      "active": true,
      "target": "-100123456789"
    },
    {
      "channel": "EMAIL",
      "active": true,
      "target": "manut-escadas@mestrealvaro.com.br"
    }
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
        "tenantId": "11111111-1111-1111-1111-111111111111",
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
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "EMAIL",
        "active": true,
        "target": "manut-escadas@mestrealvaro.com.br",
        "config": {},
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      }
    ]
  },
  "requestId": "req_abc123"
}
```

---

### `GET /groups/:groupId/channels` — listar canais configurados

**Response `200 OK`**

```json
{
  "success": true,
  "data": {
    "count": 2,
    "items": [
      {
        "id": "a1b2c3d4-0001-0001-0001-000000000001",
        "tenantId": "11111111-1111-1111-1111-111111111111",
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
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "EMAIL",
        "active": true,
        "target": "manut-escadas@mestrealvaro.com.br",
        "config": {},
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      }
    ]
  },
  "requestId": "req_abc124"
}
```

---

### `PATCH /groups/:groupId/channels/:channel` — atualizar canal individual

Atualiza apenas os campos enviados. `channel` no path é o canal a editar (ex: `TELEGRAM`).

**Request body — trocar chat_id**

```json
{
  "target": "-100987654321"
}
```

**Request body — desativar canal sem remover**

```json
{
  "active": false
}
```

**Response `200 OK`**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-0001-0001-0001-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "groupId": "eeee0001-0001-0001-0001-000000000010",
    "channel": "TELEGRAM",
    "active": true,
    "target": "-100987654321",
    "config": {},
    "createdAt": "2026-03-16T00:00:00.000Z",
    "updatedAt": "2026-03-16T12:30:00.000Z"
  },
  "requestId": "req_abc125"
}
```

---

### `DELETE /groups/:groupId/channels/:channel` — remover canal

**Response `200 OK`**

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "channel": "TELEGRAM"
  },
  "requestId": "req_abc126"
}
```

---

## 2. Group Dispatch — configurar QUAIS ações disparam em qual canal

Matriz `canal × ação → active + escalationDelayMs`.

| canal     | ação     | significado                                            |
|-----------|----------|--------------------------------------------------------|
| EMAIL     | OPEN     | Envia e-mail quando alarme ABRE                       |
| EMAIL     | CLOSE    | Envia e-mail quando alarme FECHA                      |
| TELEGRAM  | OPEN     | Envia msg Telegram quando alarme ABRE                 |
| TELEGRAM  | CLOSE    | Envia msg Telegram quando alarme FECHA                |
| TELEGRAM  | ESCALATE | Re-envia no Telegram após `escalationDelayMs` ms sem ACK |

`escalationDelayMs: 0` = sem delay / não aplicável (campo obrigatório, default 0).

---

### `PUT /groups/:groupId/dispatch` — substituição completa da matriz

**Request body**

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
      {
        "id": "b2c3d4e5-0001-0001-0001-000000000001",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "EMAIL",
        "action": "OPEN",
        "active": true,
        "escalationDelayMs": 0,
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      },
      {
        "id": "b2c3d4e5-0001-0001-0001-000000000002",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "EMAIL",
        "action": "CLOSE",
        "active": true,
        "escalationDelayMs": 0,
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      },
      {
        "id": "b2c3d4e5-0001-0001-0001-000000000003",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "TELEGRAM",
        "action": "OPEN",
        "active": true,
        "escalationDelayMs": 0,
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      },
      {
        "id": "b2c3d4e5-0001-0001-0001-000000000004",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "TELEGRAM",
        "action": "CLOSE",
        "active": true,
        "escalationDelayMs": 0,
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      },
      {
        "id": "b2c3d4e5-0001-0001-0001-000000000005",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "groupId": "eeee0001-0001-0001-0001-000000000010",
        "channel": "TELEGRAM",
        "action": "ESCALATE",
        "active": true,
        "escalationDelayMs": 5000,
        "createdAt": "2026-03-16T00:00:00.000Z",
        "updatedAt": "2026-03-16T00:00:00.000Z"
      }
    ]
  },
  "requestId": "req_abc127"
}
```

---

### `GET /groups/:groupId/dispatch` — listar matriz configurada

**Response `200 OK`** — mesmo formato do PUT acima.

---

### `PATCH /groups/:groupId/dispatch` — atualizar entradas parcialmente

Atualiza apenas as entradas enviadas (upsert por `canal × ação`). Útil para toggle de `active` ou ajuste de delay sem reescrever a matriz inteira.

**Request body — desativar EMAIL × CLOSE**

```json
{
  "entries": [
    { "channel": "EMAIL", "action": "CLOSE", "active": false, "escalationDelayMs": 0 }
  ]
}
```

**Request body — aumentar delay de escalação para 30s**

```json
{
  "entries": [
    { "channel": "TELEGRAM", "action": "ESCALATE", "active": true, "escalationDelayMs": 30000 }
  ]
}
```

**Response `200 OK`** — retorna a lista completa atualizada (mesmo formato do PUT).

---

## 3. Estado final esperado (após todos os exemplos acima)

### `group_channels`

| channel  | active | target                              |
|----------|--------|-------------------------------------|
| TELEGRAM | true   | -100987654321 *(atualizado no PATCH)* |
| EMAIL    | true   | manut-escadas@mestrealvaro.com.br   |

### `group_dispatch_configs`

| channel  | action   | active | escalationDelayMs |
|----------|----------|--------|-------------------|
| EMAIL    | OPEN     | true   | 0                 |
| EMAIL    | CLOSE    | false  | 0 *(desativado no PATCH)* |
| TELEGRAM | OPEN     | true   | 0                 |
| TELEGRAM | CLOSE    | true   | 0                 |
| TELEGRAM | ESCALATE | true   | 5000              |

---

## 4. Erros comuns

**`404 Not Found`** — grupo não existe ou pertence a outro tenant

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Group not found"
  },
  "requestId": "req_abc128"
}
```

**`400 Bad Request`** — body inválido (ex: `channel` não reconhecido)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "channels[0].channel",
        "message": "Invalid enum value. Expected 'EMAIL' | 'TELEGRAM' | 'SMS' | 'PUSH' | 'WEBHOOK'"
      }
    ]
  },
  "requestId": "req_abc129"
}
```

**`409 Conflict`** — tentativa de inserir canal duplicado (não deve ocorrer com PUT, apenas se usar rota incorreta)

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Channel TELEGRAM already configured for this group"
  },
  "requestId": "req_abc130"
}
```
