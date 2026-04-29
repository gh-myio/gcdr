# QR Checker on GCDR — Frontend Integration Guide

- **Status:** Integration brief — backend Phases 1-4 live (controllers mounted)
- **Last updated:** 2026-04-29
- **Audience:** Frontend / mobile developers re-pointing the QR Checker UI at GCDR
- **Companion docs:**
  - [RFC-0032 — QR Checker Migration](./RFC-0032-QR-Checker-Migration-to-GCDR.md) (full backend spec)
  - [FILE-ASSETS-FRONTEND.md](./FILE-ASSETS-FRONTEND.md) (image upload contract)
  - [GCDR-USER.md](./GCDR-USER.md) (auth, RBAC, customer hierarchy)
  - **OpenAPI:** [docs/openapi.yaml](./openapi.yaml) — every endpoint below has a corresponding entry under tag `QR Checker`. Swagger UI at `/docs` (local + prod).

---

## What's live today (Phase 4)

The backend is callable; the frontend can start integrating. Phases 5-8
(data migration script, MCP, cutover) are still ahead but they don't
gate the FE.

| Surface                                                                   | Status |
| ------------------------------------------------------------------------- | ------ |
| `POST /api/v1/auth/operator-pin`                                          | ✅ live |
| `GET /api/v1/qrc/customers` (+`?include=stats`)                           | ✅ live |
| `GET /api/v1/qrc/customers/by-code/:code`                                 | ✅ live |
| `POST /api/v1/qrc/customers/:customerId/{enable, disable, viewer-login}`  | ✅ live |
| `PATCH /api/v1/qrc/customers/:customerId/settings`                        | ✅ live |
| `GET /api/v1/qrc/customers/:customerId/{devices, observations, report}`   | ✅ live |
| `POST/DELETE /api/v1/qrc/customers/:customerId/observations[/:obsId]`     | ✅ live |
| `POST /api/v1/qrc/install`  (deviceId or addrLow+addrHigh)                | ✅ live |
| `GET / PATCH /api/v1/qrc/installations/:id`                               | ✅ live |
| `GET /api/v1/qrc/installations/:id/audit`                                 | ✅ live |
| Installation images (multipart upload + caption/order + delete)            | ✅ live |
| Installation tasks (CRUD + status changes emit audit)                      | ✅ live |
| Visitas (CRUD + audit + report)                                           | ✅ live |
| Visita ambientes (CRUD + images, max 50/ambiente)                         | ✅ live |
| Visita products (CRUD + images, max 5/product)                            | ✅ live |
| Visita observations (CRUD)                                                | ✅ live |
| `PATCH /api/v1/qrc/users/:userId/pin` (set/clear; 409 PIN_TAKEN)          | ✅ live |
| `GET /api/v1/qrc/users/:userId/audit`                                     | ✅ live |
| Customer report `?format=xlsx` / `pdf`                                     | ⏳ json only in v1 |
| Bulk device import/export per customer                                     | ⏳ later phase |

**FE checklist (now actionable):**
1. Flip `BASE_URL` to `process.env.NEXT_PUBLIC_GCDR_BASE_URL` (e.g. `https://gcdr-api.a.myio-bas.com/api/v1`).
2. Send `X-Tenant-Id` header on every request.
3. Resolve `slug → customerId` once per page-mount via `GET /qrc/customers/by-code/:code`.
4. Wire the 3 image-upload screens to the multipart `POST` endpoints.
5. Replace the legacy `POST /api/admin/users/check-pin` pre-check with `409 PIN_TAKEN` handling on submit.

---

## What this is

QR Checker (today: standalone Next.js app at `qrcode-check.git`) is being
folded into GCDR. The UI stays where it is; only the backend changes. This
doc maps **every existing screen → the new GCDR endpoint(s)** so the
frontend can be re-pointed without behavioural surprises.

The mapping is one-for-one for the operator and admin flows. The biggest
conceptual shift is that **mall ⊂ customer** — there is no `/malls/*` API
anymore. Every "mall" is a GCDR customer with an opt-in
`qrc_customer_settings` row, and every URL keys off `customerId` (UUID)
or `customerCode` (the legacy slug). See *Mall → Customer mapping* below.

