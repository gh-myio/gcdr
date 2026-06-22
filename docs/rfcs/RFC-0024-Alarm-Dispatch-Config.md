# RFC-0024: Alarm Dispatch Configuration & Rule Notifications Redesign

- **Feature Name**: `alarm-dispatch-config`
- **Start Date**: 2026-03-12
- **RFC PR**: (pending)
- **Related RFCs**: [RFC-0023 Device Sync Job API](./RFC-0023-Device-Sync-Job-API.md), [RULE-ENTITY](../alarms/RULE-ENTITY.md)

---

## Summary

Introduce a three-layer alarm dispatch system that controls **which notification channels fire for which alarm lifecycle actions**, with a redesigned `RuleNotifications` model that supports per-action recipient lists and multi-channel contacts.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           GCDR — Alarm Dispatch Stack                           │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  CUSTOMER  (e.g. Moxuara)                                                │
  │                                                                          │
  │  LAYER 1 — customer_channels  (kill switch + credentials)                │
  │  ┌───────────────┬──────────┬──────────────────────────────────────┐    │
  │  │ channel       │ active   │ config (credentials)                  │    │
  │  ├───────────────┼──────────┼──────────────────────────────────────┤    │
  │  │ EMAIL_RELAY   │ ✅ true  │ { host, port, from, user, pass }     │    │
  │  │ TELEGRAM      │ ✅ true  │ { botToken: "7123..." }              │    │
  │  │ WHATSAPP      │ ❌ false │ { apiUrl, token }                    │    │
  │  │ WEBHOOK       │ ✅ true  │ { url, secret }                      │    │
  │  └───────────────┴──────────┴──────────────────────────────────────┘    │
  │                          │                                               │
  │          ┌───────────────┴───────────────┐                              │
  │          ▼                               ▼                              │
  │  ┌───────────────────────┐   ┌───────────────────────┐                 │
  │  │  GROUP: Operações      │   │  GROUP: Gerência       │                │
  │  │  purpose: ALARMS_NOTIFY│   │  purpose: ALARMS_NOTIFY│                │
  │  │                       │   │                        │                 │
  │  │  LAYER 2 — dispatch    │   │  LAYER 2 — dispatch    │                │
  │  │  group_dispatch_configs│   │  group_dispatch_configs│                │
  │  └───────────────────────┘   └───────────────────────┘                 │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  LAYER 3 — rules.notifications  (per-action recipients, JSONB)           │
  │                                                                          │
  │  Rule: "Fancoil Ligado"                                                  │
  │    OPEN     → Group: Operações, User: Ana Lima                           │
  │    ESCALATE → Group: Gerência, Manual: Carlos (+5531...)                 │
  │    ACK      → Group: Operações                                           │
  │    CLOSE    → Group: Operações                                           │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Dispatch Resolution Flow

```
Alarm event fires (action = OPEN, ruleId = X)
        │
        ▼
 ┌──────────────────────────────────┐
 │  1. Load rule.notifications.OPEN │
 │     → recipients: [grp-operacoes]│
 └──────────────┬───────────────────┘
                │
                ▼
 ┌──────────────────────────────────┐
 │  2. For each GROUP recipient:    │
 │     Load group_dispatch_configs  │
 │     WHERE group_id = grp-operacoes│
 │       AND action = 'OPEN'        │
 │     → [EMAIL_RELAY, TELEGRAM]    │
 └──────────────┬───────────────────┘
                │
                ▼
 ┌──────────────────────────────────┐
 │  3. For each channel:            │
 │     JOIN customer_channels       │
 │     WHERE customer_id = moxuara  │
 │       AND channel = EMAIL_RELAY  │
 │     → active = true? ✅          │
 │     → config = { smtp creds }    │
 └──────────────┬───────────────────┘
                │
                ▼
 ┌──────────────────────────────────────────────────────────┐
 │  4. Resolve recipients by delivery_mode:                  │
 │                                                           │
 │  delivery_mode = GROUP                                    │
 │    → send to dispatch_config.target (chat_id or email)   │
 │    → one message to the group destination                 │
 │                                                           │
 │  delivery_mode = INDIVIDUAL                               │
 │    → expand group.members                                 │
 │    → load user_contacts for each member                   │
 │    → send one message per person                          │
 └──────────────────────────────────────────────────────────┘
```

