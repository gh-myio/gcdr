# RFC-0033 — Customer Integration Sync State

- **Status:** Draft (pending approval) — **partially superseded by [RFC-0035](./RFC-0035-Plural-MQTT-Integrations-On-Centrals.md) (centrals.items[] shape — §5 `CentralEntrySchema` and §115–154)**
- **Created:** 2026-05-06
- **Author:** GCDR Core Team
- **Domain:** Customers / Cross-System Integrations
- **Decision needed by:** before implementation kickoff

> ⚠️ **Partial supersession**: The `centrals.items[]` entry shape defined in this RFC
> (`uuid`, `ingestionGatewayId`, `mqttUserName`, `mqttClientId`, `mqttPassword`,
> `ipv6Yggdrasil`) is replaced by RFC-0035. Identity (`ipv6Yggdrasil`) moves to
> `centrals.config`; broker config (`mqttUserName`/`mqttClientId`/etc.) becomes a
> plural `centrals.config.mqttIntegrations[]`; per-integration passwords stay in
> `customers.metadata.integrations.centrals.items[].mqttPasswords` partitioned by
> integration id. All other integration keys (`ingestion`, `thingsboard`, `alarms`,
> `workorders`, `freshdesk`) and the sync-state ledger contract in this RFC remain
> in effect.

---

## Summary

Introduce a structured `integrations` namespace inside the existing
`customers.metadata` JSONB column to track the **live sync state** of every
external ecosystem the customer participates in (Ingestion, Centrals
registry, ThingsBoard, Alarm orchestrator, Work Orders, Freshdesk).

The version log is **not** kept in-row. Every sync event emits exactly one
audit log entry (RFC-0009); querying `audit_logs` is the single supported
way to read past events.

For the `centrals` integration specifically, the state carries an
`items[]` array, one entry per central, each with the connection
parameters (`uuid`, `ingestionGatewayId`, `mqttUserName`, `mqttClientId`,
`mqttPassword`, `ipv6Yggdrasil`). The MQTT password is stored as plaintext
in JSONB — see the **Security** section for the trade-off and the
mitigations required before this RFC ships.

No schema migration is required — the column `customers.metadata jsonb NOT NULL
DEFAULT '{}'` already exists (`schema.ts:178`). This RFC defines the shape,
invariants, and access rules that make it safe to use as a multi-integration
sync ledger.

---

## Motivation

The customer is the **anchor entity** of the MYIO ecosystem. Around it orbit
several systems that must remain in lockstep, but each is owned by a different
backend:

| Ecosystem        | Owner                  | What is synchronised                                  |
|------------------|------------------------|-------------------------------------------------------|
| Ingestion        | data-ingestion service | Whether telemetry pipelines are wired and consuming   |
| Centrals         | GCDR (`centrals` table)| Provisioning state of every gateway/edge controller   |
| ThingsBoard      | tb-bridge              | `external_id` mapping + entity provisioning           |
| Alarms           | alarm-orchestrator     | Bundle version actually loaded by the orchestrator    |
| Work Orders (OS) | OS service             | Per-customer dispatch profile                         |
| Freshdesk        | Freshdesk              | Tenant/company mirror + agent provisioning            |

Today there is no single place that answers operational questions like:

- *Is customer X fully provisioned across all systems?*
- *When did the ThingsBoard sync last succeed for customer Y?*
- *Which integration broke first when onboarding customer Z?*
- *What bundle version is the orchestrator actually running for this customer?*

Operators answer these by chasing logs across six services. We need a single,
queryable, customer-scoped record of integration health.

The **simplest** mechanism that satisfies this need without a new table or
migration is the existing `customers.metadata` column. RFC-0019 already
established the pattern of using a top-level JSONB column on `customers` to
hold extensible per-customer state without migrations. RFC-0033 extends the
same approach to integration tracking.

---

## Guide-level explanation

### Where the data lives

Every customer carries a `metadata.integrations` object. Each known
integration is a key under it.

