# RFC-0046 · Addendum A — Device-Granular Goals

- **Status**: **APPROVED** rev. 2 (2026-07-14) — formal OK to implement, with
  the rulings of §DEC-11/§DEC-12 incorporated. Prerequisite: the feedback-v1
  P0/P1 fixes (branch `fix/rfc-0046-feedback-v1`) land first.
- **Date**: 2026-07-15 · **rev. 2**: 2026-07-14 — product ruling replaces the
  rev. 1 no-mix invariant with **mixed allocation + residual** (§DEC-8): a
  customer-level total and per-device goals coexist; unspecified entry meters
  absorb the residual (even split). The residual distribution the base service
  applies over the time dimension is the exact rule this addendum reuses over
  the device dimension.
- **Amends**: RFC-0046 (Customer Consumption Goals) · interacts with RFC-0052 (Goal Margin), RFC-0053 (Single Dashboard)
- **Motivation owner**: energy management — customers with multiple ENTRY meters (e.g. Moxuara: `TRAFO_GERAL`, `TRAFO_CAG`) budget per billing point, one seasonalized spreadsheet per meter — **and** customers that only know the group total upfront, learning per-meter budgets later
- **Design review**: BMAD party-mode roundtable, 2026-07-15 (Architect / Sr Dev-DBA / QA / PM) — notes in §9

## 1. Summary

Goals gain an optional **device dimension on the hourly canonical grain**. A
goal (customer × domain × year) is either **CUSTOMER-granular** (today's
behavior, unchanged) or **DEVICE-granular**: its `consumption_goal_hours` rows
carry a `device_id`, and the customer's value for any bucket is **computed on
read** by aggregating the device rows (SUM for SUM domains).

A DEVICE-granular year supports **mixed input** (rev. 2): the operator may
state the **group total** without knowing every meter, pin **explicit goals on
some devices**, and the system materialises the **residual** onto the remaining
entry meters (even split — `EXPLICIT` vs `RESIDUAL` allocation, §DEC-8). The UI
gains an optional **entry-meter selector** next to year + domain; without a
selection it shows the consolidated view (editable — editing it rebalances the
residual meters).

What this addendum deliberately does **not** change: one goal header per
customer × domain × year — one `version` (optimistic lock), one RFC-0052 margin,
one history stream, one bundle `X-Version-Id`. Device is a coordinate of the
hour row, like `hour` itself — **not** a new goal header.

## 2. Decisions (continuing the RFC-0046 numbering — DEC-1..6 already exist)

> ⚠️ Numbering note: `ConsumptionGoalService` already ratifies DEC-1..6
> (hourly canon, roll-up, distribution, version txn, PUT/PATCH semantics,
> per-domain aggregation). This addendum adds **DEC-7..12**.

### DEC-7 — Device as an optional dimension of the hour grain

`consumption_goal_hours` gains:

```sql
device_id  uuid NULL REFERENCES devices(id) ON DELETE RESTRICT,
-- Drizzle's onConflictDoUpdate cannot target an expression index; a stored
-- generated column keeps the upsert on plain columns while device_id stays a
-- real nullable FK. Cost: 16 bytes/row.
device_key uuid GENERATED ALWAYS AS
             (COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
-- rev. 2 — how this device's value was produced (mirrors `derived` on the
-- time dimension): EXPLICIT = the operator stated this device's goal;
-- RESIDUAL = the system allocated it from the group total (§DEC-8).
-- Meaningless (kept at default) on device_id NULL rows.
device_allocation text NOT NULL DEFAULT 'EXPLICIT'
             CHECK (device_allocation IN ('EXPLICIT', 'RESIDUAL'))
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

### DEC-8 — Mixed allocation with residual (rev. 2 — replaces the no-mix invariant)

`consumption_goals` gains:

```sql
granularity text NOT NULL DEFAULT 'CUSTOMER'
            CHECK (granularity IN ('CUSTOMER', 'DEVICE'))
