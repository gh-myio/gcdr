# RFC-0046 — Customer Consumption Goals API

**Contract document** shared by the GCDR backend and frontend (`GoalsPanel` / `openGoalsPanel`) teams.
This is the authoritative wire contract derived from [`RFC-0046-Customer-Consumption-Goals.md`](./RFC-0046-Customer-Consumption-Goals.md).
If this document and the RFC disagree, the RFC wins; open a PR to reconcile.

- **Status:** Design closed (DEC-1…DEC-7). Implementation contract — first backend step.
- **Base path:** `/api/v1`
- **Auth:** hybrid (`hybridAuthByMethod`) — JWT Bearer *or* customer API key (`X-API-Key: gcdr_cust_*`).
- **Scopes:** reads need `goals:read` (or `*:read`); writes need `goals:write`.
- **Audit:** every write emits `CUSTOMER_GOALS_UPDATED` `{ customerId, domain, year, version, actionLevel }` (no goal values in the audit row).

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
- A later coarser edit re-distributes over `derived = true` hours **only** by default. Operator-confirmed (`derived = false`) hours are preserved unless the operator forces a reset. This backs the panel's "suggested vs confirmed" UX.

### 1.4 Roll-up on read (coarser output ← hour rows)
Computed on read:
- `DAY` = `SUM(hours)` (SUM domains) or **weighted** `AVG(hours)` (AVERAGE domains).
- `MONTH` / `YEAR` = same reduction over their hours.
- **Weighted** = by the count of contributing hours (DEC-2) — a 31-day month does not weigh the same as February.
- Every node in the returned tree declares its `method`, so a temperature average is never mistaken for a sum.

### 1.5 Write semantics — `PUT` (replace) vs `PATCH` (merge) — DEC-5
- **`PUT` = replace** the whole `(year, domain)`. The payload *is* the year; buckets absent from the payload's scope are **removed**.
- **`PATCH` = merge** only the sent buckets; everything else is preserved. CSV import uses PATCH/merge semantics and is idempotent per bucket.

### 1.6 Versioning & optimistic concurrency — DEC-4
- `version` lives on the parent `(tenant, customer, domain, year)` and **increments on every successful change**.
- `PUT`/`PATCH`/`DELETE` MAY send the expected `version` (body field or `If-Match`-style). A mismatch → **`409 Conflict`** with the current `version` in the body (`error.currentVersion`).
- The front-end treats `409` as **reload-and-reapply**, not reload-and-discard.
- The hourly upsert, the version bump, and the history append run in **one transaction**.

### 1.7 History
`?fetchHistory=true` adds a `history` array of **≤100 entries, newest-first**. Each entry records the **level the operator acted on** (not the 8,760 underlying hours): `actionLevel`, `bucketRef`, `oldValue`, `newValue`, `distributed`, `hoursAffected`, `version`, `actor`, `changedAt`.

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

### Query discriminators (write + single-domain read)
| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `domain` | enum | yes | `ENERGY` \| `WATER` \| `TEMPERATURE`. |
| `year` | smallint | yes | e.g. `2026`. |
| `granularity` | enum | no (read only) | `year` \| `month` \| `day` \| `hour`. Default `month`. |
| `fetchHistory` | boolean | no (read only) | `true` → adds `history` (≤100, newest-first). Default `false`. |

### Validation rules (`400 VALIDATION_ERROR`)
- `domain` must be one of the three; `unit` (if echoed in a body) must match the domain.
- `year` plausible; `month` `1..12`; `day` valid for the month/year (**leap-year aware**); `hour` `0..23`.
- `value` `.finite()`. SUM domains require `value >= 0`; TEMPERATURE may be negative.
- `granularity` ∈ the four levels; `granularity=hour` is fully supported on read and write.

---

## 3. Endpoints

| # | Action | Method | Path | Scope |
| --- | --- | --- | --- | --- |
| 3.1 | List domains with goals | `GET` | `/customers/:id/goals` | `goals:read` |
| 3.2 | Get goals (derived tree) | `GET` | `/customers/:id/goals?domain=&year=&granularity=&fetchHistory=` | `goals:read` |
| 3.3 | Replace a year+domain | `PUT` | `/customers/:id/goals?domain=&year=` | `goals:write` |
| 3.4 | Merge buckets | `PATCH` | `/customers/:id/goals?domain=&year=` | `goals:write` |
| 3.5 | Import CSV (dry-run/confirm) | `POST` | `/customers/:id/goals/import?domain=&year=` | `goals:write` |
| 3.6 | Delete a year (or sub-bucket) | `DELETE` | `/customers/:id/goals?domain=&year=` | `goals:write` |