```jsonc
{
  // ... any other metadata fields ...
  "integrations": {
    "ingestion":   { /* IntegrationState */ },
    "centrals":    { /* IntegrationState */ },
    "thingsboard": { /* IntegrationState */ },
    "alarms":      { /* IntegrationState */ },
    "workorders":  { /* IntegrationState */ },
    "freshdesk":   { /* IntegrationState */ }
  }
}
```

A missing integration key means **"never synchronised"** — equivalent to
status `IDLE`. The absence of the wrapping `integrations` object is also
treated as `IDLE` for every known integration.

### The shape of a single integration state

```jsonc
{
  "status":         "OK",                          // see Status enum below
  "version":        "v42",                         // opaque string owned by integration
  "lastSyncAt":     "2026-05-06T12:30:00.000Z",   // last attempt, success or not
  "lastSuccessAt":  "2026-05-06T12:30:00.000Z",   // last successful run
  "lastError":      null,                          // string (truncated) when status=FAILED/DEGRADED
  "syncCount":      137,                           // monotonically increasing
  "failureCount":   2,                             // resets on any successful sync
  "payload":        { /* free-form, integration-owned */ }
}
```

There is **no in-row history array**. The complete version log lives in
`audit_logs` (RFC-0009) under `entity_type = 'customer.integration'` —
that is the canonical, queryable, retention-bound version log for every
sync event. Carrying a duplicate copy in `metadata` would cost row size
without buying anything `audit_logs` does not already provide.

### The `centrals` integration is special: it carries an `items[]` list

Every other integration key is a plain `IntegrationState`. The `centrals`
integration **extends** the state with an `items` array — one entry per
central provisioned for the customer. This is the only place in this RFC
where shape differs by key.

```jsonc
"centrals": {
  "status":        "OK",
  "version":       "rev-7",
  "lastSyncAt":    "2026-05-06T12:30:00.000Z",
  "lastSuccessAt": "2026-05-06T12:30:00.000Z",
  "lastError":     null,
  "syncCount":     12,
  "failureCount":  0,
  "payload":       { /* free-form, integration-owned */ },
  "items": [
    {
      "uuid":               "e982edf9-edb1-4aa6-8a14-4782465ae5a3",
      "ingestionGatewayId": "11111111-2222-3333-4444-555555555555",
      "mqttUserName":       "central-moxuara-01",
      "mqttClientId":       "moxuara-01",
      "mqttPassword":       "<plaintext — see Security>",
      "ipv6Yggdrasil":      "200:abcd:1234:::1"
    }
  ]
}
```

Field meanings:

| Field                | Purpose                                                                  |
|----------------------|--------------------------------------------------------------------------|
| `uuid`               | The central's GCDR id (`centrals.id`).                                   |
| `ingestionGatewayId` | The id of the ingestion gateway that owns the MQTT bridge for the central |
| `mqttUserName`       | MQTT broker username used by this central                                |
| `mqttClientId`       | MQTT broker client id (must be unique on the broker)                     |
| `mqttPassword`       | MQTT broker password — **plaintext** in JSONB (see Security)         |
| `ipv6Yggdrasil`      | Yggdrasil-mesh IPv6 address of the central (used for direct addressing)  |

### Recording a sync event (operator-level)

A backend that owns an integration calls a single helper:

```ts
await customerIntegrationService.recordSync(customerId, 'thingsboard', {
  status:  'OK',
  version: 'v42',
  actor:   'tb-bridge:cron',
  note:    'incremental sync, 12 entities updated',
  payload: { entitiesUpdated: 12, entitiesCreated: 0 },
});
```

The helper is responsible for:

1. Reading `metadata.integrations.thingsboard` (or initialising it).
2. Updating the live state fields (`status`, `version`, `lastSyncAt`,
   `lastSuccessAt`, counters, `payload`, `lastError`).
3. Emitting an audit-log entry (RFC-0009) carrying the full sync event —
   that audit row, **not** an in-row array, is the durable version log.
