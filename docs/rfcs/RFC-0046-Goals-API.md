# RFC-0046 — Customer Consumption Goals API

**Contract document** shared by the GCDR backend and frontend teams.
This is the authoritative wire contract derived from [`RFC-0046-Customer-Consumption-Goals.md`](./RFC-0046-Customer-Consumption-Goals.md), **kept in sync with the implementation** (`src/controllers/consumption-goals.controller.ts`, `src/dto/request/GoalsDTO.ts`, `src/services/consumptionGoalService.ts`). If this document and the code disagree, the code wins; open a PR to reconcile.

- **Status:** **Implemented** (branch `feat/rfc-0046-consumption-goals`, not yet merged/in prod).
- **Base path:** `/api/v1`
- **Auth:** hybrid (`hybridAuthByMethod`) — JWT Bearer *or* customer API key (`X-API-Key: gcdr_cust_*`).
- **Scopes:** reads need `goals:read` (or `*:read`); writes need `goals:write`.
- **Audit:** every change appends a per-goal `consumption_goal_history` row (one per operation — see §1.7). A global `CUSTOMER_GOALS_UPDATED` event is designed but **not yet emitted**.
- **Last updated:** 2026-06-19

---

## 1. Concepts consumers MUST understand

These rules govern every request/response. Read this before the endpoint reference.

### 1.1 Always-hourly canonical storage
The **hour is the only stored grain**. A fully-specified year is up to **8,760 hour rows** per `(customer, domain, year)`. The `granularity` an operator picks is an **input mode**, not a storage shape; coarser views (`year`/`month`/`day`) are **derived on read**, never materialised.

### 1.2 Aggregation method is FIXED per domain
The method is a property of the domain, not an operator choice and not stored on each hour row:

| Domain | `unit` | `aggregationMethod` | Distribution on write | Roll-up on read | Negative values |
| --- | --- | --- | --- | --- | --- |
| `ENERGY` | `kWh` | `SUM` | even split: `hourValue = parentValue / hoursInScope` | `SUM(hours)` | rejected (`>= 0`) |
| `WATER` | `m3` | `SUM` | even split | `SUM(hours)` | rejected (`>= 0`) |
| `TEMPERATURE` | `C` | `AVERAGE` | **copy** parent to each hour | **weighted** `AVG(hours)` | allowed |

`total = 25` on a TEMPERATURE goal reads as "25 °C", not "25 units summed".

### 1.3 Distribution on write (coarser input → hour rows)
- **`SUM` domains** — parent value is split **evenly** across the hours in scope (`parent / hoursInScope`). Example: a March total ÷ 744 hours (31 days × 24).
- **`AVERAGE` domains** — parent value is **copied** to each hour, so the weighted average back up equals the parent.
- Each generated hour row carries:
  - `sourceLevel` — the level the operator actually set (`YEAR | MONTH | DAY | HOUR`).
  - `derived` — `true` when system-distributed, `false` when the operator set that exact hour.
- A later coarser edit re-distributes over `derived = true` hours **only** by default. Operator-confirmed (`derived = false`) hours are preserved unless the operator forces a reset. This backs the "suggested vs confirmed" UX.

### 1.4 Roll-up on read (coarser output ← hour rows)
Computed on read:
- `DAY` = `SUM(hours)` (SUM domains) or **weighted** `AVG(hours)` (AVERAGE domains).
- `MONTH` / `YEAR` = same reduction over their hours.
- **Weighted** = by the count of contributing hours (DEC-2) — a 31-day month does not weigh the same as February.
- Every node in the returned tree declares its `method`, so a temperature average is never mistaken for a sum.

### 1.5 Write semantics — `PUT` (replace) vs `PATCH` (merge) — DEC-5
- **`PUT` = replace** the whole `(year, domain)`. The body is a **nested tree** (`{ annual?, monthly{ daily{ hourly }} }`); buckets absent from the payload's scope are **removed**.
- **`PATCH` = merge** a sparse **`buckets[]`** list — only the named buckets are (re)distributed; everything else is preserved. Re-distribution overwrites `derived:true` hours only.
- **Import** uses PATCH/merge semantics over a CSV and is **stateless**: post the CSV with `?dryRun=true` to preview, then re-post the *same* CSV with `?dryRun=false` to persist. There is **no `previewToken`**.

