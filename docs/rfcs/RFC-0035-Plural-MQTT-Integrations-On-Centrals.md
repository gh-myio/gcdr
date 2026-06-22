# RFC-0035 — Plural MQTT Integrations on Centrals

- **Status:** Implemented (2026-05-16)
- **Created:** 2026-05-15
- **Author:** GCDR Core Team
- **Domain:** Centrals / Customer Integrations
- **Supersedes (partial):** RFC-0033 §5 `CentralEntrySchema`, §115–154 `centrals.items[]` shape
- **Implementation commits:** `94e2283` (Phase 2 additive), `4504fd2` (backend cutover), `b821125` (frontend cutover)

---

## Summary

Reshape the central's network and MQTT model so that:

1. **IPv6 Yggdrasil moves to the central itself** (`centrals.config.ipv6Yggdrasil`). It is intrinsic to the hardware — the same address regardless of which integrations are configured.
2. **MQTT becomes plural**. A central can publish to multiple upstream destinations (GCDR, Alarms, ThingsBoard, Ingestion), each with its own broker URL, credentials, TLS, QoS, topic — represented as `centrals.config.mqttIntegrations[]`.
3. **Per-integration MQTT passwords stay in `customers.metadata.integrations.centrals.items[]`** but partitioned per integration id (`mqttPasswords: Record<integrationId, string>`).

This supersedes the `centrals.items[]` shape from RFC-0033 (single broker, single password, ipv6 mixed with credentials). The rest of RFC-0033 (other integration keys: `ingestion`, `thingsboard`, `alarms`, `workorders`, `freshdesk` as state ledgers) stays intact.

No schema migration is required — both `centrals.config` and `customers.metadata` are existing JSONB columns. Data is reshaped via idempotent SQL backfill.

An external-consumer audit (alarms-orchestrator code review confirmed: 100% via GCDR REST/bundle, zero direct reads of the affected fields — see Drawbacks §1 for the audit trail) showed there is **no external consumer of the affected fields**. The refactor is internal to GCDR backend + frontend.

---

## Motivation

The current model is split across two places and assumes a single MQTT broker per central:

| What | Where today | Problem |
|---|---|---|
| MQTT broker URL, port, TLS, topic prefix, QoS | `centrals.config.mqttConfig` (single object) | Assumes ONE broker for the central. Real world: each destination is its own broker. |
| MQTT username, clientId, password | `customers.metadata.integrations.centrals.items[i]` | Credentials for an unstated broker (implicitly the ingestion one). Operator has to know which. |
| Destination flags (`ingestionEnabled`, `thingsboardEnabled`) + per-flag topics | `centrals.config.mqttConfig` (mixed with broker fields) | Mixes "broker connection" with "downstream destination". Confusing when topics belong to different brokers. |
| IPv6 Yggdrasil (mesh address, intrinsic identity) | `customers.metadata.integrations.centrals.items[i].ipv6Yggdrasil` | Intrinsic hardware property stored under an integration scope. Same central, multiple customer references would imply multiple ipv6 — semantically wrong. |
| `ingestionGatewayId` | `customers.metadata.integrations.centrals.items[i].ingestionGatewayId` | Specific to one integration (ingestion). Should live with that integration entry. |

The cumulative effect:

- *Operator UX*: editing a single MQTT integration requires two screens (central edit for broker URL + customer integrations tab for credentials).
- *Extensibility*: when GCDR-MQTT and Alarms-MQTT come online there is no slot for a second broker on the same central.
- *Modeling clarity*: IPv6 Yggdrasil is identity, not integration.

This RFC fixes all four points in a single internal refactor.

---

## Guide-level explanation

### The new model

