# API — GET /bundle/verify

> **Audiência:** Equipe de Integração (Node-RED, Alarm Orchestrator, Gateway)
> **Data:** 2026-03-06
> **Relacionado:** [`/bundle/simple`](./NODE-RED-Alarm-Bundle-Integration.md), [RFC-0019](./RFC-0019-Customer-Config.md)

---

## Visão Geral

`GET /api/v1/customers/:customerId/alarm-rules/bundle/verify`

Retorna o mesmo conteúdo do `/bundle/simple` enriquecido com dois campos adicionais voltados para verificação e inicialização do gateway:

| Campo adicional | Onde aparece | Descrição |
|---|---|---|
| `meta.gatewayToken` | raiz do bundle | Token de autenticação do gateway, salvo em `customer.config.gatewayToken` |
| `rules[id].notifications` | por rule | Configuração de notificação (destinatários + emailRelay) por categoria |

> Use este endpoint na **inicialização do gateway** para obter o bundle completo + credenciais de notificação em uma única chamada. Para polling contínuo de atualizações, use `/bundle/simple` com `X-Version-Id`.

---

## Request

```
GET /api/v1/customers/{customerId}/alarm-rules/bundle/verify
```

### Headers

| Header | Obrigatório | Descrição |
|---|---|---|
| `Authorization` | Sim | `Bearer <jwt>` ou `X-API-Key: gcdr_cust_*` |
| `X-Central-Id` | Não | UUID da central — filtra devices vinculados a ela |

### Query Params

| Param | Tipo | Descrição |
|---|---|---|
| `domain` | string | Filtra rules por domínio de métrica (ex: `energy`) |
| `deviceType` | string | Filtra rules por tipo de device |
| `includeDisabled` | boolean | Inclui rules com `enabled: false` (padrão: `false`) |

### Exemplo de Request

```http
GET /api/v1/customers/84e0370e-636a-4741-9874-504b5e0b3577/alarm-rules/bundle/verify
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
X-Central-Id: e982edf9-edb1-4aa6-8a14-4782465ae5a3
```

---

## Response

**Status:** `200 OK`

### Estrutura

```ts
{
  meta: SimpleBundleMeta & {
    gatewayToken?: string;       // Token do customer (ausente se não configurado)
  };
  deviceIndex: Record<string, SimpleDeviceMapping>;
  rules: Record<string, SimpleBundleAlarmRule & {
    notifications?: RuleNotifications; // Ausente se rule não tem notificações
  }>;
}
```

### Campos de `meta`

| Campo | Tipo | Descrição |
|---|---|---|
| `version` | string | Hash da versão atual do bundle |
| `generatedAt` | string (ISO 8601) | Data/hora de geração |
| `customerId` | string (UUID) | ID do customer |
| `customerName` | string | Nome do customer |
| `tenantId` | string (UUID) | ID do tenant |
| `signature` | string | HMAC-SHA256 do conteúdo |
| `algorithm` | string | Sempre `"HMAC-SHA256"` |
| `ttlSeconds` | number | TTL do cache em segundos |
| `rulesCount` | number | Total de rules no bundle |
| `devicesCount` | number | Total de devices no bundle |
| `skipVersionCheck` | boolean | `true` se `customer.config.bundle.checkVersion === false` |
| `gatewayToken` | string? | Token de autenticação do gateway **(novo)** |

### Campos de `rules[id].notifications`

Presente apenas nas rules que possuem notificações configuradas.

```ts
{
  alarmNotify?: {          // Disparado quando o alarme é ativado
    enabled: boolean;
    recipients: NotificationRecipient[];
    emailRelay?: NotificationEmailRelay;
  };
  alarmReport?: {          // Relatório periódico de alarmes
    enabled: boolean;
    recipients: NotificationRecipient[];
    emailRelay?: NotificationEmailRelay;
  };
  alarmInsight?: {         // Insights e análises de alarme
    enabled: boolean;
    recipients: NotificationRecipient[];
    emailRelay?: NotificationEmailRelay;
  };
}
```

#### `NotificationRecipient`

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | string | Nome do destinatário |
| `email` | string | Email do destinatário |
| `sourceType` | `USER \| GROUP_MEMBER \| MANUAL` | Origem do cadastro |
| `userId` | string? (UUID) | ID do usuário (USER ou GROUP_MEMBER) |
| `groupId` | string? (UUID) | ID do grupo de origem (GROUP_MEMBER) |

#### `NotificationEmailRelay` (SMTP)

| Campo | Tipo | Descrição |
|---|---|---|
| `host` | string | Host SMTP (ex: `smtp.sendgrid.net`) |
| `port` | number | Porta SMTP (ex: `465` ou `587`) |
| `secure` | boolean | `true` = TLS/SSL, `false` = STARTTLS |
| `user` | string? | Usuário de autenticação SMTP |
| `from` | string | Endereço remetente (ex: `"Alertas <noreply@empresa.com>"`) |

