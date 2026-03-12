# Alarm Orchestrator — Dispatch Integration Guide (RFC-0024)

Guia de integração para o **alarm-orchestrator** (backend de alarmes) consumir o sistema de despacho de notificações do GCDR.
Baseado em: [RFC-0024](./RFC-0024-Alarm-Dispatch-Config.md)

---

## Visão Geral

Quando um alarme muda de estado (OPEN, ACK, ESCALATE, SNOOZE, CLOSE, STATE_HISTORY), o orchestrator precisa:

1. **Resolver quais grupos** recebem notificação para aquela rule + ação
2. **Verificar se o canal está ativo** no nível do customer (kill switch global)
3. **Verificar se o canal está ativo** no nível do grupo para aquela ação
4. **Expandir destinatários** por tipo (USER → lookup user, GROUP → membros, MANUAL → contato direto)
5. **Despachar** via o canal correto com as credenciais do customer

---

## Endpoint de Resolução de Dispatch

### `GET /api/v1/customers/:customerId/channels`

Busca todos os canais e suas credenciais para o customer.

**Headers:**
```
Authorization: Bearer <jwt>   -- ou API Key do orchestrator
X-Tenant-Id: <tenantId>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id":      "a1b2c3d4-...",
        "channel": "EMAIL_RELAY",
        "active":  true,
        "config": {
          "host":    "smtp.office365.com",
          "port":    587,
          "secure":  false,
          "user":    "alertas@moxuara.com.br",
          "from":    "Alertas MYIO <alertas@moxuara.com.br>"
        }
      },
      {
        "id":      "b2c3d4e5-...",
        "channel": "TELEGRAM",
        "active":  true,
        "config": {
          "botToken":      "7123456789:AAF...",
          "defaultChatId": "-100123456789"
        }
      }
    ]
  }
}
```

Armazene este mapa em cache (keyed por `channel`) para a duração do ciclo de dispatch. Revalide a cada 5–15 minutos ou ao detectar falha de entrega.

---

### `GET /api/v1/groups/:groupId/dispatch`

Busca a matriz `canal × ação × ativo` de um grupo.

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      { "channel": "EMAIL_RELAY", "action": "OPEN",     "active": true  },
      { "channel": "EMAIL_RELAY", "action": "ESCALATE", "active": true  },
      { "channel": "TELEGRAM",    "action": "OPEN",     "active": true  },
      { "channel": "TELEGRAM",    "action": "ESCALATE", "active": true  }
    ]
  }
}
```

---

## Algoritmo de Resolução de Dispatch

```
função resolveDispatch(rule, alarmAction, customerChannelsMap):

  actionNotif = rule.notifications[alarmAction]
  se não actionNotif ou não actionNotif.enabled:
    return []          -- nenhuma notificação para esta ação

  recipients = []

  para cada recipient em actionNotif.recipients:

    se recipient.sourceType == 'USER':
      user = gcdr.getUser(recipient.userId)
      -- despachar via email do user ou canal default do customer
      recipients.append({ type: 'USER', contact: user.email, channel: 'EMAIL_RELAY' })

    se recipient.sourceType == 'GROUP':
      groupDispatch = gcdr.getGroupDispatch(recipient.groupId)
      channelEntries = groupDispatch.filter(e => e.action == alarmAction AND e.active == true)

      para cada entry em channelEntries:
        customerChannel = customerChannelsMap[entry.channel]
        se customerChannel AND customerChannel.active:
          -- canal está ativo globalmente E ativo para esta ação no grupo
          members = gcdr.expandGroupMembers(recipient.groupId)
          recipients.append({ type: 'GROUP', channel: entry.channel, members, config: customerChannel.config })

    se recipient.sourceType == 'MANUAL':
      -- contato direto, sem verificação de dispatch matrix
      channel = recipient.channel
      customerChannel = customerChannelsMap[channel]
      se customerChannel AND customerChannel.active:
        recipients.append({ type: 'MANUAL', contact: recipient, config: customerChannel.config })

  return recipients
