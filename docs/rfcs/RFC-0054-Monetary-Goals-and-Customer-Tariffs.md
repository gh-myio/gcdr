# RFC-0054: Monetary Goals & Hourly Customer Tariffs

- Feature Name: `monetary_goals_and_hourly_tariffs`
- Start Date: 2026-07-16
- RFC PR: (leave this empty)
- Tracking Issue: (leave this empty)
- Status: **APPROVED & FROZEN (rev. 3, final read applied) — cleared to start Phase 1.** rev. 3 folds in the two roundtable buckets (correctness/robustness + client contract) and the product rulings below; the final consistency read fixed five items (hour-unit semantics, migration split 0062/0063, `pricePerKwh` alias, version-guard error code, V3/timezone framing). Phases 2–3 remain gated as stated.
- Related package: `packages/backend` (GCDR)
- Primary files (new/changed): `src/infrastructure/database/drizzle/schema.ts`, `drizzle/migrations/0062_*.sql` (Phase 1), `drizzle/migrations/0063_*.sql` (Phase 3), `src/services/ConsumptionGoalService.ts`, `src/services/CustomerTariffService.ts` (new), `src/services/GoalMoneyService.ts` (new), `src/repositories/customerTariffRepository.ts` (new), `src/controllers/customer-tariffs.controller.ts` (new), `src/controllers/consumption-goals.controller.ts`, `src/dto/request/TariffsDTO.ts` (new), `src/dto/request/GoalsDTO.ts`, `src/dto/request/DeviceDTO.ts`, `src/middleware/requireTariffAccess.ts` (new)
- Builds on: RFC-0046 (Consumption Goals), RFC-0046 Addendum A (Device-Granular Goals), RFC-0052 (Goal Margin)
- Client consumers: GCDR frontend (goals tab), **RFC-0222 (`openPricingPanel`)** in `myio-js-library`.

---

## Approved decisions (rev. 3)

These rulings are binding for implementation and are reflected throughout the DECs and the new §Contract:

1. **RFC-0222 contract** — the **official server contract is the hourly bucket API** (§Contract). The frontend MAY keep a simplified day/band editing UX, but only as a **client-side adapter** that expands to and consumes hourly buckets. **No second persistent month/range model exists.** A name-reconciliation table with temporary aliases and units is included (DEC-13).
2. **Device granularity stays required in v1.** The count of production device-granular goals is **not presumed here**; measuring it and curating the rest is a **Phase-2 rollout gate**, not a Phase-1 blocker.
3. **Missing category or tariff never silently becomes zero.** Zero is only the **additive identity of the covered sum**, never a presumed price. Uncovered hours / uncategorized devices are **excluded** from the money sum and **reported** (`tariffCoverageGaps`, `uncategorizedDevices`, `coverageComplete:false`). While coverage is incomplete, a budget conclusion is **withheld**: `withinBudget` is `null` — a partial projection is never compared to a full budget.
4. **Calendar** — money and tariffs use **nominal civil hours in the customer's timezone (initially `America/Sao_Paulo`), no DST bucket creation/removal**. Leap years include 29 Feb and **8 784 hours**. Golden vectors cover the day/UTC boundary and a leap year.
5. **WATER** — v1 uses `tariffModel: FLAT`, explicit in both contract and persistence; progressive/tiered models are deferred.
6. **Rounding** — includes a tie-exercising golden vector (e.g. `2.005 → "2.01"`) alongside the sum vector.
7. **Phase 1** — batched hourly upsert; an explicit **hard gate forbidding any change to `consumption_goals_uq`** in the P1 diff.
8. **HTTP contract** — literal JSON for GET/PUT/PATCH/DELETE, `null`/absent/`[]` semantics, price input precision, idempotent DELETE, stable error `code`s, and version in **both** the response body **and** the `ETag`.

---

## Summary

Telemetry measures **quantity** (`kWh` for energy, `m³` for water); the business manages **cost** (`R$`). This RFC adds the money dimension as **three independent, optional applications**, each on the same hourly canonical grain the goals already use:

1. **Hourly Customer Tariffs** — `(customer, domain, category, hour) → price` (`R$/kWh` or `R$/m³`). Stored **hour-by-hour by convention**, distribute-on-write like goals: state "1 July costs `R$ 2,00`" → fills 24 hours; state intraday bands (00–11h `R$ 2`, 11–15h `R$ 3`, 15–20h `R$ 4`, 20–24h `R$ 2`) → fills exactly those hours. Each hour carries **two** tariffs, one per **`category`**: `COMMON_AREA` and `SPECIFIC`. **`category` is a property of the device** (explicit, never inferred).
2. **Quantity Goals** — today's `kWh`/`m³` goals (RFC-0046), unchanged. With tariffs loaded, a device-granular quantity goal reads in money: `quantity(device, hour) × tariff(device.category, hour)`, rolled up by `SUM`.
3. **Financial (Budget) Goals** — a target in `R$` (e.g. "energy 2026 ≤ `R$ 7.5M`"): a goal whose `measure` is `CURRENCY`, reusing the whole RFC-0046 engine. When both a budget and a tariff-priced quantity goal exist, the read answers "is the projected cost **within budget**?" — provenance-tagged, and **withheld while coverage is incomplete**.