---

## Reference inventory — screens that exist today

The legacy app has 10 page-level views. The migration preserves all of them
verbatim from a UX perspective; only the data layer changes.

### Operator-facing (PIN auth)

| # | Page                              | Purpose                                              |
| - | --------------------------------- | ---------------------------------------------------- |
| 1 | `/`                               | Landing — list malls (now: QR-enabled customers) and visitas, post-PIN |
| 2 | `/login`                          | Operator PIN entry **or** admin email/password       |
| 3 | `/mall/[slug]`                    | Field workflow — QR scan, install, photos, tasks, observations |
| 4 | `/admin/visitas/[id]`             | Visita técnica detail — ambientes, products, observations, audit |
| 9 | `/viewer/[slug]`                  | Read-only viewer — separate password                 |

### Admin-facing (email/password, role: `qrc-admin`)

| # | Page                              | Purpose                                              |
| - | --------------------------------- | ---------------------------------------------------- |
| 5 | `/admin`                          | Dashboard — malls/users/visitas/observations CRUD    |
| 6 | `/admin/devices`                  | Device CRUD per mall (add, import, edit, status)     |
| 7 | `/admin/reports`                  | Installation analytics + Excel export                |
| 8 | `/admin/users/[id]/history`       | User audit trail (installation revisions)            |

### Shared component

| Component                | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| `components/QRScanner`   | html5-qrcode camera viewport. Unchanged in v1.    |

---

## Authentication — three coexisting flows

### 1. Operator PIN  (RFC-0032 Phase 2)

Field operators tap a 4-digit PIN. The app trades it for a 24-hour JWT.

```http
POST /api/v1/auth/operator-pin
Content-Type: application/json

{
  "pin": "1234",
  "tenantId": "11111111-1111-1111-1111-111111111111"
}
```

**200 OK**:
```json
{
  "success": true,
  "data": {
    "accessToken":     "<jwt 24h>",
    "refreshToken":    "<jwt 7d>",
    "tokenType":       "Bearer",
    "expiresIn":       3600,
    "refreshExpiresIn": 604800,
    "user":      { "id": "...", "email": "...", "displayName": "...", "type": "CUSTOMER", "roles": ["role:field-operator"] },
    "customers": [ /* QR-enabled customers the operator can access */ ]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

The `customers` array is the operator's worklist — what used to be the
"malls" grid on `/`. Each entry is a full `Customer` DTO; the legacy
`mall.slug` lives in `customer.code`.

**Errors:**
- `401 UNAUTHORIZED` — PIN invalid (no enumeration: same response for "no
  match" and "wrong hash")
- `429 RATE_LIMITED` — 10 attempts / 5 min / IP (header `Retry-After: <seconds>`)

The frontend MUST surface both as a generic "PIN inválido" without
distinguishing them visually — only the toast countdown changes when 429.

### 2. Admin / regular user — email + password

Unchanged from the rest of GCDR:

```http
POST /api/v1/auth/login
{ "email": "...", "password": "..." }
```

The post-login `GET /api/v1/auth/me` enrichment (effective permissions,
denied patterns) is described in [GCDR-USER.md](./GCDR-USER.md).

### 3. Viewer (read-only stakeholder)

The legacy `/api/viewer/login` flow used a per-mall viewer password. In
GCDR this becomes a **shared-secret check against
`qrc_customer_settings.viewer_password_hash`** that issues a short-lived
viewer JWT scoped to a single customer:

```http
POST /api/v1/qrc/customers/:customerId/viewer-login
{ "password": "<viewer password>" }

