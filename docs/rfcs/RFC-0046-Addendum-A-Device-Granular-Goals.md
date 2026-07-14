# RFC-0046 · Addendum A — Device-Granular Goals

- **Status**: DRAFT (awaiting approval — no implementation yet)
- **Date**: 2026-07-15
- **Amends**: RFC-0046 (Customer Consumption Goals) · interacts with RFC-0052 (Goal Margin), RFC-0053 (Single Dashboard)
- **Motivation owner**: energy management — customers with multiple ENTRY meters (e.g. Moxuara: `TRAFO_GERAL`, `TRAFO_CAG`) budget per billing point, one seasonalized spreadsheet per meter
- **Design review**: BMAD party-mode roundtable, 2026-07-15 (Architect / Sr Dev-DBA / QA / PM) — notes in §9

## 1. Summary

Goals gain an optional **device dimension on the hourly canonical grain**. A goal
(customer × domain × year) is either **CUSTOMER-granular** (today's behavior,
unchanged) or **DEVICE-granular**: its `consumption_goal_hours` rows carry a
`device_id`, and the customer's value for any bucket is **computed on read** by
aggregating the device rows (SUM for SUM domains). The UI gains an optional
**entry-meter selector** next to year + domain; without a selection it shows the
consolidated (computed) view.

What this addendum deliberately does **not** change: one goal header per
customer × domain × year — one `version` (optimistic lock), one RFC-0052 margin,
one history stream, one bundle `X-Version-Id`. Device is a coordinate of the
hour row, like `hour` itself — **not** a new goal header.

## 2. Decisions (continuing the RFC-0046 numbering — DEC-1..6 already exist)

> ⚠️ Numbering note: `ConsumptionGoalService` already ratifies DEC-1..6
> (hourly canon, roll-up, distribution, version txn, PUT/PATCH semantics,
> per-domain aggregation). This addendum adds **DEC-7..10**.

### DEC-7 — Device as an optional dimension of the hour grain

`consumption_goal_hours` gains:

```sql
device_id  uuid NULL REFERENCES devices(id) ON DELETE RESTRICT,
-- Drizzle's onConflictDoUpdate cannot target an expression index; a stored
-- generated column keeps the upsert on plain columns while device_id stays a
-- real nullable FK. Cost: 16 bytes/row.
device_key uuid GENERATED ALWAYS AS
             (COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED
```

Uniqueness moves from `(goal_id, month, day, hour)` to
**`(goal_id, device_key, month, day, hour)`** (plain unique index — create the
new index, then drop the old one, in a single transactional migration; volumes
today are ~26k rows, lock time is milliseconds; next sequential migration
number, e.g. 0060).

**FK ruling (`ON DELETE RESTRICT`)** — the roundtable diverged (DBA proposed
CASCADE). Ruling: goal hours are operator-authored targets; deleting an entry
meter must not silently destroy them. Deleting a device that still owns goal
rows fails with a clear error; the operator first removes (or migrates) that
device's goal rows through the API. This mirrors — in the opposite, deliberate
direction — the WO precedent (d7c7f19) where only *soft-deleted* references
stopped blocking deletion.

Validation: `device_id` must belong to the goal's tenant **and** customer →
`404 DEVICE_NOT_FOUND` otherwise (same choice as the RFC-0053 asset scope).
Device moves to another customer are **blocked** while it owns goal rows
(same RESTRICT rationale).

### DEC-8 — Explicit granularity, no-mix invariant

`consumption_goals` gains:

```sql
granularity text NOT NULL DEFAULT 'CUSTOMER'
            CHECK (granularity IN ('CUSTOMER', 'DEVICE'))
```

- A goal-year is **either** CUSTOMER or DEVICE granular — never both. Mixed
  rows for the same hour would double-count under DEC-2 roll-up; granularity is
  therefore **stated on the header**, never inferred from row shape.
- Enforcement is **service-level** in `ConsumptionGoalService` (every write
  already funnels through the DEC-4 version-guarded transaction, so the check
  is race-free). No row-level trigger (8,760 parent lookups per bulk write is
  waste); a DB CHECK backstop may be added later via composite-FK trick if ever
  needed.
- **Transitions are explicit and recorded**: switching granularity is only
  possible through a **full-year `PUT` (REPLACE)** that states the target
  granularity; it deletes the previous grain's rows, writes the new ones, bumps
  `version`, and records a `REPLACE` history entry (with the granularity
  switch in `details`). Both directions allowed; nothing implicit.
