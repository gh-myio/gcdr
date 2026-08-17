# RFC-0055 — No-Consumption Detection & Incidents Panel

- **Status:** Draft v2 (feedback-v1 folded in) · aligned with Alarms RFC-0030/0031 (2026-08-13)
- **Created:** 2026-08-03
- **Updated:** 2026-08-13 (aligned with the Alarms-side implementation)
- **Author:** GCDR Core Team
- **Domain:** Rules Engine / Alarms Orchestrator / Incidents / Frontend
- **Related RFCs:** RFC-0015 (Alarm Bundle Version History), RFC-0016 (ThingsBoard Entity Mapping), RFC-0035 (Plural MQTT on Centrals), `docs/RULE-ENTITY.md`, `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`
- **Owners (split):** GCDR Backend · GCDR Frontend · Alarms Orchestrator · Central Agent (read-only)

> **Changelog v2 (feedback-v1):** added a normative bundle payload; pinned the
> definition of "empty slot" (zero is present, null/absent is empty); decided the
> day-rollover + late-telemetry policy; changed the status model to
> `OPEN | RESOLVED` + ack metadata (no `ACKNOWLEDGED` status); switched slot ranges
> to **full timestamps** in storage/API (UI renders `HH:mm`); metric moved to the
> device level + validated enum; `timezone` required; v1 restricts `windowMinutes`
> to 60 and ships the rule **disabled by default** until Alarms confirms support;
> added Authorization, Frontend transport decision, Testing, and Acceptance
> Criteria sections; unique key now includes `customer_id`.

> **Alignment update (2026-08-13)** — reconciled with the shipped Alarms-side
> implementation (**RFC-0030**, No-Consumption; **RFC-0031**, Multi-Source
> Ingestion): (1) §8 rewritten — `NO_CONSUMPTION` is delivered as a separate
> additive `noConsumptionRules[]` section on `/bundle/to-verify-service` only
> (never in `rules[]`, never in `/bundle/simple`); the real precondition is the
> Alarms-side type guard (RFC-0030 §3.7, prod 2026-08-06), not "older builds
> ignore unknown types". (2) §7/§4/Summary — the Incidents panel is owned by
> `alarms-web`; GCDR `/incidents` is a **redirect**, not a proxy+panel. (3) the
> `metric` enum is lowercase on the wire (`energy_consumption` \| `water_flow`).
> (4) §4 — public candidate ingestion is superseded in part by RFC-0031.

---

## Summary

Detect when a device **stops producing consumption telemetry** — i.e. its hourly
telemetry slot is **empty** for a 1-hour window (or a run of windows) even though
the device may still be "online" at the connectivity level — and surface it as a
first-class **Incident** in a dedicated **Incidents panel**.

Three moving parts:

1. **GCDR** gains a new **internal rule type `NO_CONSUMPTION`** (a *data-absence*
   rule, distinct from the connectivity-based `DEVICE_OFFLINE`). It is
   platform-managed (`internalRule = true`), enters the alarm bundle like any
   other rule, and carries the detection window + expected-cadence config.

2. The **Alarms Orchestrator** consumes the bundle, evaluates the telemetry
   stream against the rule, and — when slots are empty — creates a **detailed
   Incident candidate**: *central X, date Y, device(s) with empty slots from hour
   T1 to T2* (or a set of intervals). Incidents are **aggregated by day per
   central**, grouping the affected devices, and within each device the **empty
   time-slot ranges**.

3. The **Incidents panel** (day → central → device → slot ranges, drill-down,
   filters, ack/resolve) is rendered by **`alarms-web`**, which owns the
   incidents plane (Alarms RFC-0030 §3.8). **GCDR Frontend** only exposes a
   `/incidents` **redirect** to it — see §7 (the earlier "GCDR renders the panel"
   plan was superseded).

This RFC defines the rule shape, the detection semantics, the incident data
model, the API contracts, and — importantly — **who owns each piece**.

---

## Motivation

`DEVICE_OFFLINE` answers "is the central/device reachable?". It does **not**
answer "is the device actually reporting the consumption metric we bill/monitor
on?". A meter can hold a live MQTT/connectivity link and still deliver **empty
consumption slots** (sensor fault, mis-mapped channel, upstream drop, ingestion
gap). Today that gap is invisible until someone notices a flat chart — exactly
the WestPlaza-style escalation (telemetry gaps) that reaches us via the client.

