# Work Orders (OS) — consumer API guide

> Audience: teams integrating with GCDR (the field-ops / "OS" frontend, the
> Copiloto assistant, setup tooling, operators) that need to **create and drive
> work orders, chamados (tickets), their event timeline, device scope, files and
> observations**.
>
> Context: **RFC-0037** models a work order as an **append-only event log** whose
> `status` is a *projection* of the latest lifecycle event. On top of it:
> **RFC-0044** adds Chamados (a work order of `type: CHAMADO`), **RFC-0051** adds
> Grupos de OS (parent/child), **RFC-0041** makes the lifecycle table-driven
> (Lifecycle Rules), and **RFC-0036** adds polymorphic Annotations (observations
> on a work order or one of its events). In the UI this whole domain is called
> **"OS"**; on the wire the base path is **`/wo`** and annotations live under
> **`/annotations`**. The formal wire shapes live in `docs/openapi.yaml` and the
> Swagger — local `http://localhost:3015/docs`, prod
> `https://gcdr-api.a.myio-bas.com/docs/`.
>
> ⚠️ **Swagger currency:** as of this writing `openapi.yaml` documents
> `/wo/work-orders`, `/wo/customers`, `/wo/event-types` and `/annotations`, but
> **not** `/wo/tickets` (RFC-0044) nor `/wo/lifecycle-rules` (RFC-0041). Until the
> spec is regenerated, this guide is the source of truth for those two. See §9.

---

## 1. Conceptual model

- **A work order is an event log; `status` is derived.** You never write `status`
  directly. You append lifecycle events (`POST …/events`) and the service
  re-projects the current `status` from the latest lifecycle event. New work
  orders start at `PLANEJADA`.
- **"OS" ≠ a `type` value.** There is **no** `OS` or `ANOTACAO` enum. "OS" is the
  business word for a work order in general (and the auto `code` prefix
  `OS-<plate>`). The enumerated `type` values are:

  | `type` | Meaning |
  |---|---|
  | `INSTALACAO` · `MANUTENCAO` · `VISITA_TECNICA` | the three **execution** OS types |
  | `CHAMADO` | a ticket (RFC-0044), driven through `/wo/tickets` |
  | `GRUPO` | a container that groups child OSes (RFC-0051) |

- **Chamado → OS.** A `CHAMADO` is the intake; it **derives** an execution OS
  (`POST /wo/tickets/:id/work-orders`, one of the three execution types) and can
  attach/detach existing OSes. A chamado never derives into `CHAMADO`/`GRUPO`.
- **Grupo → children.** A `GRUPO` groups OSes via `parentId`. Attach/detach/move
  with `PUT /wo/work-orders/:id/parent`; list a group's children with
  `?parentId=<groupId>`. `parentId: null` = root.
- **Lifecycle is table-driven (RFC-0041).** Which event-types are allowed from the
  current state, and which status each projects, is governed by the tenant's
  Lifecycle Rules (`/wo/lifecycle-rules`) plus a built-in fallback flow. Ask
  `GET /wo/work-orders/:id/transitions` before offering an action to the user.
- **Observations are separate (RFC-0036).** Notes/attachments on a work order are
  **annotations**, addressed by `entityType=work_order|work_order_event` under
  `/annotations` — not a WO event type.
- **Customer opt-in.** A customer must be **WO-enabled** (`POST
  /wo/customers/:id/enable`) before it appears in the OS tooling. A viewer
  password enables a public, read-only, single-customer login (RFC-0032 carryover).

## 2. Authentication & scope

- **Everything under `/wo/work-orders`, `/wo/tickets`, `/wo/lifecycle-rules`,
  `/wo/event-types` and `/annotations`** is behind **standard auth** — a **JWT
  Bearer** or a **Customer API Key** (`X-API-Key: gcdr_cust_…`) — applied at the
  mount point. Tenant isolation comes from the token's `tenantId`; the actor is
  recorded as `USER` or `API_KEY` in the event log. **There is no per-endpoint
  RBAC/scope check in this domain** — any authenticated principal in the tenant
  may call these routes. (Contrast with `/customers/*`, which is scope-gated.)