### 1.6 Versioning & optimistic concurrency — DEC-4
- `version` lives on the parent `(tenant, customer, domain, year)` and **increments on every successful change**.
- `PUT`/`PATCH`/`DELETE`/import-confirm MAY send `expectedVersion` in the body. A mismatch → **`409 Conflict`** with the current version in the body (`error.currentVersion`, also `error.details.currentVersion`).
- The front-end treats `409` as **reload-and-reapply**, not reload-and-discard.
- The hourly upsert, the version bump, and the history append run in **one transaction**.

### 1.7 History — one row per operation
`?fetchHistory=true` adds a `history` array of **≤100 entries, newest-first**. History is **one row per operation** (a mutation = a version = one entry), *not* one per bucket. Each entry:

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | enum | `IMPORT` \| `REPLACE` \| `MERGE` \| `DELETE` \| `EDIT` — the operation. (`REPLACE`/`MERGE` are operator edits.) |
| `actionLevel` | enum | `YEAR \| MONTH \| DAY \| HOUR` — the coarsest level the operation touched. |
| `bucketRef` | string | Representative ref (the single bucket's ref, else the year). |
| `oldValue` | number\|null | Single-bucket previous value (null on create / multi-bucket op). |
| `newValue` | number\|null | Single-bucket new value (null on delete / multi-bucket op). |
| `bucketCount` | number | How many operator buckets the operation carried. |
| `details` | array | Compact `[{ ref, value }]` sample (server-capped at 50) for the breakdown. |
| `distributed` | boolean | `true` = system spread to hours. |
| `hoursAffected` | number | Total hour rows written by the operation. |
| `version` | number | The version this operation produced. |
| `actor` | string\|null | User/actor id, or null for system/seed. |
| `changedAt` | string | ISO-8601 timestamp. |

> A 120-line hourly import becomes **one** `IMPORT` entry with `bucketCount: 120`, not 120 rows — so a single import never floods the ≤100-row window. Deleting a *whole year* cascades away the goal and its history (no entry); only sub-bucket deletes append a `DELETE` row.

### 1.8 Response & error envelope
Success and error bodies follow the standard GCDR envelope.

Success:
```json
{ "success": true, "data": { /* ... */ }, "meta": { "requestId": "…", "timestamp": "…" } }
```
Error:
```json
{ "success": false, "error": { "message": "…", "code": "…", "details": { } }, "meta": { "requestId": "…", "timestamp": "…" } }
```
In examples below the `meta` wrapper is omitted for brevity; only `data` (or `error`) contents are shown unless noted.

---

## 2. Common parameters

### Path
| Param | Type | Description |
| --- | --- | --- |
| `id` | uuid | Customer id. Hierarchy access (`SELF`/`SUBTREE`/`TENANT`) is honoured. |

### Query discriminators
| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `domain` | enum | yes | `ENERGY` \| `WATER` \| `TEMPERATURE`. |
| `year` | smallint | yes | `2000..2100`. |
| `granularity` | enum | no (read only) | `year` \| `month` \| `day` \| `hour`. Default `month`. |
| `fetchHistory` | boolean | no (read only) | `true` → adds `history` (≤100, newest-first). Default `false`. |
| `dryRun` | boolean | no (import only) | `true` (default) previews; `false` persists. |

### Validation rules (`400 VALIDATION_ERROR`)
- `domain` must be one of the three; `year` `2000..2100`; `month` `1..12`; `day` valid for the month/year (**leap-year aware**); `hour` `0..23`.
- `value` `.finite()`. SUM domains require `value >= 0`; TEMPERATURE may be negative.
- Bucket `ref` must match its `level` (`YEAR` `2026`, `MONTH` `2026-03`, `DAY` `2026-03-15`, `HOUR` `2026-03-15T08`); a merge bucket's ref-year must equal the query `year`.
- PUT body must define at least an `annual` value or one month; PATCH `buckets[]` must be non-empty (≤ 8760).

---

## 3. Endpoints

| # | Action | Method | Path | Scope |
| --- | --- | --- | --- | --- |
| 3.1 | List domains with goals | `GET` | `/customers/:id/goals` | `goals:read` |
| 3.2 | Get goals (derived tree) | `GET` | `/customers/:id/goals?domain=&year=&granularity=&fetchHistory=` | `goals:read` |
| 3.3 | Replace a year+domain | `PUT` | `/customers/:id/goals?domain=&year=` | `goals:write` |
| 3.4 | Merge buckets | `PATCH` | `/customers/:id/goals?domain=&year=` | `goals:write` |
| 3.5 | Import CSV (dry-run/persist) | `POST` | `/customers/:id/goals/import?domain=&year=&dryRun=` | `goals:write` |
| 3.6 | Delete a year (or sub-bucket) | `DELETE` | `/customers/:id/goals?domain=&year=` | `goals:write` |

---

### 3.1 List domains with goals

```
GET /api/v1/customers/:id/goals
```
**Auth:** `goals:read`. **Query:** none. Returns a summary per domain that has any goals (years present, current version, unit). A customer with no goals returns an empty `domains` array.

**200 OK**
```json
{
  "success": true,
  "data": {
    "customerId": "33333333-3333-3333-3333-333333333333",
    "domains": [
      { "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM", "years": [
          { "year": 2026, "version": 7 },
          { "year": 2025, "version": 2 }
        ] },
      { "domain": "WATER", "unit": "m3", "aggregationMethod": "SUM", "years": [
          { "year": 2026, "version": 1 }
        ] },
      { "domain": "TEMPERATURE", "unit": "C", "aggregationMethod": "AVERAGE", "years": [] }
    ]
  }
}
```

---

### 3.2 Get goals (derived tree)

```
GET /api/v1/customers/:id/goals?domain=ENERGY&year=2026&granularity=month
```
**Auth:** `goals:read`.
**Query:** `domain` (req), `year` (req), `granularity` (`year|month|day|hour`, default `month`), `fetchHistory` (default `false`).
The `tree` is derived from hours at the requested granularity (cumulative: `day` also returns `monthly`+`annual`). Each node declares its `method`. A `(domain, year)` with no goals returns `version: 0` and an empty `tree` (`{}`).

**Request**
```bash
curl -X GET "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026&granularity=month&fetchHistory=true" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"
```

#### Response shape by granularity

`?granularity=year` — single annual node:
```json
{ "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM",
  "year": 2026, "version": 7,
  "tree": { "annual": { "value": 1200000, "method": "SUM" } } }
```

`?granularity=month` (default) — annual + monthly nodes keyed `"01".."12"`:
```json
{ "year": 2026, "version": 7,
  "tree": {
    "annual": { "value": 1200000, "method": "SUM" },
    "monthly": {
      "01": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": false },
      "02": { "value": 100000, "method": "SUM", "sourceLevel": "YEAR",  "derived": true  }
    } } }
```
> `sourceLevel`/`derived` on an aggregated node reflect the **finest level the user set** within it: `derived:true` means every contributing hour was system-distributed; if any hour was operator-confirmed (`derived:false`) the node reports `derived:false`.

`?granularity=day` — + daily nodes keyed `MM-DD`; `?granularity=hour` — + hourly nodes keyed `MM-DDThh` (24 leaves/day).

#### With `fetchHistory=true`
Adds `history` (≤100, newest-first, **one row per operation** — see §1.7):
```json
{
  "version": 7,
  "tree": { "annual": { "value": 1200000, "method": "SUM" } },
  "history": [
    { "source": "MERGE", "actionLevel": "DAY", "bucketRef": "2026-03-15",
      "oldValue": null, "newValue": 3500.0, "bucketCount": 1,
      "details": [ { "ref": "2026-03-15", "value": 3500.0 } ],
      "distributed": true, "hoursAffected": 24, "version": 7,
      "actor": "9a…", "changedAt": "2026-06-19T14:22:10.000Z" },
    { "source": "IMPORT", "actionLevel": "HOUR", "bucketRef": "2026",
      "oldValue": null, "newValue": null, "bucketCount": 120,
      "details": [ { "ref": "2026-01-15T08", "value": 500 }, "…up to 50…" ],
      "distributed": true, "hoursAffected": 120, "version": 6,
      "actor": "9a…", "changedAt": "2026-06-19T14:00:00.000Z" }
  ]
}
```

**Errors:** `400` (bad `domain`/`year`/`granularity`), `401`/`403` (auth/scope), `404` (customer not found).

---

### 3.3 Replace a year+domain (`PUT`)

```
PUT /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. **Semantics:** REPLACE — the body is the whole year for that domain; buckets absent from the payload's scope are **removed**. The system distributes each leaf down to hours.

**Body — a nested tree** (mirrors the read tree). At least `annual` or one `monthly` entry is required.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `annual` | `{ value, sourceLevel? }` | no | Whole-year leaf. |
| `monthly` | object | no | Keyed `"01".."12"`; each value is a **month node**. |
| `expectedVersion` | integer (>0) | no | Optimistic guard. Omit on first write. |

A **month node** is `{ value, sourceLevel?, daily? }`; a **day node** is `{ value, sourceLevel?, hourly? }`; an **hour node** is `{ value, sourceLevel? }`. Day keys `"01".."31"` (validated against the month/year), hour keys `"00".."23"`. `sourceLevel` is optional — inferred from depth when omitted.

**Request — set 12 monthly totals**
```bash
curl -X PUT "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{
    "expectedVersion": 6,
    "monthly": {
      "01": { "value": 100000 }, "02": { "value": 100000 }, "03": { "value": 100000 },
      "04": { "value": 100000 }, "05": { "value": 100000 }, "06": { "value": 100000 },
      "07": { "value": 100000 }, "08": { "value": 100000 }, "09": { "value": 100000 },
      "10": { "value": 100000 }, "11": { "value": 100000 }, "12": { "value": 100000 }
    }
  }'
