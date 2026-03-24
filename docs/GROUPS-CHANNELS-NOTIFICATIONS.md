# GCDR — Groups, Channels, and Notifications

## Overview

This document covers the notification delivery architecture: how groups aggregate recipients, how channels define where messages are sent, and how rules control which events trigger notifications to whom.

---

## Architecture at a Glance

```
Customer
  └── customer_channels        ← credentials (SMTP, bot tokens, API keys)
        ↑ referenced at dispatch time

Group
  ├── members[]                ← users / devices / assets
  ├── group_channels[]         ← targets (email addresses, phone numbers, chat IDs, URLs)
  └── group_dispatch_configs[] ← channel × alarm action matrix (what triggers what)
        ↑ used to resolve recipients

Rule
  └── notifications{}          ← per alarm action → recipients (users, groups, or manual)
        ↑ group recipients resolved to group.members at dispatch time
```

**Key distinction between Customer and Group channels:**

| Level | Table | Stores |
|-------|-------|--------|
| Customer | `customer_channels` | Credentials — SMTP relay config, Telegram bot tokens, WhatsApp API keys |
| Group | `group_channels` | Targets — email addresses, phone numbers, Telegram chat IDs, Slack channel names |

---

## 1. Groups

### Data Model

```typescript
interface Group {
  id: string;
  tenantId: string;
  customerId: string;

  name: string;                  // Internal name
  displayName?: string;          // Human-readable label
  description?: string;
  code: string;                  // Unique per customer, format: /^[A-Z0-9_-]+$/

  type: GroupType;               // USER | DEVICE | ASSET | MIXED
  purposes: GroupPurpose[];      // At least one required (see catalog below)

  members: GroupMember[];        // Stored as JSONB
  memberCount: number;           // Denormalized count

  notificationSettings?: GroupNotificationSettings;
  hierarchy?: GroupHierarchy;    // parentGroupId, childGroupIds, path, depth

  tags: string[];
  metadata: Record<string, unknown>;

  visibleToChildCustomers: boolean;   // Child customers can see this group
  editableByChildCustomers: boolean;  // Child customers can add/remove members

  status: 'ACTIVE' | 'INACTIVE';
  version: number;               // Optimistic locking
}

interface GroupMember {
  id: string;            // UUID of the user, device, or asset
  type: 'USER' | 'DEVICE' | 'ASSET';
  addedAt: string;       // ISO 8601
  addedBy?: string;      // userId who added
  metadata?: Record<string, unknown>;
}

interface GroupNotificationSettings {
  channels: Array<{
    type: 'EMAIL' | 'SMS' | 'WEBHOOK' | 'SLACK' | 'TEAMS' | 'TELEGRAM' | 'PUSH';
    enabled: boolean;
    config?: Record<string, string>;
  }>;
  schedule?: {
    timezone: string;           // default: "America/Sao_Paulo"
    quietHours?: { start: string; end: string; days: number[]; };
    businessHoursOnly?: boolean;
    businessHours?: { start: string; end: string; days: number[]; };
  };
  escalationDelayMs?: number;
  digestEnabled?: boolean;
  digestIntervalMinutes?: number;  // min 5
}
```

### Group Purposes (catalog)

| Value | Label | Description |
|-------|-------|-------------|
| `ALARMS_NOTIFY` | Alarmes - Notificação | Real-time alarm open/close notifications |
| `ALARMS_REPORT` | Alarmes - Relatório | Periodic consolidated alarm reports |
| `ALARMS_INSIGHT` | Alarmes - Insights | Alarm pattern metrics and analytics |
| `WELCOME_USER` | Boas-vindas / Reset de Senha | Welcome emails and password recovery |
| `RELEASE_NOTE` | Comunicado de Nova Feature | New feature announcements |
| `NOTIFICATION` | Notificação | Generic operational notifications |
| `ESCALATION` | Escalonamento | Escalation chain for unacknowledged alarms |
| `ACCESS_CONTROL` | Controle de Acesso | Permission and access management |
| `REPORTING` | Relatórios | Report generation grouping |
| `MAINTENANCE` | Manutenção | Scheduled maintenance teams |
| `MONITORING` | Monitoramento | Monitoring dashboards |
| `CUSTOM` | Personalizado | Free-form, customer-defined purpose |

