# RFC-0024: Alarm Dispatch Configuration & Rule Notifications Redesign

- **Feature Name**: `alarm-dispatch-config`
- **Start Date**: 2026-03-12
- **RFC PR**: (pending)
- **Related RFCs**: [RFC-0023 Device Sync Job API](./RFC-0023-Device-Sync-Job-API.md), [RULE-ENTITY](./RULE-ENTITY.md)

---

## Summary

Introduce a two-level alarm dispatch configuration system that controls **which notification channels fire for which alarm lifecycle actions**, with a redesigned `RuleNotifications` model that supports per-action recipient lists and multi-channel contacts (EMAIL, TELEGRAM, WHATSAPP).

The system has two orthogonal layers:

1. **Customer-level channel registry** (`customer_channels`) — defines available channels and their credentials (SMTP relay, bot token, webhook URL) with a global active toggle per channel.
2. **Group-level dispatch matrix** (`group_dispatch_configs`) — a `(channel × action × active)` matrix that controls which groups receive which channels for which alarm lifecycle actions.
3. **Rule-level notifications** (existing JSONB, reshaped) — per-action recipient lists within a rule, referencing USERs, GROUPs, or MANUAL contacts with per-recipient channel selection.

---

## Motivation

The current `notifications` field on the `rules` table uses three fixed categories (`alarmNotify`, `alarmReport`, `alarmInsight`) and supports only EMAIL as a contact channel per recipient. This is insufficient for the following use cases:

- **Alarm lifecycle granularity**: operators need to control notification dispatch per alarm action — OPEN, ACK, ESCALATE, SNOOZE, CLOSE, STATE_HISTORY — independently. "Notify group A when an alarm opens, but only notify manager B when it escalates" is not expressible today.
- **Multi-channel contacts**: recipients may prefer Telegram or WhatsApp instead of email. The current model stores only `email` per recipient with no channel selection.
- **Customer-level kill switches**: when a channel integration breaks (e.g., SMTP relay goes down), there is no way to disable EMAIL for all groups and rules of a customer at once without touching every rule individually.
- **Group-level dispatch**: groups already aggregate users and channels. Repeating user lists inside rules creates duplication and drift. A group reference should be sufficient — the group carries its own membership.
- **Manual contacts**: on-call contractors or external stakeholders may not have GCDR user accounts but must still receive alarm notifications.

Without this RFC, every new notification requirement requires modifying individual rules, with no cross-cutting customer-level control.

---

## Guide-Level Explanation

### Conceptual model

Think of alarm dispatch as a three-layer gate:

```
LAYER 1 — Customer Channel Registry
  "Does this customer have EMAIL_RELAY configured and turned on globally?"

LAYER 2 — Group Dispatch Matrix
  "For Group A, does EMAIL_RELAY fire on OPEN events?"

LAYER 3 — Rule Notifications
  "For this specific rule, who are the recipients for OPEN events?"
```

A notification is dispatched only when all three layers say yes.

### Customer channels

A customer registers channels once with their credentials. The `active` flag acts as a global kill switch:

```
customer: Moxuara
  EMAIL_RELAY  active=true   config: { host: smtp.office365.com, port: 587, from: alerts@moxuara.com }
  TELEGRAM     active=true   config: { botToken: "7123...", defaultChatId: "-100123..." }
  WHATSAPP     active=false  config: { apiUrl: "...", token: "..." }
  WEBHOOK      active=true   config: { url: "https://ops.moxuara.com/hooks/gcdr", secret: "..." }
```

Turning off `TELEGRAM` at the customer level immediately suppresses Telegram notifications across all groups and rules for that customer — no individual rule changes needed.

### Group dispatch matrix

Groups define which channels trigger for which alarm actions:

```
Group: Operações (belongs to Moxuara)
  EMAIL_RELAY  × OPEN          → active
  EMAIL_RELAY  × ACK           → active
  EMAIL_RELAY  × ESCALATE      → active
  EMAIL_RELAY  × SNOOZE        → inactive
  EMAIL_RELAY  × CLOSE         → active
  EMAIL_RELAY  × STATE_HISTORY → inactive
  TELEGRAM     × OPEN          → active
  TELEGRAM     × ESCALATE      → active

Group: Gerência (belongs to Moxuara)
  EMAIL_RELAY  × ESCALATE      → active
  EMAIL_RELAY  × CLOSE         → active
```

### Rule notifications

Within a rule, notifications are keyed by alarm action. Each action holds a recipient list:

```json
{
  "OPEN": {
    "enabled": true,
    "recipients": [
      { "sourceType": "GROUP",  "groupId": "grp-operacoes-uuid" },
      { "sourceType": "USER",   "userId": "usr-supervisor-uuid" },
      { "sourceType": "MANUAL", "name": "Carlos Terceirizado",
        "channel": "WHATSAPP",  "whatsappNumber": "+5531988880000" }
    ]
  },
  "ESCALATE": {
    "enabled": true,
    "recipients": [
      { "sourceType": "GROUP",  "groupId": "grp-gerencia-uuid" },
      { "sourceType": "MANUAL", "name": "Planta Manager",
        "channel": "EMAIL",     "email": "manager@moxuara.com" }
    ]
  },
  "ACK":           { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid" }] },
  "SNOOZE":        { "enabled": false, "recipients": [] },
  "CLOSE":         { "enabled": true,  "recipients": [{ "sourceType": "GROUP", "groupId": "grp-operacoes-uuid" }] },
  "STATE_HISTORY": { "enabled": false, "recipients": [] }
}
```

### Frontend UX — Rule Notifications tab

The Notifications tab in a rule detail view renders one section per `AlarmAction`:

```
OPEN          [● enabled]
  ├── Grupo: Operações                [×]
  ├── User:  Ana Lima (ana@moxuara)   [×]
  └── [+ Add recipient]

ESCALATE      [● enabled]
  ├── Grupo: Gerência                 [×]
  ├── Manual: Carlos (+5531988...)    [×]
  └── [+ Add recipient]

ACK           [● enabled]   SNOOZE [○ disabled]   CLOSE [● enabled]   STATE_HISTORY [○ disabled]
```

**[+ Add recipient] wizard — 3 steps:**

```
Step 1 — Recipient type
  ○ System User    (search from customer user list — data pre-filled)
  ○ Group          (reference only — group carries members and channels)
  ○ Manual         (free-form — person outside the system)

Step 2 — Contact details  (only for Manual)
  Channel:  [EMAIL]  [TELEGRAM]  [WHATSAPP]

  → EMAIL:     Full name  +  email address
  → TELEGRAM:  Name       +  @handle
  → WHATSAPP:  Name       +  phone number  (+CC DDD NNNNNNNN)

Step 3 — Summary & confirm
  Review all fields before saving.
  (Verification code flow — Phase 2, see Unresolved Questions)
```

---

## Reference-Level Explanation

### New table: `customer_channels`

```sql
CREATE TABLE customer_channels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  customer_id uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel     varchar(50) NOT NULL,   -- EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SMS | SLACK | TEAMS | CUSTOM
  active      boolean     NOT NULL DEFAULT true,
  config      jsonb       NOT NULL DEFAULT '{}',
  -- Channel-specific config (never stored in plaintext passwords in logs):
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

CREATE INDEX customer_channels_tenant_customer_idx ON customer_channels (tenant_id, customer_id);
CREATE INDEX customer_channels_tenant_active_idx   ON customer_channels (tenant_id, active);
```

### New table: `group_dispatch_configs`

```sql
CREATE TYPE alarm_action AS ENUM ('OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY');

CREATE TABLE group_dispatch_configs (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid        NOT NULL,
  group_id  uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel   varchar(50) NOT NULL,  -- must match a customer_channels.channel for the group's customer
  action    alarm_action NOT NULL,
  active    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_id, channel, action)
);

CREATE INDEX group_dispatch_configs_tenant_group_idx ON group_dispatch_configs (tenant_id, group_id);
```

### Drizzle schema additions

```typescript
// src/infrastructure/database/drizzle/schema.ts

export const alarmActionEnum = pgEnum('alarm_action', [
  'OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY',
]);

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
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  groupId:   uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  channel:   varchar('channel', { length: 50 }).notNull(),
  action:    alarmActionEnum('action').notNull(),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantGroupChannelActionUnique: uniqueIndex('group_dispatch_configs_unique').on(table.tenantId, table.groupId, table.channel, table.action),
  tenantGroupIdx: index('group_dispatch_configs_tenant_group_idx').on(table.tenantId, table.groupId),
}));
```

### Revised TypeScript types (Rule entity)