---

### 3.1 List domains with goals

```
GET /api/v1/customers/:id/goals
```
**Auth:** `goals:read`. **Query:** none. Returns a summary per domain that has any goals (years present, current version, unit). A customer with no goals returns an empty `domains` array.

**Request**
```bash
curl -X GET "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111"
```

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
The `tree` is derived from hours at the requested granularity. Each node declares its `method`. A `(domain, year)` with no goals returns `version: 0` and an empty `tree`.

**Request**
```bash
curl -X GET "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026&granularity=month&fetchHistory=true" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"
```

#### Response shape by granularity

`?granularity=year` — single annual node:
```json
{
  "customerId": "33333333-3333-3333-3333-333333333333",
  "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM",
  "year": 2026, "version": 7,
  "tree": { "annual": { "value": 1200000, "method": "SUM" } }
}
```

`?granularity=month` (default) — annual + 12 monthly nodes:
```json
{
  "customerId": "33333333-3333-3333-3333-333333333333",
  "domain": "ENERGY", "unit": "kWh", "aggregationMethod": "SUM",
  "year": 2026, "version": 7,
  "tree": {
    "annual": { "value": 1200000, "method": "SUM" },
    "monthly": {
      "01": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": false },
      "02": { "value": 100000, "method": "SUM", "sourceLevel": "YEAR",  "derived": true  },
      "03": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": false }
    }
  }
}
```
> `sourceLevel`/`derived` on an aggregated node reflect the **finest level the user set** within it: `derived:true` means every contributing hour was system-distributed; if any hour in the node was operator-confirmed (`derived:false`) the node reports `derived:false`.

`?granularity=day` — annual + monthly + daily nodes keyed `MM-DD`:
```json
{
  "tree": {
    "annual":  { "value": 1200000, "method": "SUM" },
    "monthly": { "03": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": false } },
    "daily": {
      "03-15": { "value": 3500.0, "method": "SUM", "sourceLevel": "DAY",   "derived": false },
      "03-16": { "value": 3225.8, "method": "SUM", "sourceLevel": "MONTH", "derived": true  }
    }
  }
}
```

`?granularity=hour` — full hourly tree, keyed `MM-DDThh` (24 hour leaves per day):
```json
{
  "tree": {
    "annual":  { "value": 1200000, "method": "SUM" },
    "monthly": { "03": { "value": 100000, "method": "SUM" } },
    "daily":   { "03-15": { "value": 3500.0, "method": "SUM" } },
    "hourly": {
      "03-15T00": { "value": 145.83, "method": "SUM", "sourceLevel": "DAY", "derived": true },
      "03-15T01": { "value": 145.83, "method": "SUM", "sourceLevel": "DAY", "derived": true }
    }
  }
}
```

#### TEMPERATURE example (`AVERAGE`, weighted, negative allowed)
```json
{
  "domain": "TEMPERATURE", "unit": "C", "aggregationMethod": "AVERAGE",
  "year": 2026, "version": 3,
  "tree": {
    "annual": { "value": 23.0, "method": "AVERAGE" },
    "monthly": {
      "01": { "value": 23.0, "method": "AVERAGE", "sourceLevel": "YEAR", "derived": true },
      "07": { "value": 25.0, "method": "AVERAGE", "sourceLevel": "MONTH", "derived": false }
    }
  }
}
```

#### With `fetchHistory=true`
Adds `history` (≤100, newest-first) alongside `tree`:
```json
{
  "version": 7,
  "tree": { "annual": { "value": 1200000, "method": "SUM" } },
  "history": [
    { "actionLevel": "DAY",   "bucketRef": "2026-03-15", "oldValue": 3225.8, "newValue": 3500.0,
      "distributed": true, "hoursAffected": 24,  "version": 7,
      "actor": "9a…", "changedAt": "2026-06-18T14:22:10.000Z" },
    { "actionLevel": "MONTH", "bucketRef": "2026-03",    "oldValue": null,   "newValue": 100000,
      "distributed": true, "hoursAffected": 744, "version": 6,
      "actor": "9a…", "changedAt": "2026-06-18T14:00:00.000Z" }
  ]
}
```

**Errors:** `400` (bad `domain`/`year`/`granularity`), `401`/`403` (auth/scope), `404` (customer not found).

---

### 3.3 Replace a year+domain (`PUT`)