```

**Request — a month with a confirmed hour inside it (deep nesting)**
```jsonc
{
  "monthly": {
    "03": { "value": 100000, "daily": {
      "15": { "value": 3500, "hourly": { "08": { "value": 500 } } }
    } }
  }
}
```

**200 OK** — the derived tree at the action granularity + the new `version` + `distribution`:
```json
{
  "success": true,
  "data": {
    "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM",
    "year": 2026, "version": 7,
    "tree": {
      "annual": { "value": 1200000, "method": "SUM" },
      "monthly": { "01": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": true } }
    },
    "distribution": { "hoursWritten": 8760, "actionLevel": "MONTH" }
  }
}
```

**Errors:** `400` (validation — bad domain/value/calendar, or body defines neither annual nor a month), `401`/`403`, `404`, `409` (version conflict — §4.4).

---

### 3.4 Merge buckets (`PATCH`)

```
PATCH /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. **Semantics:** MERGE — only the listed buckets are (re)distributed; all other buckets are preserved. Re-distribution overwrites `derived:true` hours only.

**Body**
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `buckets` | array | yes | 1..8760 entries of `{ level, ref, value }`. |
| `expectedVersion` | integer (>0) | no | Optimistic guard. |

Each bucket: `level` ∈ `YEAR\|MONTH\|DAY\|HOUR`; `ref` year-aware and matching the level (`"2026"`, `"2026-03"`, `"2026-03-15"`, `"2026-03-15T08"`); `value` finite (sign per domain). Buckets may **mix levels** in one call; the ref-year must equal the query `year`.

**Request — edit one DAY + one HOUR**
```bash
curl -X PATCH "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{
    "expectedVersion": 6,
    "buckets": [
      { "level": "DAY",  "ref": "2026-03-15",    "value": 3500.0 },
      { "level": "HOUR", "ref": "2026-03-15T08", "value": 500 }
    ]
  }'
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM",
    "year": 2026, "version": 7,
    "tree": {
      "annual": { "value": 1200256.0, "method": "SUM" },
      "monthly": { "03": { "value": 100256.0, "method": "SUM", "sourceLevel": "DAY", "derived": false } },
      "daily":   { "03-15": { "value": 3500.0, "method": "SUM", "sourceLevel": "DAY", "derived": false } }
    },
    "distribution": { "hoursWritten": 24, "actionLevel": "DAY" }
  }
}
```

**Errors:** `400`, `401`/`403`, `404`, `409` (§4.4).

---

### 3.5 Import CSV (stateless dry-run / persist)

```
POST /api/v1/customers/:id/goals/import?domain=ENERGY&year=2026&dryRun=true
```
**Auth:** `goals:write`. **Semantics:** merge by bucket (PATCH), idempotent per bucket. **Stateless** — there is no `previewToken`/`mode`. To apply a previewed import, **re-post the identical body** with `dryRun=false`.

**Query:** `domain`, `year`, `dryRun` (default `true`).

**Body**
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `csv` | string | yes | Raw CSV text. Header `bucket,value`; one line per bucket. `bucket` ∈ `2026` / `2026-03` / `2026-03-15` / `2026-03-15T08`. Separator `,` (pipe `\|` also accepted). Finest granularity wins on conflicts. |
| `expectedVersion` | integer (>0) | no | Optimistic guard (applied on `dryRun=false`). |

**Request — dry run (preview, nothing saved)**
```bash
curl -X POST "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals/import?domain=ENERGY&year=2026&dryRun=true" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{ "csv": "bucket,value\n2026-01,100000\n2026-02,100000\n2026-03-15,3500\n2026-13,999\n" }'
```

**200 OK — dry-run preview**
```json
{
  "success": true,
  "data": {
    "dryRun": true,
    "preview": {
      "annual": { "value": 203500, "method": "SUM" },
      "monthly": { "01": { "value": 100000, "method": "SUM" }, "02": { "value": 100000, "method": "SUM" } },
      "daily": { "03-15": { "value": 3500, "method": "SUM" } }
    },
    "diagnostics": [
      { "line": 4, "bucket": "2026-13", "value": 999, "reason": "month must be 1..12" }
    ],
    "okCount": 3,
    "errorCount": 1
  }
}
```

**Request — persist (re-post the same csv)**
```bash
curl -X POST "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals/import?domain=ENERGY&year=2026&dryRun=false" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{ "csv": "bucket,value\n2026-01,100000\n2026-02,100000\n2026-03-15,3500\n2026-13,999\n", "expectedVersion": 7 }'
```

**200 OK — persisted** (adds `version` + a per-bucket `log`; one `IMPORT` history row is appended)
```json
{
  "success": true,
  "data": {
    "dryRun": false,
    "preview": { "annual": { "value": 203500, "method": "SUM" } },
    "diagnostics": [ { "line": 4, "bucket": "2026-13", "value": 999, "reason": "month must be 1..12" } ],
    "okCount": 3,
    "errorCount": 1,
    "version": 8,
    "log": [ "applied MONTH 2026-01 = 100000", "applied MONTH 2026-02 = 100000", "applied DAY 2026-03-15 = 3500" ]
  }
}
```

**Errors:** `400` (malformed body / empty CSV / **every line invalid** — "Import has no valid lines to apply"), `401`/`403`, `404`, `409` (version conflict on persist — §4.4). Partial import is explicit: valid lines apply, invalid lines are returned in `diagnostics`.

---

### 3.6 Delete a year (or sub-bucket)

```
DELETE /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. Removes the year for the domain, or narrows to a sub-bucket. A sub-bucket delete is logged + versioned (a `DELETE` history row with `newValue: null`); a **whole-year** delete cascades the parent and all hours **and its history** (no history row remains).

**Body** (optional)
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `bucket` | `{ level, ref }` | no | Narrow to a bucket: `{ "level": "MONTH", "ref": "2026-03" }` (or DAY/HOUR/YEAR). Omit = delete the whole year. |
| `expectedVersion` | integer (>0) | no | Optimistic guard. |

**Request — delete one month**
```bash
curl -X DELETE "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{ "bucket": { "level": "MONTH", "ref": "2026-03" }, "expectedVersion": 8 }'
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "customerId": "33333333-3333-3333-3333-333333333333",
    "domain": "ENERGY", "year": 2026,
    "deleted": { "bucket": "2026-03", "hoursRemoved": 744, "actionLevel": "MONTH" },
    "version": 9
  }
}
```

Deleting the **whole year** (no `bucket`) removes the parent row and all its hours; a subsequent `GET` returns `version: 0` and an empty `tree`. A full-year delete with **no `expectedVersion`** returns **`204 No Content`** (no body); with a guard it returns `200` and `deleted.bucket: null, version: 0`.

**Errors:** `400`, `401`/`403`, `404` (customer or `(domain, year)` not found), `409` (§4.4).

---

## 4. Error responses

All errors use the standard envelope: `{ success: false, error: { message, code, details }, meta }`.

### 4.1 `400 Bad Request` — validation (`VALIDATION_ERROR`)
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "details": {
      "domain": ["Invalid enum value. Expected 'ENERGY' | 'WATER' | 'TEMPERATURE'"],
      "monthly.03.value": ["value must be a finite number >= 0 for energy/water domains"],
      "monthly.02.daily.30": ["day 30 is invalid for 2026-02 (max 28)"]
    }
  },
  "meta": { "requestId": "…", "timestamp": "2026-06-19T14:22:10.000Z" }
}
```
Semantic failures that other APIs might return as `422` (e.g. a PUT body with neither annual nor a month, an import where every line is invalid) surface here as `400 VALIDATION_ERROR` in this implementation.