```typescript
// src/domain/entities/Rule.ts

export type AlarmAction = 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY';
export type NotificationChannel = 'EMAIL' | 'TELEGRAM' | 'WHATSAPP' | 'WEBHOOK' | 'SMS' | 'SLACK' | 'TEAMS' | 'CUSTOM';

export type RecipientSourceType = 'USER' | 'GROUP' | 'MANUAL';

export interface NotificationRecipient {
  sourceType: RecipientSourceType;

  // USER — resolved from customer user list
  userId?:  string;

  // GROUP — reference only; group carries its own members and channel config
  groupId?: string;

  // MANUAL — free-form contact not in the system
  name?:            string;
  channel?:         NotificationChannel;
  email?:           string;   // EMAIL channel
  telegramHandle?:  string;   // TELEGRAM channel (@username)
  whatsappNumber?:  string;   // WHATSAPP channel (+CC DDD NNNNNNNN)
}

export interface RuleActionNotification {
  enabled:    boolean;
  recipients: NotificationRecipient[];
}

// Replaces the old RuleNotifications type
export type RuleNotifications = Partial<Record<AlarmAction, RuleActionNotification>>;
```

### Revised Zod schemas (RuleDTO)

```typescript
// src/dto/request/RuleDTO.ts

const AlarmActionEnum = z.enum(['OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY']);

const NotificationRecipientSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('USER'),
    userId:     z.string().uuid(),
  }),
  z.object({
    sourceType: z.literal('GROUP'),
    groupId:    z.string().uuid(),
  }),
  z.object({
    sourceType: z.literal('MANUAL'),
    name:       z.string().min(1).max(255),
    channel:    z.enum(['EMAIL', 'TELEGRAM', 'WHATSAPP', 'WEBHOOK', 'SMS', 'SLACK', 'TEAMS', 'CUSTOM']),
    email:           z.string().email().optional(),
    telegramHandle:  z.string().regex(/^@\w+$/).optional(),
    whatsappNumber:  z.string().regex(/^\+\d{7,15}$/).optional(),
  }).refine(d => {
    if (d.channel === 'EMAIL')    return !!d.email;
    if (d.channel === 'TELEGRAM') return !!d.telegramHandle;
    if (d.channel === 'WHATSAPP') return !!d.whatsappNumber;
    return true;
  }, { message: 'Contact field required for selected channel' }),
]);

const RuleActionNotificationSchema = z.object({
  enabled:    z.boolean(),
  recipients: z.array(NotificationRecipientSchema).max(100),
});

const RuleNotificationsSchema = z.record(AlarmActionEnum, RuleActionNotificationSchema).optional();
```

### New API endpoints

```
# Customer Channels
GET    /api/v1/customers/:customerId/channels
POST   /api/v1/customers/:customerId/channels
PATCH  /api/v1/customers/:customerId/channels/:channel       (toggle active, update config)
DELETE /api/v1/customers/:customerId/channels/:channel

# Group Dispatch Matrix
GET    /api/v1/groups/:groupId/dispatch
PUT    /api/v1/groups/:groupId/dispatch                      (replace full matrix)
PATCH  /api/v1/groups/:groupId/dispatch/:channel/:action     (toggle single cell)
```

### Effective dispatch resolution query

```sql
-- Resolve active channels for a given group and alarm action
SELECT
  cc.channel,
  cc.config                             AS channel_config,
  gd.active                             AS group_active,
  cc.active                             AS customer_active,
  (cc.active AND gd.active)             AS effective
FROM group_dispatch_configs gd
JOIN groups g         ON g.id = gd.group_id
JOIN customer_channels cc
  ON  cc.customer_id = g.customer_id
  AND cc.channel     = gd.channel
  AND cc.tenant_id   = gd.tenant_id
WHERE gd.group_id = :groupId
  AND gd.action   = :action
ORDER BY cc.channel;
```

### Migration plan

- **Migration 0014**: Add `customer_channels` table + `alarm_action` enum + `group_dispatch_configs` table.
- **No data migration needed** for `rules.notifications` — JSONB shape is backwards compatible; old shape keys (`alarmNotify`, `alarmReport`, `alarmInsight`) are silently ignored by the new reader. New shape keys (`OPEN`, `ACK`, etc.) are populated on first edit.
- **Response DTO fix**: `notifications` field was missing from `RuleResponseDTO` — add it in the same PR.

---

## Drawbacks

- **Two new tables** add surface area to the schema. Teams unfamiliar with the hierarchy may not understand why channels are defined at customer level but activated at group level.
- **Effective-dispatch resolution** requires a JOIN across 3 tables at notification time — the alarm orchestrator must implement this query or call a GCDR endpoint.
- **Manual contacts with no verification** (Phase 1) means a misconfigured Telegram handle or WhatsApp number silently fails. Phase 2 verification codes are non-trivial to implement for Telegram/WhatsApp.
- **Group reference only** (no inline users in GROUP recipients) means the alarm orchestrator must expand group membership at dispatch time, adding an extra lookup.