---

### Endpoints — Groups

#### `POST /groups` — Create group
**Status:** `201 Created`

`customerId` is required in the body (not in the URL).

**Request:**
```json
{
  "customerId": "33333333-3333-3333-3333-333333333333",
  "name": "Operations Team",
  "displayName": "Equipe de Operações",
  "description": "Team responsible for daily operations and monitoring",
  "code": "OPS-TEAM",
  "type": "USER",
  "purposes": ["NOTIFICATION", "ESCALATION", "REPORTING"],
  "members": [
    { "id": "bbbb2222-2222-2222-2222-222222222222", "type": "USER" },
    { "id": "bbbb3333-3333-3333-3333-333333333333", "type": "USER" }
  ],
  "notificationSettings": {
    "channels": [
      { "type": "EMAIL", "enabled": true },
      { "type": "SMS",   "enabled": true },
      { "type": "PUSH",  "enabled": true }
    ],
    "schedule": {
      "timezone": "America/Sao_Paulo",
      "quietHours": { "start": "22:00", "end": "07:00", "days": [0, 6] }
    },
    "escalationDelayMs": 300000,
    "digestEnabled": false
  },
  "tags": ["operations", "team"],
  "metadata": { "department": "Operations", "costCenter": "CC-001" },
  "visibleToChildCustomers": true,
  "editableByChildCustomers": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "eee00001-0001-0001-0001-000000000001",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": "33333333-3333-3333-3333-333333333333",
    "name": "Operations Team",
    "displayName": "Equipe de Operações",
    "code": "OPS-TEAM",
    "type": "USER",
    "purposes": ["NOTIFICATION", "ESCALATION", "REPORTING"],
    "members": [
      { "id": "bbbb2222-...", "type": "USER", "addedAt": "2026-03-24T14:00:00.000Z" },
      { "id": "bbbb3333-...", "type": "USER", "addedAt": "2026-03-24T14:00:00.000Z" }
    ],
    "memberCount": 2,
    "notificationSettings": { "channels": [...], "schedule": {...} },
    "tags": ["operations", "team"],
    "visibleToChildCustomers": true,
    "editableByChildCustomers": false,
    "status": "ACTIVE",
    "version": 1,
    "createdAt": "2026-03-24T14:00:00.000Z"
  }
}
```

**Validation rules:**
- `code` must match `/^[A-Z0-9_-]+$/` (uppercase, digits, hyphens, underscores)
- `code` is unique per customer
- `purposes` must have at least 1 value
- Members in a `USER` group must have `type: "USER"` (enforced unless group type is `MIXED`)

**Errors:**

| Status | Reason |
|--------|--------|
| `400` | Missing `customerId`, invalid `code` format, empty `purposes` |
| `409` | `code` already exists for this customer |

---

#### `GET /groups` — List groups
**Status:** `200 OK`

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `customerId` | uuid | Filter by customer |
| `type` | string | `USER`, `DEVICE`, `ASSET`, `MIXED` |
| `purpose` | string | Any value from the purpose catalog |
| `status` | string | `ACTIVE` or `INACTIVE` |
| `parentGroupId` | uuid | Filter by parent in hierarchy |
| `tag` | string | Filter by tag |
| `search` | string | Full-text search on name/displayName |
| `limit` | number | 1–100, default 20 |
| `cursor` | string | Pagination cursor |

```
GET /groups?customerId=33333333-3333-...&type=USER&purpose=ESCALATION
```

---

#### `GET /groups/purposes` — Channel type catalog
**Status:** `200 OK` — Returns the 12 purpose types with labels and descriptions.