We need:

- A **declarative, internal rule** that states "every device in scope must have a
  non-empty consumption slot every hour", versioned and shipped in the bundle so
  the alarms side evaluates it uniformly.
- A **structured incident** (not a raw alarm per slot) that rolls the noise up
  into something an operator can act on: *"Central X, 2026-08-02: 4 devices with
  gaps; device A 03:00–05:00 and 21:00; device B 14:00–14:00; …"*.
- A **panel** to triage those incidents by day and central.

---

## Guide-level explanation

### The concept

```
GCDR (master data)                 Alarms Orchestrator                 GCDR Frontend
──────────────────                 ───────────────────                 ─────────────
NO_CONSUMPTION rule    ── bundle ─▶ evaluate telemetry slots  ── API ─▶ Incidents panel
(internal, per scope)               detect empty hourly slots            day ▸ central ▸
                                    build Incident candidate             device ▸ slots
   device/central       ◀─ enrich ─ (names, slaveId, central)
   registry lookups
```

- A slot is **"empty"** for an hour bucket `[H, H+1)` when the device produced
  **no consumption sample** (or only null/absent values) for the configured
  metric in that bucket. "Consumption" here is the metric domain already used by
  goals/tariffs (energy/water/etc.).
- The rule scopes to a set of devices (or a whole central/customer). Evaluation
  is hourly, aligned to a timezone.
- One **Incident** aggregates, for a `(central, day)`, all devices that had ≥1
  empty slot that day; each device carries its **merged empty-slot ranges**.
- The panel lets an operator see the day, expand a central, expand a device, and
  read the exact hour ranges — then acknowledge / resolve.

### Example incident (shape, not final schema)

```json
{
  "id": "inc_...",
  "kind": "NO_CONSUMPTION",
  "ruleId": "rule_no_consumption_internal",
  "customerId": "…", "customerName": "WestPlaza",
  "centralId": "…",  "centralName": "Central WestPlaza L1",
  "day": "2026-08-02",
  "timezone": "America/Sao_Paulo",
  "severity": "HIGH",
  "status": "OPEN",
  "acknowledgedAt": null, "acknowledgedBy": null,
  "devices": [
    { "deviceId": "…", "slaveId": 12, "name": "Medidor Loja 12", "metric": "energy_consumption",
      "emptySlots": [
        { "from": "2026-08-02T03:00:00-03:00", "to": "2026-08-02T05:00:00-03:00", "slotCount": 2 },
        { "from": "2026-08-02T21:00:00-03:00", "to": "2026-08-02T22:00:00-03:00", "slotCount": 1 }
      ],
      "slotCount": 3 },
    { "deviceId": "…", "slaveId": 7,  "name": "Medidor Chiller", "metric": "energy_consumption",
      "emptySlots": [
        { "from": "2026-08-02T14:00:00-03:00", "to": "2026-08-02T15:00:00-03:00", "slotCount": 1 }
      ],
      "slotCount": 1 }
  ],
  "totals": { "devices": 2, "emptySlots": 4 },
  "firstDetectedAt": "…", "lastEvaluatedAt": "…"
}
```

> Storage/API use **full ISO timestamps** for slot ranges (timezone/DST/late-telemetry
> correctness); the panel renders the compact `03:00–05:00` form.

---

## Reference-level explanation

### 1. The rule — `NO_CONSUMPTION` (GCDR backend)

New value in the `rule_type` pgEnum (currently
`ALARM_THRESHOLD | SLA | ESCALATION | MAINTENANCE_WINDOW | DEVICE_OFFLINE`) →
add `NO_CONSUMPTION`.

Config object (`noConsumptionConfig`, jsonb, mirrors how `alarmConfig` /
`slaConfig` live today):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `metric` | **enum** (consumption domain) | — | Which consumption metric must be present. Validated against a small enum — **`energy_consumption` \| `water_flow`** (lowercase, the actual `MetricDomain` values emitted on the wire), **not** an arbitrary string. |
| `windowMinutes` | int | `60` | Slot size. **v1: only `60` accepted** — reject other values until Alarms supports variable windows. |
| `minSamplesPerWindow` | int | `1` | A slot is "filled" when it has ≥ this many non-null samples. |
| `graceWindows` | int | `1` | Consecutive empty windows tolerated before it counts (debounce). |
| `activeHours` | `{start,end}?` | null | Only evaluate inside these local hours (skip known-idle periods). **v1: rule-level only** (per-device override deferred). |
| `timezone` | string | **required** | Bucket alignment + day categorization. Not silently defaulted — a missing tz is a config error (hides bugs). |
| `severity` | RulePriority | `HIGH` | Incident severity. |