---

## Rationale and Alternatives

### Why keyed by `AlarmAction` instead of three fixed categories?

The three-category model (`alarmNotify`, `alarmReport`, `alarmInsight`) conflates **what happened** (alarm fired) with **how to respond** (notify, report, analyze). Alarm lifecycle events (OPEN, ACK, ESCALATE, SNOOZE, CLOSE, STATE_HISTORY) are deterministic, exhaustive, and directly meaningful to operators.

### Why a separate `customer_channels` table instead of JSONB on customers?

The `customers.config` JSONB field (RFC-0019) could hold channel config, but:
- Channels need independent `active` flags for SQL-level kill switches.
- Channel credentials need to be queryable without deserializing the full customer config blob.
- Adding TELEGRAM, WHATSAPP, WEBHOOK etc. as opaque JSON keys inside `customers.config` would make the schema implicit rather than explicit.

### Why not store channel credentials per-group?

Credentials (SMTP relay, Telegram bot token) belong to the customer's infrastructure, not to individual groups. Duplicating them per-group would create drift when tokens rotate. Centralizing at customer level and referencing by channel name keeps credentials DRY.

### Why `discriminatedUnion` for `NotificationRecipient`?

Three recipient types have mutually exclusive required fields. A flat schema with all fields optional would allow malformed combinations (e.g., a MANUAL recipient with no name, email, handle, or number). Discriminated unions enforce correctness at the DTO layer before any DB write.

---

## Prior Art

- **PagerDuty**: Service-level notification policies with per-severity escalation routes.
- **OpsGenie**: Team-based on-call routing with multi-channel (email, SMS, push, voice) per alert type.
- **Grafana Alerting**: Contact points (channels) + notification policies (routing rules) as separate entities — direct inspiration for the customer/group split in this RFC.

---

## Unresolved Questions

1. **Contact verification (Phase 2)**: Should MANUAL recipients receive a verification code (email link / Telegram message / WhatsApp message) before being activated? What is the UX for re-verification after a contact change?

2. **Orchestrator integration**: The alarm orchestrator needs to call GCDR to resolve effective dispatch at notification time. Should GCDR expose a dedicated resolution endpoint (e.g., `GET /dispatch/resolve?groupId=&action=`) or should the orchestrator perform the JOIN itself against the alarm bundle?

3. **Group membership expansion**: When a `GROUP` recipient is listed in rule notifications, who expands group members at dispatch time — GCDR or the orchestrator? If GCDR, should it be part of the alarm bundle?

4. **Channel enum extensibility**: Is `varchar(50)` on `channel` the right choice, or should it be a `pgEnum` for strict validation? New channels (LINE, Discord, PagerDuty) would require a migration to add enum values. VARCHAR allows adding channels without migrations but loses DB-level validation.

5. **Credential encryption**: Should channel `config` JSONB (which stores SMTP passwords, bot tokens) be encrypted at rest, or is PostgreSQL-level encryption sufficient for the current threat model?

6. **Rule-level vs group-level dispatch conflict**: If a rule's `notifications.OPEN` lists Group A, but Group A's dispatch matrix has `EMAIL_RELAY × OPEN = inactive`, should the rule-level override win or should the group matrix take precedence? Current proposal: **group matrix wins** (customer/group config is the source of truth for channels; rule only controls who, not how).

---

## Future Possibilities

- **Scheduled suppression**: Integrate with `MAINTENANCE_WINDOW` rules to automatically disable dispatch during maintenance without manual toggles.
- **Per-action templates**: Custom message templates per alarm action and channel (e.g., a rich HTML email for OPEN vs a terse SMS for ACK).
- **Delivery receipts**: Track whether a notification was delivered, opened, or failed per recipient and channel — stored as a `notification_logs` table.
- **Recipient groups from LDAP/AD**: Import user groups from Active Directory for MANUAL batch provisioning.
- **Rate limiting per channel**: Prevent notification flooding for noisy rules (complementing the `cooldown` guard config already on `AlarmThresholdConfig`).
- **Bundle inclusion**: Include resolved `customerChannels` and `groupDispatchConfigs` in the alarm bundle exported to Node-RED, so the orchestrator can resolve dispatch offline without calling back to GCDR.