#### `GET /groups/channels` — Purpose catalog
**Status:** `200 OK` — Returns the 9 channel types with labels and descriptions.

---

#### `GET /groups/:id` — Get group by ID
**Status:** `200 OK` / `404 Not Found`

---

#### `PUT /groups/:id` — Update group
**Status:** `200 OK`

All fields are optional. `type` cannot be changed after creation.

```json
{
  "displayName": "Equipe de Operações (Atualizado)",
  "purposes": ["NOTIFICATION", "ESCALATION", "REPORTING", "ALARMS_NOTIFY"],
  "notificationSettings": {
    "channels": [
      { "type": "EMAIL",    "enabled": true },
      { "type": "TELEGRAM", "enabled": true },
      { "type": "SMS",      "enabled": false }
    ],
    "digestEnabled": true,
    "digestIntervalMinutes": 15
  },
  "tags": ["operations", "team", "critical"]
}
```

---

#### `DELETE /groups/:id` — Delete group
**Status:** `204 No Content`

Add `?soft=true` to soft-delete (sets `status: INACTIVE`, preserves data).

```
DELETE /groups/eee00001-0001-0001-0001-000000000001?soft=true
```

---

### Endpoints — Members

#### `GET /groups/:id/members` — List members (enriched)
**Status:** `200 OK`

USER members are enriched with `name` and `email` from the users table.

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "bbbb2222-2222-2222-2222-222222222222",
        "type": "USER",
        "addedAt": "2024-01-01T00:00:00.000Z",
        "name": "João Silva",
        "email": "joao@acmetech.com"
      },
      {
        "id": "bbbb3333-3333-3333-3333-333333333333",
        "type": "USER",
        "addedAt": "2024-01-15T00:00:00.000Z",
        "name": "Maria Souza",
        "email": "maria@acmetech.com"
      }
    ],
    "count": 2
  }
}
```

---

#### `POST /groups/:id/members` — Add members
**Status:** `200 OK` — Returns updated group.

Max 100 members per request.

```json
{
  "members": [
    { "id": "bbbb4444-4444-4444-4444-444444444444", "type": "USER" },
    { "id": "bbbb5555-5555-5555-5555-555555555555", "type": "USER", "metadata": { "role": "backup" } }
  ]
}
```

---

#### `DELETE /groups/:id/members` — Remove members
**Status:** `200 OK` — Returns updated group.

```json
{
  "memberIds": [
    "bbbb4444-4444-4444-4444-444444444444"
  ]
}
```

---

### Endpoints — Hierarchy

#### `GET /groups/:id/children` — Direct child groups
**Status:** `200 OK`

#### `GET /groups/:id/descendants` — All descendants (recursive)
**Status:** `200 OK`

#### `POST /groups/:id/move` — Move group to new parent
**Status:** `200 OK`

```json
{ "newParentGroupId": "eee00001-0001-0001-0001-000000000010" }
```

Pass `null` or omit to detach from parent (make root-level).

---

#### `GET /groups/by-member/:memberId` — Find groups containing a member
**Status:** `200 OK`

```
GET /groups/by-member/bbbb3333-3333-3333-3333-333333333333?memberType=USER
```

Required query param: `memberType` = `USER`, `DEVICE`, or `ASSET`.

---

## 2. Group Channels

Group channels define the **targets** (destinations) for notification delivery — where a group receives messages.

### Data Model

```typescript
interface GroupChannel {
  id: string;
  tenantId: string;
  groupId: string;
  channel: ChannelType;    // EMAIL | EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SLACK | SMS | TEAMS | CUSTOM
  active: boolean;
  target: string;          // Destination address (see format table below)
  config: Record<string, unknown>;  // Channel-specific extra config
  createdAt: string;
  updatedAt: string;
}
```

**`target` format by channel type:**

| Channel | `target` value | Example |
|---------|----------------|---------|
| `EMAIL` | Email address | `"ops@acmetech.com"` |
| `EMAIL_RELAY` | Email address (uses customer SMTP relay) | `"alerts@acmetech.com"` |
| `TELEGRAM` | Chat ID (negative for groups) | `"-100123456789"` |
| `WHATSAPP` | Phone number with country code | `"+5531988880000"` |
| `SMS` | Phone number with country code | `"+5531988880000"` |
| `SLACK` | Channel name | `"#alertas"` |
| `TEAMS` | Webhook URL | `"https://teams.microsoft.com/..."` |
| `WEBHOOK` | Full URL | `"https://hooks.acmetech.com/gcdr"` |
| `CUSTOM` | Free-form | any string |

**Unique constraint:** one entry per `(tenantId, groupId, channel)`.

---

### Endpoints — Group Channels

#### `GET /groups/:groupId/channels` — List all channels
**Status:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "ch-001",
      "groupId": "eee00001-0001-0001-0001-000000000001",
      "channel": "EMAIL",
      "active": true,
      "target": "ops@acmetech.com",
      "config": {}
    },
    {
      "id": "ch-002",
      "groupId": "eee00001-0001-0001-0001-000000000001",
      "channel": "TELEGRAM",
      "active": true,
      "target": "-100123456789",
      "config": {}
    },
    {
      "id": "ch-003",
      "groupId": "eee00001-0001-0001-0001-000000000001",
      "channel": "SLACK",
      "active": false,
      "target": "#alertas",
      "config": {}
    }
  ]
}
```