Rule flags: `internalRule = true`, `isInternalSupportRule = true` (platform-owned,
not customer-editable), `scope` = devices / central / customer (reuse the
existing `scope` + `scopeEntityIds uuid[]`).

**Ships disabled by default.** The rule is created with `enabled = false` and is
only flipped on once the Alarms Orchestrator confirms support for the bundle
version that carries `NO_CONSUMPTION` (see §Compatibility). This prevents shipping
a rule the consumer can't yet evaluate.

**Visibility:** `NO_CONSUMPTION` rule definitions are **read-only metadata visible
only to admin/support roles**. Customer users do **not** see or edit them (they
see the resulting incidents, scoped to their customer — §Authorization).

#### Normative alarm-bundle payload (GCDR → Alarms)

The rule appears in the existing bundle `rules[]` exactly as:

```json
{
  "id": "rule_uuid",
  "type": "NO_CONSUMPTION",
  "internalRule": true,
  "isInternalSupportRule": true,
  "enabled": true,
  "scope": "CENTRAL",
  "scopeEntityIds": ["central_uuid"],
  "priority": "HIGH",
  "noConsumptionConfig": {
    "metric": "energy_consumption",
    "windowMinutes": 60,
    "minSamplesPerWindow": 1,
    "graceWindows": 1,
    "timezone": "America/Sao_Paulo",
    "activeHours": null
  }
}
```

> **Config storage (open confirmation):** confirm whether the `rules` table has a
> generic JSONB config column that can safely carry `noConsumptionConfig`
> alongside `alarmConfig`/`slaConfig`/etc. If not, add a `no_consumption_config
> jsonb` column in the migration (§Migrations).

> **Why a new type and not `ALARM_THRESHOLD` with `COUNT == 0`?** Data-absence has
> different evaluation semantics (you alarm on the *lack* of events, which a
> threshold-on-arrival engine never fires for), a different lifecycle
> (auto-resolve when data returns), and a different output (an aggregated
> incident, not a per-sample alarm). Modeling it as a threshold would overload
> `alarmConfig` and hide the "no data" nature. Alternative kept in §Alternatives.

The rule is exposed to the alarms side **through the existing alarm bundle**
(`GET /customers/:id/alarm-rules/bundle/*`, versioned per RFC-0015). No new
transport — `NO_CONSUMPTION` rules just appear in `rules[]` with their config.

### 2. Detection & incident construction (Alarms Orchestrator)

The orchestrator already consumes the bundle and the telemetry stream. It gains a
**no-consumption evaluator**:

- **Bucketing:** for each in-scope device, align telemetry to hourly buckets in
  the rule timezone.
- **What "empty" means (normative):**
  > A slot is **empty** only when the configured `metric` has **zero non-null
  > samples** for the device in `[slotStart, slotEnd)` after the grace period.
  > A numeric **zero is a valid sample** and is **never** treated as empty.
  > Duplicate samples in the same slot **count as present** but do not inflate the
  > slot count. `null`/absent = empty.
- **Metric source (v1 decision):** absence is checked against the **hourly
  consumption aggregation** the goals/tariffs pipeline already produces (normalized
  per device), not raw sample-arrival events — because we alarm on *absence*, which
  an arrival-driven path never emits. (Confirm the exact aggregation table/feed —
  §Unresolved.)
- **Debounce:** only count a bucket after `graceWindows` consecutive empties.
- **Candidate:** emit an **Incident candidate** keyed by
  `(tenantId, customerId, centralId, day, ruleId, kind)`. This is the
  aggregation/dedup key — the same key **updates** the open incident for that day
  instead of creating N alarms. `day` is computed in the rule timezone.
- **Grouping:** within the candidate, group by `deviceId`; within each device,
  **merge contiguous empty buckets into full-timestamp ranges**
  (`2026-08-02T03:00-03:00 → 05:00`), which the UI renders as `03:00–05:00`.
