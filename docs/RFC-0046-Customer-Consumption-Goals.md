# RFC-0046 — Customer Consumption Goals

- **Status:** Draft — **design closed** (decisions DEC-1…DEC-7 resolved 2026-06-18); ready for implementation.
- **Created:** 2026-06-18
- **Author:** MYIO Engineering
- **Domain:** Customers / Consumption Goals (Energy · Water · Temperature)
- **Reviews:** `docs/RFC-0046-Customer-Consumption-Goals-feedback.md` (round 1), `…-feedback-v2.md` (round 2).
- **Related:**
  - `myio-js-library/src/docs/GoalsPanel-DataModel.md` — the `GoalsPanel` (`openGoalsPanel`, RFC-0075) UI contract that consumes/produces goals.
  - RFC-0019 — Customer Config · RFC-0028 — Device Calibration Offsets (audit/history precedent) · RFC-0016 — TB Entity Mapping · RFC-0009 — Events/Audit Logs.
  - `docs/DB-MIGRATIONS.md` — custom migration-runner conventions.

---

## Why this matters

Every shopping/customer operates against **targets**: "this mall should not exceed 1,200 MWh this year", "the food court should stay under 85 m³ in March", "hold the common areas at 23 °C". Today these targets live **outside GCDR** — in a ThingsBoard `SERVER_SCOPE` attribute edited by the `GoalsPanel` modal, in spreadsheets, or nowhere. The dashboard can *show* consumption but has no authoritative source to compare against.

GCDR is the source of truth for customer master data. **Consumption goals belong with the customer.** One authoritative, versioned, audited store that every consumer (dashboard gauges, reports) reads from — and, critically, one that supports the new client requirement: **goals analysed down to the hour**, with a full change history.

This RFC formalises a normalised model for per-customer goals across energy, water and temperature, at hourly grain with coarser views derived on read.

---

## Summary

Per-customer goals, scoped by **domain** (`ENERGY`, `WATER`, `TEMPERATURE`), persisted at a **single canonical grain — the hour**. The operator may enter a target at any level (year, month, day, hour); GCDR **distributes it down to hourly buckets** on write and **aggregates hours up** on read (sum for energy/water, weighted average for temperature). There is no mixed-granularity storage and no per-asset goal in this version.

- **Canonical store:** hourly rows under a per-`(customer, domain, year)` parent that carries an optimistic `version`.
- **Aggregation method is fixed per domain** (`SUM` energy/water, `AVERAGE` temperature) — not an operator choice.
- **History** is a separate append-only table recording the **level the user acted on** (e.g. "edited a day → system distributed to 24 hours"); `?fetchHistory=true` returns ≤100 entries.
- **Write semantics:** `PUT` replaces a whole `(year, domain)`; `PATCH`/import merges specific buckets.
- New API-key scopes `goals:read` / `goals:write`; audit event `CUSTOMER_GOALS_UPDATED`.

---

## Goals & non-goals

**Goals** — a durable, versioned, audited home for per-customer targets; hourly grain with derived coarser views; energy/water/temperature; CSV import with dry-run/partial/log; customer-scoped REST under the existing hybrid auth.

**Non-goals (future — see §10):** per-asset goals; holding/ROOT-RESELLER roll-up; operating-window/excluded hours; proportional (non-even) distribution; tenant-configurable aggregation method; computing **actual** consumption or "% of goal" (that stays in the consumers).

---

## Domain model & units

| Domain | `unit` | Aggregation (`aggregation_method`) | Distribution on write |
| --- | --- | --- | --- |
| `ENERGY` | `kWh` | `SUM` | even split: `parent / hoursInScope` |
| `WATER` | `m3` | `SUM` | even split |
| `TEMPERATURE` | `C` | `AVERAGE` (weighted) | copy parent to each hour |

The method is a **fixed property of the domain**, stored in config (not on each value row, not chosen by the operator). `total = 25` on a temperature goal reads as "25 °C".

---

## Granularity, distribution & roll-up (DEC-1, DEC-2, DEC-3)

**The hour is the only stored grain.** The granularity the operator picks is an *input mode*, not a storage shape.