---

#### `PUT /groups/:groupId/channels` — Replace all channels (full replace)
**Status:** `200 OK`

Deletes all existing channels for the group and inserts the new set. Use this for initial setup or complete reconfiguration.

```json
{
  "channels": [
    { "channel": "EMAIL",    "active": true,  "target": "ops@acmetech.com" },
    { "channel": "TELEGRAM", "active": true,  "target": "-100123456789" },
    { "channel": "SLACK",    "active": false, "target": "#alertas" },
    { "channel": "WEBHOOK",  "active": true,  "target": "https://hooks.acmetech.com/gcdr",
      "config": { "secret": "my-hmac-secret", "method": "POST" } }
  ]
}
```

---

#### `PATCH /groups/:groupId/channels/:channel` — Update a single channel
**Status:** `200 OK`

`:channel` is the channel type string (e.g., `TELEGRAM`).

**Toggle active state:**
```json
{ "active": false }
```

**Change target:**
```json
{ "target": "-100987654321" }
```

**Update config:**
```json
{
  "active": true,
  "target": "https://hooks.acmetech.com/gcdr-v2",
  "config": { "secret": "new-hmac-secret" }
}
```

---

#### `DELETE /groups/:groupId/channels/:channel` — Remove a channel
**Status:** `204 No Content`

```
DELETE /groups/eee00001-0001-0001-0001-000000000001/channels/SLACK
```

---

## 3. Group Dispatch Configuration

The dispatch config is a **channel × alarm action matrix** that defines which channel receives notifications for which alarm lifecycle events.

### Data Model

```typescript
interface GroupDispatchConfig {
  id: string;
  tenantId: string;
  groupId: string;
  channel: string;            // Must match a group_channels.channel for this group
  action: AlarmAction;        // OPEN | ACK | ESCALATE | SNOOZE | CLOSE | STATE_HISTORY
  active: boolean;
  escalationDelayMs: number;  // Delay before dispatching (default 0)
  createdAt: Date;
  updatedAt: Date;
}
```

**`AlarmAction` values:**

| Action | Meaning |
|--------|---------|
| `OPEN` | Alarm condition triggered |
| `ACK` | Alarm acknowledged by an operator |
| `ESCALATE` | Alarm escalated (unacknowledged timeout) |
| `SNOOZE` | Alarm snoozed |
| `CLOSE` | Alarm condition resolved |
| `STATE_HISTORY` | Any state change (catch-all) |

**Unique constraint:** one entry per `(tenantId, groupId, channel, action)`.

---

