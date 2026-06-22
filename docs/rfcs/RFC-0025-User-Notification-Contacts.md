# RFC-0025: User Notification Contacts

- **Feature Name**: `user-notification-contacts`
- **Start Date**: 2026-03-13
- **RFC PR**: (pending)
- **Related RFCs**: [RFC-0024 Alarm Dispatch Configuration](./RFC-0024-Alarm-Dispatch-Config.md)

---

## Summary

Add a `user_contacts` table that stores per-channel notification addresses for users (EMAIL, TELEGRAM, WHATSAPP, SMS, SLACK, etc.). This fills the gap identified in RFC-0024 where `USER` recipients in rule notifications had no structured channel-specific contact data beyond their primary email.

---

## Motivation

RFC-0024 introduced a multi-channel dispatch system where rule notifications can list recipients of type `USER`, `GROUP`, or `MANUAL`. The `USER` type references a GCDR user by `userId`, but the alarm orchestrator had no way to resolve *how* to contact that user on a specific channel — only the primary `email` column exists on the `users` table.

**Concrete gaps:**

- **Telegram dispatch**: no field to store a user's `@handle` or `chat_id`
- **WhatsApp dispatch**: no field to store a user's `+CC DDD NNNNNNNN`
- **SMS**: no structured `phone` per user (only free-form on customers)
- **Multi-account**: a user may have multiple addresses per channel (work vs personal Telegram)
- **Active/inactive per contact**: a user can temporarily disable a channel without losing the address
- **Future verification**: contacts need a `verified` flag for opt-in flows (Phase 2)

Without this RFC, every `USER` recipient in a rule notification requires a `MANUAL` entry with manually typed contact data, defeating the purpose of the user registry.

---

## Guide-Level Explanation

### Conceptual model

A user can have zero or more notification contacts. Each contact associates a channel name with a contact value:

```
User: Rodrigo Lago
  EMAIL    rodrigo@myio.com.br        active=true   verified=true   label="work"
  TELEGRAM @rodrigolago               active=true   verified=false
  WHATSAPP +5531988880000             active=true   verified=false  label="personal"
  SMS      +5531988880000             active=false  verified=false
```

The orchestrator resolves contacts at dispatch time:

```
Rule notification → action=OPEN → recipient { sourceType: USER, userId: "rodrigo-uuid" }
  → fetch user_contacts WHERE user_id = "rodrigo-uuid" AND channel = "TELEGRAM" AND active = true
  → send Telegram message to @rodrigolago
```

### Frontend UX — User profile → "Contatos de Notificação"

```
Contatos de Notificação                    [+ Adicionar Contato]

┌─ EMAIL ─────────── rodrigo@myio.com.br ──── ● ativo ─ [✓ verificado] ─ [⚙] [🗑] ┐
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ TELEGRAM ──────── @rodrigolago ─────────── ● ativo ─ [⚠ não verificado] ─ [⚙] [🗑] ┐
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─ WHATSAPP ──────── +5531988880000 ───────── ○ inativo ─ [⚠ não verificado] ─ [⚙] [🗑] ┐
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Reference-Level Explanation

### New table: `user_contacts`

```sql
CREATE TABLE user_contacts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    varchar(50) NOT NULL,
  -- EMAIL | TELEGRAM | WHATSAPP | SMS | SLACK | TEAMS | CUSTOM
  value      varchar(500) NOT NULL,
  -- EMAIL:    rodrigo@myio.com.br
  -- TELEGRAM: @rodrigolago  or  chat_id (numeric)
  -- WHATSAPP: +5531988880000
  -- SMS:      +5531988880000
  -- SLACK:    @username  or  member_id (U...)
  label      varchar(100),
  -- optional: "work", "personal", "on-call"
  verified   boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, channel, value)
);

CREATE INDEX user_contacts_tenant_user_idx    ON user_contacts (tenant_id, user_id);
CREATE INDEX user_contacts_tenant_channel_idx ON user_contacts (tenant_id, channel);
```

### Drizzle schema

```typescript
// src/infrastructure/database/drizzle/schema.ts

export const userContacts = pgTable('user_contacts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel:   varchar('channel', { length: 50 }).notNull(),
  value:     varchar('value', { length: 500 }).notNull(),
  label:     varchar('label', { length: 100 }),
  verified:  boolean('verified').notNull().default(false),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantUserChannelValueUnique: uniqueIndex('user_contacts_unique').on(table.tenantId, table.userId, table.channel, table.value),
  tenantUserIdx:    index('user_contacts_tenant_user_idx').on(table.tenantId, table.userId),
  tenantChannelIdx: index('user_contacts_tenant_channel_idx').on(table.tenantId, table.channel),
}));
```

### API Endpoints

```
GET    /api/v1/users/:userId/contacts
POST   /api/v1/users/:userId/contacts
PATCH  /api/v1/users/:userId/contacts/:contactId
DELETE /api/v1/users/:userId/contacts/:contactId
```

All routes require `Authorization: Bearer <jwt>` + `X-Tenant-Id`.

#### `POST /api/v1/users/:userId/contacts`

```json
// Request
{ "channel": "TELEGRAM", "value": "@rodrigolago", "label": "on-call", "active": true }

