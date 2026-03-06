# EMAIL_SENDER — Payload Contract

- **Versão:** 1.0
- **Data:** 2026-03-06
- **Autores:** MYIO Platform Team
- **Status:** Draft
- **Consumidor:** Serviço `EMAIL_SENDER`
- **Produtores:** `ALARMS-API`, `GCDR`

---

## Visão Geral do Fluxo

```
Produtor                     EMAIL_SENDER                         GCDR
   │                               │                                │
   │  POST /webhook (payload)      │                                │
   │──────────────────────────────>│                                │
   │                               │  GET /templates/active         │
   │                               │  ?type=<templateType>          │
   │                               │  &customerId=<id>              │
   │                               │──────────────────────────────>│
   │                               │  ← HTML template (com theme)  │
   │                               │<──────────────────────────────│
   │                               │                                │
   │                               │  renderTemplate(html, data)   │
   │                               │  (local, via engine do GCDR)  │
   │                               │                                │
   │                               │  sendEmail(to[], htmlRendered)│
   │                               │──────> SMTP / SendGrid         │
```

> **Cache:** o `EMAIL_SENDER` pode cachear o template por `(customerId + type)` por um período configurável. Responsabilidade exclusiva do `EMAIL_SENDER`.

---

## Envelope Padrão

Todo payload enviado ao `EMAIL_SENDER` **deve** conter este envelope:

```json
{
  "type":       "ALARM_OPENED",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "ALARMS-API",
  "sentAt":     "2026-03-06T10:54:00.000Z",
  "data":       { }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `type` | `EmailEventType` (enum) | ✅ | Discriminador do tipo de e-mail |
| `customerId` | UUID | ✅ | Customer destinatário — usado para buscar template e theme no GCDR |
| `tenantId` | UUID | ✅ | Tenant do customer |
| `sentBy` | string | ✅ | Serviço que originou o evento (`ALARMS-API`, `GCDR`) |
| `sentAt` | ISO 8601 | ✅ | Timestamp de geração do evento |
| `data` | object | ✅ | Conteúdo específico do tipo — detalhado abaixo |

---

## Enum de Tipos (`EmailEventType`)

| `type` | Quem emite | Template GCDR (`templateType`) | Descrição |
|---|---|---|---|
| `ALARM_OPENED` | `ALARMS-API` | `EMAIL_ALARM` | Um ou mais alarmes foram abertos |
| `ALARM_CLOSED` | `ALARMS-API` | `EMAIL_ALARM` | Um ou mais alarmes foram fechados |
| `NEW_USER` | `GCDR` | `EMAIL_WELCOME` | Novo usuário criado — link de ativação |
| `PASSWORD_RESET` | `GCDR` | `EMAIL_WELCOME` | Usuário solicitou redefinição de senha |
| `REPORT_READY` | `GCDR` / futuro | `EMAIL_REPORT` | Relatório periódico gerado |
| `RELEASE_NOTE` | `GCDR` | `RELEASE_NOTE` | Nova release publicada |
| `NOTIFICATION` | `GCDR` / qualquer | `NOTIFICATION` | Notificação avulsa de sistema |
| `INSIGHT` | `GCDR` / futuro | `INSIGHT` | Resumo de insights periódico |

> O `EMAIL_SENDER` usa o mapeamento acima para saber qual `templateType` buscar no GCDR.

---

## Destinatários (`to`)

O `EMAIL_SENDER` extrai os destinatários **a partir do `data`** de cada tipo — não há campo `to` global no envelope, pois para alarmes os destinatários variam por rule.

| `type` | Fonte dos destinatários |
|---|---|
| `ALARM_OPENED` / `ALARM_CLOSED` | `data.rules[*].alarmRecipients` — um e-mail por rule com seus destinatários |
| `NEW_USER` | `data.user.email` — único destinatário |
| `PASSWORD_RESET` | `data.user.email` — único destinatário |
| `REPORT_READY` | `data.recipients[]` — lista explícita |
| `RELEASE_NOTE` | `data.recipients[]` — lista explícita |
| `NOTIFICATION` | `data.user.email` ou `data.recipients[]` |
| `INSIGHT` | `data.recipients[]` — lista explícita |

---

## Payloads por Tipo

### `ALARM_OPENED` / `ALARM_CLOSED`

Emitido pelo `ALARMS-API` após normalização do bundle interno.

```json
{
  "type":       "ALARM_OPENED",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "ALARMS-API",
  "sentAt":     "2026-03-06T10:54:00.000Z",
  "data": {
    "summary": {
      "rulesCount":   3,
      "devicesCount": 7,
      "alarmStatus":  "OPENED"
    },
    "gateway": {
      "name": "MessageGatewayMestreAlvaro",
      "type": "MESSAGE_GATEWAY"
    },
    "rules": [
      {
        "name":             "Fancoil Ligado Fora do Horario (Seg - Dom)",
        "description":      "Fancoil permanece ligado fora do horario permitido de operacao",
        "condition":        "Valor == 1",
        "alarmRecipients":  ["rodrigo@myio.com.br", "victor@myio.com.br"],
        "devices": [
          {
            "name":      "Fancoil Sala Reuniao 01",
            "value":     "1",
            "status":    "online",
            "timestamp": "06/03/2026 10:54:00"
          },
          {
            "name":      "Fancoil Sala Reuniao 02",
            "value":     "1",
            "status":    "online",
            "timestamp": "06/03/2026 10:54:00"
          }
        ]
      },
      {
        "name":             "Temperatura Elevada - Elevador",
        "description":      "Temperatura do motor do elevador acima do limite",
        "condition":        "Valor > 80",
        "alarmRecipients":  ["rodrigo@myio.com.br"],
        "devices": [
          {
            "name":      "Elevador Torre A - Motor Principal",
            "value":     "85",
            "status":    "online",
            "timestamp": "06/03/2026 10:54:00"
          }
        ]
      }
    ]
  }
}
```

> **Nota de normalização:** o ALARMS-API recebe o bundle interno com UUIDs como chaves (ex: `"d3202744-...: { rules: { "ada23b76-...": { ... } } }"`). É **responsabilidade do ALARMS-API** converter esse formato para o array `rules[]` normalizado acima antes de enviar ao EMAIL_SENDER.

---

### `NEW_USER`

Emitido pelo `GCDR` quando um novo usuário é criado.

```json
{
  "type":       "NEW_USER",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T10:54:00.000Z",
  "data": {
    "user": {
      "name":  "João Silva",
      "email": "joao@mestrealvaro.com.br"
    },
    "customer": {
      "name": "Mestre Álvaro Engenharia"
    },
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "activation": {
      "link":      "https://app.myio.com.br/activate?token=abc123xyz",
      "expiresAt": "08/03/2026 18:00:00"
    }
  }
}
```

---

### `PASSWORD_RESET`

Emitido pelo `GCDR` quando o usuário solicita redefinição de senha.

```json
{
  "type":       "PASSWORD_RESET",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T10:54:00.000Z",
  "data": {
    "user": {
      "name":  "João Silva",
      "email": "joao@mestrealvaro.com.br"
    },
    "customer": {
      "name": "Mestre Álvaro Engenharia"
    },
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "activation": {
      "link":      "https://app.myio.com.br/reset-password?token=xyz789",
      "expiresAt": "06/03/2026 13:00:00"
    }
  }
}
```

> Usa o mesmo template `EMAIL_WELCOME` do `NEW_USER`. O conteúdo do link e a mensagem do template diferenciam os dois casos.

---

### `REPORT_READY`

```json
{
  "type":       "REPORT_READY",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T08:00:00.000Z",
  "data": {
    "recipients": ["rodrigo@myio.com.br", "gestor@mestrealvaro.com.br"],
    "customer": {
      "name": "Mestre Álvaro Engenharia"
    },
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "report": {
      "title":       "Relatório Mensal — Março 2026",
      "period":      "01/03/2026 a 31/03/2026",
      "generatedAt": "06/03/2026 08:00:00"
    },
    "summary": {
      "totalAlarms":   42,
      "activeDevices": 128
    },
    "items": [
      { "label": "Energia Total",  "value": "12.450 kWh" },
      { "label": "Água Total",     "value": "380 m³" },
      { "label": "Alarmes Abertos","value": "3" }
    ]
  }
}
```

---

### `RELEASE_NOTE`

```json
{
  "type":       "RELEASE_NOTE",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T09:00:00.000Z",
  "data": {
    "recipients": ["rodrigo@myio.com.br", "victor@myio.com.br"],
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "version":             "v0.1.428",
    "period":              "Março 2026",
    "moduleName":          "Módulo de Energia",
    "featureTitle":        "Exportação de Dados em PDF, XLS e CSV",
    "featureSubtitle":     "Disponível no topo de cada painel",
    "overviewText":        "O MYIO agora permite exportar dados de qualquer painel...",
    "highlightPanelLabel": "Coluna Área Comum — 69 dispositivos",
    "highlightMetric":     "48.932 MWh",
    "formats": [
      { "label": "PDF", "description": "Relatório visual formatado" },
      { "label": "XLS", "description": "Planilha editável" },
      { "label": "CSV", "description": "Dados brutos para integração" }
    ],
    "steps": [
      { "number": "1", "text": "Acesse o painel desejado" },
      { "number": "2", "text": "Clique no ícone de exportação" },
      { "number": "3", "text": "Escolha o formato e confirme" }
    ]
  }
}
```

---

### `NOTIFICATION`

```json
{
  "type":       "NOTIFICATION",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T10:00:00.000Z",
  "data": {
    "user": {
      "name":  "João Silva",
      "email": "joao@mestrealvaro.com.br"
    },
    "customer": {
      "name": "Mestre Álvaro Engenharia"
    },
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "notification": {
      "title":       "Manutenção programada — 07/03/2026",
      "body":        "O sistema estará em manutenção das 02h às 04h do dia 07/03/2026.",
      "level":       "INFO",
      "actionLabel": "Ver detalhes",
      "actionUrl":   "https://app.myio.com.br/notices/123"
    }
  }
}
```

> `notification.level` aceita: `INFO` | `WARNING` | `ERROR` | `SUCCESS`

---

### `INSIGHT`

```json
{
  "type":       "INSIGHT",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "tenantId":   "11111111-1111-1111-1111-111111111111",
  "sentBy":     "GCDR",
  "sentAt":     "2026-03-06T08:00:00.000Z",
  "data": {
    "recipients": ["rodrigo@myio.com.br", "gestor@mestrealvaro.com.br"],
    "customer": {
      "name": "Mestre Álvaro Engenharia"
    },
    "platform": {
      "name": "MYIO",
      "url":  "https://app.myio.com.br"
    },
    "insight": {
      "title":   "Resumo de Consumo — Março 2026",
      "period":  "01/03/2026 a 31/03/2026",
      "summary": "O consumo total aumentou 12% em relação ao mês anterior."
    },
    "metrics": [
      { "label": "Consumo Total", "value": "12.450", "unit": "kWh", "trend": "UP" },
      { "label": "Demanda Máx.",  "value": "48.2",   "unit": "kW",  "trend": "STABLE" },
      { "label": "Água",          "value": "380",     "unit": "m³",  "trend": "DOWN" }
    ],
    "recommendations": [
      {
        "title": "Reduzir consumo em horário de ponta",
        "text":  "Considere desligar equipamentos entre 18h e 21h."
      }
    ]
  }
}
```

> `metric.trend` aceita: `UP` | `DOWN` | `STABLE`

---

## Responsabilidades por Serviço

| Responsabilidade | ALARMS-API | GCDR | EMAIL_SENDER |
|---|---|---|---|
| Gerar o evento e montar o payload normalizado | ✅ | ✅ | — |
| Enviar POST para o endpoint do EMAIL_SENDER | ✅ | ✅ | — |
| Buscar template ativo no GCDR (`GET /templates/active?type=X`) | — | — | ✅ |
| Cachear template por `(customerId + type)` | — | — | ✅ |
| Renderizar HTML (substituir tags do template com `data`) | — | — | ✅ |
| Enviar e-mail via SMTP / SendGrid | — | — | ✅ |
| Armazenar templates com theme do customer | — | ✅ | — |

---

## Como o EMAIL_SENDER busca o template

```
GET https://gcdr-api.a.myio-bas.com/templates/active
  ?type=EMAIL_ALARM
  &customerId=84e0370e-636a-4741-9874-504b5e0b3577