4. Persisting the whole `metadata` column with a single `UPDATE` (atomic write,
   `version` column on `customers` is incremented by the existing optimistic
   locking layer).

### Reading sync state

```ts
const state = await customerIntegrationService.get(customerId, 'thingsboard');
// state is null if never recorded, otherwise an IntegrationState
```

A bulk endpoint returns the full `integrations` map for one customer, intended
for the admin dashboard:

```
GET /customers/:customerId/integrations
→ 200 { ingestion: { … }, centrals: { … }, thingsboard: { … }, … }
```

---

## Reference-level explanation

### 1. Storage location

```ts
// src/infrastructure/database/drizzle/schema.ts (existing)
metadata: jsonb('metadata').notNull().default({}),
```

No migration. The column already exists, is `NOT NULL`, and defaults to `{}`.

### 2. Reserved namespace

The key `metadata.integrations` is **reserved** by this RFC. No other RFC may
reuse the key for a different purpose. Any feature that needs structured
per-customer ledgers should follow the same pattern under a different key
(e.g. `metadata.licenses`, `metadata.contracts`).

### 3. Integration registry

A finite, code-side enum of supported integrations. New integrations require a
code change (constants + Zod schema), not a migration.

```ts
// src/domain/integrations/IntegrationKey.ts
export const INTEGRATION_KEYS = [
  'ingestion',     // data-ingestion pipelines for this customer
  'centrals',      // provisioning of all centrals owned by this customer
  'thingsboard',   // ThingsBoard tenant/customer mirror + entity provisioning
  'alarms',        // alarm-orchestrator bundle version applied for this customer
  'workorders',    // OS service per-customer dispatch profile
  'freshdesk',     // Freshdesk company mirror
] as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
```

### 4. Status enum

```ts
export const INTEGRATION_STATUS = [
  'IDLE',       // never synchronised (also implied by absence of the key)
  'RUNNING',    // sync in progress (set by long-running jobs only)
  'OK',         // last sync succeeded
  'DEGRADED',   // last sync partially succeeded — some entities failed
  'FAILED',     // last sync failed end-to-end
  'DISABLED',   // operator turned this integration off for this customer
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];
```

State transitions are not enforced — any backend may move directly from
`IDLE` to `OK` or from `OK` to `FAILED`. The audit log (RFC-0009) is the
trail.

### 5. Zod schema

```ts
// src/dto/customerIntegrationSchema.ts
import { z } from 'zod';
import { INTEGRATION_KEYS, INTEGRATION_STATUS } from '../domain/integrations/IntegrationKey';

export const IntegrationStateSchema = z.object({
  status:        z.enum(INTEGRATION_STATUS),
  version:       z.string().max(255).nullable().default(null),
  lastSyncAt:    z.string().datetime().nullable().default(null),
  lastSuccessAt: z.string().datetime().nullable().default(null),
  lastError:     z.string().max(2000).nullable().default(null),
  syncCount:     z.number().int().nonnegative().default(0),
  failureCount:  z.number().int().nonnegative().default(0),
  payload:       z.record(z.unknown()).default({}),
});

// Per-central entry stored under integrations.centrals.items[].
// `mqttPassword` is held as plaintext on this row — see Security.
export const CentralEntrySchema = z.object({
  uuid:               z.string().uuid(),
  ingestionGatewayId: z.string().uuid().nullable().default(null),
  mqttUserName:       z.string().min(1).max(255),
  mqttClientId:       z.string().min(1).max(255),
  mqttPassword:       z.string().min(1).max(2000),
  ipv6Yggdrasil:      z.string().min(1).max(64),
});

export const CentralsIntegrationStateSchema = IntegrationStateSchema.extend({
  items: z.array(CentralEntrySchema).default([]),
});

// The full integrations map: every known key is optional, but `centrals`
// (when present) MUST conform to the extended schema with `items`.
export const CustomerIntegrationsSchema = z.object({
  ingestion:   IntegrationStateSchema.optional(),
  centrals:    CentralsIntegrationStateSchema.optional(),
  thingsboard: IntegrationStateSchema.optional(),
  alarms:      IntegrationStateSchema.optional(),
  workorders:  IntegrationStateSchema.optional(),
  freshdesk:   IntegrationStateSchema.optional(),
});
```

