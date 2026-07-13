# RFC-0053 — Single Dashboard: single-customer operational dashboard

> **Naming update (2026-07-13):** the feature shipped as **"Single Dashboard"**
> (menu label), route `/single-customer(/:customerId)`, backend endpoint
> `GET /customers/:customerId/single-dashboard`, config block
> `customer.settings.singleDashboard`. Occurrences of "One-Store Dash" /
> "store-dash" below are the original working name.

- **Feature Name:** `single-dashboard` (né `one-store-dashboard`)
- **Start Date:** 2026-07-10
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** Rodrigo Lago (rplago@gmail.com), MYIO Platform Team
- **Domain:** New frontend module + backend aggregation endpoint
- **Depends on:** [RFC-0046](./RFC-0046-Customer-Consumption-Goals.md) (goals), [RFC-0052](./RFC-0052-Goal-Margin-Adjustment.md) (goal margin / adjusted targets), RFC-0016 (ThingsBoard entity mapping), device taxonomy (customer Taxonomia)
- **Product spec:** [RFC-0053-OneStoreDashboard.draft.md](./RFC-0053-OneStoreDashboard.draft.md) — the product/UX draft this RFC engineers; kept as the canonical wireframe/copy reference
- **Migration:** next free runner slot (`0060_store_dashboard.sql` as of authoring; only needed for Phase 2 — see §4.6)
- **Stakeholders:** Store Operations (restaurants, supermarkets, gyms, pharmacies), Platform Backend, Platform Frontend, Data/AI

---

## 1. Summary

Add **One-Store Dash**: a new top-level menu in the GCDR UI that opens a
single-store operational dashboard — "is my store operating efficiently right
now?" — for restaurant/supermarket/gym-style customers (one `customer` = one
store). The screen composes four operational groups (**Energy ⚡ purple, Water
💧 blue, Temperature 🌡️ green, Reservoirs/Tanks 🛢️ cyan**), a right sidebar
(health score, active alerts, top consumers, goal progress), and an
**Insights** feed of rule-based recommendations.

GCDR is a registry — it stores *which* devices exist, not their live values.
The dashboard therefore ships with a new backend **aggregation endpoint**
(`GET /customers/:customerId/store-dashboard`) that joins GCDR registry data
(devices, taxonomy, goals + margin, rules) with live telemetry read through
the existing ingestion references (`device.ingestionId` /
`device.externalId`), server-side and cached.

The MVP target from the product spec: a store manager answers in ≤30 seconds —
*Is everything working? Where am I spending money? Is there any risk? Can I
save money? What requires attention now?*

## 2. Motivation

The existing GCDR "Painel"/"Dashboard" pages are **platform-wide registry
views** (105 customers, 3657 devices) tuned for the MYIO operations team.
Shopping-center dashboards focus on distribution across tenants. A single
store needs the opposite: one customer, all its devices, grouped by utility,
with cost/goal/alert context on one screen.

Everything required already half-exists in the platform — devices with
profiles (CHILLER, FANCOIL, HIDR., 3F_MEDIDOR…), consumption goals with a
margin overlay (RFC-0046/0052), an alarm rules engine, and per-device
ingestion identities. What is missing is (a) a **composition layer** that
turns those into one store-shaped payload and (b) a **UI surface** designed
for the store manager persona rather than the platform operator.

### Non-goals (MVP)

- Multi-store benchmarking, carbon footprint, digital twin, occupancy/weather
  correlation — listed as Future Possibilities (§8), mirroring draft §11.
- ML-based insights. MVP insights are **deterministic heuristics** (§4.5);
  the AI layer plugs in later behind the same contract.
- Writing telemetry or commanding equipment. Read-only.
- The draft's **Reports / Performance / Settings** sub-pages ship as stubs
  (route + empty state) — content is follow-up work.

## 3. Guide-Level Explanation

### 3.1 Navigation

A new sidebar item **"One-Store Dash"** (icon: `Store` / 🏪) between
"Dashboard" and "Clientes":