---

## Entity Relationship

```
CUSTOMER
  │
  ├─── customer_channels  (1:N per customer)
  │      channel: EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SMS
  │      active:  ✅ / ❌  ← global kill switch
  │      config:  credentials (SMTP, bot token, API key, etc.)
  │
  └─── GROUPS  (N per customer)
         purpose: ALARMS_NOTIFY | ALARMS_REPORT | ALARMS_INSIGHT | …
         members: [USER, DEVICE, ASSET]
         │
         └─── group_dispatch_configs  (N per group)
                channel:                  EMAIL_RELAY | TELEGRAM | …
                action:                   OPEN | ACK | ESCALATE | SNOOZE | CLOSE | STATE_HISTORY
                active:                   ✅ / ❌
                delivery_mode:            GROUP | INDIVIDUAL
                target:                   "-100123456" (chat_id) or "ops@moxuara.com"
                escalation_delay_ms: 0 | 5000 | 15000 | 30000 …


RULE
  └─── notifications  (JSONB, keyed by AlarmAction)
         OPEN:
           recipients:
             - { sourceType: GROUP,  groupId: "grp-operacoes" }
             - { sourceType: USER,   userId:  "usr-ana" }
             - { sourceType: MANUAL, channel: TELEGRAM, handle: "@carlos" }
         ESCALATE:
           recipients:
             - { sourceType: GROUP, groupId: "grp-gerencia" }
```

---

## Layer Semantics

| Layer | Table | Owns | Controls |
|---|---|---|---|
| 1 | `customer_channels` | Customer | Is the channel available? (credentials + kill switch) |
| 2 | `group_dispatch_configs` | Group | Which channel × action combos fire? And how? (GROUP vs INDIVIDUAL) |
| 3 | `rules.notifications` | Rule | Who are the recipients for each action? |

A notification fires **only when all three layers are active**.

---

## `delivery_mode`: GROUP vs INDIVIDUAL

```
delivery_mode = GROUP
┌───────────────────────────────────────────┐
│  Telegram channel, action = OPEN           │
│  target = "-100123456789" (group chat_id)  │
│                                            │
│  → ONE message sent to the Telegram group  │
│  → All members see it in the chat          │
└───────────────────────────────────────────┘

delivery_mode = INDIVIDUAL
┌───────────────────────────────────────────┐
│  Email channel, action = ESCALATE          │
│  target = NULL (irrelevant)                │
│                                            │
│  → Expand group.members (USERs)            │
│  → Load user_contacts for each user        │
│     (from user_contacts table, RFC-0025)   │
│  → Send one email per person               │
│     → ana@moxuara.com                      │
│     → carlos@moxuara.com                   │
└───────────────────────────────────────────┘
```

---

## `customer_channels` — credentials matrix

| Channel | Required config keys | Purpose |
|---|---|---|
| `EMAIL_RELAY` | `host`, `port`, `secure`, `user`, `pass`, `from` | SMTP relay |
| `TELEGRAM` | `botToken` | Bot API token, shared across all groups |
| `WHATSAPP` | `apiUrl`, `apiToken`, `fromNumber` | WhatsApp Business API |
| `WEBHOOK` | `url`, `method`, `headers`, `secret` | Generic HTTP call |
| `SMS` | `provider`, `apiKey`, `fromNumber` | SMS gateway |
| `SLACK` | `webhookUrl` or `botToken`, `defaultChannel` | Slack workspace |
| `TEAMS` | `webhookUrl` | Microsoft Teams connector |