### 6. Service contract

```ts
// src/services/CustomerIntegrationService.ts
export interface RecordSyncInput {
  status:  IntegrationStatus;
  version?: string;
  actor:   string;
  note?:   string;
  payload?: Record<string, unknown>;
  error?:  string;          // when status = FAILED | DEGRADED
}

export interface ICustomerIntegrationService {
  get(customerId: string, key: IntegrationKey): Promise<IntegrationState | null>;
  list(customerId: string): Promise<Partial<Record<IntegrationKey, IntegrationState>>>;
  recordSync(customerId: string, key: IntegrationKey, input: RecordSyncInput): Promise<IntegrationState>;
  reset(customerId: string, key: IntegrationKey, actor: string): Promise<void>;
  disable(customerId: string, key: IntegrationKey, actor: string, note?: string): Promise<void>;
}
```

`recordSync` is the only mutating call most integrations will need. Behaviour:

| Field           | Update rule                                                          |
|-----------------|----------------------------------------------------------------------|
| `status`        | overwritten with `input.status`                                      |
| `version`       | overwritten if `input.version` provided, otherwise preserved         |
| `lastSyncAt`    | set to `now()`                                                       |
| `lastSuccessAt` | set to `now()` only when `input.status === 'OK'`                     |
| `lastError`     | set to `input.error` on FAILED/DEGRADED, cleared to `null` on OK     |
| `syncCount`     | `+= 1`                                                               |
| `failureCount`  | `+= 1` on FAILED/DEGRADED, reset to `0` on OK                        |
| `payload`       | overwritten with `input.payload` if provided, otherwise preserved    |
| audit log       | one row appended to `audit_logs` (RFC-0009) per call — see §9        |

### 7. Repository write strategy

The repository layer applies the change in a single SQL `UPDATE` using
`jsonb_set` so concurrent writes to **other** keys of `metadata` do not get
clobbered:

```sql
UPDATE customers
SET metadata = jsonb_set(
       coalesce(metadata, '{}'::jsonb),
       '{integrations,thingsboard}',
       $1::jsonb,
       true
     ),
    updated_at = now(),
    version    = version + 1
WHERE id = $2 AND tenant_id = $3
RETURNING *;
```

Two integrations writing simultaneously to **different** keys cannot collide on
the JSON path. Two writers updating the **same** integration race for
last-write-wins on that path — acceptable, because the last write reflects the
latest sync attempt and the per-call audit row in `audit_logs` (§9) preserves
both the lost write and the winning write.

### 8. REST surface (under `/customers/:customerId/integrations`)

| Method | Path                              | Auth       | Purpose                                 |
|--------|-----------------------------------|------------|-----------------------------------------|
| GET    | `/integrations`                   | JWT/APIKey | full integrations map for one customer  |
| GET    | `/integrations/:key`              | JWT/APIKey | one integration state                   |
| POST   | `/integrations/:key/sync-events`  | M2M only   | append a sync event (`recordSync`)      |
| POST   | `/integrations/:key/disable`      | JWT admin  | mark `DISABLED`                         |
| POST   | `/integrations/:key/reset`        | JWT admin  | clear state (back to IDLE) + audit log  |

`POST /sync-events` is the integration-ingress endpoint each owning service
calls. It is the only mutating route exposed to non-admin callers, and it is
restricted to **machine-to-machine** keys via `X-API-Key: gcdr_pk_*` /
`gcdr_cust_*`.

### 9. Audit logs (RFC-0009) — the canonical version log

Every `recordSync`, `reset`, and `disable` call emits **exactly one** audit
log entry. There is no in-row duplicate. The audit row is the version log.

- `entity_type = 'customer.integration'`
- `entity_id  = '<customerId>:<key>'`
- `customer_id = <customerId>`
- `action     = 'sync' | 'reset' | 'disable'`
- `metadata` carries the full `RecordSyncInput` (status, version, actor,
  note, payload, error if any) plus the previous `version` for diffing
