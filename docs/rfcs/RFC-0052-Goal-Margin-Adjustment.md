# RFC-0052 — Goal Margin Adjustment ("Margem da meta")

- **Feature Name:** `goal-margin-adjustment`
- **Start Date:** 2026-07-10
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** Rodrigo Lago (rplago@gmail.com), MYIO Platform Team
- **Domain:** Consumption Goals — extends RFC-0046
- **Depends on:** [RFC-0046](./RFC-0046-Customer-Consumption-Goals.md) (consumption goals), [RFC-0046-Goals-API](./RFC-0046-Goals-API.md) (API contract), [RFC-0009] (audit logs)
- **Migration:** next free runner slot (`0059_goal_margin.sql` as of authoring; renumber at integration if taken)
- **Stakeholders:** Energy Management, Platform Backend, Platform Frontend

---

## 1. Summary

Add a **percentage margin** to a consumption-goal tree — one signed percentage per **(customer × domain × year)**, e.g. `Moxuara × ENERGY × 2026 = -5%`, `Moxuara × WATER × 2026 = -10%`. The margin is a **read-time overlay**: the stored hourly buckets stay untouched, and the API derives an `adjustedValue` next to every `value` in the goal tree. Every margin change is versioned and audited (who, when, old → new), and the Metas tab shows the margin as an editable chip ("Margem da meta: −5%") with adjusted totals.

Canonical name across the stack: **`goalMarginPct`** (API/entity), **`goal_margin_pct`** (database), **"Margem da meta"** (UI, pt-BR).

## 2. Motivation

Operations frequently needs to tighten or relax a year's target without rebuilding it: "keep the seasonalized curve, but aim 5% below it this year". Today the only way is to regenerate the spreadsheet, re-import 8760 buckets and create a new version — heavyweight, error-prone, and it destroys the clean separation between *the modeled curve* (imported from engineering spreadsheets) and *the management stance on it* (a margin decided by operations).

A first-class margin:

- keeps the imported curve pristine and re-importable at any time;
- makes the management decision **explicit, auditable and reversible** (set `-5%`, later change to `-3%`, history shows both);
- gives every consumer (frontend, dashboards, alarm rules comparing consumption vs. goal) a single, server-computed adjusted number instead of N clients re-implementing the multiplication.

### Non-goals

- Per-month / per-day / per-hour margins (the margin is one number per customer × domain × year).
- Materializing the margin into the buckets ("apply to buckets" is a Future Possibility, not part of this RFC).
- Margins on anything other than consumption goals (rules thresholds etc. are out of scope).

## 3. Guide-Level Explanation

### 3.1 Conceptual model

A goal tree (RFC-0046) stores the **raw curve** at hourly grain. The margin is a single scalar attached to the same aggregate:

```
consumption_goals (customer × domain × year)
├── buckets  (8760 hourly rows — the raw curve, NEVER touched by the margin)
├── version  (optimistic lock — bumped by bucket writes AND margin writes)
└── goal_margin_pct  (nullable numeric — the management margin)
```

Reads derive both numbers for every node of the tree:

```
adjustedValue = round(value × (1 + goalMarginPct / 100), 3)
```

Multiplication distributes over the SUM roll-up (and over the weighted average used by TEMPERATURE), so applying the factor to derived nodes is exact — no re-aggregation needed.

- `goalMarginPct = -5`  → adjusted targets are 95% of the curve.
- `goalMarginPct = +10` → adjusted targets are 110% of the curve.
- `goalMarginPct = 0` or `NULL` → `adjustedValue === value` (field still present, so consumers never branch).

### 3.2 For the UI (Metas tab)

- **Read mode:** a chip next to "Versão atual: vN" — **"Margem: −5%"** (red for negative, green for positive, hidden when unset/0). The KPI row gains "Total anual ajustado" alongside "Total anual" whenever a margin is active.
- **Edit mode** (behind the existing "Habilitar edição"): a signed percentage input (two decimals, −100…+100) with its own save action. Saving calls the margin endpoint — it does **not** ride along the bucket "Salvar".
- **History:** margin changes appear in the existing "Histórico de versões" timeline as their own entries — "Margem da meta: 0% → −5%" with actor and timestamp — because a margin write bumps the same version stream (§4.3).