```
Central / Gateway
│
├── Identity (intrinsic, single)
│   ├── UUID                       centrals.id
│   ├── Serial Number              centrals.serial_number
│   ├── MAC Address                centrals.config.macAddress
│   └── IPv6 Yggdrasil             centrals.config.ipv6Yggdrasil     ← MOVED from items[]
│
├── Network LAN (optional, single)
│   ├── IP Address (v4)            centrals.config.ipAddress
│   ├── Hostname / port            centrals.config.hostname / port
│   └── (DNS, gateway, subnet —    currently frontend-only; future schema)
│
└── MQTT Integrations (plural, N)
    centrals.config.mqttIntegrations[] = [
      { id: "gcdr"|"alarms"|"thingsboard"|"ingestion", enabled, broker, port,
        clientId, userName, useTls, qos, topicPrefix?, topic?, destinationGatewayId? }
    ]

    Per-integration passwords (still in customer scope, partitioned):
    customers.metadata.integrations.centrals.items[] = [
      { uuid, mqttPasswords: { ingestion?, thingsboard?, gcdr?, alarms? } }
    ]
```

### A worked example

A central for customer X publishes to two destinations today (ingestion + thingsboard) and the operator wants to enable alarms tomorrow.

**`centrals.config`** (managed via `PUT /centrals/:id`):

```jsonc
{
  "ipAddress":     "192.168.1.10",
  "macAddress":    "AA:BB:CC:DD:EE:01",
  "ipv6Yggdrasil": "200:abcd:1234::1",

  "mqttIntegrations": [
    {
      "id":       "ingestion",
      "enabled":  true,
      "broker":   "mqtt.ingestion.myio-bas.com",
      "port":     8883,
      "clientId": "moxuara-01-ingestion",
      "userName": "central-moxuara-01",
      "useTls":   true,
      "qos":      1,
      "topicPrefix": "ingestion/telemetry",
      "topic":    "ingestion/telemetry",
      "destinationGatewayId": "11111111-2222-3333-4444-555555555555"
    },
    {
      "id":       "thingsboard",
      "enabled":  true,
      "broker":   "thingsboard.myio-bas.com",
      "port":     8883,
      "clientId": "moxuara-01-tb",
      "userName": "central-moxuara-01-tb",
      "useTls":   true,
      "qos":      1,
      "topic":    "v1/devices/me/telemetry"
    },
    {
      "id":       "alarms",
      "enabled":  false,
      "broker":   "",
      "port":     8883,
      "clientId": "",
      "userName": "",
      "useTls":   true,
      "qos":      1
    }
  ]
}
```

**`customers.metadata.integrations.centrals.items[]`** (managed via `PATCH /customers/:cId/integrations` or per-integration password endpoints):

```jsonc
[
  {
    "uuid": "adb43bf6-6107-44fa-b786-6e88c150d779",
    "mqttPasswords": {
      "ingestion":   "<plaintext>",
      "thingsboard": "<plaintext>"
    }
  }
]
```

The operator enabling alarms tomorrow flips `enabled: true`, fills broker/clientId/userName, and sets the password via `PUT /centrals/:id/mqtt-passwords/alarms`.

### Read enrichment

`GET /centrals/:id` and the list endpoints still enrich on read (single source of truth pattern from the prior iteration), but the enriched payload is just a per-integration `mqttPasswordsSet: Record<integrationId, boolean>` indicator. Broker config, ipv6, and topic come straight from `centrals.config` — no customer lookup needed for those.

```jsonc
{
  "id": "adb43bf6-...",
  "config": {
    "ipv6Yggdrasil": "200:abcd:1234::1",
    "mqttIntegrations": [ /* as above */ ]
  },
  "mqttPasswordsSet": {
    "ingestion":   true,
    "thingsboard": true,
    "gcdr":        false,
    "alarms":      false
  }
}
```

---

## Reference-level explanation

### 1. Storage changes (no schema migration)

