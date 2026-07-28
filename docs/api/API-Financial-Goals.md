# Financial Goals & Customer Tariffs — consumer API guide

> Audience: teams integrating with GCDR (dashboards, Node-RED, the alarm
> orchestrator, import scripts) that need to price consumption in **R$** — read
> or write **hourly tariffs**, see a goal **in money**, or set a **budget**.
>
> Context: **RFC-0054** adds three orthogonal, optional resources on top of the
> RFC-0046 goals domain — an hourly **tariff** per customer, a read-only **money
> overlay** on quantity goals, and native **CURRENCY (budget) goals**. The formal
> spec lives in `docs/openapi.yaml` and the Swagger — local
> `http://localhost:3015/docs`, prod `https://gcdr-api.a.myio-bas.com/docs/`.
> See also `GOALS-API-GUIDE.md` (the quantity-goals model this builds on).

---

## 1. Conceptual model

Three independent pieces, each optional:

1. **The device carries its tariff category.** Every device may be classified as
   `COMMON_AREA` or `SPECIFIC` (`devices.tariffCategory`). It is **explicit,
   never inferred**. A device with no category is **excluded** from any money sum
   and reported in `uncategorizedDevices`.

2. **A tariff is an hourly price, edited like a goal.** A tariff is identified by
   **(customer × domain × category × year)** — e.g. `Moxuara × ENERGY × SPECIFIC
   × 2026`. Like goals, storage is **always hourly** (8760 buckets/year, 8784 in
   a leap year); coarser writes (year/month/day) are distributed to the hours and
   the finest level wins. Prices are **R$ per unit** (`R$/kWh` for ENERGY,
   `R$/m³` for WATER), model `FLAT` in v1.

3. **Money on a goal is derived, and honest.** `GET /goals?…&withMoney=true`
   overlays R$ onto a **device-granular** quantity goal by resolving each
   device's category → tariff → price at the hour grain. Partial coverage returns
   the **covered sum** with `coverageComplete:false` and the full
   `uncategorizedDevices` list — never a silent blend, never `R$ 0` for the
   missing ones.

4. **A budget is a goal with `measure = CURRENCY`.** The same goal endpoints,
   with `measure=CURRENCY`, store an R$/year (or R$/month) budget. `measure`
   joins the goal identity, so a customer can hold a **kWh goal AND a R$ budget**
   for the same `(domain, year)`. On a `withMoney` read the projection is
   compared against this native budget (`budget` block).

> **All money/price fields are decimal strings** (never JSON numbers), e.g.
> `"2.000000"`. Arrays are `[]` when empty (never omitted). A block that does not
> apply is `null`/absent per the rules below.

## 2. Authentication & limits

- **Tariffs** (`/customers/:id/tariffs`): hybrid by method — **GET** needs scope
  `tariffs:read`; **PUT / PATCH / DELETE** need `tariffs:write`. Accepts **JWT
  Bearer** or **Customer API Key** (`X-API-Key: gcdr_cust_…`, reach per
  `hierarchyAccess` — see `API-KEYS-CONSUMERS.md`). A JWT user also needs the
  RBAC permission `tariffs.tariff.update` for writes.
- **Goals money / CURRENCY** (`/customers/:id/goals`): same auth as goals —
  `goals:read` / `goals:write` (see `GOALS-API-GUIDE.md`).
- **Optimistic concurrency**: every read and write returns `version` in the body
  and as a strong `ETag: "<version>"`. Writes accept a guard via **either**
  `If-Match: "<version>"` **or** body `expectedVersion`; if both are sent they
  must be equal (else `400 VERSION_GUARD_MISMATCH`). A stale guard →
  `409 *_VERSION_CONFLICT` carrying `currentVersion`.

## 3. Endpoints

Base path: `/api/v1`. Customer-scoped.

### Tariffs

| Operation | Endpoint | Notes |
|---|---|---|
| Read tree | `GET /customers/:id/tariffs?domain=&category=&year=&granularity=` | `granularity`: `year` \| `month` \| `day` (default) \| `hour` |
| Replace year | `PUT /customers/:id/tariffs?domain=&category=&year=` | REPLACE: nested price tree; ≥ an `annual` price or one month |
| Merge buckets | `PATCH /customers/:id/tariffs?domain=&category=&year=` | MERGE: sparse `buckets[]` by level+ref |
| Delete | `DELETE /customers/:id/tariffs?domain=&category=&year=` | whole year (204) or a sub-bucket via body (200) |