### 3.3 For API consumers

Additive, non-breaking. Existing consumers keep reading `value`. New consumers read `adjustedValue` and/or the `goalMargin` block:

```jsonc
GET /api/v1/customers/:id/goals?domain=ENERGY&year=2026&granularity=hour
{
  "success": true,
  "data": {
    "customerId": "84e0370e-…",
    "domain": "ENERGY",
    "year": 2026,
    "version": 8,
    "goalMargin": {
      "goalMarginPct": -5,
      "updatedBy": "fee5f663-…",
      "updatedAt": "2026-07-10T14:03:22Z"
    },
    "tree": {
      "annual":  { "value": 10447565.08, "adjustedValue": 9925186.83, "method": "SUM" },
      "monthly": { "05": { "value": 860365.01, "adjustedValue": 817346.76, "method": "SUM", … } },
      "daily":   { "05-13": { "value": 27753.71, "adjustedValue": 26365.02, … } },
      "hourly":  { "05-13T17": { "value": 1592.935, "adjustedValue": 1513.288, … } }
    }
  }
}
```

`goalMargin` is `null` when no margin was ever set. `adjustedValue` is always present (equal to `value` when margin is 0/unset).

## 4. Reference-Level Explanation

### 4.1 Database — migration `0059_goal_margin.sql`

Two changes; both idempotent (`IF NOT EXISTS` / guarded `ALTER`), matching the custom runner conventions (`docs/DB-MIGRATIONS.md`).

**(a) Margin columns on the existing aggregate root:**

```sql
ALTER TABLE "consumption_goals"
  ADD COLUMN IF NOT EXISTS "goal_margin_pct"        numeric(6,2),
  ADD COLUMN IF NOT EXISTS "goal_margin_updated_by" uuid,
  ADD COLUMN IF NOT EXISTS "goal_margin_updated_at" timestamptz;

ALTER TABLE "consumption_goals"
  ADD CONSTRAINT "consumption_goals_margin_range_check"
  CHECK ("goal_margin_pct" IS NULL
     OR ("goal_margin_pct" >= -100 AND "goal_margin_pct" <= 100));
```

A separate table is unnecessary: the margin's identity (customer × domain × year) is exactly `consumption_goals`' uniqueness, and RFC-0046 already gives the row an optimistic `version` and a history table.

**(b) New history source:** extend the `consumption_goal_history.source` CHECK with `'MARGIN'`:

```sql
ALTER TABLE "consumption_goal_history"
  DROP CONSTRAINT IF EXISTS "consumption_goal_history_source_check";
ALTER TABLE "consumption_goal_history"
  ADD CONSTRAINT "consumption_goal_history_source_check"
  CHECK ("source" IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT','MARGIN'));
```

A margin history row reuses the RFC-0046 shape ("a mutation = a version = one entry"):

| column | value for a margin change |
|---|---|
| `source` | `'MARGIN'` |
| `action_level` | `'YEAR'` |
| `bucket_ref` | the year (e.g. `"2026"`) |
| `old_value` / `new_value` | old pct → new pct (`NULL` old on first set; `NULL` new on clear) |
| `bucket_count` / `hours_affected` | `0` (no buckets touched) |
| `distributed` | `false` |
| `version` | the version this change produced |
| `actor` / `changed_at` | who / when |

### 4.2 Drizzle schema (`src/infrastructure/database/drizzle/schema.ts`)

```ts
// consumptionGoals — RFC-0052 margin overlay
goalMarginPct:       numeric('goal_margin_pct', { precision: 6, scale: 2 }),
goalMarginUpdatedBy: uuid('goal_margin_updated_by'),
goalMarginUpdatedAt: timestamp('goal_margin_updated_at', { withTimezone: true }),
```