---

## Exemplo de Response

```json
{
  "meta": {
    "version": "v-1741215600-a3f9b2c1",
    "generatedAt": "2026-03-06T10:00:00.000Z",
    "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
    "customerName": "Moxuara",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "signature": "hmac-sha256-abc123...",
    "algorithm": "HMAC-SHA256",
    "ttlSeconds": 300,
    "rulesCount": 2,
    "devicesCount": 3,
    "skipVersionCheck": false,
    "gatewayToken": "gw_tok_moxuara_2026_xYzK9..."
  },
  "deviceIndex": {
    "d1a2b3c4-0000-0000-0000-000000000001": {
      "deviceName": "Sensor Sala 01",
      "slaveId": 12,
      "offset": { "temp": -0.5, "hum": 0 },
      "ruleIds": ["rule-uuid-aaa", "rule-uuid-bbb"]
    },
    "d1a2b3c4-0000-0000-0000-000000000002": {
      "deviceName": "Medidor Principal",
      "slaveId": 5,
      "offset": {},
      "ruleIds": [{ "ruleId": "rule-uuid-ccc", "channelId": 0 }]
    }
  },
  "rules": {
    "rule-uuid-aaa": {
      "id": "rule-uuid-aaa",
      "name": "Temperatura Alta",
      "metric": "temperature",
      "operator": "GT",
      "value": 30,
      "duration": 0,
      "hysteresis": 0,
      "aggregation": "LAST",
      "startAt": "00:00",
      "endAt": "23:59",
      "daysOfWeek": { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true },
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
      }
    },
    "rule-uuid-ccc": {
      "id": "rule-uuid-ccc",
      "name": "Energia Acima do Limite",
      "metric": "instantaneous_power",
      "operator": "GT",
      "value": 5000,
      "channelId": 0,
      "keyMulti": 1,
      "duration": 60000,
      "hysteresis": 2,
      "aggregation": "AVG",
      "startAt": "08:00",
      "endAt": "18:00",
      "daysOfWeek": { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false }
    }
  }
}
```

> Rules sem notificações configuradas (`rule-uuid-ccc` no exemplo) aparecem exatamente como no `/bundle/simple`, sem o campo `notifications`.

---

## Diferenças em relação ao `/bundle/simple`

| | `/bundle/simple` | `/bundle/verify` |
|---|---|---|
| Conteúdo base | Igual | Igual |
| `meta.gatewayToken` | Não | Sim (se configurado no customer) |
| `rules[id].notifications` | Não | Sim (se configurado na rule) |
| Cache | Sim (TTL 5min) | Sim (mesmo cache do `/simple`) |
| Uso recomendado | Polling de atualizacoes | Inicializacao do gateway |

---

## Configurar `gatewayToken` no Customer

O `gatewayToken` e salvo em `customer.config.gatewayToken` via `PATCH /customers/:id`:

```http
PATCH /api/v1/customers/84e0370e-636a-4741-9874-504b5e0b3577
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "config": {
    "gatewayToken": "gw_tok_moxuara_2026_xYzK9..."
  }
}
```

---

## Configurar `notifications` em uma Rule

As notificacoes sao salvas via `PATCH /rules/:id`:

```http
PATCH /api/v1/rules/rule-uuid-aaa
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "notifications": {
    "alarmNotify": {
      "enabled": true,
      "recipients": [
        {
          "name": "Joao Silva",
          "email": "joao@empresa.com",
          "sourceType": "USER",
          "userId": "usr-uuid-001"
        }
      ],
      "emailRelay": {
        "host": "smtp.sendgrid.net",
        "port": 587,
        "secure": false,
        "user": "apikey",
        "from": "Alertas MYIO <noreply@empresa.com.br>"
      }
    }
  }
}
```

---

## Ver categorias de notificacao disponiveis

```
GET /api/v1/rules/notification-categories
GET /api/v1/domains/notification-categories
```

```json
[
  {
    "id": "alarmNotify",
    "label": "Notificacao de Alarme",
    "description": "Enviado quando um alarme e disparado",
    "icon": "bell-alert",
    "templateType": "EMAIL_ALARM"
  },
  {
    "id": "alarmReport",
    "label": "Relatorio de Alarmes",
    "description": "Relatorio periodico com resumo de alarmes",
    "icon": "chart-bar",
    "templateType": "EMAIL_REPORT"
  },
  {
    "id": "alarmInsight",
    "label": "Insight de Alarmes",
    "description": "Analise e insights baseados em padroes de alarme",
    "icon": "light-bulb",
    "templateType": "INSIGHT"
  }
]
```