The customer configures credentials **once**. All groups that use `TELEGRAM` share the same `botToken`. Each group defines its own `target` (chat_id) in `group_dispatch_configs`.

---

## Guide-Level Explanation

### Conceptual model

Think of alarm dispatch as a three-layer gate:

```
LAYER 1 — Customer Channel Registry
  "Does this customer have EMAIL_RELAY configured and turned on globally?"

LAYER 2 — Group Dispatch Matrix
  "For Group: Operações, does EMAIL_RELAY fire on OPEN events?
   And does it send to a group inbox (GROUP) or per-person (INDIVIDUAL)?"

LAYER 3 — Rule Notifications
  "For this specific rule, who are the recipients for OPEN events?"
```

### Example: Moxuara, alarm OPEN

```
customer_channels (Moxuara):
  EMAIL_RELAY → ✅ active, smtp.office365.com
  TELEGRAM    → ✅ active, botToken: "7123..."

Rule "Fancoil Ligado" → notifications.OPEN.recipients:
  → GROUP: grp-operacoes

group_dispatch_configs (grp-operacoes):
  ┌──────────────┬──────────┬────────┬───────────────┬───────────────────────────┬──────────┐
  │ channel      │ action   │ active │ delivery_mode │ target                    │ delay ms │
  ├──────────────┼──────────┼────────┼───────────────┼───────────────────────────┼──────────┤
  │ EMAIL_RELAY  │ OPEN     │ ✅     │ INDIVIDUAL    │ NULL (per-user contacts)  │ 0        │
  │ EMAIL_RELAY  │ ACK      │ ✅     │ INDIVIDUAL    │ NULL                      │ 0        │
  │ EMAIL_RELAY  │ ESCALATE │ ✅     │ INDIVIDUAL    │ NULL                      │ 0        │
  │ TELEGRAM     │ OPEN     │ ✅     │ GROUP         │ -100123456789             │ 0        │
  │ TELEGRAM     │ ESCALATE │ ✅     │ GROUP         │ -100123456789             │ 5000     │
  └──────────────┴──────────┴────────┴───────────────┴───────────────────────────┴──────────┘

Effective dispatch on OPEN:
  • EMAIL_RELAY: expand grp-operacoes members → load user_contacts → send per-person
  • TELEGRAM:    send one message to chat -100123456789
```

---

## Reference-Level Explanation

### Table: `customer_channels`

```sql
CREATE TABLE customer_channels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  customer_id uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel     varchar(50) NOT NULL,
  -- EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SMS | SLACK | TEAMS | CUSTOM
  active      boolean     NOT NULL DEFAULT true,
  config      jsonb       NOT NULL DEFAULT '{}',
  -- EMAIL_RELAY:  { host, port, secure, user, from, displayName }
  -- TELEGRAM:     { botToken, defaultChatId }
  -- WHATSAPP:     { apiUrl, apiToken, fromNumber }
  -- WEBHOOK:      { url, method, headers, secret }
  -- SMS:          { provider, apiKey, fromNumber }
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (tenant_id, customer_id, channel)
);
```

### Table: `group_dispatch_configs`

```sql
CREATE TYPE alarm_action AS ENUM ('OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY');
CREATE TYPE delivery_mode AS ENUM ('GROUP', 'INDIVIDUAL');

CREATE TABLE group_dispatch_configs (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid          NOT NULL,
  group_id                 uuid          NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel                  varchar(50)   NOT NULL,
  action                   alarm_action  NOT NULL,
  active                   boolean       NOT NULL DEFAULT true,
  delivery_mode            delivery_mode NOT NULL DEFAULT 'INDIVIDUAL',
  -- GROUP:      send to `target` (group chat_id, group email alias, etc.)
  -- INDIVIDUAL: expand members → lookup user_contacts → send per-person
  target                   text,
  -- Used when delivery_mode = GROUP:
  --   TELEGRAM → chat_id (e.g. "-100123456789")
  --   EMAIL_RELAY → group alias (e.g. "ops@moxuara.com")
  --   SLACK → channel name (e.g. "#alertas-criticos")
  --   NULL when delivery_mode = INDIVIDUAL
  escalation_delay_ms int           NOT NULL DEFAULT 0,
  -- Minutes to wait before sending this channel+action combination
  -- Useful for escalation chains: EMAIL fires at 0ms, TELEGRAM at 5000ms
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_id, channel, action)
);
```

