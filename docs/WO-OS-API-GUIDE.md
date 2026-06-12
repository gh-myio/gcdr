# Work Orders (OS) — API Guide

> Consumer-facing guide for the **Work Orders** domain (`wo`), surfaced in the UI
> as **OS** (Ordens de Serviço) under `/os`. Implements the **RFC-0037 event
> model**: a work order is an append-only event log, and its `status` is a
> *projection* of the latest lifecycle event.
>
> Companion docs: [`WO-OS-MAP.md`](./WO-OS-MAP.md) (domain map),
> [`RFC-0037-Work-Orders-Event-Model.md`](./RFC-0037-Work-Orders-Event-Model.md)
> (model rationale), [`openapi.yaml`](./openapi.yaml) (machine spec, Swagger at
> `/docs`).

---

## 1. Conventions

| | |
|---|---|
| **Base URL** | `https://<host>/api/v1` (local: `http://localhost:3015/api/v1`) |
| **Auth** | `Authorization: Bearer <JWT>` **or** `X-API-Key: <key>` + `X-Tenant-ID: <uuid>` |
| **Tenant** | Resolved from the token/key; `X-Tenant-ID` required for API-Key calls |
| **Content-Type** | `application/json` |
| **Request id** | Echoed back in `X-Request-Id`; also inside the response body |

### Response envelope

Every success response is wrapped:

```json
{ "success": true, "data": <payload>, "requestId": "..." }
```

List endpoints put the array under `data.items` (or `data` + `data.pagination`
for cursor-paginated lists). Errors:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

`204 No Content` is returned by the delete endpoints (no body).

---

## 2. Core concepts

### 2.1 Types & status

- **type** (`WorkOrderType`): `INSTALACAO` · `MANUTENCAO` · `VISITA_TECNICA`
- **status** (`WorkOrderStatus`, **read-only — projected from events**):
  `PLANEJADA` · `EM_ANDAMENTO` · `INTERROMPIDA` · `AGUARDANDO` · `REAGENDADA` ·
  `FINALIZADA` · `CANCELADA`

You **never set `status` directly** — you append a lifecycle event and the
server recomputes it. The suffix of a `<TYPE>_<STATE>` event maps to a status:

| Event suffix | Projected status |
|---|---|
| `PLANEJADA` | `PLANEJADA` |
| `INICIADA` · `REINICIADA` · `EXECUTADA_PARCIAL` | `EM_ANDAMENTO` |
| `INTERROMPIDA` | `INTERROMPIDA` |
| `REAGENDADA` | `REAGENDADA` |
| `AGUARDANDO_AGENDA_CLIENTE` · `AGUARDANDO_AGENDA_TECNICO` · `AGUARDANDO_OUTROS_MOTIVOS` | `AGUARDANDO` |
| `FINALIZADA` | `FINALIZADA` |
| `CANCELADA` | `CANCELADA` |

`FINALIZADA` and `CANCELADA` are terminal.

### 2.2 Event categories

Each event-type belongs to a **category** (from `GET /wo/event-types`):