- `created_at` is the timestamp of the event

`audit_logs` is already indexed on `(tenantId, entityType, entityId)` and
`(tenantId, customerId, createdAt)` — both fit this access pattern (e.g.
"the last 50 sync events for customer X / integration thingsboard"). Retention
is 1 year per RFC-0009.

Querying the recent history for one customer × integration becomes a normal
SQL filter:

```sql
SELECT created_at, action, metadata->>'status' AS status,
       metadata->>'version' AS version, metadata->>'actor' AS actor
FROM audit_logs
WHERE tenant_id   = $1
  AND entity_type = 'customer.integration'
  AND entity_id   = $2 || ':' || $3   -- customerId:key
ORDER BY created_at DESC
LIMIT 50;
```

This replaces what the original draft of this RFC stored as an in-row
`history` array. Carrying a duplicate copy in `metadata` would cost row size
without buying anything `audit_logs` does not already provide.

### 10. Indexes (none)

No indexes are added on `metadata`. Operational queries answered by this RFC
are **per-customer** (ID lookup is already indexed). Cross-customer reports
("which customers have failed ThingsBoard sync?") are answered by querying
`audit_logs` with `entity_type = 'customer.integration'` and a status filter,
not by scanning `metadata`. If that query pattern becomes hot, a partial
expression index on `(metadata->'integrations'->'thingsboard'->>'status')` can
be added later without breaking this RFC.

---

## Security

### Plaintext MQTT credentials in `customers.metadata`

`integrations.centrals.items[].mqttPassword` is stored as **plaintext** in
the JSONB `customers.metadata` column. This is a deliberate trade-off, not
an oversight, and operators must understand the surface area before this
RFC ships:

- **`pg_dump` carries it.** Every backup, every snapshot, every replication
  bootstrap. Any operator with read access to a dump has the password.
- **Replicas carry it.** Read replicas, dev mirrors, anything that
  follows the primary will hold the credential.
- **Audit log snapshots may carry it.** RFC-0009 captures `oldValues` and
  `newValues` on customer updates. If a customer update sets
  `metadata.integrations.centrals.items[]`, the password lands in
  `audit_logs.new_values` unless the audit middleware explicitly redacts
  the path. **A redaction rule is required before this ships** — see
  `pii-sanitizer.ts` for the existing redaction layer; this RFC adds
  `metadata.integrations.centrals.items[*].mqttPassword` to its deny list.
- **API responses must redact.** `GET /customers/:id/integrations` and
  `GET /customers/:id` (which returns the full row) MUST scrub the
  password field unless the caller holds an explicit
  `centrals:credentials:read` scope. The default response replaces the
  field with `"<redacted>"` and a sibling `mqttPasswordSet: boolean`.
- **Logs and error traces.** Any error path that serialises the customer
  row (validation errors, repository failures) risks leaking the password
  to the application log. Service-layer error formatters MUST drop the
  field before logging.

### Mitigations included in this RFC

1. **PII sanitiser deny list.** `pii-sanitizer.ts` is updated to redact
   `mqttPassword` on every JSON traversal it performs (audit log diffs,
   error logs, response serialisers that opt in).
2. **Default API response redaction.** The integrations endpoints replace
   `mqttPassword` with `<redacted>` unless the caller has the
   `centrals:credentials:read` scope. Writers do not get the password
   back on their own writes.
3. **Service-layer write guard.** `CustomerIntegrationService.recordSync`
   refuses to log an audit row whose `metadata` contains a verbatim
   password — it strips the field server-side before emitting the audit
   record.

### What this RFC does NOT solve

- **At-rest encryption of the password column.** This requires either
  pgcrypto with a managed key, or a vault-reference indirection. Both
  are option-3-grade migrations and are deliberately out of scope for
  this RFC. They are flagged in Drawbacks §3 as the trigger for option 3
  if security review demands them before merge.