### Escalation delay example

```
Group: Gerência — action: ESCALATE
  ┌──────────────┬──────────────────┬──────────────────────────┐
  │ channel      │ delay (ms)       │ behavior                 │
  ├──────────────┼──────────────────┼──────────────────────────┤
  │ EMAIL_RELAY  │ 0                │ fires immediately        │
  │ TELEGRAM     │ 5000             │ fires after 5 000ms (5s)  │
  │ SMS          │ 15000            │ fires after 15 000ms (15s)│
  └──────────────┴──────────────────┴──────────────────────────┘

If alarm is ACKed before the delay elapses → delayed channels are cancelled.
```

### Drizzle schema additions

```typescript
// src/infrastructure/database/drizzle/schema.ts

export const alarmActionEnum = pgEnum('alarm_action', [
  'OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY',
]);

export const deliveryModeEnum = pgEnum('delivery_mode', ['GROUP', 'INDIVIDUAL']);

export const customerChannels = pgTable('customer_channels', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  channel:    varchar('channel', { length: 50 }).notNull(),
  active:     boolean('active').notNull().default(true),
  config:     jsonb('config').notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid('created_by'),
}, (table) => ({
  tenantCustomerChannelUnique: uniqueIndex('customer_channels_unique').on(table.tenantId, table.customerId, table.channel),
  tenantCustomerIdx: index('customer_channels_tenant_customer_idx').on(table.tenantId, table.customerId),
}));

export const groupDispatchConfigs = pgTable('group_dispatch_configs', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull(),
  groupId:                uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  channel:                varchar('channel', { length: 50 }).notNull(),
  action:                 alarmActionEnum('action').notNull(),
  active:                 boolean('active').notNull().default(true),
  deliveryMode:           deliveryModeEnum('delivery_mode').notNull().default('INDIVIDUAL'),
  target:                 text('target'),
  escalationDelayMs: integer('escalation_delay_ms').notNull().default(0),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantGroupChannelActionUnique: uniqueIndex('group_dispatch_configs_unique').on(table.tenantId, table.groupId, table.channel, table.action),
  tenantGroupIdx: index('group_dispatch_configs_tenant_group_idx').on(table.tenantId, table.groupId),
}));
```

### Revised TypeScript types (Rule entity)

```typescript
// src/domain/entities/Rule.ts

export type AlarmAction = 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY';
export type NotificationChannel = 'EMAIL_RELAY' | 'TELEGRAM' | 'WHATSAPP' | 'WEBHOOK' | 'SMS' | 'SLACK' | 'TEAMS' | 'CUSTOM';
export type DeliveryMode = 'GROUP' | 'INDIVIDUAL';
export type RecipientSourceType = 'USER' | 'GROUP' | 'MANUAL';

export interface NotificationRecipient {
  sourceType: RecipientSourceType;
  userId?:         string;   // USER
  groupId?:        string;   // GROUP
  name?:           string;   // MANUAL
  channel?:        NotificationChannel; // MANUAL
  email?:          string;   // MANUAL EMAIL
  telegramHandle?: string;   // MANUAL TELEGRAM
  whatsappNumber?: string;   // MANUAL WHATSAPP
}

export interface RuleActionNotification {
  enabled:    boolean;
  recipients: NotificationRecipient[];
}

export type RuleNotifications = Partial<Record<AlarmAction, RuleActionNotification>>;
```

### New API endpoints