- `INSTALACAO` / `MANUTENCAO` / `VISITA_TECNICA` — **lifecycle** events; these
  drive the status projection (must match the WO's own type).
- `ESTRUTURA` — structural markers (`WO_CRIADA`, `WO_ATRIBUIDA`,
  `AMBIENTE_ASSOCIADO`, `PRODUTO_INSTALADO`, `DEVICE_MOVIDO`, …) — **never**
  change status.
- `OBSERVACAO` / `ANEXO` — annotation/attachment markers (carry `annotationId`
  in the payload); **never** change status.

---

## 3. Event-type catalog

### `GET /wo/event-types`

Active catalog used to populate the timeline composer.

```http
GET /api/v1/wo/event-types
Authorization: Bearer <JWT>
```

```json
{
  "success": true,
  "data": [
    { "code": "INSTALACAO_INICIADA", "category": "INSTALACAO", "label": "Instalação iniciada", "isTerminal": false, "sortOrder": 12, "active": true },
    { "code": "PRODUTO_INSTALADO",   "category": "ESTRUTURA",  "label": "Produto instalado",   "isTerminal": false, "sortOrder": 83, "active": true },
    { "code": "AMBIENTE_ASSOCIADO",  "category": "ESTRUTURA",  "label": "Ambiente associado",  "isTerminal": false, "sortOrder": 87, "active": true }
  ]
}
```

---

## 4. Work orders — `/wo/work-orders`

### 4.1 List — `GET /wo/work-orders`

Query params (all optional): `customerId`, `status`, `type`, `assignedTo`,
`deviceId`, `createdFrom` (ISO), `createdTo` (ISO), `sort`, `limit` (1–**100**),
`cursor`.

`sort` ∈ `createdAt_desc` (default) · `createdAt_asc` · `updatedAt_desc` ·
`updatedAt_asc` · `scheduledAt_asc` · `scheduledAt_desc`.

```http
GET /api/v1/wo/work-orders?customerId=7777...&status=EM_ANDAMENTO&limit=50&sort=createdAt_desc
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "a000...", "tenantId": "1111...", "customerId": "7777...",
        "rootAssetId": "dddd...", "type": "INSTALACAO", "status": "EM_ANDAMENTO",
        "code": "OS-ABC1D2", "assignedTo": "bbbb...", "scheduledAt": "2026-06-20T13:00:00.000Z",
        "createdBy": "bbbb...", "createdAt": "...", "updatedAt": "...", "deletedAt": null
      }
    ],
    "pagination": { "total": 137, "totalPages": 3, "hasMore": true, "nextCursor": "50" }
  }
}
```

### 4.2 Create — `POST /wo/work-orders`

```jsonc
// body
{
  "customerId": "7777...",            // required (uuid)
  "type": "INSTALACAO",               // required: INSTALACAO|MANUTENCAO|VISITA_TECNICA
  "rootAssetId": "dddd...",           // optional (uuid|null)
  "code": "OS-ABC1D2",                // optional — auto-generated OS-<Mercosul plate> if omitted
  "assignedTo": "bbbb...",            // optional (uuid|null)
  "scheduledAt": "2026-06-20T13:00:00Z", // optional (ISO|null)
  "devices": ["2222...", "2222..."]   // optional initial scope (max 500 uuids)
}
```

`201 Created` → returns the full **detail** (WO + `devices` + `events`; a
`WO_CRIADA` marker — and `WO_ATRIBUIDA` when `assignedTo` is set — is emitted
automatically). Status starts `PLANEJADA`.

### 4.3 Detail — `GET /wo/work-orders/:id`

Returns the WO plus its `devices[]` (scope) and `events[]` (full timeline).

### 4.4 Update — `PATCH /wo/work-orders/:id`

Editable fields only: `rootAssetId`, `code`, `assignedTo`, `scheduledAt`
(each `uuid|string|null`, optional).

```jsonc
{ "assignedTo": "bbbb...", "scheduledAt": "2026-06-25T14:30:00Z" }
```

> Changing `assignedTo` auto-emits a `WO_ATRIBUIDA` marker. Changing
> `scheduledAt` does **not** emit anything — append a `<TYPE>_REAGENDADA` event
> yourself if you want it on the timeline (and to move status to `REAGENDADA`).

### 4.5 Delete — `DELETE /wo/work-orders/:id`

Soft delete → `204 No Content`.

---

## 5. Events (timeline) — `/wo/work-orders/:id/events`

### 5.1 List — `GET /wo/work-orders/:id/events`

```json
{ "success": true, "data": { "items": [
  { "id": "e000...", "workOrderId": "a000...", "eventType": "WO_CRIADA",
    "actorType": "USER", "actorUserId": "bbbb...",
    "actor": { "id": "bbbb...", "email": "tech@x.io", "name": "Carlos" },
    "assetId": null, "deviceId": null,
    "payload": { "type": "INSTALACAO", "customerId": "7777..." },
    "createdAt": "..." }
] } }
```

### 5.2 Append — `POST /wo/work-orders/:id/events`

```jsonc
{
  "eventType": "INSTALACAO_INICIADA",  // required (must exist in the catalog)
  "deviceId":  "2222...",              // optional (uuid|null)
  "assetId":   "dddd...",              // optional (uuid|null)
  "payload":   { "note": "Equipe em campo" } // optional free-form object
}
```

`201 Created` → the new event. If `eventType` is a lifecycle code, the WO
`status` is recomputed. Examples:

- Install a device: `{ "eventType": "PRODUTO_INSTALADO", "deviceId": "2222...", "payload": { "serial": "SN-..." } }`
- Reschedule: `{ "eventType": "INSTALACAO_REAGENDADA", "payload": { "previousScheduledAt": "...", "scheduledAt": "...", "reason": "Cliente" } }`
- Finish: `{ "eventType": "INSTALACAO_FINALIZADA", "payload": { "note": "Sem pendências" } }`

---

## 6. Device scope — `/wo/work-orders/:id/devices`

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/:id/devices` | — | `{ items: [ { workOrderId, deviceId, addedBy, addedAt } ] }` |
| `POST` | `/:id/devices` | `{ "deviceId": "2222..." }` | `201` the scope row |
| `DELETE` | `/:id/devices/:deviceId` | — | `204` |

---

## 7. Files / evidence — `/wo/work-orders/:id/files`

v1 links an **existing** `file_asset` (multipart upload lands in a follow-up).

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/:id/files` | — | `{ items: [...] }` |
| `POST` | `/:id/files` | `{ "fileAssetId": "...", "workOrderEventId": null, "imageOrder": 0, "caption": "..." }` | `201` |
| `DELETE` | `/:id/files/:fileId` | — | `204` |

---

## 8. Customer enablement & viewer — `/wo/customers`

A customer must be **OS-enabled** before it can hold work orders.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/wo/customers` | List OS-enabled customers (`?include=stats` adds `wo.total`) |
| `GET` | `/wo/customers/by-code/:code` | Resolve by customer code |
| `POST` | `/wo/customers/:customerId/enable` | Body: `{ defaultCentralId?, viewerPassword?, woMetadata? }` |
| `PATCH` | `/wo/customers/:customerId/settings` | Same shape; partial update |
| `POST` | `/wo/customers/:customerId/disable` | Opt out |
| `GET` | `/wo/customers/:customerId/devices` | Devices in the customer scope |
| `GET` | `/wo/customers/:customerId/observations` | Customer-level notes |
| `GET` | `/wo/customers/:customerId/report` | Aggregates: `{ total, byStatus, byType }` |
| `POST` | `/wo/customers/:customerId/viewer-login` | **PUBLIC** — see below |

### Viewer login (public)

A single read-only password gates a customer's OS data for non-authenticated
viewers. Requires `X-Tenant-ID`; no JWT.

```http
POST /api/v1/wo/customers/7777.../viewer-login
X-Tenant-ID: 1111...
Content-Type: application/json

{ "password": "..." }
```

```json
{ "success": true, "data": {
  "accessToken": "<viewer JWT>", "tokenType": "Bearer", "expiresIn": 3600,
  "customer": { "id": "7777...", "name": "...", "code": "..." }
} }
```

Use the returned `accessToken` as a `Bearer` token (role `wo-viewer`, scoped to
that one customer) for subsequent read-only calls.

---

## 9. Quick recipes

**Create → assign → start → install → finish**

```bash
# 1) create (PLANEJADA)
POST /wo/work-orders { "customerId":"7777...", "type":"INSTALACAO", "devices":["2222..."] }
# 2) start (→ EM_ANDAMENTO)
POST /wo/work-orders/:id/events { "eventType":"INSTALACAO_INICIADA" }
# 3) record an install
POST /wo/work-orders/:id/events { "eventType":"PRODUTO_INSTALADO", "deviceId":"2222..." }
# 4) finish (→ FINALIZADA)
POST /wo/work-orders/:id/events { "eventType":"INSTALACAO_FINALIZADA" }
```

**Reschedule the estimated date**

```bash
PATCH /wo/work-orders/:id { "scheduledAt":"2026-07-01T13:00:00Z" }
POST  /wo/work-orders/:id/events { "eventType":"INSTALACAO_REAGENDADA",
  "payload": { "previousScheduledAt":"...", "scheduledAt":"2026-07-01T13:00:00Z" } }
```

---

## 10. Source of truth

- Routes: `src/controllers/work-orders/work-orders.controller.ts`,
  `wo-customers.controller.ts` · mounted in `src/app.ts` (`/wo/event-types`,
  `/wo/work-orders`, `/wo/customers`).
- Request DTOs (Zod): `src/dto/request/work-orders/`.
- Status projection: `src/services/work-orders/WorkOrderService.ts`
  (`lifecycleStateForCode`).
- Tables (`wo_*`): `src/infrastructure/database/drizzle/schema.ts`.
- Frontend: `gcdr-frontend.git/src/pages/os/` (routes under `/os`).