### 4.2 `401 / 403` — auth & scope
- `401 UNAUTHORIZED` — missing/invalid JWT or API key.
- `403 FORBIDDEN` — authenticated but lacks the scope (`goals:read`/`goals:write`) or hierarchy access to the customer.

### 4.3 `404 Not Found` (`NOT_FOUND`)
```json
{ "success": false,
  "error": { "message": "Customer not found", "code": "NOT_FOUND", "details": { "customerId": "33333333-…" } },
  "meta": { "requestId": "…", "timestamp": "…" } }
```

### 4.4 `409 Conflict` — optimistic version mismatch (`VERSION_CONFLICT`)
Returned when `expectedVersion` does not match the stored `version`. **`currentVersion` is in the body** so the front-end can reload-and-reapply.
```json
{
  "success": false,
  "error": {
    "message": "Version conflict: goal was modified by another change",
    "code": "VERSION_CONFLICT",
    "currentVersion": 9,
    "details": { "expectedVersion": 6, "currentVersion": 9, "domain": "ENERGY", "year": 2026 }
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

---

## 5. Worked example, end-to-end

An operator sets a MONTH energy value, the system distributes it to that month's hours, then edits one DAY — producing two `consumption_goal_history` operation rows.

**Start:** customer `33333333-…` has no ENERGY 2026 goal. `GET …?domain=ENERGY&year=2026` → `version: 0`, empty `tree`.

### Step 1 — operator sets MONTH (March) = 100,000 kWh (PATCH)
```bash
curl -X PATCH ".../goals?domain=ENERGY&year=2026" -H "X-API-Key: …" -H "Content-Type: application/json" \
  -d '{ "buckets": [ { "level": "MONTH", "ref": "2026-03", "value": 100000 } ] }'