Headers:
  X-API-Key: gcdr_pk_...
  X-Tenant-Id: 11111111-1111-1111-1111-111111111111
```

Resposta:
```json
{
  "id":          "uuid",
  "slug":        "alarm-email-mestre-alvaro",
  "type":        "EMAIL_ALARM",
  "status":      "ACTIVE",
  "htmlContent": "<html>... template com cores do customer ...</html>",
  "version":     3
}
```

> Se não houver template `ACTIVE` para o `(type + customerId)`, o EMAIL_SENDER deve usar o template padrão do tenant raiz como fallback — ou logar erro e não enviar.

---

## Mapeamento `type` → `templateType` (GCDR)

```
ALARM_OPENED    → EMAIL_ALARM
ALARM_CLOSED    → EMAIL_ALARM
NEW_USER        → EMAIL_WELCOME
PASSWORD_RESET  → EMAIL_WELCOME
REPORT_READY    → EMAIL_REPORT
RELEASE_NOTE    → RELEASE_NOTE
NOTIFICATION    → NOTIFICATION
INSIGHT         → INSIGHT
```

---

## Validações esperadas do EMAIL_SENDER

1. `type` presente e com valor válido → rejeitar com erro se desconhecido
2. `customerId` presente e UUID válido → rejeitar se ausente
3. `data` presente e não vazio → logar warning se vazio (template será renderizado sem dados)
4. Template não encontrado no GCDR → logar erro, **não enviar**, não explodir
5. Falha de SMTP → retentar N vezes com backoff (responsabilidade do EMAIL_SENDER)