```
# Customer Channels
GET    /api/v1/customers/:customerId/channels
POST   /api/v1/customers/:customerId/channels
PATCH  /api/v1/customers/:customerId/channels/:channel    (toggle active, update config)
DELETE /api/v1/customers/:customerId/channels/:channel

# Group Dispatch Matrix
GET    /api/v1/groups/:groupId/dispatch
PUT    /api/v1/groups/:groupId/dispatch                   (replace full matrix)
PATCH  /api/v1/groups/:groupId/dispatch/:channel/:action  (toggle single cell)

# Catalog endpoints (static)
GET    /api/v1/groups/purposes                            (list all GroupPurpose values)
GET    /api/v1/groups/channels                            (list all supported channel types)
```

### Effective dispatch resolution query

```sql
-- Resolve active dispatch configs for a given group and alarm action,
-- joined with customer channel credentials and kill switch status.
SELECT
  cc.channel,
  cc.config                           AS channel_config,
  cc.active                           AS customer_active,
  gd.active                           AS group_active,
  gd.delivery_mode,
  gd.target,
  gd.escalation_delay_ms,
  (cc.active AND gd.active)           AS effective
FROM group_dispatch_configs gd
JOIN groups g          ON g.id = gd.group_id
JOIN customer_channels cc
  ON  cc.customer_id = g.customer_id
  AND cc.channel     = gd.channel
  AND cc.tenant_id   = gd.tenant_id
WHERE gd.group_id = :groupId
  AND gd.action   = :action
ORDER BY gd.escalation_delay_ms, cc.channel;
```

### Frontend UX — Rule Notifications tab

```
OPEN          [● enabled]
  ├── Grupo: Operações                [×]
  ├── User:  Ana Lima (ana@moxuara)   [×]
  └── [+ Add recipient]

ESCALATE      [● enabled]
  ├── Grupo: Gerência                 [×]
  ├── Manual: Carlos (+5531988...)    [×]
  └── [+ Add recipient]

ACK [● enabled]   SNOOZE [○ disabled]   CLOSE [● enabled]   STATE_HISTORY [○ disabled]
```

**[+ Add recipient] — 3-step wizard:**

```
Step 1 — Recipient type
  ○ System User    (search from customer user list)
  ○ Group          (reference only — group carries members and channel config)
  ○ Manual         (free-form — person outside the system)

Step 2 — Contact details  (only for Manual)
  Channel:  [EMAIL_RELAY]  [TELEGRAM]  [WHATSAPP]

  → EMAIL:     Full name + email address
  → TELEGRAM:  Name + @handle
  → WHATSAPP:  Name + phone number (+CC DDD NNNNNNNN)

Step 3 — Summary & confirm
```

### Frontend UX — Group Dispatch Matrix (Settings page)

```
Group: Operações — Notification Channels
─────────────────────────────────────────────────────────────
              │ OPEN │ ACK  │ ESCALATE │ SNOOZE │ CLOSE │ …
──────────────┼──────┼──────┼──────────┼────────┼───────┤
EMAIL_RELAY   │  ✅  │  ✅  │    ✅    │   ❌   │  ✅   │
  mode: INDIVIDUAL                                       │
  delay: 0ms                                             │
──────────────┼──────┼──────┼──────────┼────────┼───────┤
TELEGRAM      │  ✅  │  ❌  │    ✅    │   ❌   │  ❌   │
  mode: GROUP                                            │
  target: -100123456789                                  │
  delay: 5000ms (ESCALATE only)                          │
─────────────────────────────────────────────────────────
```

---

## Migration plan

- **Migration 0014** (✅ ran in prod 2026-03-16): `alarm_action` enum + `customer_channels` + `group_dispatch_configs` (original shape, no `delivery_mode`/`target`/`escalation_delay_ms`)
- **Migration 0018** (⏳ pending): Add `delivery_mode` enum + add columns `delivery_mode`, `target`, `escalation_delay_ms` to `group_dispatch_configs`

