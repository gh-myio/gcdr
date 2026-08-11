# Customer Config Document — consumer API guide

> Audience: teams integrating with GCDR (the Shopping dashboard / `myio-js-library`,
> setup tooling, operators) that need to **read or write a customer's consolidated
> configuration** — feature-button visibility, alarm/ticket toggles, temperature
> limits, dashboards, ingestion credentials — in **one place** instead of scattered
> ThingsBoard SERVER_SCOPE attributes.
>
> Context: **RFC-0057** consolidates customer config into a single GCDR document
> served by `GET/PUT/PATCH/DELETE /customers/:id/config`, plus a dedicated,
> JWT-only, audited **secrets** sub-resource. It is the backend counterpart of the
> client-side **RFC-0229** (which migrates the dashboard off TB attributes). The
> formal wire shapes live in `docs/openapi.yaml` and the Swagger — local
> `http://localhost:3015/docs`, prod `https://gcdr-api.a.myio-bas.com/docs/`.

---

## 1. Conceptual model

- **One document, assembled from several columns.** The read model merges the
  customer's `settings` (→ `locale`), `theme`, the `config` jsonb (the new
  sections) and `metadata` into a single normalized shape. There is **no schema
  migration** — everything new lives in `customers.config` (jsonb).
- **Defaults are always filled.** `GET` never returns `undefined` for a governed
  field; missing values come back as their documented default (§4), so consumers
  can read every key unconditionally.
- **`featureButtons` is a 2×3 checkbox matrix.** Two features
  (`demandPeak`, `instantTelemetry`) × three groups (`entrada`, `areacomum`,
  `lojas`), each an independent boolean. Any combination is valid, including all
  `false` (hidden everywhere) and all `true`. This matches RFC-0229 §1.
- **Secrets are separate and masked.** `ingestion.clientSecret` and
  `security.masterAdminPassword` are **never** returned in plaintext by `GET
  /config` (they read as `"***"`) and **cannot** be written through
  `PUT/PATCH /config`. They are managed only via `…/config/secrets` (JWT-only,
  audited), stored encrypted at rest (`secretEnvelope`).
- **Governed vs free sections.** Governed sections (`featureButtons`, `alarms`,
  `tickets`, `temperature`) are **strict** — unknown keys are rejected. Free
  sections (`display.*`, `classificationProfile`, `defaultDashboard.cfg`,
  `metadata`) accept opaque values but are **size-capped**.

## 2. Authentication & limits

- **Config** (`/customers/:id/config`): hybrid by method —
  **GET** needs `customers:read`; **PUT / PATCH / DELETE** need `customers:write`.
  Accepts **JWT Bearer** or **Customer API Key** (`X-API-Key: gcdr_cust_…`).
  Beyond the scope check, the caller must also be **allowed to touch this
  customer**: an API key's `hierarchyAccess` (`SELF`/`SUBTREE`/`TENANT`) must
  reach `:id`, and a JWT is evaluated against RBAC `customers.hierarchy.read` /
  `customers.hierarchy.update` on `customer:<id>` — otherwise `404` (out of
  reach) or `403` (no RBAC grant). Same enforcement applies to the inline
  `?include=config`.
- **Secrets** (`/customers/:id/config/secrets`): **JWT / master key only** —
  customer API keys are **denied** (DEC-7). JWT operators need the named
  `customers:secrets:read` permission (RBAC `customers.secret.read` on
  `customer:<id>`) for **both** GET and PUT. Every read/write is **audit-logged**
  (`CUSTOMER_CONFIG_SECRET_REVEALED` / `…_UPDATED`), values never logged.
- **Size caps** (DEC-13): each free section ≤ **16 KB**, whole writable document
  ≤ **64 KB** (measured on the JSON serialization).
- **Versioning**: the read model returns a `version` field (informational). There
  is no optimistic-concurrency guard on writes in v1.

## 3. Endpoints

Base path: `/api/v1`. Customer-scoped.

| Operation | Endpoint | Auth | Notes |
|---|---|---|---|
| Read config | `GET /customers/:id/config` | `customers:read` / JWT | normalized read model, secrets masked |
| Replace config | `PUT /customers/:id/config` | `customers:write` / JWT | full replace of writable sections |
| Merge config | `PATCH /customers/:id/config` | `customers:write` / JWT | deep-merge; `featureButtons` merges per group |
| Reset config | `DELETE /customers/:id/config` | `customers:write` / JWT | writable sections → defaults |
| Reveal secrets | `GET /customers/:id/config/secrets` | **JWT/master only**, audited | real decrypted values |
| Set secrets | `PUT /customers/:id/config/secrets` | **JWT/master only**, audited | string sets · `null` clears · `"***"` → 400 |

The config is also exposed **inline** on the customer resource, opt-in, under a
separate field: `GET /customers/:id?include=config` → `configResolved` (masked).

## 4. Reading

```
GET /customers/{customerId}/config
```
```jsonc
// 200 — all keys present; secrets masked as "***"
{
  "version": 3,
  "featureButtons": {
    "demandPeak":       { "entrada": true, "areacomum": true, "lojas": false },
    "instantTelemetry": { "entrada": true, "areacomum": true, "lojas": false }
  },
  "alarms":      { "notificationsEnabled": true, "showOffline": false, "showInternalSupport": false },
  "tickets":     { "enabled": false, "onlyToMyio": true },
  "temperature": { "min": 18, "max": 27, "clampMin": 15, "clampMax": 40 },
  "display":     { "measurementDisplaySettings": null, "mapInstantaneousPower": null },
  "defaultDashboard": { "id": null, "cfg": null },
  "classificationProfile": null,
  "locale":      { "timezone": "America/Sao_Paulo", "locale": "pt-BR", "currency": "BRL" },
  "theme":       { "primaryColor": null, "secondaryColor": null },
  "ingestion":   { "clientId": "myio-prod", "clientSecret": "***" },
  "security":    { "masterAdminPassword": "***" },
  "metadata":    { "inaugurationDate": null, "obs": "" }
}
```