The three compose but never depend on each other. Because tariffs are hourly, there is **no period-overlap problem** (uniqueness on `(customer, domain, category, month, day, hour)` makes overlaps impossible by construction) and **no month-boundary/timezone ambiguity** (every price is pinned to a nominal civil hour of a concrete date). All money is computed **backend-authoritative**: clients receive the `R$` as a decimal string and never re-derive it.

---

## Motivation

- **Consumption is measured; cost is managed.** Operators budget and report in `R$`. The price that converts is today a magic constant in reports/spreadsheets (RFC-0222 §Motivation).
- **Tariffs are hourly and category-split in reality.** A shopping's energy price floats intraday and differs between **common-area** infrastructure and **specific** consumers (stores/restaurants/parking). The hourly goal grain already models this; tariffs reuse it.
- **Some targets are natively financial.** "Spend ≤ `R$ 7.5M`" is money-first, not a converted quantity.
- **RFC-0222 needs a real, correct home.** It prototyped pricing in `localStorage` with a coarse month/range shape and client-only validation. Reality is hourly and category-aware; this RFC is the authoritative server model every consumer reads.

### Non-goals

Tariff decomposition (TE/TUSD, taxes, bandeiras as fields), water **progressivity/sewage** tiers, demand/contracted-power charges, and multi-currency are **out of scope** (see §Future). v1 stores a single blended `R$/unit` per `(category, hour)`, BRL only, `tariffModel: FLAT`.

---

## Guide-level explanation

### The device carries its tariff category