```
PUT /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. **Semantics:** REPLACE — the payload is the whole year for that domain; buckets absent from the payload's scope are **removed**. System distributes each leaf down to hours.

**Body**
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `expectedVersion` | integer | no | Optimistic guard. Omit to force-write. `0` = "I expect no existing goal". |
| `granularity` | enum | yes | The level the values are expressed at (`year`/`month`/`day`/`hour`). |
| `values` | object | yes | Keyed by bucket at the chosen granularity (`"2026"`, `"03"`, `"03-15"`, `"03-15T08"`). |

**Request — set a YEAR total**
```bash
curl -X PUT "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{
    "expectedVersion": 6,
    "granularity": "month",
    "values": {
      "01": 100000, "02": 100000, "03": 100000, "04": 100000,
      "05": 100000, "06": 100000, "07": 100000, "08": 100000,
      "09": 100000, "10": 100000, "11": 100000, "12": 100000
    }
  }'
```

**200 OK** — returns the resulting derived tree at the request granularity plus the new `version`:
```json
{
  "success": true,
  "data": {
    "customerId": "33333333-3333-3333-3333-333333333333",
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

**Errors:** `400`, `401`/`403`, `404`, `409` (version conflict — §4), `422` (semantically valid JSON but un-persistable, e.g. monthly buckets do not cover/exceed the replaced year scope, or mixed-granularity conflict that cannot be resolved).

---

### 3.4 Merge buckets (`PATCH`)

```
PATCH /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. **Semantics:** MERGE — only the sent buckets are (re)distributed; all other buckets are preserved. Re-distribution overwrites `derived:true` hours only (operator-confirmed hours preserved).

**Body** — same shape as PUT, but `values` contains only the buckets to change. Buckets may mix granularity in one call (`granularity` then declares the *finest* level present; each key's depth determines its own level).

**Request — edit one DAY**
```bash
curl -X PATCH "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{
    "expectedVersion": 6,
    "granularity": "day",
    "values": { "03-15": 3500.0 }
  }'
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "customerId": "33333333-3333-3333-3333-333333333333",
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

**Errors:** `400`, `401`/`403`, `404`, `409` (§4), `422`.

---

### 3.5 Import CSV (dry-run / confirm)

```
POST /api/v1/customers/:id/goals/import?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. **Semantics:** merge by bucket (PATCH), idempotent per bucket. **Always dry-run first** — nothing is saved until an explicit confirm. Finest-granularity wins on conflicting lines; partial import is explicit (valid lines import, invalid lines are listed with a downloadable error report).

**Body**
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | enum | yes | `dryRun` (preview, nothing saved) or `confirm` (persist). |
| `csv` | string | yes (`dryRun`) | Raw CSV text. Header: `bucket,value` where `bucket` ∈ `2026` / `2026-03` / `2026-03-15` / `2026-03-15T08`. |
| `token` | string | yes (`confirm`) | The `previewToken` returned by a prior `dryRun`, binding confirm to a previewed result. |
| `expectedVersion` | integer | no (`confirm`) | Optimistic guard for the persist step. |

**Request — dry run**
```bash
curl -X POST "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals/import?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{
    "mode": "dryRun",
    "csv": "bucket,value\n2026-01,100000\n2026-02,100000\n2026-03-15,3500\n2026-13,999\n"
  }'