- **Rotation.** There is no built-in mechanism to rotate the MQTT password
  for a central. A rotation flow can be added later as a single-call
  endpoint that updates `mqttPassword`, emits an audit event with the
  password redacted, and notifies the broker out-of-band.

### Decision required before implementation

Stakeholders MUST sign off on storing the MQTT password in plaintext
JSONB or push back to option 3. This is an explicit gate in the
acceptance criteria below.

---

## Drawbacks

1. **No schema-level type safety.** The Zod layer protects writes through the
   service, but ad-hoc `UPDATE` statements that mutate `metadata` directly
   bypass it. Mitigation: only the `CustomerIntegrationService` is allowed to
   write under `metadata.integrations`; reviewers reject any PR that does
   otherwise.
2. **Limited cross-customer queries.** Filtering "all customers with
   `thingsboard.status = FAILED`" requires a sequential scan or a later
   expression index. Acceptable for the current scale (< 10k customers); if
   the alarm dashboard needs sub-second cross-tenant reports, escalate to
   option 3 of the design discussion (dedicated `customer_integrations`
   table).
3. **Plaintext MQTT credentials in `customers.metadata`** *(see Security).* The
   `centrals.items[].mqttPassword` field is stored as **plaintext** in a
   JSONB column with no column-level encryption, no field-level masking,
   and no row-level access control beyond the application layer. Every
   `pg_dump`, every replica, and every audit row that captures a `metadata`
   snapshot will carry the password in clear. This is the highest-risk
   trade-off in this RFC and may force option 3 (or a dedicated secrets
   table / vault reference) before this section ships.
4. **Last-write-wins on concurrent same-key updates.** Two writers calling
   `recordSync('thingsboard', …)` simultaneously will overwrite each other's
   live state. Acceptable because each integration is owned by a single
   backend that does not run two writers in parallel for the same customer,
   and the per-call audit row in `audit_logs` (§9) preserves the lost write.
5. **Large `metadata` rows when `centrals.items` grows.** Each central entry
   carries six string fields including the long Yggdrasil IPv6 address. With
   ~50 centrals on the largest customer this is still well under 32 KB and
   fits inside Postgres TOAST without performance pain, but it is the only
   integration whose row size scales with cardinality. Mitigation: repository
   methods that don't need integrations fetch with an explicit column list.

---

## Rationale and alternatives

Three options were considered. The full discussion lives in the chat thread
that produced this RFC; below is the summary.

### Option 1 (chosen) — reuse `customers.metadata`

- **Pros:** zero migration, pattern identical to RFC-0019 (`customers.config`),
  the simplest thing that works, easy to extend with a new integration key by
  changing one constants file.
- **Cons:** see Drawbacks §1–§5.

### Option 2 — dedicated `customers.integrations jsonb` column

A separate JSONB column instead of nesting inside `metadata`. Marginally
cleaner separation but adds a migration and gives no real query benefit over
option 1, since the queryability ceiling of a JSONB column is the same.
**Rejected** as not worth the migration.

### Option 3 — relational `customer_integrations` + per-central secrets table

Two new tables (`customer_integrations` for live state per integration,
plus a dedicated `customer_central_credentials` for the MQTT credentials
of `centrals.items`). Best for cross-customer reporting, retry policies,
and — critically — column-level isolation of the MQTT password. **Deferred**:
revisit when option 1's drawbacks become operational pain (Drawback §2)
or when the Security risk forces credential isolation. The pivot
cost is moderate — one migration that backfills from `metadata.integrations`
and a swap of the repository layer; the public service interface stays
stable, callers do not change.

---

## Prior art

- **RFC-0019 — Customer Config**: established the pattern of an extensible
  per-customer JSONB column (`customers.config`). RFC-0033 mirrors that
  pattern but reuses `metadata` instead of adding a new column, because
  `metadata` already exists and is `NOT NULL` with default `{}`.
