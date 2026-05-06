# RFC-0033 — Customer Integration Sync State

- **Status:** Draft (pending approval)
- **Created:** 2026-05-06
- **Author:** GCDR Core Team
- **Domain:** Customers / Cross-System Integrations
- **Decision needed by:** before implementation kickoff

---

## Summary

Introduce a structured `integrations` namespace inside the existing
`customers.metadata` JSONB column to track the **sync state** and a **bounded
version log** of every external ecosystem the customer participates in
(Ingestion, Centrals registry, ThingsBoard, Alarm orchestrator, Work Orders,
Freshdesk).

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
  "payload":        { /* free-form, integration-owned */ },
  "history": [                                     // bounded version log, newest first
    {
      "at":        "2026-05-06T12:30:00.000Z",
      "status":    "OK",
      "version":   "v42",
      "actor":     "tb-bridge:cron",               // who triggered the sync
      "note":      "incremental sync, 12 entities updated"
    }
    // ... up to 20 entries, oldest entries are dropped ...
  ]
}
```

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
3. Prepending a new entry to `history` and truncating to 20 entries.
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
`IDLE` to `OK` or from `OK` to `FAILED`. The history log is the audit trail.

### 5. Zod schema

```ts
// src/dto/customerIntegrationSchema.ts
import { z } from 'zod';
import { INTEGRATION_KEYS, INTEGRATION_STATUS } from '../domain/integrations/IntegrationKey';

const HistoryEntrySchema = z.object({
  at:      z.string().datetime(),
  status:  z.enum(INTEGRATION_STATUS),
  version: z.string().max(255).optional(),
  actor:   z.string().max(255),
  note:    z.string().max(500).optional(),
});

export const IntegrationStateSchema = z.object({
  status:        z.enum(INTEGRATION_STATUS),
  version:       z.string().max(255).nullable().default(null),
  lastSyncAt:    z.string().datetime().nullable().default(null),
  lastSuccessAt: z.string().datetime().nullable().default(null),
  lastError:     z.string().max(2000).nullable().default(null),
  syncCount:     z.number().int().nonnegative().default(0),
  failureCount:  z.number().int().nonnegative().default(0),
  payload:       z.record(z.unknown()).default({}),
  history:       z.array(HistoryEntrySchema).max(20).default([]),
});

export const CustomerIntegrationsSchema = z.object(
  Object.fromEntries(
    INTEGRATION_KEYS.map((k) => [k, IntegrationStateSchema.optional()]),
  ),
);
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
| `history`       | new entry prepended; array truncated to **20 entries** (newest kept) |

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
latest sync attempt and `history` records the lost detail.

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

### 9. Audit logs (RFC-0009 hook)

Every `recordSync`, `reset`, and `disable` call emits an audit log entry with:

- `entity_type = 'customer.integration'`
- `entity_id  = '<customerId>:<key>'`
- `action     = 'sync' | 'reset' | 'disable'`
- payload contains the `RecordSyncInput`

The on-row `history` array is the **fast** local log (last 20). The audit log
is the **complete** log, kept for 1 year per RFC-0009 retention.

### 10. Bounded history

The hard cap is **20 entries** in `metadata.integrations.<key>.history`. With
six integrations this caps `metadata` growth at roughly **6 × 20 = 120**
history entries plus state envelopes — typically under 32 KB per row, well
inside Postgres `jsonb` performance bounds. The complete history lives in
audit logs (see §9).

### 11. Indexes (none)

No indexes are added on `metadata`. Operational queries answered by this RFC
are **per-customer** (ID lookup is already indexed). Cross-customer reports
("which customers have failed ThingsBoard sync?") are answered by querying
`audit_logs` with `entity_type = 'customer.integration'` and a status filter,
not by scanning `metadata`. If that query pattern becomes hot, a partial
expression index on `(metadata->'integrations'->'thingsboard'->>'status')` can
be added later without breaking this RFC.

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
3. **Bounded history.** Only the last 20 entries per integration are retained
   in-row. The full version log lives in `audit_logs` (RFC-0009) and outlives
   the bounded copy.
4. **Last-write-wins on concurrent same-key updates.** Two writers calling
   `recordSync('thingsboard', …)` simultaneously will overwrite each other's
   live state; only one history entry is kept. Acceptable because each
   integration is owned by a single backend that does not run two writers in
   parallel for the same customer.
5. **Large `metadata` rows.** With six integrations and twenty history entries
   each, the column can reach tens of kilobytes per row. Postgres TOASTs this
   transparently, but very wide reads (`SELECT * FROM customers`) will pull it
   in. Mitigation: repository methods that don't need integrations fetch with
   an explicit column list.

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

### Option 3 — relational `customer_integrations` + `customer_integration_events`

Two new tables (`customer_integrations` for live state, append-only
`customer_integration_events` for full version log). Best for cross-customer
reporting, retry policies, and full unbounded audit. **Deferred**: revisit
when option 1's drawbacks become operational pain (see §11). The pivot cost is
moderate — one migration that backfills from `metadata.integrations` and a
swap of the repository layer; no domain change.

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
- **RFC-0009 — Events / Audit Logs**: provides the long-tail log this RFC
  hooks into. The on-row `history` is a 20-entry cache; the authoritative log
  is `audit_logs`.
- **RFC-0015 — Alarm Bundle Version History**: precedent for per-customer
  versioned state with bounded retention.

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
- [ ] `IntegrationStateSchema` and `CustomerIntegrationsSchema` Zod schemas
      shipped in `src/dto/`.
- [ ] `CustomerIntegrationService` implemented with the contract in §6,
      writing through `jsonb_set` as in §7.
- [ ] REST routes under `/customers/:customerId/integrations` (§8) with auth
      rules enforced.
- [ ] Audit log emission wired through `recordSync`, `reset`, `disable` (§9).
- [ ] Unit tests cover: history cap at 20, counter reset on success, last-error
      cleared on success, status transitions, and `jsonb_set` correctness when
      `metadata` was previously `{}`.
- [ ] Integration test against a real Postgres validating no clobbering when
      two integrations write concurrently to different keys.
- [ ] Operator runbook entry in `docs/ONBOARDING.md` pointing at this RFC.
- [ ] No migration files added — explicitly verified in PR description.