- **`/wo/customers` is auth **per-handler**.** Every route requires auth **except**
  `POST /wo/customers/:customerId/viewer-login`, which is **public** and
  self-authenticates via the viewer password (see §7).
- **Viewer JWT.** `viewer-login` returns a **1-hour, non-refreshable** JWT scoped
  to a single customer (`roles: [role:wo-viewer, scope:customer:<id>]`,
  `type: CUSTOMER`). It is read-only, single-customer OS access — meant for the
  public viewer panel.
- **Optimistic concurrency (annotations only).** Annotation mutations take a
  version via the `If-Match` header or a body `version`; a stale version → conflict.
  Work orders themselves have no optimistic-lock guard.

## 3. Endpoints

Base path: `/api/v1`. Success payloads are enveloped with the `requestId`
(`201` create · `204` delete · `200` otherwise).

### 3.1 Work orders — `/wo/work-orders`

| Operation | Endpoint | Notes |
|---|---|---|
| List / filter | `GET /wo/work-orders` | cursor paging; filters below |
| Create | `POST /wo/work-orders` | starts `PLANEJADA`, emits `WO_CRIADA` |
| Detail | `GET /wo/work-orders/:id` | WO + `devices[]` + `events[]` |
| Update meta | `PATCH /wo/work-orders/:id` | `rootAssetId` · `code` · `assignedTo` · `scheduledAt` |
| Set/clear parent (RFC-0051) | `PUT /wo/work-orders/:id/parent` | `{ parentId: uuid \| null }` |
| Allowed transitions (RFC-0041) | `GET /wo/work-orders/:id/transitions` | which event-types are allowed now |
| Soft-delete | `DELETE /wo/work-orders/:id` | `204` |
| Timeline | `GET /wo/work-orders/:id/events` | append-only log |
| **Append event** | `POST /wo/work-orders/:id/events` | drives lifecycle; re-projects `status` |
| Device scope | `GET · POST /wo/work-orders/:id/devices`, `DELETE …/devices/:deviceId` | |
| Files | `GET · POST /wo/work-orders/:id/files`, `DELETE …/files/:fileId` | links an existing `fileAssetId` |

`GET` query filters: `customerId`, `status`, `type`, `assignedTo`, `deviceId`,
`parentId`, `createdFrom`, `createdTo` (ISO), `sort`
(`createdAt_desc|createdAt_asc|updatedAt_desc|updatedAt_asc|scheduledAt_asc|scheduledAt_desc`),
`limit` (1–100), `cursor`.

### 3.2 Event-type catalog — `/wo/event-types`

| Operation | Endpoint | Notes |
|---|---|---|
| List catalog | `GET /wo/event-types` | global, read-only; `{ code, category, label, isTerminal, sortOrder, active }` |

### 3.3 Lifecycle rules (RFC-0041) — `/wo/lifecycle-rules`

| Operation | Endpoint | Notes |
|---|---|---|
| Read full rule set | `GET /wo/lifecycle-rules` | includes inactive rules |
| Replace whole flow | `PUT /wo/lifecycle-rules` | idempotent; `{ rules: [...] }` (≤500), validated against the catalog |

### 3.4 Chamados / tickets (RFC-0044) — `/wo/tickets`

| Operation | Endpoint | Notes |
|---|---|---|
| List + board | `GET /wo/tickets` | `?status`, `?view=TECNICO\|SUPERVISOR\|HOLDING\|ALL`, `?limit` |
| Team pickers | `GET /wo/tickets/team` | deduped assignees |
| Open | `POST /wo/tickets` | creates a `CHAMADO` |
| Detail | `GET /wo/tickets/:id` | meta, watchers, derived OS, progress |
| Timeline | `GET /wo/tickets/:id/timeline` | own events + derived OS events |
| Derive OS | `POST /wo/tickets/:id/work-orders` | `type` ∈ execution types |
| Attach / detach OS | `POST · DELETE /wo/tickets/:id/links/:woId` | |
| Transition | `POST /wo/tickets/:id/transition` | `action` ∈ `pending\|awaiting\|resolve\|close\|reopen\|cancel` |