| Location | Action |
|---|---|
| `centrals.config.ipv6Yggdrasil` | **ADD** (string, max 64) |
| `centrals.config.mqttIntegrations[]` | **ADD** (array of `CentralMqttIntegration`) |
| `centrals.config.mqttConfig` | **DROP** (after backfill in Phase B) |
| `customers.metadata.integrations.centrals.items[i].uuid` | **KEEP** |
| `customers.metadata.integrations.centrals.items[i].mqttPasswords` | **ADD** (`Record<integrationId, string>`) |
| `customers.metadata.integrations.centrals.items[i].mqttPassword` | **DROP** (string singular; data moves into `mqttPasswords.ingestion`) |
| `customers.metadata.integrations.centrals.items[i].mqttUserName` | **DROP** (moves to `mqttIntegrations[id='ingestion'].userName`) |
| `customers.metadata.integrations.centrals.items[i].mqttClientId` | **DROP** (moves to `mqttIntegrations[id='ingestion'].clientId`) |
| `customers.metadata.integrations.centrals.items[i].ipv6Yggdrasil` | **DROP** (moves to `centrals.config.ipv6Yggdrasil`) |
| `customers.metadata.integrations.centrals.items[i].ingestionGatewayId` | **DROP** (moves to `mqttIntegrations[id='ingestion'].destinationGatewayId`) |

All changes are JSONB content changes — no `ALTER TABLE`.

### 2. Integration ID registry

```ts
// src/domain/integrations/CentralMqttIntegrationId.ts
export const CENTRAL_MQTT_INTEGRATION_IDS = [
  'gcdr',         // future: telemetry/control via GCDR-owned broker (not impl in v1)
  'alarms',       // future: alarm dispatch via alarms-orchestrator broker (not impl in v1)
  'thingsboard',  // mirror to ThingsBoard MQTT
  'ingestion',    // primary telemetry → data-ingestion service
] as const;

export type CentralMqttIntegrationId = (typeof CENTRAL_MQTT_INTEGRATION_IDS)[number];
```

Only `ingestion` and `thingsboard` carry data on day 1. `gcdr` and `alarms` are reserved slots — backfill creates them with `enabled: false` so the UI can render them without special-casing.

### 3. Zod schemas

```ts
// src/dto/request/CentralDTO.ts
import { CENTRAL_MQTT_INTEGRATION_IDS } from '../../domain/integrations/CentralMqttIntegrationId';

const CentralMqttIntegrationSchema = z.object({
  id:                   z.enum(CENTRAL_MQTT_INTEGRATION_IDS),
  enabled:              z.boolean().default(false),
  broker:               z.string().max(500).optional(),
  port:                 z.number().int().min(1).max(65535).optional(),
  clientId:             z.string().max(255).optional(),
  userName:             z.string().max(255).optional(),
  useTls:               z.boolean().default(true),
  qos:                  z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  keepAlive:            z.number().int().min(0).max(3600).optional(),
  topicPrefix:          z.string().max(500).optional(),
  topic:                z.string().max(500).optional(),
  destinationGatewayId: z.string().uuid().nullable().optional(),
});

const CentralConfigSchema = z.object({
  // ... existing fields (ipAddress, macAddress, hostname, port, syncInterval, ...)
  ipv6Yggdrasil:      z.string().max(64).optional(),
  mqttIntegrations:   z.array(CentralMqttIntegrationSchema).max(8).optional(),
});
```

```ts
// src/dto/request/CustomerIntegrationDTO.ts  — superseded centrals.items[] shape
export const CentralEntrySchema = z.object({
  uuid:          z.string().uuid(),
  mqttPasswords: z
    .record(z.enum(CENTRAL_MQTT_INTEGRATION_IDS), z.string().min(1).max(2000))
    .default({}),
});
```

### 4. Service contract

**`CentralService`**

Existing methods stay; behaviour adjusted:

- `getById`, `list`, `listByCustomer`, `listByAsset` — still enrich on read, but the enriched payload is `central.mqttPasswordsSet: Record<id, boolean>` (replaces `central.connection`).
- `update(tenantId, id, data, userId)` — `body.config.mqttIntegrations[]` writes directly to `centrals.config` (no proxy). `body.connection` is REMOVED. Password writes go through the new dedicated routes.

**`CustomerIntegrationService`**