### Endpoints — Group Dispatch

#### `GET /groups/:groupId/dispatch` — Get dispatch matrix
**Status:** `200 OK`

```json
{
  "success": true,
  "data": [
    { "channel": "EMAIL",    "action": "OPEN",     "active": true,  "escalationDelayMs": 0 },
    { "channel": "EMAIL",    "action": "CLOSE",    "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "OPEN",     "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "ACK",      "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "ESCALATE", "active": true,  "escalationDelayMs": 300000 },
    { "channel": "TELEGRAM", "action": "CLOSE",    "active": true,  "escalationDelayMs": 0 },
    { "channel": "SLACK",    "action": "OPEN",     "active": false, "escalationDelayMs": 0 }
  ]
}
```

---

#### `PUT /groups/:groupId/dispatch` — Replace entire matrix
**Status:** `200 OK`

Clears all existing entries and inserts the new set.

**Typical production setup (email + Telegram):**
```json
{
  "entries": [
    { "channel": "EMAIL",    "action": "OPEN",          "active": true,  "escalationDelayMs": 0 },
    { "channel": "EMAIL",    "action": "CLOSE",         "active": true,  "escalationDelayMs": 0 },
    { "channel": "EMAIL",    "action": "ESCALATE",      "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "OPEN",          "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "ACK",           "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "ESCALATE",      "active": true,  "escalationDelayMs": 300000 },
    { "channel": "TELEGRAM", "action": "CLOSE",         "active": true,  "escalationDelayMs": 0 },
    { "channel": "TELEGRAM", "action": "STATE_HISTORY", "active": false, "escalationDelayMs": 0 }
  ]
}
```

---

#### `PATCH /groups/:groupId/dispatch` — Partial update
**Status:** `200 OK`

Only updates the entries explicitly included. Other entries are left unchanged.

**Disable Slack for all actions:**
```json
{
  "entries": [
    { "channel": "SLACK", "action": "OPEN",     "active": false, "escalationDelayMs": 0 },
    { "channel": "SLACK", "action": "CLOSE",    "active": false, "escalationDelayMs": 0 },
    { "channel": "SLACK", "action": "ESCALATE", "active": false, "escalationDelayMs": 0 }
  ]
}
```

---

## 4. Customer Channels

Customer channels store **credentials and configuration** for dispatch transports. They are shared across all groups belonging to a customer.

### Data Model

```typescript
interface CustomerChannel {
  id: string;
  tenantId: string;
  customerId: string;
  channel: CustomerChannelType;  // EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SMS | SLACK | TEAMS | CUSTOM
  active: boolean;
  config: Record<string, unknown>;  // Credentials — tokens, SMTP config, API keys
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}
```

**`config` shape by channel type:**

| Channel | Typical `config` keys |
|---------|----------------------|
| `EMAIL_RELAY` | `host`, `port`, `secure`, `user`, `password`, `from` |
| `TELEGRAM` | `botToken` |
| `WHATSAPP` | `accountSid`, `authToken`, `from` (or equivalent API creds) |
| `WEBHOOK` | `secret` (HMAC signing key), `headers` |
| `SMS` | `provider`, `apiKey`, `from` |
| `SLACK` | `botToken` or `webhookUrl` |
| `TEAMS` | `webhookUrl` |
| `CUSTOM` | Free-form |

**Unique constraint:** one entry per `(tenantId, customerId, channel)` — a customer can only have one configuration per channel type.

---

### Endpoints — Customer Channels