### 4.3 API (`/api/v1`, all behind the standard hybrid auth)

| Operation | Endpoint | Notes |
|---|---|---|
| Set / change margin | `PUT /customers/:customerId/goals/margin?domain=&year=` | body `{ "goalMarginPct": -5, "version": 7 }`; upsert |
| Clear margin | `DELETE /customers/:customerId/goals/margin?domain=&year=` | sets `NULL`; history row (`new_value: null`) |
| Read (embedded) | `GET /customers/:customerId/goals?domain=&year=` | response gains `goalMargin` + per-node `adjustedValue` |
| History (embedded) | `GET …/goals?…&fetchHistory=true` | `MARGIN` entries interleave in the existing history array |

**Semantics:**

- **Optimistic lock** — same contract as bucket writes (RFC-0046 §4.4): the body `version` (or `If-Match`) must match `consumption_goals.version`; mismatch → `409 VERSION_CONFLICT` with `currentVersion`. A successful margin write **bumps `version`** — margin and buckets share one version stream, so the timeline stays totally ordered and a margin change invalidates a concurrent stale bucket edit (and vice-versa).
- **Upsert** — `PUT` on a (customer, domain, year) with no `consumption_goals` row creates the parent row with the margin and no buckets (`adjustedValue`s appear once buckets exist). `version` starts at 1.
- **Validation (Zod, `GoalsDTO.ts`)** — `goalMarginPct: z.number().min(-100).max(100).multipleOf(0.01)`; `domain`/`year` via the existing `GoalsTargetQuerySchema`.
- **No-op guard** — writing the same pct returns `200` without bumping the version or writing history.
- **Audit (RFC-0009)** — each margin write also emits a local audit-log event `GOAL_MARGIN_CHANGED` (customerId, domain, year, old→new, actor), mirroring how goal imports are audited.
- **Derivation** — `ConsumptionGoalService.get()` computes `adjustedValue = round(value * (1 + pct/100), 3)` on every node (annual/monthly/daily/hourly) after the existing roll-up. Zero extra queries: the margin comes from the already-loaded parent row.

**Error codes:** `404 CUSTOMER_NOT_FOUND`, `409 VERSION_CONFLICT`, `422 VALIDATION_ERROR` (range/precision), plus the standard auth failures.

### 4.4 Response DTO / OpenAPI

- `GoalTree` schema (`docs/openapi.yaml`): every node object gains optional `adjustedValue: number`; top-level `data` gains `goalMargin: { goalMarginPct, updatedBy, updatedAt } | null`.
- New path `/customers/{id}/goals/margin` with `put` + `delete`, tagged `Goals`.
- `GoalHistoryEntry.source` enum gains `MARGIN`.

### 4.5 Frontend (`gcdr-frontend`)

| File | Change |
|---|---|
| `src/services/api/goalsService.ts` | `setGoalMargin(customerId, domain, year, pct, version)` / `clearGoalMargin(…)`; typed `goalMargin` on the GET response |
| `src/hooks/useGoals.ts` | expose `goalMargin` + mutation helpers with 409 retry-after-refetch |
| `src/components/customers/CustomerGoalsTab.tsx` | read-mode chip "Margem: −5%" (danger/success variant by sign) next to "Versão atual"; "Total anual ajustado" KPI; edit-mode signed % input + save; history timeline renders `MARGIN` entries as "Margem da meta: 0% → −5%" |
| `src/i18n/locales/pt-BR/…` + `en/…` | `goals.margin.*` keys ("Margem da meta", "Total anual ajustado", history labels) |

UI rules:

- The margin input only appears in edit mode; saving it is independent of the bucket "Salvar" (different endpoint, same version stream).
- Adjusted numbers are **displayed alongside** raw numbers, never replacing them — the month grid keeps editing raw values (buckets are what you edit; the margin is what management layered on top).
- Sign convention surfaced explicitly in the input (`−5 %` renders with the sign, placeholder `0,00`).