- `upsertCentralEntry` → renamed `upsertCentralPasswords(tenantId, customerId, uuid, partialPasswords, actor)` — merges into `items[uuid].mqttPasswords` per-id (incoming key wins; absent keys preserved).
- `replaceCentralsItems(input)` — `input.items[]` now matches the new `CentralEntrySchema` (uuid + mqttPasswords map). Per-id password merge rule: empty string on an existing id keeps the stored value (same semantics as today, just plural).
- `revealCentralCredential(tenantId, customerId, uuid)` → renamed `revealCentralPassword(tenantId, customerId, uuid, integrationId)` — returns one specific password.

### 5. REST surface

**Existing endpoints (behaviour change, same URL)**:

| Method | Path | Change |
|---|---|---|
| GET | `/centrals` `/centrals/:id` `/customers/:cId/centrals` `/assets/:aId/centrals` | Response: `central.mqttPasswordsSet` replaces `central.connection`. `central.config.mqttIntegrations[]` populated. `central.config.mqttConfig` no longer present (Phase B). |
| PUT | `/centrals/:id` | `body.connection.*` REMOVED. To change broker config: `body.config.mqttIntegrations`. To change passwords: new endpoints below. |
| GET | `/customers/:cId/integrations` | `centrals.items[]` shape changes — see §3 above. |
| PATCH | `/customers/:cId/integrations` (admin bulk) | Accepts new `CentralEntrySchema`. |

**New endpoints**:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PUT | `/centrals/:id/mqtt-passwords/:integrationId` | JWT/APIKey (`customers:write`) | Set the password for one integration. Body: `{ password: string }`. |
| DELETE | `/centrals/:id/mqtt-passwords/:integrationId` | JWT/APIKey (`customers:write`) | Unset the password (removes the key). |
| GET | `/centrals/:id/mqtt-passwords/:integrationId/reveal` | JWT admin | Reveal plaintext password. Emits `CUSTOMER_INTEGRATION_CREDENTIALS_REVEALED` audit with `metadata.integrationId`. |

### 6. Migration (idempotent SQL, two phases)

Files:
- `scripts/db/ops/0035-phaseA-additive-backfill.sql`
- `scripts/db/ops/0035-phaseB-cleanup-legacy.sql`

**Phase A (additive — runs first, while code reads both old and new)**

```sql
-- A1. Copy ipv6Yggdrasil from items[] to centrals.config (only if not already set)
UPDATE centrals c
SET config = c.config || jsonb_build_object('ipv6Yggdrasil', item->>'ipv6Yggdrasil')
FROM customers cu,
     jsonb_array_elements(cu.metadata #> '{integrations,centrals,items}') AS item
WHERE c.id = (item->>'uuid')::uuid
  AND c.customer_id = cu.id
  AND (item ? 'ipv6Yggdrasil')
  AND NOT (c.config ? 'ipv6Yggdrasil');

-- A2. Build mqttIntegrations[] from legacy mqttConfig + items[] (one row per central)
UPDATE centrals c
SET config = c.config || jsonb_build_object(
  'mqttIntegrations', jsonb_build_array(
    jsonb_build_object(
      'id', 'ingestion',
      'enabled', coalesce((c.config->'mqttConfig'->>'ingestionEnabled')::boolean, false),
      'broker', c.config->'mqttConfig'->>'broker',
      'port', nullif(c.config->'mqttConfig'->>'port', '')::int,
      'clientId', c.config->'mqttConfig'->>'clientId',
      'userName', item->>'mqttUserName',
      'useTls', coalesce((c.config->'mqttConfig'->>'useTls')::boolean, true),
      'qos', coalesce(nullif(c.config->'mqttConfig'->>'qos', '')::int, 1),
      'topicPrefix', c.config->'mqttConfig'->>'topicPrefix',
      'topic', coalesce(c.config->'mqttConfig'->>'ingestionTopic', 'ingestion/telemetry'),
      'destinationGatewayId', nullif(item->>'ingestionGatewayId', '')
    ),
    jsonb_build_object(
      'id', 'thingsboard',
      'enabled', coalesce((c.config->'mqttConfig'->>'thingsboardEnabled')::boolean, false),
      'broker', c.config->'mqttConfig'->>'broker',
      'port', nullif(c.config->'mqttConfig'->>'port', '')::int,
      'clientId', c.config->'mqttConfig'->>'clientId',
      'userName', item->>'mqttUserName',
      'useTls', coalesce((c.config->'mqttConfig'->>'useTls')::boolean, true),
      'qos', coalesce(nullif(c.config->'mqttConfig'->>'qos', '')::int, 1),
      'topic', coalesce(c.config->'mqttConfig'->>'thingsboardTopic', 'v1/devices/me/telemetry')
    ),
    jsonb_build_object('id', 'gcdr',   'enabled', false, 'useTls', true, 'qos', 1),
    jsonb_build_object('id', 'alarms', 'enabled', false, 'useTls', true, 'qos', 1)
  )
)
FROM customers cu,
     jsonb_array_elements(cu.metadata #> '{integrations,centrals,items}') AS item
WHERE c.id = (item->>'uuid')::uuid
  AND c.customer_id = cu.id
  AND NOT (c.config ? 'mqttIntegrations');

-- A3. Restructure items[] — keep only uuid + new mqttPasswords map
UPDATE customers cu
SET metadata = jsonb_set(
  cu.metadata,
  '{integrations,centrals,items}',
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'uuid', item->>'uuid',
        'mqttPasswords', jsonb_build_object(
          'ingestion', item->>'mqttPassword'
        )
      )
    )
    FROM jsonb_array_elements(cu.metadata #> '{integrations,centrals,items}') AS item
    WHERE (item ? 'mqttPassword') AND length(item->>'mqttPassword') > 0
  )
)
WHERE cu.metadata #> '{integrations,centrals,items}' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(cu.metadata #> '{integrations,centrals,items}') AS item
    WHERE item ? 'mqttPassword'
  );
```