- **Lifecycle (v1 decision):** status is `OPEN | RESOLVED`; acknowledgement is
  **metadata**, not a status (avoids the awkward `ACKNOWLEDGED → RESOLVED`
  terminal-state problem):
  - `OPEN` → created on first detection for the key; **updated** (append/shrink
    devices+slots) while the day is current.
  - **Late telemetry** may **shrink or remove** slot ranges while the incident is
    `OPEN`. After it is acknowledged, late telemetry still updates the evidence but
    **must not erase the audit trail** (`acknowledgedAt/By` + note are preserved).
  - **Day rollover:** at midnight (rule tz) the incident is auto-`RESOLVED`
    **only if** no device still has an unresolved *current* empty run; otherwise it
    stays `OPEN` carrying the ongoing run.
  - `acknowledgedAt` / `acknowledgedBy` / `acknowledgementNote` set when an operator
    acks in the panel (does not change `status`).
- **Dispatch (optional):** an incident MAY notify via the existing channel model
  (RFC channels / EMAIL_RELAY) — reusing dispatch, not reinventing it. Default:
  incident is created silently and only shown in the panel; notification is a
  follow-on policy.

### 3. Incident persistence & ownership

**Decision (proposed):** incidents are **owned/persisted by the Alarms
Orchestrator** (it owns the event/decision plane; GCDR is master data). GCDR
provides:

- the **rule** (via bundle),
- **enrichment** lookups (device name/slaveId, central name, customer name) so the
  incident payload and the panel don't need raw UUIDs.

GCDR **does not** store incidents. The frontend reads incidents from the alarms
API. (Alternative — GCDR hosts an incidents table — in §Alternatives.)

### 4. APIs

**Alarms Orchestrator (new):**
- `GET /incidents?kind=NO_CONSUMPTION&customerId&centralId&dayFrom&dayTo&status&severity&cursor&limit`
  — list, filterable, paginated. Use a **`dayFrom`/`dayTo` range** (operators need
  weekly/monthly views), not a single `day`.
- `GET /incidents/:id` — full incident (device groups + full-timestamp slot ranges).
- `POST /incidents/:id/ack` — body `{ "comment": "…" }`; persists `actorId`,
  timestamp, tenant. Sets ack metadata, not status.
- `POST /incidents/:id/resolve` — body `{ "reason": "…" }`; persists `actorId`,
  timestamp, tenant.
- (internal) candidate ingestion is in-process; no public create endpoint.
  **Superseded in part by Alarms RFC-0031** (Multi-Source Incident Ingestion),
  which adds `POST /incidents/candidates` + an atomic `ON CONFLICT` upsert once a
  second producer exists. Still a decision open there (`AUTHORITATIVE`/`PARTIAL`,
  and whether GCDR itself becomes a producer).
- The orchestrator **exposes support/version info** (which bundle version /
  rule types it can evaluate) so GCDR can flip the rule on safely (§Compatibility).

**List item / detail shape (normative):** list items carry `id, kind, customerId,
customerName, centralId, centralName, day, timezone, severity, status,
acknowledgedAt, totals:{devices,emptySlots}, firstDetectedAt, lastEvaluatedAt`.
The detail adds `devices[]` with `{deviceId, slaveId, name, metric, emptySlots:[{
from, to, slotCount }], slotCount}` where `from`/`to` are **full ISO timestamps
with offset**.

**GCDR Backend (new/updated):**
- Rule CRUD already supports internal rules — add `NO_CONSUMPTION` type +
  `noConsumptionConfig` validation (Zod) and bundle serialization.
- **Enrichment endpoint** (if not already covered): batch resolve
  `deviceId[] → {name, slaveId, centralId}` and `centralId → {name}` for the
  alarms side to hydrate incidents. Reuse existing device/central reads where
  possible.

**GCDR Frontend (updated — see §7):**
- **No in-GCDR panel.** The Incidents panel lives in **`alarms-web`** (Alarms
  RFC-0030 §3.8). GCDR's `/incidents` route is a **redirect**: a standard modal
  explaining incidents are part of the Alarms project, with a button opening the
  alarms-web panel in a new tab. The grouped **day ▸ central ▸ device ▸ slot
  ranges** view, filters, severity chips and ack/resolve all live on the
  alarms-web side.

### 5. Categorization / grouping (the panel)

- **Top level:** group by **day** (desc), then by **central**.
- **Within a central card:** one row per device, showing merged empty-slot ranges
  as chips (`03:00–05:00`, `21:00`), a slot count, and severity.