```

**200 OK — dry-run preview** (nothing persisted)
```json
{
  "success": true,
  "data": {
    "mode": "dryRun",
    "previewToken": "imp_5f2c…",
    "summary": { "linesTotal": 4, "ok": 3, "problems": 1,
      "willApply": { "monthly": 2, "daily": 1, "hourly": 0 } },
    "diagnostics": [
      { "line": 4, "bucket": "2026-13", "value": 999,
        "severity": "error", "code": "INVALID_MONTH",
        "message": "month must be 1..12" }
    ],
    "ghostTree": {
      "annual": { "value": 203500, "method": "SUM" },
      "monthly": { "01": { "value": 100000, "method": "SUM" }, "02": { "value": 100000, "method": "SUM" } },
      "daily": { "03-15": { "value": 3500, "method": "SUM" } }
    },
    "errorReportUrl": "/api/v1/customers/33333333-…/goals/import/imp_5f2c…/errors.csv"
  }
}
```

**Request — confirm**
```bash
curl -X POST "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals/import?domain=ENERGY&year=2026" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -d '{ "mode": "confirm", "token": "imp_5f2c…", "expectedVersion": 7 }'
```

**200 OK — confirmed**
```json
{
  "success": true,
  "data": {
    "mode": "confirm",
    "applied": { "monthly": 2, "daily": 1, "hourly": 0, "linesIgnored": 1 },
    "year": 2026, "version": 8,
    "logUrl": "/api/v1/customers/33333333-…/goals/import/imp_5f2c…/log.csv"
  }
}
```

**Errors:** `400` (malformed body/CSV header), `401`/`403`, `404`, `409` (version conflict on confirm — §4), `422` (e.g. all lines invalid, or `confirm` with an expired/unknown `token`).

---

### 3.6 Delete a year (or sub-bucket)

```
DELETE /api/v1/customers/:id/goals?domain=ENERGY&year=2026
```
**Auth:** `goals:write`. Removes the year for the domain. Optionally narrow the deletion to a sub-bucket. Logged + versioned (history entry with `newValue: null`).

**Query (in addition to `domain`, `year`)**
| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `bucket` | string | no | Narrow to a bucket: `03` (month) / `03-15` (day) / `03-15T08` (hour). Omit = delete the whole year. |
| `expectedVersion` | integer | no | Optimistic guard. |

**Request**
```bash
curl -X DELETE "http://localhost:3015/api/v1/customers/33333333-3333-3333-3333-333333333333/goals?domain=ENERGY&year=2026&bucket=03" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026"
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "customerId": "33333333-3333-3333-3333-333333333333",
    "domain": "ENERGY", "year": 2026,
    "deleted": { "bucket": "03", "hoursRemoved": 744, "actionLevel": "MONTH" },
    "version": 9
  }
}
```
Deleting the **whole year** (no `bucket`) removes the parent row and all its hours; subsequent `GET` for that `(domain, year)` returns `version: 0` and an empty `tree`. Such a full delete MAY return `204 No Content` (no body) when the client sends no `expectedVersion`; with a guard it returns `200` and the body above.

**Errors:** `400`, `401`/`403`, `404` (customer or `(domain, year)` not found), `409` (§4).

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
      "values.03": ["value must be a finite number >= 0 for SUM domains"],
      "values.02-30": ["day 30 is not valid for month 02 of year 2026"]
    }
  },
  "meta": { "requestId": "…", "timestamp": "2026-06-18T14:22:10.000Z" }
}
```

### 4.2 `401 / 403` — auth & scope
- `401 UNAUTHORIZED` — missing/invalid JWT or API key.
- `403 FORBIDDEN` — authenticated but lacks the scope (`goals:read` for reads, `goals:write` for writes) or hierarchy access to the customer.
```json
{
  "success": false,
  "error": { "message": "Missing required scope: goals:write", "code": "FORBIDDEN", "details": { "requiredScope": "goals:write" } },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

### 4.3 `404 Not Found` (`NOT_FOUND`)
```json
{
  "success": false,
  "error": { "message": "Customer not found", "code": "NOT_FOUND", "details": { "customerId": "33333333-…" } },
  "meta": { "requestId": "…", "timestamp": "…" }
}
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

### 4.5 `422 Unprocessable Entity` (`UNPROCESSABLE_ENTITY`)
Syntactically valid request that cannot be applied as a goal:
```json
{
  "success": false,
  "error": {
    "message": "Import confirm token expired or unknown",
    "code": "UNPROCESSABLE_ENTITY",
    "details": { "token": "imp_5f2c…", "reason": "EXPIRED" }
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```
Other `422` cases: every CSV line invalid; a PUT whose buckets cannot tile the replaced year scope; unresolvable mixed-granularity conflict.

---

## 5. Worked example, end-to-end

A concrete trace of the author's case: an operator sets a MONTH energy value, the system distributes it to that month's hours, then edits one DAY producing a history entry.

**Start:** customer `33333333-…` has no ENERGY 2026 goal. `GET …?domain=ENERGY&year=2026` → `version: 0`, empty `tree`.

### Step 1 — operator sets MONTH (March) = 100,000 kWh
```bash
curl -X PATCH ".../customers/33333333-…/goals?domain=ENERGY&year=2026" \
  -H "X-API-Key: gcdr_cust_test_bundle_key_myio2026" \
  -H "Content-Type: application/json" \
  -d '{ "granularity": "month", "values": { "03": 100000 } }'
```
- March 2026 has 31 days → **744 hours**. SUM domain → even split: `100000 / 744 = 134.4086… kWh/hour`.
- 744 hour rows written with `sourceLevel: "MONTH", derived: true`.
- `version` 0 → **1**. History row appended:
  `{ actionLevel: "MONTH", bucketRef: "2026-03", oldValue: null, newValue: 100000, distributed: true, hoursAffected: 744, version: 1 }`.