- v1 restricts DEVICE granularity to **SUM domains (ENERGY, WATER)**.
  AVG domains (e.g. TEMPERATURE) are excluded until the asymmetric-coverage
  rule is specified (see Open Questions) — "sum of sensors" is SUM-domain
  thinking and QA correctly flagged the AVG ambiguity as untestable.

### DEC-9 — Read and write semantics

**Reads (additive only — zero shape change for existing consumers):**

- `GET` without `deviceId` returns **exactly today's tree shape**. For DEVICE
  goals every bucket value is computed by summing the device rows of that
  bucket (SQL-side `SUM … GROUP BY` for the dashboard/summary paths; the
  full-tree path may roll up in service code as today).
- `GET ?deviceId=<uuid>` returns the same tree shape **filtered to one
  device**.
- The envelope gains two additive fields:
  `granularity: 'CUSTOMER' | 'DEVICE'` and, when DEVICE,
  `devices: [{ deviceId, code, label, annual, annualAdjusted }]` — a summary
  block only. **No per-device breakdown inside tree nodes** (8,760 nodes × N
  devices explodes the payload).
- `derived`/`sourceLevel` become per-(device, hour) streams; customer-level
  computed nodes **omit** them (ambiguous across devices written at different
  levels).
- Bundle `X-Version-Id`/304 and the Single Dashboard consume the customer
  roll-up and are unaffected.

**Writes:**

- `PUT`/`PATCH`/`DELETE` bucket operations gain an optional `deviceId`.
- DEVICE goal **without** `deviceId` → `400 GOAL_DEVICE_REQUIRED`.
- CUSTOMER goal **with** `deviceId` → `409 GOAL_GRANULARITY_CONFLICT`
  (transition only via DEC-8 full-year REPLACE).
- DEC-3 distribution (month → hours, even split / confirmed-hour preservation)
  runs **within the selected device's scope**; the confirmed-hour merge key
  becomes `(device_key, month, day, hour)`.
- The goal-wide `version` lock is **intentional**: two operators editing
  different sensors of the same goal-year serialize; the loser receives the
  standard `VERSION_CONFLICT` 409. One mutation = one version = one history
  entry (now carrying `device_id` in the row/details) — unchanged.

### DEC-10 — Margin (RFC-0052) applies after aggregation

`goal_margin_pct` stays on the header, customer-level. `adjustedValue` is the
**post-aggregation multiplier**: customer bucket adjusted = (Σ device values) ×
(1 + pct/100). Device-level reads expose the same multiplier applied to the
device's own values (for SUM domains the two orders are equal; stating the
order keeps AVG domains well-defined if they are ever admitted). **Per-device
margin is out of scope.**

## 3. UI / UX (stated decisions)

- **Selector**: curated list of the customer's **ENTRY-classified meters**
  (via `device_channel_type` / channel classification), not inferred from
  existing goal rows (a first granular import must be targetable). Default
  option: **“Total do cliente”**.
- **Consolidated view** of a DEVICE goal is **read-only**, badged
  “Consolidado (N sensores)”, with drill-in per sensor. Editing the total on a
  granular year is blocked with a CTA to pick a sensor (or run a full REPLACE).
- **CSV import**: primary flow unchanged — operator picks the target sensor in
  the selector and imports **one file per sensor** (the SA Cavalcante flow,
  plus one dropdown). Additionally the parser accepts an optional third column
  `device` (matched against `devices.code`, e.g. `TRAFO_GERAL`) for bulk
  multi-sensor files; mixing device and no-device lines in one file → `400`.
- **Single Dashboard (store/asset-scoped views)**: nothing changes — entry-
  meter goals surface only on the customer/admin views. When ingestion
  telemetry lands (RFC-0053 Q1), per-device goal lines pair 1:1 with the
  per-device consumption series.

## 4. History & audit

`consumption_goal_history` (and its `details` payload) gains nullable
`device_id`. The RFC-0046 invariant — *one mutation = one version = one
entry* — is untouched. REPLACE entries produced by granularity transitions
record `{ granularity: { from, to } }` in `details`.

## 5. Migration sketch (single transactional file, custom runner)

1. `ALTER TABLE consumption_goal_hours ADD COLUMN device_id uuid NULL
   REFERENCES devices(id) ON DELETE RESTRICT;`
2. `ADD COLUMN device_key uuid GENERATED ALWAYS AS (COALESCE(device_id,
   '0000…'::uuid)) STORED;`