**Phase B (cleanup — runs after frontend deploy)**

```sql
-- B1. Drop legacy mqttConfig from centrals.config
UPDATE centrals
SET config = config - 'mqttConfig'
WHERE config ? 'mqttConfig';
```

Both phases dry-run-able (`BEGIN; ...; ROLLBACK;` template, output row counts before commit).

### 7. PII sanitiser + audit

Update `src/shared/utils/pii-sanitizer.ts` deny-list:

- REMOVE: `metadata.integrations.centrals.items[*].mqttPassword`
- ADD:    `metadata.integrations.centrals.items[*].mqttPasswords.*` (wildcard match — any key)

`CustomerIntegrationService.replaceCentralsItems` and `upsertCentralPasswords` strip the same path before emitting audit metadata.

`revealCentralPassword` audit row includes `metadata.integrationId` (so the audit log distinguishes "ingestion password revealed" from "thingsboard password revealed" for the same uuid).

### 8. Read masking (response shape)

`maskCentralEntry` returns:

```ts
{
  uuid: string,
  mqttPasswordsSet: Record<CentralMqttIntegrationId, boolean>,  // ← derived from presence of each key
  // NO mqttPasswords field on default responses — only on reveal path.
}
```

`/customers/:cId/integrations` returns `centrals.items[i].mqttPasswordsSet` only. The password values themselves are not in the default response; reveal goes through the dedicated per-integration endpoint.

---

## Security

Same surface as RFC-0033 §Security: plaintext passwords live in JSONB, exposed by `pg_dump`, replicas, and unredacted audit snapshots. All mitigations propagate, plus:

- **Per-integration audit granularity**: each reveal is tagged with its `integrationId`, so abuse of one credential is distinguishable in the audit log.
- **Deny-list change is breaking**: existing audit redaction rule matches a single `mqttPassword` key. The wildcard `mqttPasswords.*` must land in the same commit as the data shape change, or audit rows post-migration could leak passwords.

What this RFC still does **NOT** solve:
- At-rest encryption (vault reference / pgcrypto) — out of scope, same as RFC-0033.
- Rotation API — single-call endpoint per integration is a natural follow-up; not in v1.

---

## Drawbacks