- `/store-dash` — store picker: customers the user can read, searchable
  (skipped automatically when the user's scope resolves to exactly one store).
- `/store-dash/:customerId` — the dashboard itself, with an internal
  left sub-nav per draft §4: **Dashboard**, **Insights**, **Alerts**,
  Reports*, Performance*, Settings* (*stub in MVP).

### 3.2 Screen anatomy (draft §3/§5/§6/§9)

```
┌───────────────────────────────────────────────────────────┐
│ Header: store selector · date range · notifications · user│
├──────────────┬───────────────────────────────┬────────────┤
│ Sub-nav      │ 4 operational groups          │ Insights   │
│ (Dashboard,  │  ⚡ Energy   💧 Water          │ sidebar:   │
│  Insights,   │  🌡️ Temp    🛢️ Tanks          │ health 92  │
│  Alerts, …)  │  summary card + device cards  │ alerts     │
│              │                               │ top consum.│
│              │                               │ goal 78%   │
└──────────────┴───────────────────────────────┴────────────┘
```

- **Date range**: Today · Yesterday · Last 7 · Last 30 · Current month ·
  Custom (reuses `LibDateRangePicker`).
- **Group summary cards** (draft §6): current demand/flow, daily & monthly
  consumption, cost estimate, sensors online / out-of-range, fill level and
  autonomy for tanks.
- **Device cards**: one per device in the group — live value, today/monthly
  figures, sparkline, alarm badge; actions (real-time graph, history,
  reports, alarms, config, maintenance) deep-link to the existing
  DeviceDetail tabs rather than re-implementing them.
- **Right sidebar** (draft §9): Operational Health Score (0–100), active
  alerts, top consumers, **monthly goal progress** — consumption vs. the
  RFC-0052 **`adjustedValue`** (the margin-adjusted target), insight counter.
- **Visual language**: existing MYIO dashboard look (white, rounded cards,
  purple `#6C3CF0` accent, soft shadows, sparklines, dense layout).

### 3.3 How devices land in groups

Grouping is **registry-driven, not hard-coded**: each device maps to a group
via its profile/taxonomy (e.g. `3F_MEDIDOR → energy`, `HIDR. → water`,
`TERMOMETRO → temperature`, `CAIXA_DAGUA/BOMBA → tanks`). A per-customer
override lives in `customer.settings.storeDashboard` (§4.4) so a store can
re-bucket devices without a deploy. Devices with no mapping appear in an
"Unassigned" drawer so nothing is silently hidden.

## 4. Reference-Level Explanation

### 4.1 Backend — aggregation endpoint

```
GET /api/v1/customers/:customerId/store-dashboard?from=&to=&sections=
```

- **Auth**: standard hybrid (`goals:read`-style read scope — final scope name
  in §7); rate-limited like the goals router.
- **Composes** (per section, so the UI can lazy-load):
  - `groups[]` — energy/water/temperature/tanks: summary + device cards
    (registry fields from GCDR; live/period values from the telemetry
    read-through, §4.2);
  - `health` — score + component breakdown (§4.3);
  - `alerts[]` — active alarms for the store's devices (source: alarm
    orchestrator API — Unresolved Q2);
  - `goals` — per domain: consumption-to-date vs. `value` and
    `adjustedValue` from RFC-0046/0052 (`GET /goals` internals reused);
  - `insights[]` — §4.5.
- **New controller** `store-dashboard.controller.ts` + service
  `StoreDashboardService` (composition only; no new tables in Phase 1).

### 4.2 Telemetry read-through

GCDR stores identities, not values. `StoreDashboardService` resolves each
device's `ingestionId` (fallback `externalId`/tbId per RFC-0016) and queries
the **MYIO Ingestion API** server-side for: instantaneous value, period
totals, and a small sparkline series. Rules:

- **Batched + cached** — one upstream query per (customer, range) with a
  short TTL (30–60 s) keyed in-memory; the dashboard never fans out N
  browser→upstream calls, and GCDR credentials to the ingestion API stay
  server-side.
- **Degrade, don't fail** — devices whose telemetry is unavailable render
  their registry card with a "no data" state; the endpoint returns partial
  data with per-section `errors[]` instead of a 5xx.
- Cost estimates = consumption × tariff from `customer.settings.storeDashboard.tariffs`
  (flat per-kWh/m³ in MVP; utility-bill modeling is future work).

### 4.3 Operational Health Score

Deterministic and explainable (0–100), recomputed per request:

```
score = 100
  − 15 × critical_active_alarms   (cap 45)
  −  5 × warning_active_alarms    (cap 20)
  − 10 × (offline_sensors / total_sensors) × 10   (cap 20)
  −  5 × out_of_range_temperature_sensors          (cap 15)
```

The response carries the breakdown (`components[]`) so the UI can explain
the number — no magic scores.

### 4.4 Configuration (no new tables in Phase 1)

`customer.settings.storeDashboard` (JSONB already exists on `customers`):

```jsonc
{
  "enabled": true,
  "groupOverrides": { "<deviceId>": "tanks" },
  "tariffs": { "ENERGY": 0.92, "WATER": 11.5 },      // R$/kWh, R$/m³
  "tankCapacities": { "<deviceId>": 20000 }           // litres, for autonomy calc
}
```

The Settings sub-page (stub in MVP) will edit this block later; until then it
is set via the existing customer edit/API.

### 4.5 Insights (MVP heuristics)

Computed on demand inside `StoreDashboardService` from the same telemetry
window — **no storage, no ML** in Phase 1:

| key | rule (draft §7 examples) |
|---|---|
| `night-flow-leak` | water flow > 0 sustained during configured closed hours ("continuous flow 02:00–05:00") |
| `baseline-deviation` | group/device consumption > X% above the trailing 4-week same-weekday baseline ("HVAC 18% above baseline") |
| `temp-out-of-range` | temperature sensor outside its rule-engine min/max for > N minutes |
| `runtime-increase` | compressor/pump duty-cycle up > X% vs. baseline ("Freezer #2 runtime +35%") |
| `refill-frequency` | tank refill cycles/day up > X% vs. baseline |
| `goal-pace` | month-to-date consumption pace exceeds the **adjusted** (RFC-0052) monthly goal |

Each insight: `{ key, severity, title, description, deviceId?, groupKey,
estimatedImpact?, detectedAt }`. The contract is the extension point — the
future AI generator emits the same shape.

### 4.6 Phase 2 (separate migration `0060_store_dashboard.sql`, out of MVP)

Persisted insights (dismiss/acknowledge/history), insight audit, and a
scheduled evaluator (so insights exist before the first page load and can
notify). Deliberately deferred: MVP proves the read model first.

### 4.7 Frontend

| Piece | Detail |
|---|---|
| Sidebar | new item `One-Store Dash` → `/store-dash` (i18n `nav.storeDash`) |
| Routes | `/store-dash` (picker) · `/store-dash/:customerId` (+ `?view=insights\|alerts\|…` for the sub-nav) |
| Pages | `src/pages/store-dash/StoreDashPicker.tsx`, `StoreDashboard.tsx`, `StoreInsights.tsx`, `StoreAlerts.tsx` + stubs |
| Components | `GroupSummaryCard`, `DeviceMiniCard` (sparkline via existing chart lib), `HealthScoreGauge`, `GoalProgressBar` (raw vs. adjusted), `InsightCard` |
| Service/hook | `storeDashboardService.get(customerId, params)` + `useStoreDashboard` (per-section loading, 30 s polling for the live column) |
| Deep links | device card actions → `/devices/:id` tabs (graphs/alarms/reports/config) — no duplication |
| i18n | `store-dash` namespace, pt-BR + en |

### 4.8 Files to Modify