```

### Regra de precedência

| Layer | Controle | Resultado se inativo |
|-------|----------|----------------------|
| `customer_channels.active` | Kill switch global do canal | Canal inteiro suprimido para todos os grupos e rules |
| `group_dispatch_configs.active` | Ativação do canal × ação para o grupo | Grupo não recebe notificação para aquela ação naquele canal |
| `rule.notifications[action].enabled` | Habilitação da ação na rule | Rule inteira silenciosa para aquela ação |

**O grupo matrix sempre prevalece sobre o recipient da rule** — se o grupo tem `EMAIL_RELAY × OPEN = inactive`, o grupo não recebe email em OPEN mesmo que esteja listado em `rule.notifications.OPEN`.

---

## Consulta SQL Direta (alternativa ao HTTP)

Se o orchestrator tiver acesso direto ao PostgreSQL do GCDR, pode resolver o dispatch em uma única query:

```sql
-- Resolve canais efetivos para um grupo e uma ação de alarme
SELECT
  cc.channel,
  cc.config                     AS channel_config,
  cc.active                     AS customer_channel_active,
  gd.active                     AS group_dispatch_active,
  (cc.active AND gd.active)     AS effective
FROM group_dispatch_configs gd
JOIN groups g
  ON  g.id        = gd.group_id
JOIN customer_channels cc
  ON  cc.customer_id = g.customer_id
  AND cc.channel     = gd.channel
  AND cc.tenant_id   = gd.tenant_id
WHERE gd.tenant_id = $1
  AND gd.group_id  = $2
  AND gd.action    = $3          -- 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY'
  AND gd.active    = true
  AND cc.active    = true
ORDER BY cc.channel;
```

---

## Estrutura de `rule.notifications`

O campo `notifications` da rule (JSONB no banco) tem o formato:

```typescript
type AlarmAction = 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY';

interface RuleNotifications {
  [action in AlarmAction]?: {
    enabled: boolean;
    recipients: NotificationRecipient[];
  };
}

type NotificationRecipient =
  | { sourceType: 'USER';   userId: string;  name: string; email?: string }
  | { sourceType: 'GROUP';  groupId: string; name: string }
  | { sourceType: 'MANUAL'; name: string; channel: string;
      email?: string; telegramHandle?: string; whatsappNumber?: string };