```
- March 2026 has 31 days → **744 hours**. SUM → even split: `100000 / 744 = 134.4086… kWh/hour`.
- 744 hour rows written `sourceLevel: "MONTH", derived: true`.
- `version` 0 → **1**. History row: `{ source: "MERGE", actionLevel: "MONTH", bucketRef: "2026-03", newValue: 100000, bucketCount: 1, hoursAffected: 744, version: 1 }`.

### Step 2 — GET month shows it (roll-up on read)
`SUM(744 × 134.4086…) = 100000` — the roll-up reproduces the entered month total.

### Step 3 — operator edits one DAY (2026-03-15) = 3,500 kWh (PATCH)
```bash
curl -X PATCH ".../goals?domain=ENERGY&year=2026" -H "X-API-Key: …" -H "Content-Type: application/json" \
  -d '{ "expectedVersion": 1, "buckets": [ { "level": "DAY", "ref": "2026-03-15", "value": 3500 } ] }'
```
- 2026-03-15 has **24 hours** → `3500 / 24 = 145.8333… kWh/hour`, written `sourceLevel: "DAY", derived: false` (operator-confirmed).
- The other 720 March hours (`derived: true`) are untouched.
- `version` 1 → **2**. History row: `{ source: "MERGE", actionLevel: "DAY", bucketRef: "2026-03-15", newValue: 3500, bucketCount: 1, hoursAffected: 24, version: 2 }`.

### Step 4 — history (newest first)
```bash
curl ".../goals?domain=ENERGY&year=2026&granularity=month&fetchHistory=true" -H "X-API-Key: …"
```
```json
{ "version": 2,
  "history": [
    { "source": "MERGE", "actionLevel": "DAY",   "bucketRef": "2026-03-15", "newValue": 3500,   "bucketCount": 1, "details": [{ "ref": "2026-03-15", "value": 3500 }],   "distributed": true, "hoursAffected": 24,  "version": 2 },
    { "source": "MERGE", "actionLevel": "MONTH", "bucketRef": "2026-03",    "newValue": 100000, "bucketCount": 1, "details": [{ "ref": "2026-03",    "value": 100000 }], "distributed": true, "hoursAffected": 744, "version": 1 }
  ] }
```

---

## 6. Quick reference — invariants for the frontend adapter

- Storage is hourly; you never send hours unless you mean to — coarse buckets are distributed for you.
- **PUT** body is a **nested tree** (`annual`/`monthly{daily{hourly}}`); **PATCH** body is a flat **`buckets[]`** (`{level, ref, value}`).
- Import is **stateless**: post with `?dryRun=true` to preview, re-post the same `csv` with `?dryRun=false` to persist. No previewToken.
- Read `method` on every node; render AVERAGE (temperature) and SUM (energy/water) differently.
- `derived:true` = system-suggested (safe to overwrite on coarse edits); `derived:false` = operator-confirmed (preserved).
- On `409`, read `error.currentVersion`, re-`GET`, reapply against the new version — do not silently discard.
- `fetchHistory=true` is capped at 100 newest-first **operation** entries (one per version); paginate by time client-side if you need more (no server cursor in this version).

---

**Source of truth:** [`RFC-0046-Customer-Consumption-Goals.md`](./RFC-0046-Customer-Consumption-Goals.md) + the implementation. · **Last updated:** 2026-06-19