1. **External-consumer audit is the safety net for this whole RFC.** The plan stands or falls on alarms-orchestrator never reading these fields. Evidence: code audit on `alarms-backend.git` (2026-05-15) confirmed orchestrator only consumes GCDR via REST (`/api/v1/rules/:id`, `/customers/:id/channels`, etc.) and the alarm bundle endpoint. Zero references to `mqttPassword`, `mqttUserName`, `mqttClientId`, `ipv6Yggdrasil`, `ingestionGatewayId`, or `customer.metadata.integrations`. Also confirmed: GCDR-side `gatewayToken` (legacy rule field still read by orchestrator with optional chaining) has zero references in GCDR `src/` — it is not populated by anything we are about to refactor. If a future external consumer enters the picture, this RFC must be revisited.

2. **Duplicate broker config when integrations point to the same physical broker.** If `ingestion` and `thingsboard` use the same broker URL/port/credentials, the operator fills them in two entries. Trade-off vs an indirection (`broker_id` referencing a deduplicated mqtt-brokers entity). Deferred — call to introduce that abstraction is the trigger to revisit (see Future possibilities).

3. **Brief dual-shape window in `centrals.config`** between Phase A and Phase B. Reader code must check both `mqttIntegrations` and `mqttConfig` and prefer the former. Mitigation: Phase B runs immediately after frontend deploy is confirmed in production.

4. **Backward-incompat with `body.connection` PUT helper** (added in commit `eb0f5ae` and consumed by frontend `d9fa492`). The helper is removed in this RFC. Mitigation: frontend reshape lands in the same window; no external API consumer used the helper (only `gcdr-frontend.git`).

5. **`enabled` flag default semantics.** New integrations created by backfill have `enabled: false` for `gcdr`/`alarms` slots. Operator must explicitly flip them on. This is the right default but means the UI must distinguish "unconfigured" (no broker) from "configured but disabled".

---

## Rationale and alternatives

### Option A — Cosmetic UI fix only (no schema change)
Move IPv6 input visually to the Network card, rename "Connection" to "Ingestion Credentials". Backend unchanged. **Rejected** — does not address the plural-broker need and perpetuates the split storage.

### Option B (chosen) — Plural `mqttIntegrations[]` + ipv6 to central
Single source of truth per concern: identity in the central, integration broker config in the central, passwords partitioned per integration in customer scope. Builds cleanly on RFC-0033 patterns without a new table.

### Option C — Dedicated `mqtt_brokers` table + `central_mqtt_endpoints`
Two new tables, FK-deduplicated brokers. Best for cardinality (many centrals sharing brokers) and column-level credential isolation. **Deferred** — same trigger as RFC-0033 Option 3 (security review demanding column-level isolation, or operational pain from JSONB cross-customer queries). The pivot cost is moderate: one migration + repository swap; the service interface defined here stays stable.

---

## Prior art

- **RFC-0033** — established the `customers.metadata.integrations` namespace. This RFC partially supersedes its `centrals.items[]` shape only.
- **RFC-0019** — extensible per-customer JSONB pattern (`customers.config`). Same philosophy applied to `centrals.config` here.
- **Removal of `gatewayToken` from rules** (declared in `docs/GCDR-USER.md:329`) — precedent for cleaning up unused fields on the central/rule path.
- **Commit `eb0f5ae`** (GCDR backend) and **`d9fa492`** (gcdr-frontend) — the immediate prior iteration (singular `body.connection` helper). Superseded but kept in history as the path that revealed the need for the plural model.

---

## Unresolved questions

1. **Should the dual-shape window in `centrals.config` (Phase A → Phase B) read-prefer the new or the old shape during the window?** Default proposal: **prefer `mqttIntegrations` when present, fall back to `mqttConfig`**. This way the backfill output is immediately authoritative and the legacy is only consulted for centrals not yet covered.

2. **`mqttPasswords` empty for an enabled integration — block sync or fail at publish?** Default proposal: do not block. The integration sync layer will fail at MQTT connect with a clear error. The UI surfaces `mqttPasswordsSet[id] = false` for visibility.