```sql
-- migration 0018 (planned)
CREATE TYPE delivery_mode AS ENUM ('GROUP', 'INDIVIDUAL');

ALTER TABLE group_dispatch_configs
  ADD COLUMN delivery_mode            delivery_mode NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN target                   text,
  ADD COLUMN escalation_delay_ms int           NOT NULL DEFAULT 0;
```

No data migration needed for `rules.notifications` — old JSONB shape keys (`alarmNotify`, `alarmReport`, `alarmInsight`) are silently ignored by the new reader. New keys (`OPEN`, `ACK`, etc.) are populated on first edit.

---

## Drawbacks

- Two new tables add surface area. Teams must understand the customer → group → rule hierarchy to configure dispatch correctly.
- Effective-dispatch resolution requires a JOIN across 3 tables at notification time.
- `delivery_mode = INDIVIDUAL` requires expanding group membership at dispatch time, adding an extra lookup against `user_contacts`.
- Manual contacts with no verification (Phase 1) means a misconfigured handle silently fails.

---

## Rationale and Alternatives

### Why `delivery_mode` per dispatch config row (not per group)?

Different channels within the same group may have different delivery semantics. Telegram fires to a group chat (`GROUP` mode) while email goes per-person (`INDIVIDUAL` mode). Putting `delivery_mode` at the row level enables this naturally.

### Why `target` per row instead of in `customer_channels.config`?

A customer bot token is shared (`customer_channels.config.botToken`), but each group has a **different** Telegram chat ID (`target`). Separating credentials (customer level) from routing destination (group level) keeps them DRY.

### Why `escalation_delay_ms` at the dispatch config level?

Delay is a property of the channel × action × group combination — "send SMS 15 000ms after ESCALATE fires for group Gerência." It cannot live at the customer channel level (too broad) or at the rule level (too narrow). The dispatch matrix row is the right owner.

### Why keyed by `AlarmAction` instead of three fixed categories?

The three-category model (`alarmNotify`, `alarmReport`, `alarmInsight`) conflates *what happened* with *how to respond*. Alarm lifecycle events are deterministic, exhaustive, and directly meaningful to operators.

### Why a separate `customer_channels` table?

Credentials need independent `active` flags for SQL-level kill switches and must be queryable without deserializing a full customer config blob.

---

## Prior Art

- **PagerDuty**: Service-level notification policies with per-severity escalation routes.
- **OpsGenie**: Team-based on-call routing with multi-channel per alert type.
- **Grafana Alerting**: Contact points (channels) + notification policies (routing rules) — direct inspiration for the customer/group split.

---

## Unresolved Questions

1. **Contact verification (Phase 2)**: Should MANUAL recipients receive a verification code before being activated?
2. **Orchestrator integration**: Should GCDR expose a dedicated resolution endpoint `GET /dispatch/resolve?groupId=&action=` or should the orchestrator JOIN itself via the alarm bundle?
3. **Group membership expansion**: Who expands group members at dispatch time — GCDR or the orchestrator?
4. **Channel enum extensibility**: `varchar(50)` vs `pgEnum` — new channels (LINE, Discord) would require a migration to add enum values.
5. **Credential encryption**: Should `customer_channels.config` (SMTP passwords, bot tokens) be encrypted at rest?
6. **Rule vs group conflict**: If `notifications.OPEN` lists Group A but Group A has `EMAIL_RELAY × OPEN = inactive`, group matrix wins (current proposal).

---

## Future Possibilities

- **Scheduled suppression**: Integrate with `MAINTENANCE_WINDOW` rules to auto-disable dispatch during maintenance.
- **Per-action templates**: Custom message templates per alarm action and channel.
- **Delivery receipts**: `notification_logs` table tracking delivered/opened/failed per recipient.
- **Bundle inclusion**: Include resolved `customerChannels` and `groupDispatchConfigs` in the alarm bundle for offline resolution by Node-RED.
- **Rate limiting**: Prevent notification flooding for noisy rules (complementing `cooldown` guard config on `AlarmThresholdConfig`).