**Backend (`gcdr.git`)**
- `src/controllers/store-dashboard.controller.ts` (new) + mount in `app.ts`
- `src/services/StoreDashboardService.ts` (new; composition, health, insights)
- `src/services/IngestionTelemetryClient.ts` (new; batched, cached read-through)
- `src/dto/request/StoreDashboardDTO.ts` (new)
- `docs/openapi.yaml` — new path + schemas (`StoreDashboard*`)
- `tests/unit/services/StoreDashboardService.test.ts` (health score, grouping, insights heuristics — telemetry client mocked)

**Frontend (`gcdr-frontend.git`)**
- `src/components/layout/Sidebar.tsx` — menu item
- `src/App.tsx`/router — routes
- `src/pages/store-dash/**` (new module), `src/services/api/storeDashboardService.ts`, `src/hooks/useStoreDashboard.ts`
- `src/i18n/locales/{pt-BR,en}/store-dash.json` (new namespace)

**Documentation**
- `docs/api/STORE-DASHBOARD-API-GUIDE.md` (consumer guide, same format as GOALS/ANNOTATIONS guides)
- `docs/BACKLOG-RFCS.md` — register RFC-0053
- Draft spec stays as the UX annex (link in header)

## 5. Drawbacks

- GCDR takes on a **read-through dependency** on the ingestion API; a slow
  upstream degrades the dashboard (mitigated by cache + partial responses,
  §4.2) and couples deploys operationally.
- Heuristic insights can be noisy until thresholds are tuned per vertical;
  a bad first impression undermines the differentiating feature.
- One more dashboard surface to keep visually in sync with the design system.

## 6. Rationale and Alternatives

- **Server-side aggregation vs. browser composition** — the browser could call
  N existing endpoints + ingestion directly, but that leaks ingestion
  credentials, multiplies latency by device count, and makes the health/insight
  logic unimplementable consistently (mobile, reports reuse). One composed
  endpoint is the only shape that keeps secrets server-side.
- **`customer.settings` JSONB vs. new config tables** — MVP config is small,
  per-customer and low-churn; JSONB avoids a migration until the Settings page
  ships (Phase 2 revisits).
- **Heuristics-first vs. AI-first insights** — deterministic rules are
  debuggable, explainable to the store manager, and define the contract the
  AI generator later fills. Shipping "AI insights" without a baseline would be
  unverifiable.
- **New module vs. extending `/dashboard`** — the platform dashboard serves a
  different persona (MYIO ops, cross-customer); mixing both would compromise
  each. The draft explicitly calls for a distinct surface.

## 7. Unresolved Questions

1. **Ingestion API contract** — exact endpoints/auth for instantaneous +
   period + series queries by `ingestionId` (needs confirmation with the
   ingestion team before `IngestionTelemetryClient` is coded); ThingsBoard
   fallback for devices without `ingestionId`?
2. **Active alerts source** — alarm orchestrator REST
   (`docs/alarm-orsquestrador-backend`) vs. GCDR-local rule state: which is
   authoritative for "active now", and does the orchestrator expose a
   per-customer active-alarm listing with the needed latency?
3. **RBAC** — new scope (`store-dash:read`) or ride on existing read scopes?
   Store-manager users likely need a role that sees ONLY this module.
4. **Closed-hours schedule** for the leak heuristic — per-customer setting
   (where in `settings`?) or derived from an operating-hours registry that
   does not exist yet?
5. Which **verticals** pilot the MVP (draft lists restaurant examples —
   Steak House Prime) and therefore which device-profile→group mappings must
   exist on day one?

## 8. Future Possibilities

Draft §11, unchanged in intent: carbon footprint, utility-billing prediction,
occupancy & weather correlation, multi-store benchmarking, digital-twin mode,
equipment health score, AI assistant integration. Plus, from this design:
persisted/acknowledgeable insights with notification fan-out (Phase 2, §4.6),
tariff modeling beyond flat rates, and reuse of `StoreDashboardService` as the
data source for scheduled PDF/email reports.