Every device is (optionally) classified `COMMON_AREA` or `SPECIFIC` — explicit on the device registry, never inferred (same discipline as Addendum A's `meter_role`). This is the join key between consumption and price.

### A tariff is an hourly price, edited like a goal

An operator picks a customer, domain (energy/water) and category, and states prices at any convenient grain — a day, intraday bands, a month, the year. GCDR distributes to the 8 760 / 8 784 hours exactly as it distributes a goal (finest level wins). Re-stating overwrites in place (versioned). Storage is hourly, so there is nothing to "not overlap."

### Seeing a quantity goal in money — and honestly

A **device-granular** quantity goal reads in `R$`: each device's hourly quantity × its category's hourly price, summed. The response carries `monetaryValue` beside `value` (like RFC-0052's `adjustedValue`). Crucially, **uncovered hours and uncategorized devices are excluded from the sum, never priced at `R$ 0`**, and are listed (`tariffCoverageGaps`, `uncategorizedDevices`) with `coverageComplete:false`. Zero appears only as the neutral element of the *covered* sum — it is never a stand-in for "we don't know the price."

### Setting — and checking — a budget

A **financial goal** is set directly in `R$`, on the same hourly storage/distribution/versioning/history (money aggregates by `SUM`). When both a tariff-priced `kWh` goal and a `R$` budget exist for a `(domain, year)`, the read returns the **projection** vs the **budget** with a variance and a `withinBudget` flag — each amount tagged `source: OVERLAY | NATIVE`. **If coverage is incomplete, `withinBudget` is `null`**: a half-priced projection is never declared in- or over-budget.

---

## Reference-level explanation

### Decisions (DEC-1 … DEC-13)

#### DEC-1 — Three orthogonal, optional resources

Tariffs, quantity goals and financial goals are independent storage, each usable alone. Quantity goal + tariff → derived `R$` view (nothing persisted as money); financial goal → native `R$` target (needs no tariff); tariff alone → a catalog other products consume. No feature requires another.

#### DEC-2 — Tariff category lives on the device (explicit); partial coverage is reported

```
ALTER TABLE devices
  ADD COLUMN tariff_category text
    CHECK (tariff_category IS NULL OR tariff_category IN ('COMMON_AREA','SPECIFIC'));
```

- Explicit, never inferred (mirrors Addendum A DEC-11). A device with no classification is **excluded** from the money sum and listed in `uncategorizedDevices`.
- **Partial-category behavior (ruling):** when *some* devices of a goal are categorized and others are not, the money block returns the **partial covered sum** with `coverageComplete:false` and the full `uncategorizedDevices` list — never a silent blend and never `R$ 0` for the missing ones. The budget conclusion is withheld (DEC-6).

#### DEC-3 — Tariff data model (hourly, header + hours, mirrors goals)

A tariff is `(customer, domain, category, year)` distributed to hours — structurally a sibling of a goal.

```
customer_tariffs                                  -- header (parent)
  id           uuid pk
  tenant_id    uuid not null
  customer_id  uuid not null -> customers(id) on delete cascade
  domain       text not null CHECK IN ('ENERGY','WATER')     -- priced (SUM) domains; no TEMPERATURE
  category     text not null CHECK IN ('COMMON_AREA','SPECIFIC')
  year         smallint not null
  unit         text not null CHECK IN ('kWh','m3')           -- price denominator, from domain
  currency     text not null default 'BRL' CHECK (currency='BRL')
  tariff_model text not null default 'FLAT' CHECK (tariff_model IN ('FLAT'))  -- WATER/ENERGY v1 = FLAT; evolution axis
  timezone     text not null default 'America/Sao_Paulo'     -- nominal civil-hour calendar (DEC-8)
  version      integer not null default 1
  created_at/by, updated_at/by
  UNIQUE (tenant_id, customer_id, domain, category, year)

customer_tariff_hours                             -- canonical hourly grain (one row / hour)
  tariff_id    uuid not null -> customer_tariffs(id) on delete cascade
  month        smallint not null CHECK 1..12
  day          smallint not null CHECK 1..31      -- valid for (month, year); 29 Feb exists in leap years
  hour         smallint not null CHECK 0..23
  price        numeric(14,6) not null CHECK (price > 0)       -- R$ per unit
  source_level text not null CHECK IN ('YEAR','MONTH','DAY','HOUR')
  derived      boolean not null
  updated_at/by
  UNIQUE (tariff_id, month, day, hour)            -- structural no-overlap; NO daterange/EXCLUDE/btree_gist

customer_tariff_history                           -- append-only audit (mirrors goal history)
  … stable key (tenant, customer, domain, category, year) + source/actionLevel/old→new + version
```

- **No `EXCLUDE gist`, `daterange`, `btree_gist`, period algebra, or month/timezone boundary.** Hourly grain + `UNIQUE (tariff_id, month, day, hour)` makes two prices for the same hour impossible; a "band" is a contiguous set of hour rows.
- **Distribute-on-write is the RFC-0046 engine, reused verbatim**, producing `(month, day, hour)` rows (not day-of-year) so the conflict target matches. Writes are **batched** (single multi-row `INSERT … ON CONFLICT (tariff_id, month, day, hour) DO UPDATE`), never per-hour roundtrips.
- **`tariff_model` is the evolution axis** for progressive water/energy later; v1 is `FLAT`, and the value is echoed in the contract so a downstream consumer can tell a blended number from a future componentized one without reprocessing.
- **Calendar:** hours are **nominal civil hours** in `customer_tariffs.timezone` (DEC-8). Leap years materialize 29 Feb → 8 784 rows.

#### DEC-4 — Financial goals = `measure = CURRENCY` on the goal header

```
ALTER TABLE consumption_goals
  ADD COLUMN measure text NOT NULL DEFAULT 'QUANTITY'
    CHECK (measure IN ('QUANTITY','CURRENCY'));
```

- **`measure` joins the goal identity**: `consumption_goals_uq` becomes `(tenant, customer, domain, year, measure)`. A customer can hold a `kWh` goal **and** a `R$` budget for the same `(domain, year)`. Existing rows default `QUANTITY` (key unchanged for them). Every existing goal upsert conflict target and history key gains `measure` — **Phase 3 only** (DEC-12).
- **`CURRENCY` reuses the whole RFC-0046 engine** (value in `R$`, distribute/residual/version/history/device-granular/margin). Money aggregates by **`SUM`** → `CURRENCY` valid only on SUM domains; `CURRENCY` on `TEMPERATURE` → `422 GOAL_MEASURE_INVALID`, enforced in the **service layer** (a column CHECK can't see the aggregation method), at **both** the goal-write and the overlay-resolution points.
- `unit` on a `CURRENCY` goal is `BRL`.

#### DEC-5 — Money overlay resolves category at the device grain; zero is only the sum identity

For a `QUANTITY` goal read with `?withMoney=true`:

```
monetaryValue(node) = Σ over the node's (device, hour) buckets WITH a resolvable price of
                        effectiveQty(device, hour) × price(customer, domain, device.tariff_category, hour)
```

- `effectiveQty` is **margin-adjusted** (RFC-0052); composition is fixed **tariff × adjustedValue** (never raw). `monetaryRawValue` (pre-margin) is also returned.
- **Requires device granularity.** A customer-level `QUANTITY` goal returns `money: null`, `reason: "MONEY_REQUIRES_DEVICE_GRANULARITY"`.
- **Zero-is-not-a-price (binding correction).** Buckets with **no resolvable price** — an uncategorized device, or an hour whose `(category)` tariff is absent — are **excluded from the sum** and reported; they are **never multiplied by a presumed `0`**. Zero appears only as the additive identity of the *covered* buckets. The `money` block always states coverage:
  ```
  money: {
    currency: "BRL",
    coverageComplete: <bool>,                 // === (pricedHours === totalHours)
    pricedHours: <int>, totalHours: <int>,    // DEVICE-HOURS (see the hour-unit ruling below)
    tariffCoverageGaps: { missing: string[], truncated: bool, missingHours: int },  // ALWAYS present; complete → { missing:[], truncated:false, missingHours:0 }
    uncategorizedDevices: [ { deviceId, code, label } ]                             // ALWAYS present; complete → []
    // per node: monetaryValue, monetaryRawValue (decimal strings)
  }
  ```
- **Empty-field contract (single rule).** `tariffCoverageGaps` and `uncategorizedDevices` are **always present** with the stable empty shape when coverage is complete (`{ missing:[], truncated:false, missingHours:0 }` and `[]`) — never omitted. This matches the global "arrays are `[]` when empty, never omitted" rule; the whole `money` block is still `null`/absent only per the block-level rules (customer-level goal / `withMoney=false`).
- **Hour-unit semantics (binding).** `totalHours` and `pricedHours` are **device-hours**: `totalHours = Σ over the goal's devices of the year's calendar hours (8 760 / 8 784)`; `pricedHours = the device-hours that had a resolvable price`; `coverageComplete ≡ (pricedHours === totalHours)`. A device-hour is unpriced if **either** its device is uncategorized **or** its hour's category tariff is absent. The two lists are **diagnostics in their own units, not arithmetic complements** of the device-hour shortfall: `tariffCoverageGaps.missingHours` is in **calendar hours** (which periods of a category lack a tariff) and `uncategorizedDevices` is a **device count**.
- For a `CURRENCY` goal, `?withMoney=true` is a **no-op** that returns the native value tagged `source: NATIVE` (never silent).

#### DEC-6 — Budget comparison, withheld while coverage is incomplete

On a `QUANTITY` goal read with `?withMoney=true`, when a `CURRENCY` goal exists for the same `(customer, domain, year)`:

```jsonc
"budget": {
  "projected":    { "amount": "6912340.50", "source": "OVERLAY", "coverageComplete": true },
  "target":       { "amount": "7500000.00", "source": "NATIVE" },
  "variance":     "-587659.50",       // projected − target; null when coverage incomplete
  "withinBudget": true                // boolean ONLY when projected.coverageComplete === true; else null
}
```

- **Provenance mandatory**: every `R$` amount carries `source: OVERLAY | NATIVE`; a projection is never presented as the committed target.
- **`withinBudget` is `null` (and `variance` is `null`) whenever the projection's coverage is incomplete** — a partial projection is never declared in- or over-budget (binding ruling). The UI shows the partial projection with the coverage warning, not a verdict.

#### DEC-7 — Endpoints (see §Contract for literal JSON)

**`year` is a required query discriminator on all four verbs** — the tariff identity is `(customer, domain, category, year)`, so a customer with 2026 and 2027 tariffs would otherwise be ambiguous on GET/PUT/DELETE. Bucket `ref`s in PATCH/DELETE bodies must match the query `year` (mismatch → `400 TARIFF_BUCKET_INVALID`).

**Tariffs** (bucket API, mirrors goals — the official contract):

```
GET    /customers/:id/tariffs?domain=&category=&year=&granularity=
PUT    /customers/:id/tariffs?domain=&category=&year=   body: nested price tree (replace the year)
PATCH  /customers/:id/tariffs?domain=&category=&year=   body: sparse price buckets (bands/days/hours)
DELETE /customers/:id/tariffs?domain=&category=&year=   whole year or a sub-bucket (idempotent)
```

**Goals** (extended): `?measure=QUANTITY|CURRENCY` (default `QUANTITY`); `GET …?withMoney=true` adds the overlay + budget; the domains list reports which measures exist per `(domain, year)`.

#### DEC-8 — Backend-authoritative rounding + calendar; specified as an algorithm with golden vectors

The server computes every `R$`; **clients consume the decimal string and never re-derive**. Money is `numeric`, serialized as a **decimal string**, never a JSON number.

```
For each returned node N (withMoney=true):
  raw(N) = Σ over priced (device,hour) in N of adjustedQty(device,hour) × price(device.category,hour)  [full numeric precision, no intermediate rounding]
  monetaryValue(N)    = round_half_up(raw(N), 2)          [round ONCE, at this node's boundary]
  monetaryRawValue(N) = round_half_up(rawUnadjusted(N), 2)
```

- **One rounding boundary, top-down.** Parent = `round(Σ child full-precision raws)`, not the sum of children's already-rounded values.
- **`round_half_up`** operates on the exact **decimal** value at 2 places (BRL), half away from zero. A single shared util backs Postgres and Node (same algorithm, not two impls that merely agree on a round example).
- **Calendar (binding):** goal-hours and tariff-hours are both **nominal civil hours** indexed by `(month, day, hour)` in the same civil calendar (`customer_tariffs.timezone`, initially `America/Sao_Paulo`). The pricing multiply is a **pure `(month, day, hour)` join between the two nominal series — no UTC conversion ever occurs at pricing time**; `timezone` records the civil calendar both series must share (mapping raw telemetry to a nominal goal-hour is upstream of this RFC). **No DST creation/removal of buckets** — hours are nominal, so there is never a 23- or 25-hour day. Leap years have 29 Feb and 8 784 hours.
- **Golden vectors (shared oracle — a consumer is correct iff it reproduces all of them):**
  - **V1 — sum (bands):** one `SPECIFIC` device, 2026-07-01:
    ```
    00–10 (11h) @2.000000 × 10 kWh = 220.000000
    11–14 ( 4h) @3.000000 × 10     = 120.000000
    15–19 ( 5h) @4.000000 × 12     = 240.000000
    20–23 ( 4h) @2.000000 ×  8     =  64.000000
    raw(day)=644.000000 → monetaryValue="644.00"
    ```
  - **V2 — tie / true rounding:** raw that lands on a half-cent must round half-up:
    ```
    raw = 2.005000 → monetaryValue = "2.01"   (naive float64 toFixed would give "2.00" — must NOT)
    raw = 644.005000 → "644.01" ;  raw = 644.004999 → "644.00"
    ```
  - **V3 — nominal join, no UTC at pricing:** a goal-hour indexed `(month=7, day=1, hour=0)` is priced by the tariff row `(7, 1, 0)` — a direct nominal-to-nominal join. The vector pins that pricing performs **no** UTC conversion: whatever UTC instant a nominal hour corresponds to is irrelevant here (that mapping is upstream), so the same `(m,d,h)` on both sides always meet.
  - **V4 — leap year:** 2028-02-29 exists; a full-year tariff distributes to 8 784 rows and a full-year `QUANTITY×tariff` sums all 8 784 without a gap at 02-29.

#### DEC-9 — Authorization

Dedicated `tariffs.tariff.read` / `tariffs.tariff.update`, enforced by `requireTariffAccess` (modeled on `requireGoalsAccess`: JWT via RBAC scoped to the customer → `403`; API key via hierarchy `SELF/SUBTREE/TENANT`, out-of-reach → `404`; `'*'` bypass). Seeded `policy:tariff-management` on `role:customer-admin` + `role:energy-analyst`; prod ops script. RFC-0222's `@myio.com.br`/SuperAdmin gate remains a deployment policy on top. Money read rides `goals.goal.read`; setting `devices.tariff_category` rides `device.device.update`.

#### DEC-10 — Domains: ENERGY (`R$/kWh`) and WATER (`R$/m³`), both `FLAT` in v1

Both priced (SUM) domains ship in v1. **WATER uses `tariffModel: FLAT`, explicit in contract and persistence** — a single blended `R$/m³` per `(category, hour)`. Real water progressivity (tiers + sewage) is deferred to a future `tariff_model`; the column makes that evolution non-destructive.

#### DEC-11 — Migrations: `0062` (Phase 1) and `0063` (Phase 3) — TWO separate files

The phase split is enforced at the migration-file boundary so Phase 1 physically cannot touch `consumption_goals` (AC-P1.4).

**`0062` (Phase 1, custom runner):**
1. `ALTER TABLE devices ADD COLUMN tariff_category …` (nullable, backward-compatible).
2. `CREATE TABLE customer_tariffs` (incl. `tariff_model`, `timezone`), `customer_tariff_hours`, `customer_tariff_history` (+ unique indexes; **no extension needed**).
3. Seed `policy:tariff-management`; prod ops script `add-tariff-management-policy.sql`.

**`0063` (Phase 3, custom runner) — does NOT ship with Phase 1:**
4. `ALTER TABLE consumption_goals ADD COLUMN measure …` (default `QUANTITY`).
5. Recreate `consumption_goals_uq` to include `measure` — `DROP … IF EXISTS` then create (0061 `DROP CONSTRAINT` lesson; prod created it as a constraint, a bare `DROP INDEX` fails `2BP01`).
6. Add `measure` to the goal-history stable key (nullable + backfill `'QUANTITY'`).

`0062` never references `consumption_goals`. Leap years materialize 8 784 tariff-hour rows. Omitting `measure`/`withMoney` (i.e. before `0063`) leaves existing goal reads/writes byte-identical.

#### DEC-12 — Phased delivery + Phase-1 hard gate

- **Phase 1 — Tariffs + device category.** Migration `0062` only, `devices.tariff_category`, `customer_tariffs*`, tariff bucket endpoints, RBAC, batched upsert. **Additive.** **Hard gate: the Phase-1 diff MUST NOT touch `consumption_goals_uq` or any existing goal conflict target / history key, and MUST NOT include migration `0063`** — a `schema.ts` diff limited to the new tables + `tariff_category` is a merge precondition (AC-P1.4). Unblocks `openPricingPanel` persistence.
- **Phase 2 — Money overlay.** `?withMoney=true` (DEC-5/6/8), coverage. Read-only; no goal schema change. **Rollout gate (product):** before P2, **measure how many production goals are device-granular** and define curation for the rest — so P2 does not debut returning `money: null` for most of the base. This count is deliberately **not presumed** in this RFC.
- **Phase 3 — Financial goals.** `consumption_goals.measure` + the identity migration (DEC-4/11) + budget comparison (DEC-6). Carries the goal-uniqueness blast radius; ships last, behind its own review.

#### DEC-13 — RFC-0222 reconciliation: hourly bucket API is canonical; the widget is an adapter

The **server's only persistent model is the hourly bucket API** (§Contract). RFC-0222's `openPricingPanel` MAY keep a day/band editing UX, but it acts as a **client-side adapter**: a "day price" expands to 24 hourly buckets, a "band" to its contiguous hours, before PUT/PATCH; on read it collapses equal contiguous hours back into bands for display. **No month/range period object is persisted.**

**Name & unit reconciliation (transition):**

| RFC-0222 (client, legacy) | RFC-0054 (canonical) | Type | Transition |
|---|---|---|---|
| `PricingEntry` (month/range) | hourly buckets (no period object) | — | adapter expands to buckets; not persisted as a period |
| `pricePerKwh` | `price` (in `customer_tariff_hours`) | **decimal string** | **INPUT-only alias**, deprecated on arrival: accepted on write through the 2nd minor release after GA (`v(GA+2)`), removed in `v(GA+3)`. **Never emitted in responses** (reads always return `price`). |
| `periodType: month\|range`, `periodKey`, `start`, `end` | (client-side only) | — | adapter concern; never sent as persistence |
| `currency: 'BRL'` | `currency: 'BRL'` | enum | unchanged |
| (implicit kWh) | `unit: 'kWh' \| 'm3'` (from `domain`) | enum | **explicit**; ENERGY→`kWh`, WATER→`m3` |

`unit` is derived from `domain` and echoed on every response so the widget multiplies the right denominator. The temporary `pricePerKwh` alias is **input-only and never echoed**; its removal is anchored to the GA release (`v(GA+3)`), pending confirmation of the GA version against the widget's release cadence.

### Interaction matrix

| Existing feature | Financial (`CURRENCY`) goal | Money overlay (tariff × quantity) |
|---|---|---|
| Hourly canonical storage (RFC-0046) | reused (value `R$`) | reused for tariffs; read-time for goals |
| Distribute-on-write / residual (Add. A) | reused | reused (tariff bands) |
| Device-granular (Add. A) | composes (`R$` per meter) | **required** (category per device) |
| Margin (RFC-0052) | composes (% on `R$`) | multiplies the **adjusted** quantity |
| Coverage gaps (Add. A) | reused | `tariffCoverageGaps` + `uncategorizedDevices`; `coverageComplete` |
| Version / history | reused (per measure / per category) | tariffs versioned + audited |

---

## Contract (HTTP)

Authoritative wire shapes. **All money/price fields are decimal strings** (never JSON numbers). Arrays are `[]` when empty (never omitted). A block that does not apply is `null` with a `reason`, or absent per the rules below. Every read and write returns `version` in the **body** and as a strong `ETag: "<version>"`; writes accept optimistic concurrency via **either** `If-Match: "<version>"` **or** body `expectedVersion` — if **both** are sent they must be equal, else `400 VERSION_GUARD_MISMATCH`. A stale guard (either form) → `409 *_VERSION_CONFLICT` carrying `currentVersion` (also in the `ETag`).

### Tariff — `GET /customers/:id/tariffs?domain=ENERGY&category=SPECIFIC&year=2026&granularity=day`

```jsonc
// 200
{
  "customerId": "…", "domain": "ENERGY", "category": "SPECIFIC",
  "year": 2026, "unit": "kWh", "currency": "BRL", "tariffModel": "FLAT",
  "timezone": "America/Sao_Paulo", "version": 7,
  "tree": {                                   // derived at the requested granularity; prices are decimal strings
    "daily": {
      "07-01": { "price": "2.000000", "sourceLevel": "DAY", "derived": false,
                 "hourly": { "15": { "price": "4.000000", "sourceLevel": "HOUR", "derived": false }, … } }
    }
  }
}
```

### Tariff — `PUT` / `PATCH` `…?domain=ENERGY&category=SPECIFIC&year=2026`

```jsonc
// PUT body — nested tree, finest level wins; prices are decimal strings
{ "monthly": { "07": { "daily": { "01": { "price": "2.000000",
     "hourly": { "11":{"price":"3.000000"}, "12":{"price":"3.000000"}, "13":{"price":"3.000000"}, "14":{"price":"3.000000"},
                 "15":{"price":"4.000000"}, … "19":{"price":"4.000000"}, "20":{"price":"2.000000"}, … } } } } },
  "expectedVersion": 7 }

// PATCH body — sparse buckets by level+ref (ref is year-aware, civil calendar)
{ "buckets": [ { "level":"DAY",  "ref":"2026-07-01", "price":"2.000000" },
               { "level":"HOUR", "ref":"2026-07-01T15", "price":"4.000000" } ],
  "expectedVersion": 7 }

// 200 → the derived tree at the action level + new version (body) + ETag
```

Price **input precision**: up to **6 decimals**; more → `422 TARIFF_PRICE_INVALID`. Price must be `> 0`.

### Tariff — `DELETE` (idempotent)

```
DELETE /customers/:id/tariffs?domain=ENERGY&category=SPECIFIC&year=2026  → whole year, 204 (idempotent: absent = 204)
DELETE …&year=2026  body { "bucket": { "level":"DAY", "ref":"2026-07-01" }, "expectedVersion": 7 } → 200 + body; absent bucket → 204
```

### Goal money read — `GET /customers/:id/goals?domain=ENERGY&year=2026&granularity=month&withMoney=true`

```jsonc
// 200 (device-granular QUANTITY goal, partial coverage example)
{
  "customerId":"…","domain":"ENERGY","year":2026,"measure":"QUANTITY","version":5,
  "tree": { "monthly": { "07": { "value":"310000.000", "adjustedValue":"294500.000",
                                  "monetaryValue":"612340.50", "monetaryRawValue":"644570.00" }, … } },
  "money": {
    "currency":"BRL", "coverageComplete": false,
    // 2 devices → totalHours = 2 × 8760 = 17520 device-hours.
    // "Bomba 3" uncategorized → its 8760 device-hours excluded;
    // the categorized device's March (744 calendar-hours) has no tariff → excluded.
    // pricedHours = 17520 − 8760 − 744 = 8016.
    "pricedHours": 8016, "totalHours": 17520,
    "tariffCoverageGaps": { "missing":["2026-03"], "truncated":false, "missingHours":744 },  // calendar hours
    "uncategorizedDevices": [ { "deviceId":"…","code":"…","label":"Bomba 3" } ]              // device count
  },
  "budget": {
    "projected": { "amount":"6912340.50","source":"OVERLAY","coverageComplete":false },
    "target":    { "amount":"7500000.00","source":"NATIVE" },
    "variance": null,          // withheld: coverage incomplete
    "withinBudget": null       // withheld: coverage incomplete
  }
}
```

Rules: `money` is **absent** when `withMoney=false`; `money` is `null` with `reason:"MONEY_REQUIRES_DEVICE_GRANULARITY"` for a customer-level QUANTITY goal; when `money` is present, `tariffCoverageGaps` and `uncategorizedDevices` are **always included** with the stable empty shape (`{ missing:[], truncated:false, missingHours:0 }` / `[]`) when coverage is complete — never omitted; `budget` is absent when no `CURRENCY` goal exists; `variance`/`withinBudget` are `null` whenever `projected.coverageComplete` is `false`.

### Error taxonomy (stable `code`s)

Body: `{ "error": { "code": "<STABLE>", "message": "…", "details"?: { … } } }`. Clients switch on `code`, never on `message`.

| HTTP | `code` | When | `details` |
|---|---|---|---|
| 409 | `TARIFF_VERSION_CONFLICT` | `expectedVersion`/`If-Match` stale | `expectedVersion`, `currentVersion` (also in `ETag`) |
| 400 | `VERSION_GUARD_MISMATCH` | both `If-Match` and body `expectedVersion` sent and they disagree | `ifMatch`, `expectedVersion` |
| 422 | `TARIFF_PRICE_INVALID` | price ≤ 0 or > 6 decimals | `value` |
| 400 | `TARIFF_BUCKET_INVALID` | bad month/day/hour or ref (incl. 02-29 in a non-leap year) | `ref` |
| 400 | `DOMAIN_INVALID` | domain ∉ {ENERGY, WATER} | `domain` |
| 400 | `CATEGORY_INVALID` | category ∉ {COMMON_AREA, SPECIFIC} | `category` |
| 409 | `GOAL_VERSION_CONFLICT` | goal optimistic mismatch | `expectedVersion`, `currentVersion` |
| 422 | `GOAL_MEASURE_INVALID` | `CURRENCY` on a non-SUM domain (TEMPERATURE) | `domain`, `measure` |
| 403 | `FORBIDDEN` | JWT lacks `tariffs.tariff.update` | — |
| 404 | `NOT_FOUND` | customer/goal out of hierarchy reach (no existence leak) | — |

Non-error coverage states (`coverageComplete:false`, `uncategorizedDevices`, `MONEY_REQUIRES_DEVICE_GRANULARITY`) travel in the **200 body**, not as errors.

---

## Acceptance criteria

1. Omitting `measure`/`withMoney` keeps every `QUANTITY` goal read/write byte-identical (golden-snapshot read-identity — #1 gate).
2. A tariff stated at DAY fills 24 hours; an intraday band overrides only its hours (`derived=false`); re-stating overwrites in place, bumps version, appends one history row. Full-year distribute → **8 760** rows (non-leap) / **8 784** (leap, incl. 02-29).
3. Two prices for the same `(tariff_id, month, day, hour)` are impossible (unique violation); the schema contains **no** `EXCLUDE`/`daterange`/`btree_gist`.
4. Money overlay reproduces **all four golden vectors** (V1 sum, V2 tie `2.005→"2.01"`, V3 day/UTC boundary, V4 leap year) to the centavo, in both the Postgres-side and Node-side rounding utils.
5. **Zero-is-not-a-price:** an uncategorized device or an hour with no category tariff is **excluded** from the sum and reported (`uncategorizedDevices` / `tariffCoverageGaps`, `coverageComplete:false`) — never priced at `R$ 0`. A regression test asserts a missing tariff never yields a `0` monetary contribution.
6. **Budget withheld on incomplete coverage:** when `projected.coverageComplete` is `false`, `variance` and `withinBudget` are `null`; both are computed only when coverage is complete.
7. Customer-level `QUANTITY` goal + `withMoney` → `money: null`, `reason: MONEY_REQUIRES_DEVICE_GRANULARITY`.
8. Financial goal: `(ENERGY, 2026, CURRENCY)` and `(ENERGY, 2026, QUANTITY)` coexist, edited independently (separate versions + history); `CURRENCY` on `TEMPERATURE` → `422 GOAL_MEASURE_INVALID` at both the write and the overlay points.
9. Monetary/price fields serialize as **decimal strings**; a test rejects any `number`-typed money/price in the JSON. `version` appears in the body **and** `ETag`; a stale `If-Match` **or** body `expectedVersion` → `409 *_VERSION_CONFLICT`.
10. **AC-P1.4 (hard gate):** the Phase-1 diff does not alter `consumption_goals_uq` or any existing goal conflict target / history key; `schema.ts` changes limited to the new tables + `tariff_category`.
11. **AC-P1.2 (batched upsert):** an 8 784-hour year write is a single batched `INSERT … ON CONFLICT (tariff_id, month, day, hour) DO UPDATE`, idempotent (2× = same state), bounded roundtrips (asserted count).
12. Migration `0062` (Phase 1) is **idempotent after a complete run** — the custom runner wraps the file in a single transaction, so a failure rolls back wholesale (a partially-created table is not a supported state; `IF NOT EXISTS` guards a clean re-run, not reconciliation of a half-applied table). It **contains no reference to `consumption_goals`**; the `consumption_goals_uq` recreation lives only in `0063` (Phase 3) and does not error on prod's constraint form.
13. WATER responses carry `tariffModel: "FLAT"`; DELETE is idempotent (absent bucket → 204).

## Drawbacks

- **Tariff storage volume.** Hourly × 2 categories × customers = up to `8 784 × 2` rows/customer-year (~878k at 100 tariffs). Same order as goals; chunked/batched upserts apply. Justified by the intraday-band requirement.
- **`measure` in the goal identity is a blast radius**, contained to Phase 3 behind AC-P1.4 and its own review; SUM-only lives in the service, not a column check.
- **Money view requires device granularity.** A customer-level quantity goal can't be priced; flagged, with the P2 measurement gate to size curation.
- **Two sources of cost truth** (native budget vs projection) can disagree — intentional, made safe by mandatory `source` and by withholding `withinBudget` on incomplete coverage.
- **Blended price only** (`FLAT`). Water especially may need tiers before production billing use; the `tariff_model` column is the non-destructive evolution path.
- **The timezone problem moved, it did not vanish.** It now lives in write-time distribution (nominal civil hours), guarded by golden vectors V3/V4 and the explicit `timezone` column rather than by a query-time range.

## Rationale and alternatives

- **Hourly tariffs instead of RFC-0222 month/range:** reality is intraday-banded and the goal grain already models it; hourly *removes* the entire overlap/timezone-range machinery. RFC-0222's month/range survives only as a **client adapter** (DEC-13), not a second persistence.
- **Category on the device, not the customer:** "loja vs área comum" is a device fact; a single customer holds both; device-granularity already gives the split.
- **`measure` on the goal, not a separate `monetary_goals` table:** reuses 100% of the RFC-0046 engine; money is a `SUM` quantity in another unit.
- **Keep native budget *and* the overlay:** they answer different questions (committed budget vs forecast); `source` + withheld verdict keep them distinct and honest.
- **Zero excluded, not multiplied:** a presumed `0` price would make a partial projection look complete and a budget look met — the exact silent-money bug the roundtable flagged.
- **Rejected — derive money only from tariffs (no native budget):** a budget is money-first, not derivable from a quantity.
- **Rejected — reuse `goalMarginPct` for money:** margin is a unitless percentage; tariff is a per-hour, per-category unit conversion with its own catalog and lifecycle.

## Prior art

- **RFC-0222 (`openPricingPanel`):** the client UI this RFC persists — upgraded to hourly + category, with RFC-0222's month/range demoted to a client adapter (DEC-13).
- **RFC-0046 + Addendum A:** hourly canonical storage, distribute-on-write, residual, device-granularity, coverage-gaps, explicit classification (`meter_role`) — all reused.
- **RFC-0052 (Goal Margin):** the read-time derived-sibling overlay is the template for `value`+`monetaryValue`, `money`/`budget` blocks.
- **ANEEL tariff structures (ponta/fora-ponta, bandeiras):** the hourly banded price is the standard domain reality.

## Unresolved questions

- **Customer-level money view:** allow a customer default `tariff_category` so non-device goals can be priced, or keep device granularity hard-required? (Proposed: hard-required in v1; revisit after the P2 measurement.)
- **Water tariff realism:** the P2 measurement and pilot will show whether `FLAT` water is usable or WATER money must wait for a tiered `tariff_model`.
- **`withMoney` default:** opt-in (proposed) vs auto when tariffs exist.
- **`tariff_category` source:** any existing device classification to derive from, or the explicit column as sole source? (Proposed: explicit only.)
- **`pricePerKwh` alias removal anchor:** the window is decided (input-only, removed in `v(GA+3)`, never echoed — DEC-13); only the concrete GA version number remains to be pinned against the widget's release cadence.

## Future possibilities

- Wire `openPricingPanel` to the tariff bucket API via the adapter, dropping the `localStorage` stub.
- Feed tariffs into AllReportModal / energy summaries so `R$` shows beside `kWh`/`m³`, on the DEC-8 rounding contract.
- **Tariff components** (TE/TUSD, taxes, bandeiras) and **tiered water** (tiers + sewage) as new `tariff_model` values; `FLAT` remains the compatible baseline.
- Inverse view: a `CURRENCY` goal's implied quantity via tariffs.
- Realized-vs-goal **variance in `R$`** (RFC-0182/0217 consumers).
- Multi-currency (the `currency` column already exists).
- CSV import/export of an hourly tariff table (parity with the goals CSV import).
