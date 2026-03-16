# Frontend Guide — Group Purposes

> **Para:** Time de Frontend
> **Versão:** 1.0 — 2026-03-16
> **Relacionado:** `docs/FRONTEND-Templates-Engine.md`, `docs/RFC-0024-Alarm-Dispatch-Config.md`

---

## O que mudou

O campo `purposes` no cadastro e edição de grupos recebeu **5 novos valores** que alinham os grupos ao sistema de templates de email e ao fluxo de dispatch de alarmes.

É uma **adição** — os valores anteriores continuam válidos, sem breaking change.

---

## Enum completo: `GroupPurpose`

### Propósitos de comunicação (novos)

| Valor | Descrição | Template de email |
|---|---|---|
| `ALARMS_NOTIFY` | Grupo recebe notificações de alarme disparado | `EMAIL_ALARM` |
| `ALARMS_REPORT` | Grupo recebe relatórios periódicos de alarme | `EMAIL_REPORT` |
| `ALARMS_INSIGHT` | Grupo recebe resumos de insights e métricas | `INSIGHT` |
| `WELCOME_USER` | Grupo recebe emails de boas-vindas e reset de senha | `EMAIL_WELCOME` |
| `RELEASE_NOTE` | Grupo recebe comunicados de nova feature | `RELEASE_NOTE` |

### Propósitos operacionais (existentes — sem alteração)

| Valor | Descrição |
|---|---|
| `NOTIFICATION` | Notificações avulsas genéricas |
| `ESCALATION` | Cadeia de escalonamento |
| `ACCESS_CONTROL` | Gestão de permissões |
| `REPORTING` | Agrupamento para relatórios |
| `MAINTENANCE` | Agendamento de manutenção |
| `MONITORING` | Dashboards de monitoramento |
| `CUSTOM` | Propósito livre |

---

## UX recomendada — tela de cadastro de grupo

Ao exibir o seletor de `purposes`, sugerimos agrupar visualmente:

```
── Alarmes e Comunicação ─────────────────────────
  ☐ Notificações de alarme     (ALARMS_NOTIFY)
  ☐ Relatórios de alarme       (ALARMS_REPORT)
  ☐ Insights e métricas        (ALARMS_INSIGHT)
  ☐ Boas-vindas / Reset senha  (WELCOME_USER)
  ☐ Release notes              (RELEASE_NOTE)

── Operacional ───────────────────────────────────
  ☐ Notificação genérica       (NOTIFICATION)
  ☐ Escalonamento              (ESCALATION)
  ☐ Controle de acesso         (ACCESS_CONTROL)
  ☐ Relatórios                 (REPORTING)
  ☐ Manutenção                 (MAINTENANCE)
  ☐ Monitoramento              (MONITORING)
  ☐ Customizado                (CUSTOM)
```

---

## Relação com dispatch de alarmes

Grupos com purposes de alarme são os candidatos naturais para serem referenciados em `rules.notifications`:

```
Rule: "Fancoil Ligado"
  notifications.OPEN.recipients:
    → GROUP com purpose ALARMS_NOTIFY  ← notifica na abertura
  notifications.ESCALATE.recipients:
    → GROUP com purpose ALARMS_NOTIFY  ← re-notifica no escalonamento
```

O grupo com `ALARMS_NOTIFY` define também, em `group_dispatch_configs`, **quais canais** disparam para **quais ações** — e se o envio é em grupo (`GROUP`) ou individualizado (`INDIVIDUAL`). Veja `docs/RFC-0024-Alarm-Dispatch-Config.md`.

---

## Relação com templates de email

Quando o sistema dispara um email para um grupo, o template é resolvido conforme o `purpose` do grupo:

| purpose do grupo | template buscado |
|---|---|
| `ALARMS_NOTIFY` | `EMAIL_ALARM` |
| `ALARMS_REPORT` | `EMAIL_REPORT` |
| `ALARMS_INSIGHT` | `INSIGHT` |
| `WELCOME_USER` | `EMAIL_WELCOME` |
| `RELEASE_NOTE` | `RELEASE_NOTE` |

A resolução do template segue a hierarquia: customer próprio → customer pai → tenant padrão. Veja `docs/FRONTEND-Templates-Engine.md`.

---

## Endpoints

Sem mudança nos endpoints de grupo — a alteração é apenas nos valores aceitos em `purposes`.

```
POST  /api/v1/groups          → campo purposes aceita os novos valores
PATCH /api/v1/groups/:id      → idem
GET   /api/v1/groups          → filtro ?purpose= aceita os novos valores
```

Catálogo de valores disponíveis (novo endpoint planejado):
```
GET /api/v1/groups/purposes   → lista todos os GroupPurpose com label e descrição
```

---

## Referências

- **RFC dispatch:** `docs/RFC-0024-Alarm-Dispatch-Config.md`
- **Templates:** `docs/FRONTEND-Templates-Engine.md`
- **OpenAPI:** `docs/openapi.yaml` — schema `GroupPurpose` atualizado