### Distribution (set a coarser level → store hours)
- **`SUM` domains (energy/water):** the parent value is split **evenly** across the hours in scope: `hourValue = parentValue / hoursInScope` (e.g. a month total ÷ that month's hours). Proportional/profile-weighted distribution is **future**.
- **`AVERAGE` domains (temperature):** the parent value is **copied** to each hour, so the weighted average back up equals the parent.
- Every generated hour row records:
  - `source_level` — the level the user actually set (`YEAR | MONTH | DAY | HOUR`);
  - `derived` — `true` when the value was system-distributed, `false` when the operator set this exact hour.
- On a later coarser edit, re-distribution overwrites only `derived = true` hours by default (explicit hourly values the operator confirmed are preserved unless the operator forces a reset). This is the storage backing for the panel's "suggested vs confirmed" UX.

### Roll-up (read a coarser level)
Computed **on read** (not materialised in the MVP; add a materialised view per `(customer, domain, year)` only if profiling demands):
- `DAY` = `SUM(hours)` (energy/water) or **weighted `AVG(hours)`** (temperature);
- `MONTH` = sum/weighted-avg of its hours; `YEAR` likewise.
- **Weighted** = by the count of contributing hours (DEC-2), so a long month does not weigh the same as a short one. The read response declares the method per node so a temperature average is never mistaken for a sum.

> **Volume (DEC-3, accepted):** a fully-specified year is up to **8,760 hour-rows per (customer, domain, year)**. This is the deliberate "model for the worst case" choice; coarser views are derived, not stored.

---

## Data model

### `consumption_goals` — parent (holds the optimistic version)
```sql
CREATE TABLE consumption_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  domain      text NOT NULL,            -- ENERGY | WATER | TEMPERATURE
  year        smallint NOT NULL,
  unit        text NOT NULL,            -- kWh | m3 | C (from domain config)
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT consumption_goals_uq UNIQUE (tenant_id, customer_id, domain, year)
);
CREATE INDEX consumption_goals_customer_idx ON consumption_goals (tenant_id, customer_id);
```

### `consumption_goal_hours` — the canonical hourly grain
```sql
CREATE TABLE consumption_goal_hours (
  goal_id      uuid NOT NULL REFERENCES consumption_goals(id) ON DELETE CASCADE,
  month        smallint NOT NULL,       -- 1..12
  day          smallint NOT NULL,       -- 1..31 (valid for the month/year)
  hour         smallint NOT NULL,       -- 0..23
  value        numeric NOT NULL,
  source_level text NOT NULL,           -- YEAR | MONTH | DAY | HOUR (level the user set)
  derived      boolean NOT NULL,        -- true = system-distributed
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  CONSTRAINT consumption_goal_hours_uq UNIQUE (goal_id, month, day, hour)
);
```

### `consumption_goal_domains` — fixed aggregation config
```sql
CREATE TABLE consumption_goal_domains (
  tenant_id          uuid NOT NULL,
  domain             text NOT NULL,
  aggregation_method text NOT NULL,     -- SUM | AVERAGE
  unit               text NOT NULL,     -- kWh | m3 | C
  PRIMARY KEY (tenant_id, domain)
);
```
Seeded per tenant: `ENERGY→SUM/kWh`, `WATER→SUM/m3`, `TEMPERATURE→AVERAGE/C`. Tenant-configurable override is future.

### `consumption_goal_history` — append-only audit (DEC-4)
```sql
CREATE TABLE consumption_goal_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        uuid NOT NULL,
  actor          uuid,                  -- who changed it
  action_level   text NOT NULL,         -- YEAR | MONTH | DAY | HOUR (what the user touched)
  bucket_ref     text NOT NULL,         -- "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08"
  old_value      numeric,               -- at the input level (NULL on create)
  new_value      numeric,               -- at the input level (NULL on delete)
  distributed    boolean NOT NULL,      -- true = system spread to hours
  hours_affected integer NOT NULL,      -- count of hour rows written by this change
  version        integer NOT NULL,      -- the version this change produced
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumption_goal_history_idx ON consumption_goal_history (goal_id, changed_at DESC);
```

**Example (the author's case):** an operator edits day `2026-03-15` → one history row `{ action_level: DAY, bucket_ref: "2026-03-15", old_value, new_value, distributed: true, hours_affected: 24, actor, version }`; the 24 updated hour rows carry `source_level: DAY, derived: true`.

---

## Versioning & concurrency (DEC-4, A)

- `version` lives on `consumption_goals` (per `(tenant, customer, domain, year)`) and **increments on every successful change** within that year.
- `PUT`/`PATCH` may carry the expected `version`; a mismatch → **`409 Conflict`** with the current `version` in the body. Contention grain is the year (low-contention data; acceptable). The front-end treats `409` as **reload-and-reapply**, not reload-and-discard.
- The hourly upsert, the `version` bump and the history append run in **one transaction**.

---

## API

`domain` and `year` are query discriminators. The wire shape returns the tree at the requested granularity, computed from hours, plus the `version`.

```jsonc
// GET /api/v1/customers/{id}/goals?domain=ENERGY&year=2026&granularity=month  →
{
  "customerId": "…", "domain": "ENERGY", "unit": "kWh",
  "aggregationMethod": "SUM", "year": 2026, "version": 7,
  "tree": {                              // requested granularity, derived from hours
    "annual": { "value": 1200000, "method": "SUM" },
    "monthly": { "01": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": false } }
  }
  // ?granularity=hour returns the full hourly tree; ?fetchHistory=true adds "history": [ ≤100 entries ]
}
```

### Endpoints (customer-scoped, hybrid auth, hierarchy honoured)

| Action | Method | Path | Notes |
| --- | --- | --- | --- |
| List domains with goals | `GET` | `/customers/:id/goals` | Summary per domain (`unit`, `version`, years present). |
| Get goals | `GET` | `/customers/:id/goals?domain=&year=&granularity=&fetchHistory=` | `granularity` ∈ `year\|month\|day\|hour` (default `month`); derived from hours. `fetchHistory=true` → ≤100 entries, newest first. |
| Replace a year | `PUT` | `/customers/:id/goals?domain=&year=` | **Replace**: the payload is the whole year; buckets absent from the payload's scope are removed; system distributes to hours; `version` optimistic. |
| Merge buckets | `PATCH` | `/customers/:id/goals?domain=&year=` | **Merge**: only the sent buckets are (re)distributed; the rest are preserved. |
| Import (CSV) | `POST` | `/customers/:id/goals/import?domain=&year=` | Dry-run/preview by default; see §CSV. |
| Delete | `DELETE` | `/customers/:id/goals?domain=&year=` | Removes the year (or a sub-bucket); logged + versioned. |

- **Validation:** `granularity:"hour"` is fully supported; month `01..12`, day valid for the month/year (leap-year aware), hour `0..23`; values `.finite()`, `>= 0` for energy/water (temperature may be negative); `unit` matches the domain.

---

## CSV import — experience, not parse

Always a **dry-run preview** before persisting:
1. **Upload** → "Preview. Nothing is saved until you confirm."
2. **Dry-run** → a ghost tree of how the year would look + line-by-line diagnostics (`8,380 OK · 32 problems`, each citing the exact line; granularity conflicts resolve as "finest wins"). **Partial import is explicit** (valid lines import; invalid are listed) with a downloadable error report. Never silent; never all-or-nothing.
3. **Confirm** in numbers ("3 months become hourly, 5 daily, 4 monthly; 32 lines ignored").
4. **Full log** — downloadable, auditable; the importer then lands on the imported tree for hourly tweaks.

Import is **merge by bucket** (PATCH semantics) and idempotent per bucket.

---

## Auth & scopes

- **API keys:** add `goals:read` / `goals:write` to the customer-API-key scope catalogue; reads require `goals:read` (or `*:read`), writes require `goals:write`.
- **JWT:** RBAC permissions `goals:read` / `goals:write`, granted to roles that manage customer configuration.
- Customer-scoped via the existing `hybridAuthByMethod`; hierarchy access (`SELF`/`SUBTREE`/`TENANT`) honoured.
- Every write emits an audit event `CUSTOMER_GOALS_UPDATED` `{ customerId, domain, year, version, actionLevel }` — no goal values in the audit row.

---

## Migration & backward compatibility

- One additive migration creating the four tables (custom runner, no `BEGIN/COMMIT` in the file; number assigned at implementation time) + a seed of `consumption_goal_domains` per tenant.
- No backfill; customers start with no goals (`GET` returns an empty tree).
- **Schema ownership = the domain (GCDR), not the `GoalsPanel`** (DEC-6). The panel adapts to this contract; an adapter maps the panel's `goalsData` to/from these endpoints. If the panel's JSON evolves, the adapter absorbs it — the stored model does not change.

---

## Decisions resolved (closing record)

| # | Decision | Resolution |
| --- | --- | --- |
| DEC-1 | Storage grain / roll-up | **Always hourly**; coarser derived on read (sum / weighted-avg). |
| DEC-2 | Temperature reduction | **Weighted average** (by contributing hours/days). |
| DEC-3 | Bucket representation | Uniform hourly rows (no granularity discriminator); ~8,760/yr accepted. |
| DEC-4 | Version & history | `version` per `(customer, domain, year)`, bumped per change; history at hour grain but records the **input level** + distribution. |
| DEC-5 | Write semantics | `PUT` = replace (year+domain); `PATCH`/import = merge (bucket). |
| DEC-6 | Aggregation config | **Fixed per domain** (ENERGY/WATER `SUM`, TEMPERATURE `AVERAGE`); not operator-editable. |
| DEC-7 | Excluded/operating-window hours | **Future** (not modelled now). |

---

## Future possibilities

- **Per-asset goals** — add a nullable `asset_id` to the key (the normalised model extends cleanly).
- **Holding/ROOT-RESELLER roll-up** — derivable by summing children; a dedicated read endpoint.
- **Operating-window / excluded hours** — mark hours as not-counted on the goal (DEC-7).
- **Proportional distribution** — split a coarse value by a load profile instead of evenly (B).
- **Tenant-configurable aggregation method** — override the per-domain default.
- **Materialised roll-up view** — only if hourly read aggregation proves slow.

---

## References

- `myio-js-library/src/docs/GoalsPanel-DataModel.md` — the `GoalsPanel` UI contract.
- `docs/RFC-0046-Customer-Consumption-Goals-feedback.md` / `…-feedback-v2.md` — the two review rounds that shaped this design.
- RFC-0019 (Customer Config) · RFC-0028 (Calibration history) · RFC-0016 (TB mapping) · RFC-0009 (Audit) · `docs/DB-MIGRATIONS.md`.