3. `CREATE UNIQUE INDEX consumption_goal_hours_device_uq ON
   consumption_goal_hours (goal_id, device_key, month, day, hour);`
4. `DROP INDEX consumption_goal_hours_uq;` (old 4-column unique)
5. `ALTER TABLE consumption_goals ADD COLUMN granularity text NOT NULL
   DEFAULT 'CUSTOMER' CHECK (granularity IN ('CUSTOMER','DEVICE'));`
6. `ALTER TABLE consumption_goal_history ADD COLUMN device_id uuid NULL;`

Existing rows are untouched (`device_id NULL` ⇒ CUSTOMER) — **fully backward
compatible**; no backfill.

## 6. Acceptance criteria (QA-ratified)

1. **Read-identity**: golden-snapshot GET/summary of every pre-existing
   CUSTOMER goal is byte-identical after the migration.
2. PUT/PATCH with `deviceId` on a CUSTOMER goal-year → `409
   GOAL_GRANULARITY_CONFLICT`.
3. PUT/PATCH without `deviceId` on a DEVICE goal-year → `400
   GOAL_DEVICE_REQUIRED`.
4. Customer-level GET of a DEVICE goal equals the hour-exact SUM of its device
   rows — including leap years (8,784 hours × N devices).
5. `adjustedValue` rule (DEC-10) holds and is identical whether read at device
   or customer level.
6. Concurrent PATCH to two devices of the same goal: exactly one succeeds; the
   loser gets `VERSION_CONFLICT`; history holds one row per mutation with the
   correct `device_id`.
7. Cross-customer/tenant `deviceId` → `404 DEVICE_NOT_FOUND`; deleting a
   device that owns goal rows is blocked (RESTRICT) with a clear error.
8. Granularity transition only via full-year REPLACE; the previous grain's
   rows are gone, `version` bumped once, one REPLACE history entry recorded.
9. CSV: selector-targeted single-device file imports as today; `device` column
   resolves by `devices.code`; mixed granularity lines → `400`.
10. Bundle `X-Version-Id`/304 behavior and Single Dashboard goal reads
    unchanged for both granularities.

## 7. Out of scope (explicit)

- Per-device margin (RFC-0052 stays customer-level).
- Per-**asset** goals and any rateio/allocation semantics (CAG rateio is an
  allocation problem downstream of entry-meter goals — wrong layer here).
- Goal × telemetry comparison (owned by the ingestion work, RFC-0053 Q1).
- DEVICE granularity for AVG domains (TEMPERATURE) — see Open Questions.
- Backfill/conversion of existing years.

## 8. Rollout

Pilot: **Moxuara**, domain **ENERGY**, year **2026**, sensors `TRAFO_GERAL` +
`TRAFO_CAG` (the real CAG split that motivated this). One customer, one
domain, one year — then generalize.

## 9. Roundtable notes (party mode, 2026-07-15)

- **Architect**: device-as-dimension over per-device headers (one lock/margin/
  history); explicit `granularity` on the header; additive-only API; flagged
  DEC numbering collision, expression-index upsert problem, RESTRICT on FK,
  AVG-domain exclusion.
- **Sr Dev/DBA**: stored generated `device_key` + plain unique index (Drizzle
  can't target expression indexes); single transactional migration, no
  CONCURRENTLY needed at current volume; service-level no-mix enforcement (no
  trigger); SQL-side GROUP BY for dashboard reads; CSV optional device column;
  confirmed-hour merge key must include device. Proposed CASCADE on the FK —
  **overruled** in favor of RESTRICT (§DEC-7).
- **QA**: golden-snapshot read-identity, margin-order ambiguity on AVG,
  version-bump semantics across devices, transition rules, leap year,
  asymmetric AVG coverage, and the acceptance list in §6.
- **PM/PO**: device (billing point) over asset; curated ENTRY selector with
  “Total do cliente” default; read-only consolidated badge; one CSV per sensor
  as the primary flow; store-scoped dashboards unchanged; Moxuara pilot;
  out-of-scope guardrails in §7.

## 10. Open questions

1. AVG domains: when admitted, is the customer hour the AVG over
   devices-present-that-hour or over all registered devices (zero-filling)?
2. Should the ENTRY-meter classification come from `device_channel_type`, a
   tag, or an explicit `isEntryMeter` flag? (Selector curation source.)
3. Does the plan tiering (PLANS.md) gate device-granular goals to Enterprise?