// Response 201
{
  "id":        "uuid",
  "userId":    "rodrigo-uuid",
  "channel":   "TELEGRAM",
  "value":     "@rodrigolago",
  "label":     "on-call",
  "verified":  false,
  "active":    true,
  "createdAt": "2026-03-13T..."
}
```

#### `GET /api/v1/users/:userId/contacts`

```json
{
  "items": [
    { "id": "...", "channel": "EMAIL",    "value": "rodrigo@myio.com.br", "verified": true,  "active": true  },
    { "id": "...", "channel": "TELEGRAM", "value": "@rodrigolago",        "verified": false, "active": true  },
    { "id": "...", "channel": "WHATSAPP", "value": "+5531988880000",       "verified": false, "active": false }
  ],
  "count": 3
}
```

#### `PATCH /api/v1/users/:userId/contacts/:contactId`

```json
// Disable a contact
{ "active": false }

// Update value
{ "value": "@novo_handle" }
```

### Orchestrator integration

When resolving a `USER` recipient for a given channel and action:

```sql
SELECT uc.value
FROM user_contacts uc
WHERE uc.tenant_id = $tenantId
  AND uc.user_id   = $userId
  AND uc.channel   = $channel   -- e.g. 'TELEGRAM'
  AND uc.active    = true
ORDER BY uc.created_at
LIMIT 1;
```

Full resolution flow:

```
rule.notifications.OPEN.recipients
  → { sourceType: "USER", userId: "rodrigo-uuid" }

1. fetch user_contacts WHERE user_id = "rodrigo-uuid"
                         AND channel = dispatch_channel
                         AND active  = true

2. for each contact:
   → fetch customer_channels.config for credentials
   → send via channel adapter (SMTP, Bot API, etc.)
```

### Migration

- **Migration 0016**: `0016_user_contacts.sql` — creates `user_contacts` table + indexes.
- No data migration needed — existing USER recipients in rule notifications will gain contact resolution once users populate their contacts.

---

## Drawbacks

- **Self-service contact management**: users populating their own contacts requires a profile UI section not yet implemented in the frontend.
- **No verification in Phase 1**: contacts are stored as `verified=false` and used immediately. A misconfigured `@handle` or phone number silently fails at dispatch time.
- **Duplicate with `users.email`**: the primary email already exists on the `users` table. `user_contacts` will redundantly store email contacts. The orchestrator should prefer `user_contacts` when available and fall back to `users.email` for EMAIL channel.

---

## Rationale and Alternatives

### Why a separate table instead of JSONB on `users.profile`?

`users.profile` is already used for avatar, display preferences, and locale settings. Embedding contacts there:
- Cannot be indexed per channel
- Cannot have `active`/`verified` flags per contact without nested structure
- Cannot enforce uniqueness per `(user, channel, value)` at the DB level
- Cannot be queried efficiently by the orchestrator without deserializing the entire profile blob

A dedicated table gives SQL-level uniqueness, indexability, and independent lifecycle management per contact.

### Why `varchar(500)` for `value`?

Covers all current channel formats:
- Email: up to ~254 chars (RFC 5321)
- Telegram: handle up to 32 chars, but chat_id can be a large integer string
- WhatsApp/SMS: E.164 format, max 15 digits + `+`
- Slack member ID: `U` + 10 alphanumeric chars
- Future channels (Discord snowflake IDs, etc.): safe upper bound

### Why not `verified=true` by default?

Contacts are entered by an admin or the user themselves. An unverified contact may be a typo. The `verified=false` default makes the unverified state explicit. Phase 2 will add opt-in flows (Telegram bot `/start`, WhatsApp OTP, email link).

---

## Unresolved Questions

1. **Verification flow (Phase 2)**: What is the UX for verifying a Telegram contact? The user must start a conversation with the bot. Should GCDR generate a one-time code and the bot validates it? Who initiates — the admin or the user?

2. **Fallback to `users.email`**: Should the orchestrator automatically fall back to `users.email` when no `EMAIL` contact exists in `user_contacts`? Or should admins be required to explicitly create an EMAIL contact for each user?

3. **Visibility**: Can users see and edit their own contacts via the profile UI? Or are contacts admin-only? Likely both — user self-service + admin override.

4. **Multi-value per channel**: The unique constraint allows multiple contacts per `(user, channel)` if the `value` differs. Should the orchestrator send to all active contacts for a channel, or just the first one?

5. **Sync with `users.email`**: When a user changes their `users.email`, should the EMAIL contact in `user_contacts` be automatically updated, or are they independent?

---

## Future Possibilities

- **Verification receipts**: store verification attempts + timestamps in `user_contacts` for audit.
- **Preferred channel per context**: `{ "alarm": "TELEGRAM", "report": "EMAIL" }` — users choose channel per notification type.
- **Contact groups**: link a set of contacts to a named "on-call rotation" for easy assignment in rules.
- **Bundle inclusion**: include resolved `user_contacts` in the alarm bundle so the orchestrator can resolve dispatch offline without calling back to GCDR at notification time.
- **Import from LDAP/AD**: populate contacts from Active Directory `mobile`, `mail`, and custom extension attributes.