3. **Topic and topicPrefix coexistence** — for `ingestion` and `thingsboard` we have one `topicPrefix` (legacy) and one `topic` (destination). Should the new schema enforce exactly one, both, or leave both optional? Default proposal: **leave both optional**, integration-owning service interprets them.

4. **Should `gcdr` and `alarms` placeholder entries be created by backfill (so the UI always has 4 cards) or created lazily on first edit?** Default proposal: **created by backfill** — keeps the UI predictable and lets the operator see all four slots without first having to add them.

---

## Future possibilities

- **`mqtt-brokers` abstraction** (Option C) — when cardinality of brokers grows or security review demands column-level isolation.
- **Per-integration secret rotation API** — single-call endpoint, audit-logged, broker-side coordination out-of-scope.
- **Webhook fan-out on credential change** — notify the broker management plane when a password is rotated.
- **Bring `dns`, `gateway`, `subnet` (today frontend-only) into the schema** — separate RFC, follows the same shape principle as ipv6Yggdrasil.

---

## Acceptance criteria

- [ ] `CENTRAL_MQTT_INTEGRATION_IDS` constant in `src/domain/integrations/CentralMqttIntegrationId.ts`.
- [ ] `CentralMqttIntegrationSchema`, extended `CentralConfigSchema`, rewritten `CentralEntrySchema` shipped via `src/dto/`.
- [ ] `CentralService` updated: `enrichWithConnection` → emits `mqttPasswordsSet` map; `update` no longer accepts `body.connection`.
- [ ] `CustomerIntegrationService`: `upsertCentralPasswords` (per-integration password upsert), `replaceCentralsItems` accepting new shape, `revealCentralPassword(uuid, integrationId)` returning one specific password.
- [ ] New routes: `PUT /centrals/:id/mqtt-passwords/:integrationId`, `DELETE /centrals/:id/mqtt-passwords/:integrationId`, `GET /centrals/:id/mqtt-passwords/:integrationId/reveal`.
- [ ] `scripts/db/ops/0035-phaseA-additive-backfill.sql` (idempotent, dry-runnable) executed in dev/staging/prod.
- [ ] `scripts/db/ops/0035-phaseB-cleanup-legacy.sql` executed only after frontend deploy.
- [ ] `pii-sanitizer.ts` deny-list updated to wildcard `metadata.integrations.centrals.items[*].mqttPasswords.*`. Old single-key rule removed.
- [ ] Frontend `gcdr-frontend.git`:
    - [ ] `CentralForm.tsx` — "Connection" card removed; IPv6 input moved to Network card; "Configuração MQTT" reshaped to 4 sub-cards (gcdr/alarms/thingsboard/ingestion).
    - [ ] `CentralDetail.tsx` — "Connection" card removed; IPv6 row moved into Network card; "MQTT" card reshaped to N sub-cards with per-integration password-set badge.
    - [ ] `CustomerIntegrationsTab.tsx` — items[] editor only edits passwords by integration id; mqttUserName/clientId/ipv6 fields removed (they live on the central now).
    - [ ] Types updated, locales `pt-BR`/`en` strings added.
- [ ] Unit tests rewritten:
    - [ ] `CustomerIntegrationService` per-integration password merge, audit row stripping with the wildcard rule.
    - [ ] `CentralService` enrich returns correct `mqttPasswordsSet` map.
    - [ ] Migration SQL: round-trip backfill of one customer × 2 centrals × 2 passwords each.
- [ ] RFC-0033 marked as "partially superseded by RFC-0035" in its header; link added.
- [ ] `docs/api/API-Rule-GetById.md` — stale `gatewayToken` references removed (side-quest, separate PR ok).
- [ ] `docs/BACKLOG-RFCS.md` updated.
- [ ] `docs/ONBOARDING.md` or `docs/GCDR-USER.md` cross-references updated if they pointed at the old `centrals.items[]` shape.
- [ ] Verified in PR description: zero changes to `alarms-backend.git`, `data-ingestion.git`, or any external consumer. Internal-only refactor.