`domain` ∈ {`ENERGY`, `WATER`}, `category` ∈ {`COMMON_AREA`, `SPECIFIC`}.

### Goals — money overlay & CURRENCY budget

| Operation | Endpoint | Notes |
|---|---|---|
| Goal in money | `GET /customers/:id/goals?domain=&year=&granularity=&withMoney=true` | adds `money` (+ `budget`) blocks and per-node `monetaryValue` |
| Read budget | `GET /customers/:id/goals?domain=&year=&measure=CURRENCY` | the native CURRENCY goal (R$) |
| Write budget | `PUT /customers/:id/goals?domain=&year=&measure=CURRENCY` | body is an R$ tree (`{ annual }` or `{ monthly }`) |
| Delete budget | `DELETE /customers/:id/goals?domain=&year=&measure=CURRENCY` | same delete semantics as a quantity goal |

`measure` defaults to `QUANTITY`; omitting it keeps every pre-RFC-0054 call
byte-identical. `CURRENCY` is valid only on a SUM domain (ENERGY/WATER).

## 4. Reading

### 4.1 Tariff tree

```
GET /customers/:id/tariffs?domain=ENERGY&category=SPECIFIC&year=2026&granularity=day
```
```jsonc
// 200 — prices are decimal strings; ETag: "7"
{
  "customerId": "…", "domain": "ENERGY", "category": "SPECIFIC",
  "year": 2026, "unit": "kWh", "currency": "BRL", "tariffModel": "FLAT",
  "timezone": "America/Sao_Paulo", "version": 7,
  "tree": {
    "daily": {
      "07-01": { "price": "2.000000", "sourceLevel": "DAY", "derived": false,
                 "hourly": { "15": { "price": "4.000000", "sourceLevel": "HOUR", "derived": false } } }
    }
  }
}
```
An empty tariff returns `version: 0` and an empty `tree`.

### 4.2 Goal in money (`withMoney=true`)

```
GET /customers/:id/goals?domain=ENERGY&year=2026&granularity=month&withMoney=true
```
On a **device-granular** goal, each tree node gains `monetaryValue` (R$) and a
`money` block is returned:

```jsonc
{
  "customerId": "…", "domain": "ENERGY", "year": 2026, "measure": "QUANTITY", "version": 5,
  "money": {
    "currency": "BRL",
    "coverageComplete": false,
    "pricedHours": 61320, "totalHours": 87600,          // DEVICE-hours
    "tariffCoverageGaps": { "missing": ["2026-03-01T00"], "truncated": false, "missingHours": 24 },
    "uncategorizedDevices": [ { "deviceId": "…", "code": "Q303A_L3", "label": "Loja 303A" } ]
  },
  "budget": {                                            // present when a CURRENCY goal exists
    "projected": { "amount": "128000.00", "source": "OVERLAY", "coverageComplete": false },
    "target":    { "amount": "120000.00", "source": "NATIVE" },
    "variance":  null,                                    // null while coverage is incomplete (DEC-6)
    "withinBudget": null
  },
  "tree": { "annual": { "value": 250000, "monetaryValue": "223000.00" } }
}
```

- On a **CUSTOMER-granular** goal, `money` is
  `{ "reason": "MONEY_REQUIRES_DEVICE_GRANULARITY" }` — the money view needs a
  device-granular goal whose devices carry a tariff category.
- `withinBudget` / `variance` are non-null **only** when the projection is fully
  covered; otherwise the conclusion is withheld (DEC-6).
- These coverage states travel in the **200 body**, not as errors.

## 5. Writing

### 5.1 Set a tariff (PUT replace)

FLAT v1 → one annual price applied to every hour:

```bash
curl -X PUT "$BASE/customers/$CID/tariffs?domain=ENERGY&category=SPECIFIC&year=2026" \
  -H "X-API-Key: gcdr_cust_…" -H 'Content-Type: application/json' \
  -d '{ "annual": { "price": "0.892000" }, "expectedVersion": 7 }'
```
Intraday bands via a nested tree (finest wins):
```jsonc
{ "monthly": { "07": { "daily": { "01": {
    "hourly": { "18": { "price": "1.200000" }, "19": { "price": "1.200000" } } } } } },
  "expectedVersion": 7 }
```

### 5.2 Adjust points (PATCH merge)