- **Aggregates:** per day-per-central totals (devices affected / empty slots);
  per central over time (trend).
- Reuse the OS/OneStore card + collapsible section patterns already in the
  frontend (RFC-0053 style) for the day/central grouping and expand/collapse-all.

### 6. Authorization & access (v1)

- **Tenant isolation is mandatory** on every Alarms incident endpoint.
- **View:** customer users can view incidents scoped to **their own customer**;
  admin/support see all.
- **Ack/Resolve:** only **operator/admin** roles.
- **Partner API keys** do **not** access the incidents API unless explicitly
  granted a scope for it.
- **Internal rule definitions** (`NO_CONSUMPTION`) are **read-only metadata**
  visible only to admin/support — never customer-editable.

### 7. Frontend transport decision — SUPERSEDED: the panel lives in `alarms-web`

> **Update (2026-08-13).** The earlier decision below (ED-1077: a thin GCDR
> proxy fronting an in-GCDR panel) was **superseded**. The Incidents panel is
> owned by **`alarms-web`** — see Alarms **RFC-0030 §3.8** — which already holds
> the auth, the API client, and the alarm-shaped ack/resolve operations. GCDR's
> `/incidents` route is a **redirect** to the alarms-web panel (a standard modal
> explaining incidents live in the Alarms project, opening
> `https://alarms-web.a.myio-bas.com/pt/incidents` in a new tab). No GCDR proxy,
> no in-GCDR panel, no `incidentService`. Shipped in gcdr-frontend PR #24 → #29.
>
> Consequence: the GCDR-side items in §4 ("GCDR Frontend — Incidents panel") and
> in the Summary reduce to the redirect; the proxy endpoints (ED-1088) are **not
> built**. Alarms remains the system of record either way.

*Historical (superseded) decision, kept for the record:*

**Decision (ED-1077, 2026-08-04): Option B — a thin GCDR-Backend proxy for
`/incidents*`.** The browser calls GCDR; GCDR forwards to the Alarms API and
enriches the response in-process before returning it. Rationale was auth/CORS/
tenant scoping/RBAC already living in GCDR, in-process enrichment (ED-1080), and
a GCDR-only frontend. That path added one hop and four pass-through endpoints and
was **not** pursued once the panel moved to `alarms-web`.

### 8. Compatibility / versioning

- The `NO_CONSUMPTION` rule ships **`enabled = false`** and is flipped on only
  after the Alarms Orchestrator reports it supports the bundle version carrying the
  new type (the orchestrator exposes support/version info; §4).
- **How the rule reaches Alarms — and why it is not a threshold hazard.** GCDR
  emits `NO_CONSUMPTION` rules in a **separate additive `noConsumptionRules[]`
  section**, exposed **only on `GET /…/bundle/to-verify-service`** — never mixed
  into `rules[]`, and **never in `/bundle/simple`** (the Node-RED bundle strips
  it). A consumer that only iterates `rules[]` therefore never sees the rule and
  cannot mis-evaluate it as a threshold; it simply ignores the unknown top-level
  key. (An earlier draft claimed "older Alarms builds ignore unknown rule *types*
  in the bundle" — that framing was imprecise: nothing about GCDR's output places
  `NO_CONSUMPTION` inside `rules[]` in the first place.)
- **The real precondition is on the Alarms side.** When the verify pipeline
  begins *reading* the `noConsumptionRules[]` section, it must recognize the type
  explicitly — a rule type it cannot evaluate must be **skipped and counted, never
  reported as healthy**. Alarms **RFC-0030 §3.7** ships exactly this (a type guard
  + a supported-types/version endpoint), **in production since 2026-08-06**. GCDR
  only flips `enabled = true` **after** that guard is live, gated on the
  supported-types endpoint. See Alarms **RFC-0030** (No-Consumption, Alarms side).

---

## Responsibility matrix