### 3.5 WO-enabled customers — `/wo/customers`

| Operation | Endpoint | Auth | Notes |
|---|---|---|---|
| List | `GET /wo/customers` | auth | `?include=stats` adds `{ wo: { total } }` |
| Resolve by slug | `GET /wo/customers/by-code/:code` | auth | must be WO-enabled → else 404 |
| Enable | `POST /wo/customers/:id/enable` | auth | `defaultCentralId?`, `viewerPassword?`, `woMetadata?` |
| Update settings | `PATCH /wo/customers/:id/settings` | auth | same fields |
| Disable | `POST /wo/customers/:id/disable` | auth | `204` |
| **Viewer login** | `POST /wo/customers/:id/viewer-login` | **public** | `{ password }` + `X-Tenant-Id` → 1h JWT |
| Devices | `GET /wo/customers/:id/devices` | auth | limit 1000 |
| Report | `GET /wo/customers/:id/report` | auth | `?format=json` → `{ total, byStatus, byType }` |

### 3.6 Annotations (RFC-0036) — `/annotations`

Polymorphic; WO observations use `entityType=work_order` or `work_order_event`.

| Operation | Endpoint | Notes |
|---|---|---|
| Create | `POST /annotations` | `entityType`, `entityId`, `customerId`, `text` (1–255), `importance` (1–5) |
| List | `GET /annotations` | cross-entity filters (`entityType`, `entityId`, `customerId`, `type`, `status`, …) |
| Detail | `GET /annotations/:id` | + responses, events, mentions, attachments |
| Edit | `PATCH /annotations/:id` | needs version (`If-Match`/body) |
| Archive | `POST /annotations/:id/archive` | finalizes |
| Respond | `POST /annotations/:id/responses` | `type` ∈ `approved\|rejected\|comment\|archived` |
| Mention | `POST /annotations/:id/mentions` | one of `mentionedUserId`/`mentionedDeviceId` |
| Attachments | `POST /annotations/:id/attachments`, `DELETE …/attachments/:attId` | link/detach a `fileAssetId` |

## 4. Reading

```
GET /wo/work-orders/{id}
```
```jsonc
// 200 — detail = work order + its device scope + its event log
{
  "id": "…", "tenantId": "…", "customerId": "…",
  "type": "MANUTENCAO",
  "status": "EM_ANDAMENTO",          // projected from the latest lifecycle event
  "code": "OS-ABC1D23",              // unique per tenant; auto if omitted on create
  "rootAssetId": "…", "parentId": null,
  "assignedTo": "…", "scheduledAt": "2026-09-20T13:00:00Z",
  "createdBy": "…", "createdAt": "…", "updatedAt": "…", "deletedAt": null,
  "devices": [ { "deviceId": "…" } ],
  "events":  [ { "eventType": "WO_CRIADA", "actorType": "USER", "createdAt": "…" },
               { "eventType": "MANUTENCAO_INICIADA", "createdAt": "…" } ]
}
```

Ask the rules engine what the user may do next:
```
GET /wo/work-orders/{id}/transitions
```
```jsonc
// 200 — each catalog event-type, allowed or blocked with a reason
{ "status": "EM_ANDAMENTO",
  "transitions": [
    { "eventType": "MANUTENCAO_FINALIZADA", "allowed": true },
    { "eventType": "MANUTENCAO_INICIADA",   "allowed": false, "reasonCode": "WRONG_STATE" }
  ] }
```
`reasonCode` ∈ `TERMINAL` (WO already `FINALIZADA`/`CANCELADA`), `TYPE_MISMATCH`
(event category ≠ WO type), `WRONG_STATE` (built-in flow), `MISSING_PREDECESSORS`
(table-driven flow prerequisites not met).