Default `featureButtons` (when unset) is `{entrada:true, areacomum:true, lojas:false}`
for **both** features — this reproduces the legacy `deviceProfile !== '3F_MEDIDOR'`
fallback (RFC-0229 §1). `locale` mirrors `customers.settings`; `theme` mirrors
`customers.theme`.

## 5. Writing

### 5.1 Merge a subset (PATCH — preferred)

`featureButtons` merges **per group key** — the five other toggles are untouched:

```bash
curl -X PATCH "$BASE/customers/$CID/config" \
  -H "X-API-Key: gcdr_cust_…" -H 'Content-Type: application/json' \
  -d '{ "featureButtons": { "demandPeak": { "lojas": true } },
        "alarms": { "showInternalSupport": true } }'
```
Clear a feature to **none** = set its three groups to `false`:
```jsonc
{ "featureButtons": { "instantTelemetry": { "entrada": false, "areacomum": false, "lojas": false } } }
```

### 5.2 Replace writable sections (PUT)

`PUT` replaces the writable document; a section omitted comes back at its default.
On `PUT`, `featureButtons` (if present) must be the **complete 2×3 matrix**:

```jsonc
{ "featureButtons": {
    "demandPeak":       { "entrada": true, "areacomum": true,  "lojas": false },
    "instantTelemetry": { "entrada": true, "areacomum": false, "lojas": false } },
  "temperature": { "min": 18, "max": 27, "clampMin": 15, "clampMax": 40 } }
```

### 5.3 Reset (DELETE)

```bash
curl -X DELETE "$BASE/customers/$CID/config" -H "X-API-Key: gcdr_cust_…"
```
Resets the writable config sections to defaults and returns the full read model.
**Preserved:** `settings` (`locale`), `theme`, the alarm-`bundle` config, and the
at-rest secrets (a config reset does not wipe credentials).

### 5.4 Secrets (JWT-only)

Set / clear (a string sets & encrypts, `null` clears, `"***"` is rejected):
```bash
curl -X PUT "$BASE/customers/$CID/config/secrets" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "ingestion": { "clientSecret": "s3cr3t" }, "security": { "masterAdminPassword": null } }'
```
Reveal (audited):
```bash
curl "$BASE/customers/$CID/config/secrets" -H "Authorization: Bearer $JWT"
# 200 → { "ingestion": { "clientSecret": "s3cr3t" }, "security": { "masterAdminPassword": null } }
```
A customer API key on either secrets route → **401** (denied by design).

## 6. Validation rules (governed sections)

- **Unknown keys → 400.** Governed sections are strict; this is also how secret
  fields (`ingestion.clientSecret`, any `security.*`) are rejected on `PUT/PATCH
  /config`.
- **`null` on a governed section → 400 (MVP).** `alarms`, `tickets`,
  `temperature` and `ingestion.clientId` do **not** accept `null`. To clear a
  value, PATCH it to its default explicitly or `DELETE` the document to reset.
  (Explicitly-nullable fields — `defaultDashboard.id`, the free `display.*`
  values, `classificationProfile` — still accept `null`.) On the **secrets**
  endpoint, `null` **clears** the secret (that path is not a governed section).
- **Temperature invariants → 400:** `min ≤ max`, `clampMin ≤ min`, `max ≤ clampMax`;
  each value bounded to `[-50, 100]` with at most **1 decimal**. Comparisons apply
  only when both operands are present (so partial PATCH is fine).
- **Size caps → 400:** free section > 16 KB, or whole document > 64 KB.
- **Secrets:** `"***"` in a secrets write → 400 (the mask never round-trips).

## 7. Error taxonomy

Body: `{ "error": { "code": "…", "message": "…" } }`. Clients switch on HTTP +
`code`, never on `message`.

| HTTP | When |
|---|---|
| 400 | invalid body — unknown key, secret field on `/config`, temperature invariant, size cap, `"***"` secret, malformed `customerId` |
| 401 | customer API key on `…/config/secrets` (JWT/master only); or missing/invalid auth |
| 403 | authenticated but lacking the required scope/permission |
| 404 | customer outside the key's hierarchy reach / not found (no existence leak) |

## 8. References

- `docs/rfcs/RFC-0057-Customer-Config-Document.md` — full spec (DEC-1 … DEC-15).
- `myio-js-library` **RFC-0229** — the client-side migration off TB SERVER_SCOPE.
- `API-KEYS-CONSUMERS.md` — Customer API Keys, scopes, `hierarchyAccess`.
- `docs/openapi.yaml` / Swagger — authoritative wire shapes.

> Rollout note: the config document is served now, and the **TB→GCDR backfill**
> (RFC-0057 DEC-14, including the legacy `canShowDemandButtons → featureButtons`
> mapping) ships with this work as `CustomerConfigBackfillService` — an
> idempotent, dry-run-capable, per-customer diffing migration. Running it against
> production TB SERVER_SCOPE data (wiring the TB source + staged cutover) is the
> operational follow-up; until it runs, existing customers read GCDR defaults plus
> whatever has been written explicitly.