| # | Item | GCDR Backend | GCDR Frontend | Alarms Orchestrator | Central Agent |
|---|---|---|---|---|---|
| 1 | `NO_CONSUMPTION` rule type + `noConsumptionConfig` (schema, Zod, migration) | **Owns** | — | consumes via bundle | — |
| 2 | Internal rule seed/management UI (create the platform rule) | **Owns** (API) | Owns (admin UI, optional) | — | — |
| 3 | Rule in alarm bundle (versioned) | **Owns** | — | **Consumes** | — |
| 4 | Telemetry bucketing + empty-slot detection | — | — | **Owns** | produces telemetry (unchanged) |
| 5 | Debounce (`graceWindows`) + timezone bucket alignment | defines config | — | **Owns** logic | — |
| 6 | Incident candidate build (group by device, merge slot ranges) | — | — | **Owns** | — |
| 7 | Incident persistence + lifecycle (OPEN/ACK/RESOLVED, auto-resolve) | — | — | **Owns** | — |
| 8 | Incident enrichment (device/central/customer names, slaveId) | **Owns** (lookup API) | — | consumes lookup | — |
| 9 | `GET /incidents*` + ack/resolve API | — | consumes | **Owns** | — |
| 10 | Incidents panel (day▸central▸device▸slots, filters, drill-down) | — | **Owns** | — | — |
| 11 | Optional notification of incidents (reuse channels/EMAIL_RELAY) | provides channel config | — | **Owns** dispatch | — |
| 12 | Docs / contract (this RFC, bundle field, incident payload) | co-owns | co-owns | co-owns | — |

---

## Data model (proposed, alarms-owned)

```
incidents
  id                  uuid pk
  kind                text            -- 'NO_CONSUMPTION' (future: other kinds)
  tenant_id           uuid
  customer_id         uuid
  central_id          uuid
  rule_id             uuid
  day                 date            -- categorization axis (rule tz)
  timezone            text            -- rule tz, stored on the row
  severity            text
  status              text            -- OPEN | RESOLVED   (ack is metadata, below)
  acknowledged_at     timestamptz null
  acknowledged_by     uuid null
  acknowledgement_note text null
  totals              jsonb           -- { devices, emptySlots }
  first_detected_at   timestamptz
  last_evaluated_at   timestamptz
  resolved_at         timestamptz null
  UNIQUE (tenant_id, customer_id, central_id, day, rule_id, kind)  -- dedup/aggregation key

incident_devices
  incident_id       uuid fk
  device_id         uuid
  slave_id          smallint null
  metric            text            -- device-level (safer for heterogeneous devices)
  empty_slots       jsonb           -- [{from:<iso>, to:<iso>, slotCount:int, lastCheckedAt:<iso>}] merged ranges
  slot_count        int
  UNIQUE (incident_id, device_id)
```

Notes:
- `status` is `OPEN | RESOLVED`; acknowledgement is metadata
  (`acknowledged_at/by/note`) so `ack` and `resolve` are independent.
- Slot ranges are stored as **full timestamps** (not `HH:mm`) — timezone/DST/late
  telemetry/cross-day correctness. The UI renders the compact form.
- `metric` at device level supports future rules over heterogeneous device metrics.
- `customer_id` is in the unique key even though `central_id` is globally unique —
  clearer tenant/customer filtering and debugging.

Indexes:

```sql
CREATE INDEX incidents_customer_day_idx ON incidents (tenant_id, customer_id, day DESC);
CREATE INDEX incidents_central_day_idx  ON incidents (tenant_id, central_id, day DESC);
CREATE INDEX incidents_status_idx       ON incidents (tenant_id, status, day DESC);
```

`incident_devices` keeps one row per device per day (merged `empty_slots` jsonb),
avoiding a row-per-slot explosion and matching the panel's grouping.

---

## Migrations

- **GCDR:** `00XX_rule_type_no_consumption.sql` — `ALTER TYPE rule_type ADD VALUE
  'NO_CONSUMPTION'` (additive, safe). No new column needed if `noConsumptionConfig`
  reuses an existing config jsonb slot; otherwise add `no_consumption_config jsonb`.
  > **Migration number:** pick the next free number **at implementation time** —
  > prod is baselined through `0063` (see the migration governance runbook). Do
  > **not** hardcode a number in this RFC.
- **Alarms:** `incidents` + `incident_devices` tables (alarms DB).

---

## Testing (per owned repo)

- **GCDR Backend:** `NO_CONSUMPTION` enum support; valid `noConsumptionConfig`
  accepted; invalid config rejected (unknown `metric`, missing `timezone`,
  `windowMinutes != 60`); bundle serialization + version bump; internal-rule
  visibility/edit restrictions; migration compatibility.
- **Alarms:** empty-bucket detection; **zero counts as present**; null/absent =
  empty; duplicate samples present but no double-count; grace-window debounce;
  contiguous slot merge; non-contiguous ranges stay separate; day boundary in the
  configured timezone; late-telemetry shrink/remove while OPEN; dedup by incident
  key (idempotent update); ack/resolve audit fields persisted.