→ 200 { accessToken, customer, expiresIn: 3600 }
```

The viewer JWT carries `roles: ['role:qrc-viewer']` and `scope:
customer:<id>` claims. Viewer tokens are deliberately narrow — they can
read the customer's devices, installations, images, and report. They
cannot list other customers, write anything, or hit `/admin/*`.

> **Backend note:** the viewer-login endpoint is *Phase 4* (controllers).
> Until it ships, frontend dev can stub against the operator-PIN flow with
> a read-only role.

### Header conventions

Every request after auth carries:

```
Authorization: Bearer <jwt>
X-Tenant-Id:   <tenant uuid>            ← required for non-system endpoints
X-Request-Id:  <uuid, optional>
```

`X-Tenant-Id` is the **same tenant the JWT was minted for**. The backend
rejects mismatches with `401`.

---

## Mall → Customer mapping

Single most important migration concept. There is **no Mall entity in
GCDR**. Every legacy mall is a `customers` row, optionally extended via a
`qrc_customer_settings` row that marks it as QR-enabled.

| Legacy concept                 | GCDR equivalent                                                  |
| ------------------------------ | ---------------------------------------------------------------- |
| `mall.id` (integer)            | `customer.id` (uuid) — created in migration phase                |
| `mall.slug`                    | `customer.code` (varchar, unique per tenant)                     |
| `mall.name`                    | `customer.name` / `customer.displayName`                         |
| `mall.cnpj`                    | `customer.metadata.cnpj` (free-form jsonb)                       |
| `mall.viewer_password_hash`    | `qrc_customer_settings.viewer_password_hash`                     |
| `mall.central_id`              | `qrc_customer_settings.default_central_id`                       |
| `user_malls` (M:N)             | `role_assignments` with `scope: customer:<uuid>`                 |

The legacy slug routing (`/mall/[slug]`) keeps working — the frontend
resolves `slug → customerId` once at page-mount via:

```http
GET /api/v1/qrc/customers/by-code/:code
→ 200 { id, code, name, ... }
```

After that, every API call uses the `customerId`. New deeplinks should
prefer `customerId` directly.

---

## Endpoint catalog — by screen

Below: every API call the frontend makes today, mapped to the new GCDR
endpoint. All endpoints follow GCDR's standard envelope:

```json
{ "success": true, "data": { ... }, "meta": { "requestId": "...", "timestamp": "...", "pagination": { ... } } }
```

Error responses use:
```json
{ "success": false, "error": { "code": "...", "message": "...", "details": { ... } }, "meta": { ... } }
```

### Screen 1 — Landing (`/`)

Operator post-login dashboard with two tabs (Malls + Visitas).

| Legacy                                              | GCDR                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `GET  /api/auth/me`                                 | `GET /api/v1/auth/me`                                 |
| `POST /api/auth/logout`                             | `POST /api/v1/auth/logout`                            |
| `GET  /api/malls`                                   | `GET /api/v1/qrc/customers`                           |
| `GET  /api/visitas`                                 | `GET /api/v1/qrc/visitas`                             |

`GET /api/v1/qrc/customers` returns only customers with a row in
`qrc_customer_settings` (i.e. QR-enabled). For each customer, response
includes a precomputed progress block:

```json
{
  "id": "...", "code": "shopping-mont-serrat", "name": "...",
  "qrc": {
    "totalDevices":      120,
    "installedCount":    87,
    "impedimentoCount":  3,
    "removidoCount":     0,
    "defeitoCount":      1,
    "progressPercent":   72.5,
    "lastInstalledAt":   "2026-04-27T18:42:00Z"
  }
}
```

This replaces the legacy two-call pattern (`/api/malls` then per-mall
`/devices` count).

### Screen 2 — Login (`/login`)

| Legacy                                              | GCDR                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `POST /api/auth/login`  (PIN form)                  | `POST /api/v1/auth/operator-pin`                      |
| `POST /api/auth/login`  (email/password form)       | `POST /api/v1/auth/login` (unchanged GCDR)            |
| `GET  /api/auth/me`                                 | `GET /api/v1/auth/me`                                 |

Branching is now explicit: the form's "Use PIN" toggle hits a different
endpoint instead of disambiguating server-side.

### Screen 3 — Mall workflow (`/mall/[slug]`)

The most complex operator screen — QR scan, install, image upload, tasks,
observations.

| Legacy                                                              | GCDR                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET  /api/malls/{slug}/devices`                                    | `GET /api/v1/qrc/customers/{customerId}/devices`                                  |
| `POST /api/malls/{slug}/install`                                    | `POST /api/v1/qrc/install`  (body: `{ customerId, deviceId? \| addrLow+addrHigh, position, tcType?, ... }`) |
| `GET  /api/installations/{id}`                                      | `GET /api/v1/qrc/installations/{id}`                                              |
| `PATCH /api/installations/{id}`                                     | `PATCH /api/v1/qrc/installations/{id}`                                            |
| `POST /api/installations/{id}/images`                               | `POST /api/v1/qrc/installations/{id}/images`  (multipart, see *Image uploads*)    |
| `GET  /api/installations/{id}/images`                               | `GET /api/v1/qrc/installations/{id}/images`                                       |
| `DELETE /api/installations/{id}/images/{filename}`                  | `DELETE /api/v1/qrc/installations/{id}/images/{imageId}`                          |
| `PATCH /api/installations/{id}/images/{iid}` (caption / order)      | `PATCH /api/v1/qrc/installations/{id}/images/{imageId}`                           |
| `GET  /api/installations/{id}/tasks`                                | `GET /api/v1/qrc/installations/{id}/tasks`                                        |
| `POST /api/installations/{id}/tasks`                                | `POST /api/v1/qrc/installations/{id}/tasks`                                       |
| `PATCH /api/installations/{id}/tasks/{taskId}`                      | `PATCH /api/v1/qrc/installations/{id}/tasks/{taskId}`                             |
| `GET  /api/malls/{slug}/report`                                     | `GET /api/v1/qrc/customers/{customerId}/report`                                   |
| `POST /api/malls/{slug}/observations`                               | `POST /api/v1/qrc/customers/{customerId}/observations`                            |

**Resolving `slug` → `customerId`**: the page should call
`GET /api/v1/qrc/customers/by-code/:code` once on mount and cache the
result. Subsequent navigation within the same mall reuses the id.

**QR-scan to install path**: the QR payload still encodes
`{ addr_low, addr_high }` (or sometimes a device serial number). The new
`POST /api/v1/qrc/install` accepts either:

```jsonc
// By device id (when the QR encodes it directly)
{ "customerId": "...", "deviceId": "...", "position": "Térreo - QGBT", "tcType": "100A" }

// By low/high address (legacy QR format)
{ "customerId": "...", "addrLow": 12, "addrHigh": 7, "position": "...", "tcType": "..." }
```

Server resolves to a `devices` row scoped to the customer, then upserts
the installation. Idempotent on `(tenantId, deviceId)`.

### Screen 4 — Visita Técnica detail (`/admin/visitas/[id]`)

| Legacy                                                             | GCDR                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `GET  /api/visitas/{id}`                                           | `GET /api/v1/qrc/visitas/{id}`                                      |
| `PATCH /api/visitas/{id}`                                          | `PATCH /api/v1/qrc/visitas/{id}`                                    |
| `GET  /api/visitas/{id}/ambientes/{aid}`                           | `GET /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}`               |
| `PATCH /api/visitas/{id}/ambientes/{aid}` (auto-save 1s debounce)  | `PATCH /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}`             |
| `POST /api/visitas/{id}/ambientes`                                 | `POST /api/v1/qrc/visitas/{id}/ambientes`                           |
| `DELETE /api/visitas/{id}/ambientes/{aid}`                         | `DELETE /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}`            |
| `POST /api/visitas/{id}/ambientes/{aid}/images`                    | `POST /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/images`       |
| `PATCH /api/visitas/{id}/ambientes/{aid}/images/{iid}`             | `PATCH /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/images/{imageId}` |
| `DELETE /api/visitas/{id}/ambientes/{aid}/images/{iid}`            | `DELETE /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/images/{imageId}` |
| `POST /api/visitas/{id}/ambientes/{aid}/products`                  | `POST /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/products`     |
| `DELETE /api/visitas/{id}/ambientes/{aid}/products/{pid}`          | `DELETE /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/products/{productId}` |
| `POST /api/visitas/{id}/ambientes/{aid}/products/{pid}/image`      | `POST /api/v1/qrc/visitas/{id}/ambientes/{ambienteId}/products/{productId}/images` |
| `GET  /api/visitas/{id}/observations`                              | `GET /api/v1/qrc/visitas/{id}/observations`                         |
| `POST /api/visitas/{id}/observations`                              | `POST /api/v1/qrc/visitas/{id}/observations`                        |
| `GET  /api/visitas/{id}/report`                                    | `GET /api/v1/qrc/visitas/{id}/report`                               |
| `GET  /api/visitas/{id}/users`                                     | `GET /api/v1/qrc/visitas/{id}/operators` (resolved from role_assignments) |

Path placeholder name change: `aid` → `ambienteId`, `pid` → `productId`.
Frontend constants need a one-time rename.

### Screen 5 — Admin dashboard (`/admin`)

| Legacy                                              | GCDR                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET    /api/admin/malls`                           | `GET /api/v1/qrc/customers?include=stats` (admin-scoped, sees all enabled) |
| `POST   /api/admin/malls`                           | `POST /api/v1/customers` then `POST /api/v1/qrc/customers/{id}/enable`     |
| `PUT    /api/admin/malls/{id}`                      | `PATCH /api/v1/customers/{id}` and/or `PATCH /api/v1/qrc/customers/{id}/settings` |
| `DELETE /api/admin/malls/{id}`                      | `POST /api/v1/qrc/customers/{id}/disable` (soft — keeps data; full delete via core customers API) |
| `POST   /api/admin/malls/{id}/import`               | `POST /api/v1/qrc/customers/{customerId}/devices/import`                   |
| `POST   /api/admin/malls/{id}/export`               | `GET  /api/v1/qrc/customers/{customerId}/devices/export`                   |
| `GET    /api/admin/users`                           | `GET /api/v1/users` (filter by `?role=role:field-operator`)                |
| `POST   /api/admin/users`                           | `POST /api/v1/users` + `PATCH /api/v1/qrc/users/{userId}/pin` (PIN set)    |
| `PUT    /api/admin/users/{id}`                      | `PATCH /api/v1/users/{id}` and/or `PATCH /api/v1/qrc/users/{userId}/pin`   |
| `DELETE /api/admin/users/{id}`                      | `DELETE /api/v1/users/{id}`                                                |
| `POST   /api/admin/users/check-pin`                 | *Removed.* PIN uniqueness is enforced server-side via the partial UNIQUE index on `(tenant_id, qrc_field_pin_lookup)`. The set/change endpoint returns `409 PIN_TAKEN` if collision. |
| `GET    /api/admin/malls/{id}/observations`         | `GET /api/v1/qrc/customers/{customerId}/observations`                      |
| `DELETE /api/admin/malls/{id}/observations/{obsId}` | `DELETE /api/v1/qrc/customers/{customerId}/observations/{observationId}`   |

**Two-call pattern for "create mall"**:

```js
// 1. Create the customer (core GCDR)
const customer = await POST('/api/v1/customers', {
  name: 'Shopping Mont Serrat',
  code: 'shopping-mont-serrat',
  type: 'COMPANY',
  metadata: { cnpj: '...' }
});

// 2. Mark it QR-enabled (RFC-0032 extension)
await POST(`/api/v1/qrc/customers/${customer.id}/enable`, {
  defaultCentralId: '...',                  // optional
  viewerPassword:   'shopper-2026'          // optional, hashed server-side
});
```

The legacy single-form "create mall" flow stays — the frontend just chains
the two calls behind the same submit handler.

### Screen 6 — Devices admin (`/admin/devices`)

| Legacy                                                              | GCDR                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET   /api/admin/malls/{id}/devices`                               | `GET /api/v1/qrc/customers/{customerId}/devices`           |
| `POST  /api/admin/malls/{id}/devices`                               | `POST /api/v1/devices` (with `customerId` in body)         |
| `DELETE /api/admin/devices/{deviceId}`                              | `DELETE /api/v1/devices/{deviceId}`                        |
| `PATCH  /api/admin/devices/{deviceId}`                              | `PATCH /api/v1/devices/{deviceId}`                         |
| `POST  /api/admin/malls/{id}/devices/{deviceId}/installation`       | `POST /api/v1/qrc/install` (admin can install on behalf of) |
| `GET   /api/admin/installations/{id}`                               | `GET /api/v1/qrc/installations/{id}`                       |
| `PATCH /api/admin/installations/{id}`                               | `PATCH /api/v1/qrc/installations/{id}`                     |
| `POST  /api/admin/installations/{id}/images`                        | `POST /api/v1/qrc/installations/{id}/images`               |
| `DELETE /api/admin/installations/{id}/images/{imageId}`             | `DELETE /api/v1/qrc/installations/{id}/images/{imageId}`   |

The admin and operator paths converge on the same `/api/v1/qrc/...`
endpoints. RBAC differentiates: `qrc-admin` can install/edit on any
customer; `field-operator` only on customers in their `role_assignments`.

### Screen 7 — Reports (`/admin/reports`)

| Legacy                                              | GCDR                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/admin/malls`                              | `GET /api/v1/qrc/customers?include=stats`                                   |
| `GET /api/malls/{slug}/report`                      | `GET /api/v1/qrc/customers/{customerId}/report?format=json`                 |
| `GET /api/malls/{slug}/report?format=excel`         | `GET /api/v1/qrc/customers/{customerId}/report?format=xlsx`                 |
|                                                     | `GET /api/v1/qrc/customers/{customerId}/report?format=pdf` (new)            |

The report response shape stays identical (totals + per-technician
rollup + per-day rollup). New `pdf` format renders server-side via the
Puppeteer pipeline introduced for RFC-0031.

### Screen 8 — User audit history (`/admin/users/[id]/history`)

| Legacy                                              | GCDR                                                          |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/admin/users/{id}/history`                 | `GET /api/v1/qrc/users/{userId}/audit?limit=50&cursor=...`    |

Returns rows from `qrc_installation_audit` filtered by `changed_by =
userId`. Cursor-paginated; same icon mapping (created=green,
updated=blue, image_added=purple, deleted=red) is computable from the
`changeType` discriminator client-side.

### Screen 9 — Read-only viewer (`/viewer/[slug]`)

| Legacy                                              | GCDR                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /api/viewer/login`                            | `POST /api/v1/qrc/customers/{customerId}/viewer-login` (Phase 4)    |
| `GET  /api/viewer/me`                               | `GET /api/v1/auth/me` (works with viewer JWT — `roles` shows `qrc-viewer`) |
| `POST /api/viewer/logout`                           | `POST /api/v1/auth/logout`                                          |
| `GET  /api/viewer/{slug}/devices`                   | `GET /api/v1/qrc/customers/{customerId}/devices`                    |
| `GET  /api/viewer/{slug}/report`                    | `GET /api/v1/qrc/customers/{customerId}/report`                     |

Same endpoints as the operator screens — the viewer JWT simply has a
narrower role with read-only permissions and customer scope.

### Component — QRScanner

No backend changes. The QR payload format stays the same; only the
`POST /install` endpoint that consumes the decoded QR moved.

---

## Image upload — single contract for all photos

The legacy app had four upload paths (installation, ambiente, product,
observation). All four now go through one polymorphic API:
`POST /api/v1/qrc/<owner>/images`. Internally the QRC controllers proxy to
the FileAssets API ([FILE-ASSETS-FRONTEND.md](./FILE-ASSETS-FRONTEND.md))
and write a thin row in the appropriate `qrc_*_images` join table.

Request:

```http
POST /api/v1/qrc/installations/:id/images
Content-Type: multipart/form-data
Authorization: Bearer <jwt>
X-Tenant-Id:   <uuid>

[file]            ← binary
caption           ← optional string
imageOrder        ← optional integer (default = next)
```

**200 OK**:
```json
{
  "success": true,
  "data": {
    "id":            "...",          // qrc_installation_images.id
    "fileAssetId":   "...",          // file_assets.id
    "imageOrder":    3,
    "caption":       "QGBT lateral",
    "downloadUrl":   "https://.../signed-url",   // 5-min lifetime
    "thumbnailUrl":  "https://.../signed-url?w=400",
    "contentType":   "image/jpeg",
    "sizeBytes":     2_341_802,
    "sha256":        "..."
  }
}
```

**Refresh signed URL** if it expires while the user is on the page:
`GET /api/v1/files/:fileAssetId/url`. The frontend can also keep the
`fileAssetId` and call this on retry.

### Limits (enforced server-side)

| Owner                       | Max images per parent | Max size each | Allowed types          |
| --------------------------- | --------------------- | ------------- | ---------------------- |
| `qrc_installation`          | 20                    | 10 MB         | jpg, jpeg, png, webp   |
| `qrc_visita_ambiente`       | 50                    | 10 MB         | jpg, jpeg, png, webp   |
| `qrc_visita_product`        | 5                     | 10 MB         | jpg, jpeg, png, webp   |
| `qrc_visita_observation`    | 1                     | 10 MB         | jpg, jpeg, png, webp   |
| `qrc_customer_observation`  | 1                     | 10 MB         | jpg, jpeg, png, webp   |

Server returns `409 LIMIT_REACHED` with `details.limit` and
`details.current` fields. UI should hide the "+ add" button at the limit
rather than relying on the toast.

### Camera capture vs gallery

The frontend's existing dual-button pattern (camera = `<input
capture="environment">`, gallery = plain `<input type="file">`) keeps
working — both produce a `Blob` that gets posted as multipart/form-data.
No backend distinction.

---

## RBAC and visibility

The new role assignments produced by the migration:

| Role                    | Permissions (umbrella)                                                       | Typical scope               |
| ----------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `role:field-operator`   | `qrc.installation.{create,read,update}`, `qrc.installation.image.{upload,read}`, `qrc.observation.create` | per `customer:<uuid>`       |
| `role:qrc-viewer`       | `qrc.*.read`                                                                 | per `customer:<uuid>`       |
| `role:qrc-admin`        | `qrc.*` (full)                                                               | tenant-wide                 |

The `/auth/me` enrichment endpoint returns `effectivePermissions[]` and
`deniedPatterns[]` — the frontend can drive button visibility off these
strings (e.g. only show "+ Image" when `qrc.installation.image.upload`
is in `effectivePermissions`).

The viewer flow stays intentionally narrower: a viewer JWT with
`scope: customer:<id>` cannot list other customers, hit `/admin/*`, or
write anything. Sending it elsewhere returns `403 FORBIDDEN`.

---

## Pagination

GCDR's standard pattern. Replace the legacy unbounded list calls with
cursor pagination on:

- `GET /api/v1/qrc/customers?limit=50&cursor=...`
- `GET /api/v1/qrc/customers/{customerId}/devices?limit=100&cursor=...`
- `GET /api/v1/qrc/visitas?limit=50&cursor=...`
- `GET /api/v1/qrc/users/{userId}/audit?limit=50&cursor=...`

Response `meta.pagination`:
```json
{ "limit": 50, "nextCursor": "...", "hasMore": true, "total": 187, "totalPages": 4 }
```

The legacy app currently fetches everything at once on most screens; for
large customers (hundreds of devices) the migration is an opportunity to
fix that without a UI redesign — render an infinite-scroll list.

---

## Auto-save patterns

The visita-ambiente observation textarea today debounces 1s before
PATCH. Keep the same debounce; the new endpoint is identical in shape:

```http
PATCH /api/v1/qrc/visitas/{visitaId}/ambientes/{ambienteId}
{ "observation": "..." }
```

Returns `204 No Content` on success. Frontend should swallow `409
CONCURRENT_UPDATE` (last write wins; no retry) and show a small
"sincronizado" indicator.

---

## Error code reference

| Code                   | HTTP | When                                                                |
| ---------------------- | ---- | ------------------------------------------------------------------- |
| `UNAUTHORIZED`         | 401  | JWT missing / invalid / expired; PIN wrong; viewer password wrong   |
| `FORBIDDEN`            | 403  | Auth OK but role/scope insufficient                                 |
| `NOT_FOUND`            | 404  | Resource doesn't exist or is soft-deleted                           |
| `VALIDATION_ERROR`     | 400  | Zod validation failed; check `error.details.validation[]`           |
| `CONFLICT`             | 409  | Optimistic-lock mismatch on PATCH; PIN already taken                |
| `PIN_TAKEN`            | 409  | Specifically: PIN collides with another user in the same tenant     |
| `LIMIT_REACHED`        | 409  | Image count exceeds the per-owner cap                               |
| `RATE_LIMITED`         | 429  | PIN-login rate limiter hit; `Retry-After` header tells you when     |
| `INTERNAL_ERROR`       | 500  | Server bug; surface a generic toast and log `meta.requestId`        |

---

## Migration checklist for the frontend

A practical task list for re-pointing the existing Next.js app:

- [ ] Replace `BASE_URL = '/api'` with `BASE_URL = process.env.NEXT_PUBLIC_GCDR_BASE_URL` (e.g. `https://gcdr-api.a.myio-bas.com/api/v1`)
- [ ] Add `X-Tenant-Id` to the global fetch wrapper. Pull it from a runtime config served at `/api/config` or hard-code per-deploy
- [ ] Replace `mall.id` (number) with `customer.id` (uuid) everywhere in state. Keep `customer.code` for slug-based routing
- [ ] Resolve `slug → customerId` once on `/mall/[slug]` mount via `GET /qrc/customers/by-code/:code`
- [ ] Rename path placeholders: `aid → ambienteId`, `pid → productId`, `iid → imageId`, `obsId → observationId`
- [ ] Wrap fetch with `success/data/meta` envelope unwrapping
- [ ] Drop the `POST /api/admin/users/check-pin` pre-check; handle `409 PIN_TAKEN` on submit instead
- [ ] Update viewer-login to the customer-scoped endpoint when Phase 4 ships
- [ ] Replace `<img src="/api/installations/.../images/x.jpg">` with the signed `downloadUrl` from the upload response (and refresh via `GET /files/:id/url` on expiry)
- [ ] Switch from "load everything" to cursor pagination on customer / device lists
- [ ] Add `Retry-After` countdown to the PIN-login error toast for `429`
- [ ] Hide buttons whose permissions aren't in `effectivePermissions[]`
- [ ] Test the QR-scan-to-install path end-to-end with both `deviceId` and `addrLow/addrHigh` body shapes
- [ ] Verify the visita auto-save still works under `204 No Content` (legacy returned the updated row)

---

## Out of scope (v1)

- **Re-styling the UI.** This is a backend swap. The Next.js app's look stays.
- **Mobile-native rewrite.** The current PWA stays the operator UX.
- **Dark mode / theming integration.** A future RFC may unify with GCDR's `customer.theme`.
- **Real-time push.** Today the app polls; this RFC doesn't change that.
- **Offline mode.** Future work; the migration assumes online use.
- **GCDR core admin pages.** This doc only covers `/qrc/*`. Admin users/roles/policies live under `/admin` with the existing `FRONTEND-Users-Groups-Roles.md` docs.

---

## Open questions for the FE team

1. Does the existing Next.js app point at a configurable API host, or is
   `'/api'` baked in? If baked in, the cutover is a coordinated app
   release, not just a config flip.
2. Image cache strategy: keep the legacy `installation-images-resized/`
   sharp pipeline, or rely on a future `?w=600` query param on the
   FileAssets download endpoint?
3. Authoritative slug source on `/mall/[slug]`: route param or store?
   The store-only path makes the once-per-page resolution cleanest.
4. How quickly can we drop the legacy `/api/auth/login` PIN branch from
   the form? Coordinated with backend cutover.

Track answers in this doc as they land.