```

- **Storage stays single-grain**: a CUSTOMER year holds only `device_id NULL`
  rows (today's shape, untouched); a DEVICE year holds **only device rows** —
  never both for the same hour (mixed rows would double-count under DEC-2
  roll-up). What rev. 2 changes is the **input**: mixed *statements* are
  accepted and **materialised** to the device grain at write time, exactly as
  DEC-3 materialises coarse time buckets to hours.

- **The residual rule** (the product requirement that motivated rev. 2). At
  any point the operator may state, for the same (domain, year):
    1. the **group total** (a deviceless write) — "the entry meters together
       target X", and/or
    2. **explicit per-device goals** for the meters they do know.
  For every hour bucket: explicit devices keep their values (`EXPLICIT`); the
  **residual** (total − Σ explicit) is split **evenly** across the entry
  meters without an explicit goal, written as `RESIDUAL` rows. One unspecified
  meter absorbs the whole residual; N unspecified meters take residual/N each.
  A negative residual is a `400 GOAL_DEVICE_OVERFLOW` (explicit devices already
  exceed the stated total). If **every** meter is explicit, a deviceless write
  must be numerically consistent with Σ explicit (tolerance-checked `400`) —
  the same fully-pinned rule the base service applies on the time dimension.

  Worked example (total 100, meters A/B/C):
  | action | A | B | C |
  |---|---|---|---|
  | set group total = 100 | 33.3 R | 33.3 R | 33.3 R |
  | set A = 30 | **30 E** | 35 R | 35 R |
  | set B = 40 | 30 E | **40 E** | 30 R |
  | set group total = 120 | 30 E | 40 E | **50 R** |

- **Writes keep the stated total authoritative**: while at least one RESIDUAL
  meter exists, pinning a device *rebalances the residual meters* so the group
  total is preserved (the user's stated semantics: "o residual vai para ele").
  Once all meters are explicit, the total is simply Σ devices and each device
  edit moves it.

- **Transitions**:
  - CUSTOMER → DEVICE happens **implicitly on the first device-targeted
    write** (the user's exception scenario): the year's existing deviceless
    values become the per-hour group total, the written device is pinned
    EXPLICIT, and every other entry meter receives the residual as RESIDUAL
    rows; the `device_id NULL` rows are replaced by the materialised device
    rows in the same DEC-4 transaction, with ONE version bump and ONE history
    entry recording `{ granularity: { from: 'CUSTOMER', to: 'DEVICE' } }`.
  - DEVICE → CUSTOMER remains **explicit only** (full-year `PUT` REPLACE
    stating the target granularity) — collapsing per-meter budgets is
    destructive and must be deliberate.

- **The participating meter set is pinned at write time**: materialisation
  needs the customer's ENTRY-meter list (§3 selector source). An entry meter
  registered *after* a write does not receive rows retroactively; it joins on
  the next deviceless (total) write or an explicit **rebalance** action.
  Deleting an EXPLICIT device's rows via the API reassigns its share to the
  RESIDUAL meters (total preserved); with no RESIDUAL meters left the total
  shrinks. Both are recorded in history.

- Enforcement is **service-level** in `ConsumptionGoalService` (every write
  already funnels through the DEC-4 version-guarded transaction, so the check
  is race-free). No row-level trigger (8,760 parent lookups per bulk write is
  waste); a DB CHECK backstop may be added later via composite-FK trick if ever
  needed.
- v1 restricts DEVICE granularity to **SUM domains (ENERGY, WATER)**.
  AVG domains (e.g. TEMPERATURE) are excluded until the asymmetric-coverage
  rule is specified (see Open Questions) — residual allocation is SUM-domain
  arithmetic, and QA correctly flagged the AVG ambiguity as untestable.

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
  `devices: [{ deviceId, code, label, allocation: 'EXPLICIT' | 'RESIDUAL',
  annual, annualAdjusted }]` — a summary block only (allocation reports the
  dominant flag; rev. 2). **No per-device breakdown inside tree nodes** (8,760
  nodes × N devices explodes the payload).
- `derived`/`sourceLevel` become per-(device, hour) streams; customer-level
  computed nodes **omit** them (ambiguous across devices written at different
  levels).
- Bundle `X-Version-Id`/304 and the Single Dashboard consume the customer
  roll-up and are unaffected.

**Writes (rev. 2 — mixed allocation):**

- `PUT`/`PATCH`/`DELETE` bucket operations gain an optional `deviceId`.
- DEVICE goal **without** `deviceId` → edits the **group total**: EXPLICIT
  device rows are pinned, the residual rebalances the RESIDUAL meters
  (§DEC-8). No more `GOAL_DEVICE_REQUIRED`.
- CUSTOMER goal **with** `deviceId` → **implicit conversion** to DEVICE
  granularity (§DEC-8 transitions): existing values become the group total,
  the addressed device is pinned, remaining entry meters absorb the residual.
- Explicit-vs-residual overflow → `400 GOAL_DEVICE_OVERFLOW`; fully-explicit
  set + inconsistent total → `400` (tolerance-checked).
- DEC-3 distribution (month → hours, even split / confirmed-hour preservation)
  runs **within each device's scope**; the confirmed-hour merge key becomes
  `(device_key, month, day, hour)`. The two residual passes compose: first the
  time residual within a bucket, then the device residual across meters.
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

### DEC-11 — ENTRY classification is explicit device registry data (ruling, 2026-07-14)

ENTRY participation is **never inferred** — not from `device_channel_type`,
not from tags. `devices` gains a structured meter-purpose attribute:

```sql
meter_role   text NULL CHECK (meter_role IN ('ENTRY', 'SUBMETER')),
-- The measured domain the role applies to. A bare isEntryMeter flag was
-- rejected: it cannot safely distinguish WHICH residual pool (ENERGY vs
-- WATER) the meter belongs to.
meter_domain text NULL CHECK (meter_domain IN ('ENERGY', 'WATER')),
CHECK ((meter_role IS NULL) = (meter_domain IS NULL))  -- both or neither
```

Administrable through the device API/UI, validated on write. A device
participates in a goal's residual allocation **only** when ALL hold:

1. same tenant **and** same customer as the goal;
2. `status` active;
3. `meter_domain` equals the goal's domain;
4. `meter_role = 'ENTRY'` — explicitly.

**Missing or ambiguous classification blocks the write/rebalance** with an
explicit error (`422 GOAL_ENTRY_SET_UNDEFINED`: no active ENTRY meter for the
domain) — silent allocation over a possibly-incomplete list is forbidden. The
UI must show the resolved meter list and its N **before** confirmation.
Moxuara's initial curation must be done and validated before DEVICE is enabled
for 2026.

### DEC-12 — Rebalance is an explicit operation; removals never shrink silently (ruling, 2026-07-14)

- The participating set stays **pinned at write time** (§DEC-8); registering
  or reclassifying a meter NEVER retroactively touches goals.
- The UI detects divergence between the CURRENT resolved ENTRY set (DEC-11)
  and the devices materialised in the goal, and actively surfaces
  **“rebalanceamento disponível”**.
- **Rebalance** is an explicit endpoint/action: before/after preview
  (dry-run), operator confirmation, optimistic lock (`expectedVersion`), ONE
  version bump, ONE history entry (`source: 'REBALANCE'`, details carrying
  the entering/leaving meters). It redistributes ONLY the residual share over
  the new RESIDUAL set; EXPLICIT meters are untouched.
- **Removing an EXPLICIT device's goal**: its share returns to the RESIDUAL
  meters (group total preserved) while at least one residual meter exists.
  With **no** residual meter left, the operation requires an explicit choice —
  `?mode=shrink-total` (the total drops by the removed share) or
  `?mode=rebalance` (pick the meters that absorb it) — and fails with
  `409 GOAL_REMOVAL_MODE_REQUIRED` when neither is stated. Implicit shrinking
  is forbidden.

## 3. UI / UX (stated decisions)

- **Selector**: curated list of the customer's **ENTRY-classified meters** —
  resolved by the DEC-11 rule (`meter_role='ENTRY'` + matching
  `meter_domain`, active, same customer), never inferred from existing goal
  rows (a first granular import must be targetable). Default option:
  **“Total do cliente”**. The resolved list and its N are shown before any
  write is confirmed (DEC-11).
- **Consolidated view** of a DEVICE goal is **editable** (rev. 2), badged
  “Consolidado (N sensores · M explícitos)”, with drill-in per sensor. Editing
  the total rebalances the RESIDUAL meters (§DEC-8); the editor shows which
  meters will absorb the change before saving. Per-sensor cells display an
  `EXPLICIT`/`RESIDUAL` badge mirroring the confirmed/derived badge of the
  time grid.
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

0. `ALTER TABLE devices ADD COLUMN meter_role text NULL CHECK …, ADD COLUMN
   meter_domain text NULL CHECK …;` (DEC-11 — may ship as its own earlier
   migration so curation can start before the goals columns land)
1. `ALTER TABLE consumption_goal_hours ADD COLUMN device_id uuid NULL
   REFERENCES devices(id) ON DELETE RESTRICT;`
2. `ADD COLUMN device_key uuid GENERATED ALWAYS AS (COALESCE(device_id,
   '0000…'::uuid)) STORED;`
3. `CREATE UNIQUE INDEX consumption_goal_hours_device_uq ON
   consumption_goal_hours (goal_id, device_key, month, day, hour);`
4. `DROP INDEX consumption_goal_hours_uq;` (old 4-column unique)
5. `ALTER TABLE consumption_goal_hours ADD COLUMN device_allocation text NOT
   NULL DEFAULT 'EXPLICIT' CHECK (device_allocation IN ('EXPLICIT','RESIDUAL'));`
6. `ALTER TABLE consumption_goals ADD COLUMN granularity text NOT NULL
   DEFAULT 'CUSTOMER' CHECK (granularity IN ('CUSTOMER','DEVICE'));`
7. `ALTER TABLE consumption_goal_history ADD COLUMN device_id uuid NULL;`

Existing rows are untouched (`device_id NULL` ⇒ CUSTOMER) — **fully backward
compatible**; no backfill.

## 6. Acceptance criteria (QA-ratified)

1. **Read-identity**: golden-snapshot GET/summary of every pre-existing
   CUSTOMER goal is byte-identical after the migration.
2. **Implicit up-conversion**: PUT/PATCH with `deviceId` on a CUSTOMER
   goal-year converts it — existing values become the group total, the
   addressed device is EXPLICIT, every other entry meter holds the residual
   as RESIDUAL rows; hour-exact SUM before == after; one version bump; one
   history entry recording the granularity switch.
3. **Residual arithmetic** (total 100, meters A/B/C): after `A=30`, B and C
   hold 35 each (RESIDUAL); after `B=40`, C holds 30; a group-total edit to
   120 moves only C (→ 50). One unspecified meter absorbs the whole residual;
   N unspecified meters split it evenly. `A+B > total` → `400
   GOAL_DEVICE_OVERFLOW`; all meters EXPLICIT + inconsistent total → `400`.
4. Customer-level GET of a DEVICE goal equals the hour-exact SUM of its device
   rows — including leap years (8,784 hours × N devices).
5. `adjustedValue` rule (DEC-10) holds and is identical whether read at device
   or customer level.
6. Concurrent PATCH to two devices of the same goal: exactly one succeeds; the
   loser gets `VERSION_CONFLICT`; history holds one row per mutation with the
   correct `device_id`.
7. Cross-customer/tenant `deviceId` → `404 DEVICE_NOT_FOUND`; deleting a
   device that owns goal rows is blocked (RESTRICT) with a clear error.
8. DEVICE → CUSTOMER collapse only via full-year REPLACE stating the target
   granularity; the previous grain's rows are gone, `version` bumped once, one
   REPLACE history entry recorded. (CUSTOMER → DEVICE is the implicit
   up-conversion of criterion 2.)
9. CSV: selector-targeted single-device file imports as today; `device` column
   resolves by `devices.code`; mixed granularity lines → `400`.
10. Bundle `X-Version-Id`/304 behavior and Single Dashboard goal reads
    unchanged for both granularities.
11. **Entry-set gating (DEC-11)**: a device-targeted or group-total write on a
    customer with NO active ENTRY meter for the domain → `422
    GOAL_ENTRY_SET_UNDEFINED`; inactive / wrong-domain / SUBMETER devices never
    enter the residual pool; `meter_role` without `meter_domain` (or
    vice-versa) is rejected at the device API.
12. **Rebalance (DEC-12)**: dry-run returns the before/after allocation;
    confirm applies under `expectedVersion`, bumps `version` once, appends ONE
    `REBALANCE` history row listing entering/leaving meters; EXPLICIT values
    are untouched. Registering/reclassifying a meter changes NO goal by
    itself.
13. **Explicit removal (DEC-12)**: with ≥1 RESIDUAL meter the removed share
    redistributes (customer total identical before/after); with none, the
    call without a stated `mode` → `409 GOAL_REMOVAL_MODE_REQUIRED`.
14. **Residual composition**: dedicated invariants for time-residual ×
    device-residual — rounding drift ≤ 1e-6 on 8,760/8,784-hour years, fully-
    pinned consistency checks on both dimensions, overflow on both dimensions,
    and concurrent device writes (one wins, one 409, history consistent).

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
2. ~~ENTRY-meter classification source~~ — **RESOLVED (DEC-11)**: explicit
   `meter_role` + `meter_domain` on the device registry; nothing inferred;
   missing classification blocks writes with an explicit error.
3. Does the plan tiering (PLANS.md) gate device-granular goals to Enterprise?
4. ~~Mid-year meter~~ — **RESOLVED (DEC-12)**: set stays pinned at write
   time; the UI actively surfaces "rebalanceamento disponível" on divergence;
   rebalance is an explicit, previewed, version-guarded, audited action.
5. ~~Explicit-removal policy~~ — **RESOLVED (DEC-12)**: share returns to
   RESIDUAL meters (total preserved) while any exist; otherwise the operator
   must state `shrink-total` or `rebalance` — no implicit shrinking.

## 11. Post-approval implementation notes (2026-07-15)

Additions made during implementation, beyond the approved scope — all additive:

1. **Coverage on reads** — `GET` responses expose `hoursCovered` (consolidated
   + per meter in `devices[]`) and `coverageGaps` (compact missing refs,
   coarsest-first: whole month `YYYY-MM` → whole day `YYYY-MM-DD` → hour
   `YYYY-MM-DDThh`; capped at 12 refs, with `truncated` and total
   `missingHours`; absent when complete). Wire detail: RFC-0046-Goals-API.md
   §7.4.
2. **UI tab badge semantics** — the customer-detail Goals tab badge counts
   goal SERIES for the visible (domain, year): 1 customer-wide, N meters on a
   DEVICE year, 0 when empty. A series short of 100% of the year's hour slots
   shows a warning icon + InfoTooltip naming the short series (general or
   meter X) and pointing at the holes (fed by `coverageGaps`). Pinned to the
   consolidated view.
3. **Migration `0061` fix** — the pre-existing uniqueness was created by
   `0047` as a table CONSTRAINT; the migration drops it via
   `ALTER TABLE … DROP CONSTRAINT IF EXISTS` (a plain `DROP INDEX` fails with
   `2BP01`), with a `DROP INDEX IF EXISTS` fallback for environments holding
   it as a plain index.
4. **SDI pilot data** — the per-sensor split for Shopping da Ilha lives in
   `docs/goals/sa-cavalcante/2026-v2/goals-2026-SDI-{CAG,CONDOMINIO}-Energy-import.csv`,
   generated from the seasonalized CAG × Condomínio apportionment workbook
   (`2026/SDI_Rateio_CAG_Condominio_Sazonalizado_2026-v1.xlsx`, columns G/H,
   conference column I validated row-by-row). The pre-addendum production
   goal equals the Condomínio column exactly (13 465 346.8 kWh); the complete
   two-sensor total is 16 984 541.1 kWh.