```jsonc
{ "buckets": [ { "level": "DAY",  "ref": "2026-07-01",   "price": "2.000000" },
               { "level": "HOUR", "ref": "2026-07-01T15", "price": "4.000000" } ],
  "expectedVersion": 7 }
```
Price **input precision**: up to 6 decimals (more → `422 TARIFF_PRICE_INVALID`);
price must be `> 0`.

### 5.3 Delete a tariff

```bash
# whole year, no guard → 204 (idempotent: absent = 204)
curl -X DELETE "$BASE/customers/$CID/tariffs?domain=ENERGY&category=SPECIFIC&year=2026" -H "X-API-Key: …"
# one sub-bucket, guarded → 200 + body
curl -X DELETE "$BASE/customers/$CID/tariffs?domain=ENERGY&category=SPECIFIC&year=2026" \
  -H "X-API-Key: …" -H 'Content-Type: application/json' \
  -d '{ "bucket": { "level": "DAY", "ref": "2026-07-01" }, "expectedVersion": 7 }'
```

### 5.4 Set a budget (CURRENCY goal)

Annual budget:
```bash
curl -X PUT "$BASE/customers/$CID/goals?domain=ENERGY&year=2026&measure=CURRENCY" \
  -H "X-API-Key: gcdr_cust_…" -H 'Content-Type: application/json' \
  -d '{ "annual": { "value": 120000.00 }, "expectedVersion": 3 }'
```
Monthly budget (12 buckets; the year total is their sum):
```jsonc
{ "monthly": { "01": { "value": 9000 }, "02": { "value": 9500 }, "…": {}, "12": { "value": 11000 } },
  "expectedVersion": 3 }
```
`CURRENCY` on a non-SUM domain (TEMPERATURE) → `422 GOAL_MEASURE_INVALID`.

## 6. Device tariff category

Set on the device (see `devices` API): `tariffCategory` ∈ {`COMMON_AREA`,
`SPECIFIC`, `null`}. It is independent of the meter role/domain pair and is
**required** for a device to contribute to a money sum — uncategorized devices
are excluded and listed in `money.uncategorizedDevices`.

## 7. Error taxonomy (stable `code`s)

Body: `{ "error": { "code": "<STABLE>", "message": "…", "details"?: { … } } }`.
Clients switch on `code`, never on `message`.

| HTTP | `code` | When |
|---|---|---|
| 409 | `TARIFF_VERSION_CONFLICT` | `expectedVersion`/`If-Match` stale (details: `currentVersion`) |
| 409 | `GOAL_VERSION_CONFLICT` | budget optimistic mismatch (details: `currentVersion`) |
| 400 | `VERSION_GUARD_MISMATCH` | `If-Match` and body `expectedVersion` disagree |
| 422 | `TARIFF_PRICE_INVALID` | price ≤ 0 or > 6 decimals |
| 400 | `TARIFF_BUCKET_INVALID` | bad month/day/hour or ref (incl. 02-29 in a non-leap year) |
| 400 | `DOMAIN_INVALID` | domain ∉ {ENERGY, WATER} |
| 400 | `CATEGORY_INVALID` | category ∉ {COMMON_AREA, SPECIFIC} |
| 422 | `GOAL_MEASURE_INVALID` | `CURRENCY` on a non-SUM domain (TEMPERATURE) |
| 403 | `FORBIDDEN` | JWT lacks `tariffs.tariff.update` |
| 404 | `NOT_FOUND` | customer/goal outside the key's hierarchy reach (no existence leak) |

Coverage states (`coverageComplete:false`, `uncategorizedDevices`,
`MONEY_REQUIRES_DEVICE_GRANULARITY`) are **not** errors — they travel in the 200 body.

## 8. References

- `GOALS-API-GUIDE.md` — the quantity-goals model (identity, hourly grain, versioning, CSV import).
- `API-KEYS-CONSUMERS.md` — Customer API Keys, scopes, `hierarchyAccess`.
- `docs/rfcs/RFC-0054-Monetary-Goals-and-Customer-Tariffs.md` — the full spec (DEC-1 … DEC-13, golden vectors).
- `docs/openapi.yaml` / Swagger — authoritative wire shapes.

> Rollout note: the money view assumes device-granular goals with categorized
> devices. Before relying on it broadly, measure how many production goals are
> device-granular and curate the rest, so it does not return
> `MONEY_REQUIRES_DEVICE_GRANULARITY` for most of the base.