## 5. Writing

### 5.1 Create a work order
```bash
curl -X POST "$BASE/wo/work-orders" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "customerId": "…", "type": "MANUTENCAO",
        "assignedTo": "…", "scheduledAt": "2026-09-20T13:00:00Z",
        "devices": ["…"] }'
# 201 → WorkOrderDetail, status "PLANEJADA", first event "WO_CRIADA"
```
`code` is optional (auto `OS-<plate>`); `parentId` optionally files it under a `GRUPO`.

### 5.2 Drive the lifecycle (append events)
```bash
# codes are <CATEGORY>_<SUFFIX>, e.g. MANUTENCAO_INICIADA / _FINALIZADA
curl -X POST "$BASE/wo/work-orders/$ID/events" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "eventType": "MANUTENCAO_INICIADA", "deviceId": "…", "payload": {} }'
# 201 → the event; status re-projected to EM_ANDAMENTO
```
Suffix → projected status: `PLANEJADA`→PLANEJADA · `INICIADA|REINICIADA|EXECUTADA_PARCIAL`→EM_ANDAMENTO
· `INTERROMPIDA`→INTERROMPIDA · `REAGENDADA`→REAGENDADA ·
`AGUARDANDO_AGENDA_CLIENTE|…_TECNICO|…_OUTROS_MOTIVOS`→AGUARDANDO ·
`FINALIZADA`→FINALIZADA · `CANCELADA`→CANCELADA. A blocked event → rejected.

### 5.3 Group / regroup (RFC-0051)
```bash
curl -X PUT "$BASE/wo/work-orders/$ID/parent" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "parentId": "GROUP_WO_ID" }'   # null detaches (back to root)
# list a group's children:  GET /wo/work-orders?parentId=GROUP_WO_ID
```

### 5.4 Chamado → execution OS (RFC-0044)
```bash
# open a chamado
curl -X POST "$BASE/wo/tickets" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "customerId": "…", "subject": "Medidor sem leitura",
        "requesterEmail": "loja@cliente.com", "priority": "ALTA" }'   # 201

# derive an execution OS from it
curl -X POST "$BASE/wo/tickets/$TID/work-orders" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "type": "VISITA_TECNICA", "assignedTo": "…" }'               # 201

# move the chamado through its board
curl -X POST "$BASE/wo/tickets/$TID/transition" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "action": "resolve", "note": "resolvido em campo" }'
```

### 5.5 Observation on a work order (RFC-0036)
```bash
curl -X POST "$BASE/annotations" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{ "entityType": "work_order", "entityId": "'"$ID"'", "customerId": "…",
        "text": "Cliente ausente; reagendar", "importance": 4 }'      # 201
```
Editing/archiving an annotation requires its version via `If-Match` (or body `version`).

### 5.6 Public viewer login
```bash
curl -X POST "$BASE/wo/customers/$CID/viewer-login" \
  -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT" \
  -d '{ "password": "…" }'
# 200 → { accessToken, tokenType: "Bearer", expiresIn: 3600, customer }
```
No `X-Tenant-Id` → 400; wrong password → 401 (`"Senha de viewer invalida"`).

## 6. Enumerations (quick reference)

- **WO `type`:** `INSTALACAO`, `MANUTENCAO`, `VISITA_TECNICA`, `CHAMADO`, `GRUPO`.
  Execution types (a chamado may derive into these): `INSTALACAO`, `MANUTENCAO`, `VISITA_TECNICA`.
- **WO `status`:** `PLANEJADA`, `EM_ANDAMENTO`, `INTERROMPIDA`, `AGUARDANDO`,
  `REAGENDADA`, `FINALIZADA`, `CANCELADA`. Terminal: `FINALIZADA`, `CANCELADA`.