```

### Exemplo completo

```json
{
  "OPEN": {
    "enabled": true,
    "recipients": [
      { "sourceType": "GROUP",  "groupId": "grp-operacoes-uuid",  "name": "Operações" },
      { "sourceType": "USER",   "userId":  "usr-supervisor-uuid",  "name": "Ana Lima", "email": "ana@moxuara.com" },
      { "sourceType": "MANUAL", "name": "Carlos Terceirizado", "channel": "WHATSAPP", "whatsappNumber": "+5531988880000" }
    ]
  },
  "ESCALATE": {
    "enabled": true,
    "recipients": [
      { "sourceType": "GROUP",  "groupId": "grp-gerencia-uuid", "name": "Gerência" },
      { "sourceType": "MANUAL", "name": "Planta Manager",       "channel": "EMAIL", "email": "manager@moxuara.com" }
    ]
  },
  "ACK":           { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid", "name": "Operações" }] },
  "SNOOZE":        { "enabled": false, "recipients": [] },
  "CLOSE":         { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid", "name": "Operações" }] },
  "STATE_HISTORY": { "enabled": false, "recipients": [] }
}
```

---

## Expandir Membros de Grupo

Quando um recipient é do tipo `GROUP`, os membros precisam ser expandidos no momento do disparo.

### `GET /api/v1/groups/:groupId`

```json
{
  "success": true,
  "data": {
    "id":   "grp-operacoes-uuid",
    "name": "Operações",
    "members": [
      { "userId": "usr-ana-uuid",    "name": "Ana Lima",      "email": "ana@moxuara.com" },
      { "userId": "usr-joao-uuid",   "name": "João Santos",   "email": "joao@moxuara.com" },
      { "userId": "usr-mario-uuid",  "name": "Mario Souza",   "email": "mario@moxuara.com" }
    ]
  }
}
```

Os contatos dos membros (email, telegramHandle, whatsappNumber) devem vir do perfil do user, não do grupo.

---

## Configuração por Canal (`channel_config`)

### EMAIL_RELAY

```json
{
  "host":        "smtp.office365.com",
  "port":        587,
  "secure":      false,
  "user":        "alertas@moxuara.com.br",
  "from":        "Alertas MYIO <alertas@moxuara.com.br>",
  "displayName": "Alertas MYIO"
}
```

Usar com nodemailer ou equivalente. `secure: false` + `port 587` = STARTTLS.

### TELEGRAM

```json
{
  "botToken":      "7123456789:AAF...",
  "defaultChatId": "-100123456789"
}
```

Enviar via `POST https://api.telegram.org/bot{botToken}/sendMessage` com `chat_id` = `defaultChatId` (para grupos/canais) ou `telegramHandle` do recipient (para DMs — requer que o usuário tenha iniciado conversa com o bot).

### WHATSAPP

```json
{
  "apiUrl":    "https://api.z-api.io/instances/XXX/token/YYY",
  "apiToken":  "bearer-token",
  "fromNumber": "+5531900000000"
}
```

### WEBHOOK

```json
{
  "url":    "https://ops.moxuara.com/hooks/gcdr",
  "method": "POST",
  "headers": { "X-Secret": "shared-secret" },
  "secret": "hmac-secret"
}
```

---

## Compatibilidade com Formato Legado

Rules salvas antes do RFC-0024 podem ter `notifications` no formato antigo (3 categorias fixas):

```json
{
  "alarmNotify":  { "enabled": true, "recipients": [...], "emailRelay": {...} },
  "alarmReport":  { "enabled": false, "recipients": [] },
  "alarmInsight": { "enabled": false, "recipients": [] }
}
```

O orchestrator deve ignorar silenciosamente chaves desconhecidas e só processar chaves que correspondam a `AlarmAction` válidos (`OPEN`, `ACK`, `ESCALATE`, `SNOOZE`, `CLOSE`, `STATE_HISTORY`).

Rules legadas continuam funcionando enquanto o frontend não salvar o novo formato.

---

## Alarm Bundle — Inclusão Futura

> **Status: não implementado** — planejado para RFC futuro.

No estado atual, `customer_channels` e `group_dispatch_configs` **não** fazem parte do alarm bundle exportado pelo GCDR. O orchestrator deve buscar esses dados via HTTP a cada ciclo de dispatch.

Quando incluídos no bundle, o orchestrator poderá resolver dispatch offline sem chamar o GCDR.

---

## Endpoints de Referência

| Endpoint | Uso |
|----------|-----|
| `GET /api/v1/customers/:id/channels` | Credenciais + kill switch global por canal |
| `GET /api/v1/groups/:id/dispatch` | Matriz canal × ação do grupo |
| `GET /api/v1/groups/:id` | Membros do grupo para expansão |
| `GET /api/v1/rules/:id` | Rule com campo `notifications` |
| `GET /api/v1/customers/:id/alarm-rules/bundle/verify` | Bundle completo (regras + devices + notifications) |

---

## Referências

- [RFC-0024 — Alarm Dispatch Configuration](./RFC-0024-Alarm-Dispatch-Config.md)
- [API Bundle Verify](./API-Bundle-Verify.md)
- [RULE-ENTITY](./RULE-ENTITY.md)
- [EMAIL-SENDER-PAYLOAD-CONTRACT](./EMAIL-SENDER-PAYLOAD-CONTRACT.md)