- **Frontend:** grouping day▸central▸device; device expansion; slot-range
  rendering; empty/loading/error/permission-denied states; ack/resolve flows;
  permission-gated controls.

## Acceptance criteria

Implementation-ready when:

- GCDR can create/seed an internal `NO_CONSUMPTION` rule and serialize it in the
  bundle with the stable config contract (§1).
- Alarms evaluates the rule **independent of sample arrival**.
- Alarms persists **one incident per `(tenant, customer, central, day, rule,
  kind)`** and updates it idempotently.
- Incident detail groups devices and merged **full-timestamp** slot ranges.
- Frontend can list (with `dayFrom/dayTo`), filter, inspect, acknowledge, and
  resolve incidents.
- Auth + tenant isolation defined and enforced across GCDR and Alarms (§6).
- Tests exist in each owning repo for the responsibilities above.

## Drawbacks

- New rule type = touch points in GCDR (enum, Zod, bundle serializer, tests) and a
  new evaluator in the alarms side. Cross-repo coordination (bundle contract).
- "No data" detection needs a reliable notion of *expected* cadence per metric;
  `minSamplesPerWindow`/`activeHours` mitigate but require correct config to avoid
  false positives (a genuinely idle device flagged as a gap).
- Incident ownership on the alarms side means the panel depends on a second
  service's API (cross-origin/auth), and enrichment is a server-to-server hop.

## Alternatives considered

1. **`ALARM_THRESHOLD` + `COUNT == 0` over 1h.** Reuses existing type, but overloads
   `alarmConfig`, fires per-window (noise), has no incident aggregation, and a
   threshold engine typically evaluates on sample arrival — the wrong trigger for
   *absence*. Rejected as the primary model; could back a v0 spike.
2. **Extend `DEVICE_OFFLINE`.** Conflates connectivity with data-presence — a device
   can be ONLINE yet empty. Rejected.
3. **GCDR hosts incidents.** Keeps everything in the master-data DB and one API for
   the frontend, but puts an event-plane concern in GCDR and duplicates what the
   alarms decision engine already does. Kept as a fallback if cross-service auth
   for the panel proves heavy.

## Unresolved questions

**Decided in v2 (feedback-v1):**
- ~~Day rollover policy~~ → auto-`RESOLVED` at midnight (rule tz) only if no device
  has an ongoing empty run; else stays OPEN (§2).
- ~~Late-telemetry behavior~~ → may shrink/remove ranges while OPEN; preserves audit
  after ack (§2).
- ~~Status model~~ → `OPEN | RESOLVED` + ack metadata (§2, Data model).
- ~~`activeHours` per device vs rule~~ → v1 rule-level; per-device override deferred.
- ~~Slot storage format~~ → full ISO timestamps; UI renders `HH:mm`.

**Still open:**
1. **Exact metric source:** which hourly-consumption aggregation table/feed does
   Alarms read (goals/tariffs aggregation vs normalized telemetry)? Named source
   before build (§2 v1 decision narrows this but doesn't pin the table).
2. **Config storage:** reuse a generic `rules` JSONB config column for
   `noConsumptionConfig`, or add `no_consumption_config` (§1, §Migrations)?
3. **Notification default:** panel-only (proposed) vs dispatch via
   channel/EMAIL_RELAY, per customer/central opt-in?
4. **Incident ↔ alarm linkage:** should an incident also reference DEVICE_OFFLINE
   alarms in the same window for context, or stay a pure no-consumption roll-up?

## Rollout / phases

1. **Phase 1 — GCDR:** add `NO_CONSUMPTION` type + config + Zod + bundle
   serialization + tests; seed one internal rule for a pilot customer (e.g.
   WestPlaza). No behavior change until the alarms side consumes it.
2. **Phase 2 — Alarms:** evaluator (bucketing, debounce, merge), `incidents`
   tables, candidate build + lifecycle, `/incidents` read API + ack/resolve.
3. **Phase 3 — Frontend:** Incidents panel (day▸central▸device▸slots) against the
   alarms API + GCDR enrichment.
4. **Phase 4 — Optional dispatch** of incidents via existing channels.

Each phase is independently shippable; Phase 1 is inert until Phase 2 lands.