**Response `200`:**
```json
{ "year": 2026, "version": 1,
  "tree": { "annual": { "value": 100000, "method": "SUM" },
            "monthly": { "03": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": true } } },
  "distribution": { "hoursWritten": 744, "actionLevel": "MONTH" } }
```

### Step 2 — GET month shows it (roll-up on read)
```bash
curl ".../customers/33333333-…/goals?domain=ENERGY&year=2026&granularity=month" -H "X-API-Key: …"
```
```json
{ "year": 2026, "version": 1,
  "tree": { "annual": { "value": 100000, "method": "SUM" },
            "monthly": { "03": { "value": 100000, "method": "SUM", "sourceLevel": "MONTH", "derived": true } } } }
```
> `SUM(744 hours × 134.4086…) = 100000` — the roll-up reproduces the entered month total.

### Step 3 — operator edits one DAY (2026-03-15) = 3,500 kWh
```bash
curl -X PATCH ".../customers/33333333-…/goals?domain=ENERGY&year=2026" \
  -H "X-API-Key: …" -H "Content-Type: application/json" \
  -d '{ "expectedVersion": 1, "granularity": "day", "values": { "03-15": 3500 } }'
```
- 2026-03-15 has **24 hours**. SUM domain → `3500 / 24 = 145.8333… kWh/hour`.
- 24 hour rows for `03-15` rewritten with `sourceLevel: "DAY", derived: false` (operator-set the day; its hours are now confirmed, no longer "suggested").
- The other 720 March hours (`derived: true`) are untouched.
- `version` 1 → **2**. History row appended — the author's exact case:
```json
{ "actionLevel": "DAY", "bucketRef": "2026-03-15",
  "oldValue": 3225.806, "newValue": 3500.0,
  "distributed": true, "hoursAffected": 24, "version": 2 }
```
(`oldValue ≈ 3225.806` = the previous day roll-up: `24 × 134.4086…`.)

**New March total** = `720 × 134.4086… + 3500 = 96774.19… + 3500 = 100274.19… kWh`.

### Step 4 — GET day confirms the edit
```bash
curl ".../customers/33333333-…/goals?domain=ENERGY&year=2026&granularity=day" -H "X-API-Key: …"
```
```json
{ "year": 2026, "version": 2,
  "tree": {
    "annual":  { "value": 100274.19, "method": "SUM" },
    "monthly": { "03": { "value": 100274.19, "method": "SUM", "sourceLevel": "DAY", "derived": false } },
    "daily": {
      "03-15": { "value": 3500.0,    "method": "SUM", "sourceLevel": "DAY",   "derived": false },
      "03-14": { "value": 3225.806,  "method": "SUM", "sourceLevel": "MONTH", "derived": true  }
    }
  } }
```

### Step 5 — history (newest first)
```bash
curl ".../customers/33333333-…/goals?domain=ENERGY&year=2026&granularity=month&fetchHistory=true" -H "X-API-Key: …"
```
```json
{ "version": 2,
  "history": [
    { "actionLevel": "DAY",   "bucketRef": "2026-03-15", "oldValue": 3225.806, "newValue": 3500.0,
      "distributed": true, "hoursAffected": 24,  "version": 2 },
    { "actionLevel": "MONTH", "bucketRef": "2026-03",    "oldValue": null,     "newValue": 100000,
      "distributed": true, "hoursAffected": 744, "version": 1 }
  ] }
```

---

## 6. Quick reference — invariants for the frontend adapter

- Storage is hourly; you never send hours unless you mean to — coarse buckets are distributed for you.
- Read `method` on every node; render AVERAGE (temperature) and SUM (energy/water) differently.
- `derived:true` = system-suggested (safe to overwrite on coarse edits); `derived:false` = operator-confirmed (preserved).
- `PUT` wipes the year to exactly your payload; `PATCH` only touches what you send.
- On `409`, read `error.currentVersion`, re-`GET`, reapply the operator's intended change against the new version — do not silently discard.
- `fetchHistory=true` is capped at 100 newest-first entries; paginate by time client-side if you need more (no server cursor in this version).

---

**Source of truth:** [`RFC-0046-Customer-Consumption-Goals.md`](./RFC-0046-Customer-Consumption-Goals.md) · **Last updated:** 2026-06-18