#### `GET /customers/:customerId/channels` — List all
**Status:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "cch-001",
      "customerId": "33333333-3333-3333-3333-333333333333",
      "channel": "EMAIL_RELAY",
      "active": true,
      "config": {
        "host": "smtp.sendgrid.net",
        "port": 587,
        "secure": false,
        "user": "apikey",
        "from": "noreply@acmetech.com"
      },
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "cch-002",
      "customerId": "33333333-3333-3333-3333-333333333333",
      "channel": "TELEGRAM",
      "active": true,
      "config": {
        "botToken": "7123456789:AAH..."
      },
      "createdAt": "2026-01-15T00:00:00.000Z"
    }
  ]
}
```

---

#### `POST /customers/:customerId/channels` — Create channel
**Status:** `201 Created`

**EMAIL_RELAY (SMTP):**
```json
{
  "channel": "EMAIL_RELAY",
  "active": true,
  "config": {
    "host": "smtp.sendgrid.net",
    "port": 587,
    "secure": false,
    "user": "apikey",
    "password": "SG.xxxxxxxxxxxxxxxxxxxx",
    "from": "noreply@acmetech.com"
  }
}
```

**TELEGRAM bot:**
```json
{
  "channel": "TELEGRAM",
  "active": true,
  "config": {
    "botToken": "7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

**WEBHOOK with HMAC signing:**
```json
{
  "channel": "WEBHOOK",
  "active": true,
  "config": {
    "secret": "my-shared-hmac-secret",
    "headers": {
      "X-Source": "gcdr-alerts"
    }
  }
}
```

**SLACK via bot token:**
```json
{
  "channel": "SLACK",
  "active": true,
  "config": {
    "botToken": "xoxb-xxxxxxxxxx-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| `409` | Channel type already configured for this customer |

---

#### `PATCH /customers/:customerId/channels/:channelId` — Update channel
**Status:** `200 OK`

Both fields are optional.

**Rotate Telegram token:**
```json
{
  "config": {
    "botToken": "7123456789:BBIyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
  }
}
```

**Temporarily disable:**
```json
{ "active": false }
```

---

#### `DELETE /customers/:customerId/channels/:channelId` — Delete channel
**Status:** `204 No Content`

---

## 5. Rules — Notification Configuration

Rules define alarm conditions and specify who receives notifications when each alarm lifecycle event occurs.

### Notification Recipients (discriminated union)

```typescript
type NotificationRecipient =
  | {
      sourceType: 'USER';
      userId: string;
      name: string;
      email?: string;
      telegramHandle?: string;
      whatsappNumber?: string;
    }
  | {
      sourceType: 'GROUP';   // ← resolves to group.members[] at dispatch time
      groupId: string;
      name: string;
    }
  | {
      sourceType: 'MANUAL';  // ← ad-hoc recipient, no DB record needed
      name: string;
      channel: string;
      email?: string;
      telegramHandle?: string;
      whatsappNumber?: string;
    };
```

### Per-Action Notification Config (RFC-0024)

```typescript
interface RuleActionNotification {
  enabled: boolean;
  recipients: NotificationRecipient[];
  emailRelay?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    from: string;
  };
}

// Keyed by alarm action
type RuleNotifications = Partial<Record<
  'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY',
  RuleActionNotification
>>;
```

### Example Rule with full notification config

```json
{
  "customerId": "33333333-3333-3333-3333-333333333333",
  "name": "High Energy Consumption",
  "type": "ALARM_THRESHOLD",
  "priority": "HIGH",
  "scope": {
    "type": "DEVICE",
    "entityIds": [
      "11110001-0001-0001-0001-000000000001",
      "11110001-0001-0001-0001-000000000002"
    ]
  },
  "alarmConfig": {
    "metric": "instantaneous_power",
    "operator": "GT",
    "value": 50000,
    "unit": "W",
    "duration": 300
  },
  "notifications": {
    "OPEN": {
      "enabled": true,
      "recipients": [
        {
          "sourceType": "GROUP",
          "groupId": "eee00001-0001-0001-0001-000000000001",
          "name": "Operations Team"
        },
        {
          "sourceType": "USER",
          "userId": "bbbb2222-2222-2222-2222-222222222222",
          "name": "João Silva",
          "email": "joao@acmetech.com",
          "telegramHandle": "@joaosilva"
        }
      ]
    },
    "ESCALATE": {
      "enabled": true,
      "recipients": [
        {
          "sourceType": "GROUP",
          "groupId": "eee00001-0001-0001-0001-000000000004",
          "name": "Alert Recipients"
        },
        {
          "sourceType": "MANUAL",
          "name": "On-call Manager",
          "channel": "SMS",
          "whatsappNumber": "+5531988880000"
        }
      ]
    },
    "CLOSE": {
      "enabled": true,
      "recipients": [
        {
          "sourceType": "GROUP",
          "groupId": "eee00001-0001-0001-0001-000000000001",
          "name": "Operations Team"
        }
      ]
    },
    "ACK": {
      "enabled": false,
      "recipients": []
    }
  },
  "tags": ["energy", "critical"],
  "enabled": true
}
```

---

## 6. Dispatch Flow (End-to-End)

When an alarm event occurs, the dispatch process follows these steps:

```
1. Alarm event fires (e.g., OPEN)
   ↓
2. Look up the rule → read rule.notifications["OPEN"]
   ↓
3. For each recipient in notifications["OPEN"].recipients:
   ├─ sourceType = USER   → dispatch directly using user's configured contacts
   ├─ sourceType = GROUP  → look up group → expand group.members[] → dispatch to each member
   │   └─ for each member:
   │       └─ look up group_dispatch_configs for (groupId, action=OPEN)
   │           └─ for each active dispatch entry:
   │               └─ look up group_channels for (groupId, channel)
   │                   └─ look up customer_channels for credentials
   │                       └─ send via transport (SMTP, Telegram API, webhook, etc.)
   └─ sourceType = MANUAL → dispatch to provided address using specified channel
   ↓
4. Observe escalationDelayMs before sending (if > 0)
   ↓
5. Record delivery in audit log
```

---

## 7. Common Error Responses

| Status | Code | Cause |
|--------|------|-------|
| `400` | `VALIDATION_ERROR` | Invalid field format (code pattern, missing required field) |
| `400` | `VALIDATION_ERROR` | Member `type` incompatible with group `type` |
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `404` | `NOT_FOUND` | Group, channel, or dispatch config not found |
| `409` | `CONFLICT` | Duplicate group `code` for customer, or duplicate customer channel type |

---

## 8. Practical Scenarios

### Set up a new group for Telegram alarm notifications

```
1. POST /customers/:customerId/channels
   { "channel": "TELEGRAM", "config": { "botToken": "..." } }

2. POST /groups
   { "type": "USER", "purposes": ["ALARMS_NOTIFY", "ESCALATION"], ... }

3. POST /groups/:id/members
   { "members": [{ "id": "<userId>", "type": "USER" }] }

4. PUT /groups/:id/channels
   { "channels": [{ "channel": "TELEGRAM", "active": true, "target": "-100123456789" }] }

5. PUT /groups/:id/dispatch
   { "entries": [
     { "channel": "TELEGRAM", "action": "OPEN",     "active": true, "escalationDelayMs": 0 },
     { "channel": "TELEGRAM", "action": "ESCALATE", "active": true, "escalationDelayMs": 300000 },
     { "channel": "TELEGRAM", "action": "CLOSE",    "active": true, "escalationDelayMs": 0 }
   ]}

6. PUT /rules/:ruleId
   { "notifications": { "OPEN": { "enabled": true, "recipients": [{ "sourceType": "GROUP", "groupId": "...", "name": "..." }] }}}
```

### Add a new member to an existing notification group

```
POST /groups/:id/members
{ "members": [{ "id": "<newUserId>", "type": "USER" }] }
```

The new member is immediately included in all future dispatches that reference this group.

### Temporarily silence Telegram for a group during maintenance

```
PATCH /groups/:id/channels/TELEGRAM
{ "active": false }
```

### Rotate a customer's Telegram bot token

```
PATCH /customers/:customerId/channels/:channelId
{ "config": { "botToken": "7123456789:CCnewtoken..." } }
```

Affects all groups under this customer that use the TELEGRAM channel.