### 4.6 Files to Modify

**Backend (`gcdr.git`)**
- `drizzle/migrations/0059_goal_margin.sql` (new)
- `src/infrastructure/database/drizzle/schema.ts`
- `src/dto/request/GoalsDTO.ts` (`SetGoalMarginBodySchema`)
- `src/services/ConsumptionGoalService.ts` (margin upsert/clear, adjusted derivation, history rows, audit event)
- `src/controllers/consumption-goals.controller.ts` (PUT/DELETE `/margin` routes)
- `docs/openapi.yaml`
- `tests/unit/services/ConsumptionGoalService.margin.test.ts` (new), integration coverage for the two routes

**Frontend (`gcdr-frontend.git`)**
- `src/services/api/goalsService.ts`, `src/hooks/useGoals.ts`
- `src/components/customers/CustomerGoalsTab.tsx`
- `src/i18n/locales/{pt-BR,en}/…` goals namespace

**Documentation**
- `docs/RFC-0046-Goals-API.md` — add §"Margin overlay" cross-referencing this RFC
- `docs/BACKLOG-RFCS.md` — register RFC-0052
- `docs/openapi.yaml` — as above (single source for Swagger)

## 5. Drawbacks

- One more concept on the goals aggregate ("raw vs adjusted") that every future consumer must understand; mitigated by always shipping both numbers.
- Sharing the version stream means a margin tweak 409s a concurrent bucket edit in another tab — strictly safer, but users may see one extra conflict dialog.
- `adjustedValue` roughly doubles the hourly-granularity payload (~8760 extra numbers). Acceptable today (<1 MB); a `?fields=` trim is a future option.

## 6. Rationale and Alternatives

- **Overlay vs. materializing buckets** — materializing (rewriting 8760 buckets ×0.95) destroys the imported curve, makes "what was the engineering model?" unanswerable, and turns every margin tweak into a heavyweight version. The overlay keeps one source of truth per concern. *(Decision: overlay.)*
- **Column on `consumption_goals` vs. dedicated `goal_margins` table** — a dedicated table only pays off if margins outlive or out-cardinality the goal aggregate; they don't (same natural key). Column + existing history table is less machinery.
- **Raw+adjusted vs. `?adjusted=true` vs. metadata-only** — returning both keeps the contract additive and prevents N consumers re-implementing (and rounding differently) the same multiplication. *(Decision: raw + adjusted.)*
- **Separate margin history table** — rejected; RFC-0046's history already models "one operation = one version = one entry" and the UI timeline is already built on it. A new `source='MARGIN'` slots in for free.
- **Name** — `goalMarginPct` chosen over `adjustmentPct`/`deltaPct` for the API and DB; UI copy is "Margem da meta". *(Decision: goalMarginPct.)*

## 7. Unresolved Questions

1. Should the **alarm/bundle pipeline** consume `adjustedValue` automatically when comparing consumption vs. goal, or is that a per-rule opt-in? (Leaning: consumers of the goals API get both and decide; bundles unchanged in this RFC.)
2. Does clearing a margin (`DELETE`) need a confirmation UX distinct from setting 0%? (Functionally identical; history records differ — `new_value: null` vs `0`.)
3. RBAC: is margin-setting gated by the same permission as goal editing, or does it warrant a finer scope (e.g. `goals:margin:write`)? Default: same permission as goal writes.

## 8. Future Possibilities

- **"Apply to buckets"** — a materialization action that rewrites buckets with the margin applied and resets the margin to 0 (hybrid model), producing a normal `EDIT`/`REPLACE` version.
- **Per-month margins** — a `{ "05": -10, "12": +5 }` map for seasonal management stances.
- **Margin on other domains** — WATER/TEMPERATURE ship free with this design (the margin is domain-scoped by definition); rules-engine thresholds could adopt the same overlay pattern later.
- **Margin propagation down the customer hierarchy** — a holding-level margin defaulting into children unless overridden.