- **RFC-0023 — Device Sync Job API**: introduced `device_sync_jobs`, a
  dedicated table for one specific sync workflow (device CSV import). It is
  the relational equivalent of option 3 above, scoped to one integration and
  one operation, and does not generalise to "every ecosystem the customer
  participates in".
- **RFC-0009 — Events / Audit Logs**: this RFC delegates the entire version
  log to `audit_logs`. There is no in-row history copy. Querying the audit
  log directly is the supported and only way to read past sync events for a
  customer × integration pair.
- **RFC-0015 — Alarm Bundle Version History**: precedent for per-customer
  versioned state — but it stores its history in a dedicated table, not on
  the customer row.

---

## Unresolved questions

1. **Should `metadata.integrations.<key>.disabled = true` block reads of the
   integration's data, or only stop the writer from advancing state?** The
   former requires every consumer to check the flag; the latter is simpler.
   Default proposal: **only stops state advancement**, consumers do not
   inspect the flag.
2. **Does the alarm orchestrator already have a place to record "version
   actually loaded"?** If so, RFC-0033's `alarms` integration becomes a thin
   mirror of that. Needs a 1:1 sync with the orchestrator team before the
   `alarms` integration is wired.
3. **Per-environment scope.** Today `customers.metadata` is global to the
   tenant. If a customer is staged in dev/staging/prod with different sync
   states, do we model environments here or rely on separate GCDR
   deployments? Default proposal: **separate deployments**, no env field in
   the state.

---

## Future possibilities

- **Webhook fan-out**: when a sync event arrives, optionally fan out to
  registered webhook endpoints (operations dashboard, Slack, etc.). Out of
  scope for the first cut.
- **SLO tracking**: derive a `health` rollup at the customer level
  (`metadata.integrationHealth = OK | DEGRADED | FAILED`) computed from the
  worst child status. Cheap to add; not part of v1.
- **Migration to option 3**: if cross-customer reporting becomes a hot path,
  introduce `customer_integrations` and `customer_integration_events` and
  backfill from `metadata.integrations`. Service interface stays stable;
  repository implementation swaps.
- **Per-integration retry policy in `payload`**: integrations that own their
  own retry loop can serialise next-attempt schedule into `payload`. Not
  enforced — purely opt-in per integration.

---

## Acceptance criteria (for the eventual implementation RFC)

- [ ] `INTEGRATION_KEYS` and `INTEGRATION_STATUS` constants added to
      `src/domain/integrations/`.
- [ ] `IntegrationStateSchema`, `CentralEntrySchema`,
      `CentralsIntegrationStateSchema`, and `CustomerIntegrationsSchema`
      Zod schemas shipped in `src/dto/`.
- [ ] `CustomerIntegrationService` implemented with the contract in §6,
      writing through `jsonb_set` as in §7.
- [ ] REST routes under `/customers/:customerId/integrations` (§8) with auth
      rules enforced.
- [ ] Audit log emission wired through `recordSync`, `reset`, `disable` (§9) —
      one row per call; **no in-row history array** is written.
- [ ] **Security gate (Security)**: stakeholder sign-off on storing
      `mqttPassword` plaintext in JSONB, OR pivot to option 3 before merge.
- [ ] `pii-sanitizer.ts` deny list updated to redact
      `metadata.integrations.centrals.items[*].mqttPassword` on every
      traversal.
- [ ] API responses for `GET /customers/:id` and
      `GET /customers/:id/integrations` redact `mqttPassword` unless the
      caller holds the `centrals:credentials:read` scope; sibling
      `mqttPasswordSet: boolean` exposed instead.
- [ ] Unit tests cover: counter reset on success, last-error cleared on
      success, status transitions, `jsonb_set` correctness when `metadata`
      was previously `{}`, and `centrals.items` round-trip through Zod
      including the password-redaction layer on read paths.
- [ ] Integration test against a real Postgres validating no clobbering when
      two integrations write concurrently to different keys.
- [ ] Operator runbook entry in `docs/ONBOARDING.md` pointing at this RFC.
- [ ] No migration files added — explicitly verified in PR description.