- **Event category:** `VISITA_TECNICA`, `INSTALACAO`, `MANUTENCAO`, `OBSERVACAO`,
  `ANEXO`, `ESTRUTURA`. Lifecycle-projecting categories: the first three + `CHAMADO`.
- **Ticket priority:** `BAIXA`, `MEDIA`, `ALTA`, `URGENTE`. **source:** `PAINEL`,
  `EMAIL`, `FRESHDESK`, `API`. **transition action:** `pending`, `awaiting`,
  `resolve`, `close`, `reopen`, `cancel`. **view:** `TECNICO`, `SUPERVISOR`,
  `HOLDING`, `ALL`.
- **Annotation response type:** `approved`, `rejected`, `comment`, `archived`.
- **Lifecycle-rule `predecessorRule`:** `NONE`, `ANY`, `ALL`.

## 7. viewer-login self-authentication

`viewer-login` is the one public route in the domain. It checks the customer's
stored `viewerPasswordHash` and, on success, mints a **1-hour, non-refreshable**
JWT scoped to that single customer (`sub: wo-viewer:<customerId>`, `roles:
[role:wo-viewer, scope:customer:<customerId>]`, `type: CUSTOMER`). The password
authenticates; the token then carries read-only, single-customer OS access. The
`X-Tenant-Id` header is required so the server knows which tenant's customer to
verify against. Do **not** blanket-auth the `/wo/customers` mount — that would
break this public route.

## 8. Error taxonomy

Body: `{ "error": { "code": "…", "message": "…" } }`. Switch on HTTP + `code`,
never on `message`.

| HTTP | When |
|---|---|
| 400 | invalid body/query (Zod), missing path id, parent belongs to another customer, non-json `report` format, missing `X-Tenant-Id` on viewer-login, malformed `If-Match` |
| 401 | missing/invalid auth; wrong viewer password |
| 404 | work order / customer / asset / parent not found, or customer not WO-enabled (no existence leak) |
| 409 | annotation optimistic-lock conflict (stale version); **appending a blocked lifecycle event** (rules-engine `ConflictError`, message names the `reasonCode`) |

## 9. Swagger / OpenAPI currency

`GET /docs` serves `docs/openapi.yaml`. At the time of writing it documents:

- ✅ `/wo/work-orders` and sub-paths, `/wo/customers` and sub-paths,
  `/wo/event-types`, `/annotations` and sub-paths.
- ❌ **`/wo/tickets/*`** (RFC-0044 Chamados — 9 operations) — **missing**.
- ❌ **`/wo/lifecycle-rules`** (RFC-0041 — `GET`/`PUT`) — **missing**.

Also verify, when the spec is next regenerated, that the RFC-0051 additions are
present on the documented work-order paths: the `parentId` query filter on
`GET /wo/work-orders`, the `parentId` create field, and
`PUT /wo/work-orders/:id/parent`. Until then, treat **this file** as authoritative
for tickets and lifecycle-rules.

## 10. References

- `docs/WO-OS-MAP.md` — the canonical map of the `wo` domain ("OS" in the UI):
  tables `wo_*`, endpoints `/api/v1/wo/*`, frontend `/os`.
- `docs/api/ANNOTATIONS-API-GUIDE.md` — the RFC-0036 annotations subsystem in depth.
- RFCs: **RFC-0037** (event model), **RFC-0044** (Chamados), **RFC-0051**
  (Grupo de OS), **RFC-0041** (Lifecycle Rules), **RFC-0036** (Annotations),
  **RFC-0032** (origin of the Viewer JWT), **RFC-0043** (Copiloto over WO tools).
- `docs/api/API-KEYS-CONSUMERS.md` — Customer API Keys, `hierarchyAccess`.
- `docs/openapi.yaml` / Swagger — authoritative wire shapes (mind §9 gaps).
