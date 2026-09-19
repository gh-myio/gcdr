# Entities (Generic Entity Registry) — consumer API guide

> Audience: teams integrating with GCDR's generic taxonomy tree — device
> classification profiles (RFC-0207, `myio-js-library-PROD.git`), telemetry
> group/profile/equipment taxonomies, and any future consumer that needs a
> typed key/value tree with system defaults + per-customer override.
>
> Design docs: `docs/rfcs/RFC-0047-Generic-Entity-Registry.md` (narrative),
> `RFC-0047-Entity-API.md` (original wire-contract draft), `RFC-0047-Entity-schema.md`
> (DDL) — **this document supersedes those as the source of truth for the wire
> contract**, verified directly against the running controller/service/DTO code
> (`src/controllers/entities.controller.ts`, `src/services/EntityService.ts`,
> `src/dto/request/EntityDTO.ts`) rather than the original design draft. See
> also `docs/rfcs/RFC-0064-Entity-Registry-Addendum-Classification-Closure-and-Equipment-Taxonomy.md`
> for known gaps against the RFC-0207 consumer contract.
>
> Base path: `/api/v1`. Local Swagger `http://localhost:3015/docs`, prod
> `https://gcdr-api.a.myio-bas.com/docs/`.
>
> **Real captured response samples** — one JSON file per `GET` endpoint,
> captured live against production (2026-09-18), in
> [`samples/`](./samples/):
>
> | File | Endpoint |
> |---|---|
> | [`GET-entity-types.json`](./samples/GET-entity-types.json) | `GET /entity-types` |
> | [`GET-entities-list-system-tree.json`](./samples/GET-entities-list-system-tree.json) | `GET /entities?parentId=null&scope=system&deep=all` — full system forest |
> | [`GET-entities-list-classification-energy-empty.json`](./samples/GET-entities-list-classification-energy-empty.json) | `GET /entities?type=CLASSIFICATION_ENERGY&scope=system&deep=all` — proves zero rows exist (§8) |
> | [`GET-entities-resolve-mestre-alvaro.json`](./samples/GET-entities-resolve-mestre-alvaro.json) | `GET /entities/resolve?customerId=<Mestre Álvaro>&deep=all` — effective config for a real customer with no clone of its own |
> | [`GET-entities-by-id.json`](./samples/GET-entities-by-id.json) | `GET /entities/{id}` at `deep=0` — note `children` is **absent**, not `[]` |
> | [`GET-entities-by-id-children.json`](./samples/GET-entities-by-id-children.json) | `GET /entities/{id}/children` — flat array, always present |
>
> Each sample file wraps the real API response in a small envelope
> (`endpoint`/`queryParams`/`capturedAt`/`note`/`response`) so the request
> that produced it is traceable — `response` is the exact, unmodified
> `{ success, data, meta }` body the API returned (only the by-id/children
> pair was reshaped from an already-captured tree instead of a fresh call —
> each says so in its own `source` field).

---

## 0. Cookbook — the practical path

For a ThingsBoard-side consumer (dashboard widget, MENU modal), skip the
theory below and follow this.

### To READ a customer's active taxonomy (every dashboard load)

```
GET /entities/resolve?customerId=<id>&deep=all
```

**One call.** GCDR decides internally — the customer's own customization if
one exists, else the system default. **The consumer does not need to know
or branch on which case it got** — just use the returned tree as-is.

Cache it: store the response's `X-Version-Id` header, send it back as
`If-None-Match` on the next call → `304` (no body) when nothing changed.

### To WRITE a customization (operator edits the taxonomy in the modal)

Two calls, **in this order**, only the **first** time this customer is ever
customized:

1. `POST /entities/clone` `{ "customerId": "<id>" }` — snapshots the
   **entire** system tree (every domain) under the customer. **Skipping
   this step silently deletes every other domain the customer never
   touched — see the ⚠️ callout in §6.7.**
2. `PUT /entities/bulk-replace?customerId=<id>&type=<domain>` with
   `If-Match: <previous X-Version-Id>` — swaps only the one domain's
   subtree being edited.

From the customer's **second** edit onward (already cloned), only step 2 is
needed.

To discard a customization and fall back to system defaults entirely:
`POST /entities/revert` `{ "customerId": "<id>" }`.

**One-sentence rule:** never call `bulk-replace` for a customer without
first confirming (via `/resolve`'s `source` field) that they're already
cloned — `source: "system"` means clone first, or every domain you don't
explicitly write in that same pass disappears instead of falling back.

---

## 1. Conceptual model

A **entity** is one node in a typed forest: `(entity_type, entity_key)` under
an optional `parent_entity_id`, scoped to a tenant and optionally to a
customer.

| Field | What it is |
|---|---|
| `id` | The node's GCDR UUID. |
| `entityType` | FK into the **type registry** (`GET /entity-types`) — e.g. `GROUP`, `PROFILE`, `EQUIPMENT`, `CLASSIFICATION_ENERGY`, `CLASSIFICATION_NODE`. |
| `entityKey` | The taxonomy value within that type — e.g. `energy-commonarea`, `CHILLER`, `TRANSFORMADOR`. |
| `entityValue` | Optional free-text payload (a display label, in practice). |
| `parentEntityId` | Self-FK; `null` = root. |
| `customerId` | **`null` = system default** (inherited by every customer). **Set = a customer's own override.** |
| `isSystem` | Protects a system-default row: non-admin edit/delete/deactivate → `409 SYSTEM_PROTECTED`. |
| `sortOrder` | Deterministic sibling order (children come back sorted by `sortOrder` asc, then `entityKey`). |
| `isActive` / `isDeleted` | Independent toggles — deactivate vs. soft-delete. |
| `metadata` | Free-form `jsonb`, **shape-validated per `entityType`** on write when a schema is registered (currently only the `CLASSIFICATION_*` family — see §7). |
| `version` | Optimistic-lock counter (per-row `PATCH`; a **subtree** version — a hash, not this counter — gates `bulk-replace`, see §5). |

### Two independent taxonomy families exist in the same table

Verified live in production (2026-09-18) — worth stating explicitly because
it is easy to conflate them:

- **`GROUP` → `PROFILE` → `EQUIPMENT`** — a general telemetry-grouping
  taxonomy (`energy` → `energy-commonarea` → `CHILLER`/`FANCOIL`/`HVAC`,
  `energy` → `energy-entry` → `ENTRADA`/`RELOGIO`/`SUBESTACAO`, etc.). `GROUP`
  may nest under another `GROUP` (`allowedParentTypes: ["GROUP", ""]` — the
  empty string meaning "root-only" is also allowed) or be a root; `PROFILE`
  only under `GROUP`; `EQUIPMENT` only under `PROFILE`.
- **`CLASSIFICATION_ENERGY` / `CLASSIFICATION_WATER` / `CLASSIFICATION_TEMPERATURE`
  (roots) → `CLASSIFICATION_NODE`** (any depth) — RFC-0207's
  device-classification/breakdown engine tree, the one the ThingsBoard
  dashboard's `resolveGroup`/`resolveCategory` consumer is wired to read
  (when its `GcdrResolveProfileSource` flag is on — see §8). This family has
  its own registered `metadata` schema (`label`/`domain`/`icon`/`role`/`rules`/`formula`,
  `.strict()` — see §7).

**These do not automatically feed each other.** Inserting a `GROUP`/`PROFILE`
row does not make it visible to a `CLASSIFICATION_*`-only consumer, and
vice versa — they are two independent trees that happen to share one
generic table. See §8 for the concrete, verified state of each.

---

## 2. Authentication & authorization

Mounted with `hybridAuthByMethod('entities:read', 'entities:write')`
(`src/app.ts`):

- **Read** endpoints (`GET`) require scope **`entities:read`** (or `*:read`).
- **Write** endpoints (`POST`/`PATCH`/`PUT`/`DELETE`) require **`entities:write`**
  (or `*:write`) — **MYIO-operator-only by design**: a Customer API Key
  (`gcdr_cust_*`) is never granted `entities:write` and gets `403 FORBIDDEN`
  on any write.
- Accepts a **JWT Bearer** token or a **Customer API Key**
  (`X-API-Key: gcdr_cust_…`).
- Rate-limited (`entitiesRateLimiter`, `src/app.ts` ~line 452) with a
  generous ceiling for the admin UI / M2M consumers.

### The admin tier (extra gate on top of `entities:write`)

Some operations require **`isAdminContext(req)`** in addition to
`entities:write` — creating/editing an `entity_type`, and creating or
editing an `is_system` row:

- API keys: scope `entities:admin` or `*:*`.
- JWT login: RBAC role `role:super-admin` (a `role:customer-admin` is **not**
  admin here — it must not mutate global system defaults).
- Dev/service-account wildcard: `*`.

> **`hybridAuthMiddleware`'s JWT branch itself still never checks
> `requiredScope`** — only the API-key branch does (that gap is systemic,
> affects every route mounted with `hybridAuthByMethod`, and is **not**
> fixed by the stopgap below; it needs its own wider audit — see RFC-0064's
> Unresolved Questions). **Fixed specifically for `/entities` (RFC-0064
> A.5 stopgap):** every write route here now independently requires
> `isAdminContext(req)` for any caller that isn't already a scope-checked
> Customer API Key — closing the concrete gap this doc used to warn about
> (a non-admin, non-`is_system` write, e.g. to a customer's cloned tree or
> a manually-inserted `GROUP`, previously had no JWT-side check at all).
> A non-admin JWT now gets `403 FORBIDDEN` on every write below, not just
> the `is_system`/`entity_type` ones.

---

## 3. Response envelope

Every endpoint returns the standard envelope:

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "requestId": "20905b0c-...", "timestamp": "2026-09-18T18:50:58.059Z" }
}
```

A `4xx`/`5xx` error uses the same shape with `success: false` and the error
under `data`/top-level per the standard GCDR error middleware — see §9 for
the codes this API raises.

---

## 4. Entity types — `GET /entity-types`

Lists the type registry (which `entityType` values exist and their
`allowedParentTypes`).

```
GET /api/v1/entity-types
Authorization: Bearer <jwt>
```

**Response `200`** (real production data, 2026-09-18):

```json
{
  "success": true,
  "data": [
    {
      "entityType": "CLASSIFICATION_ENERGY",
      "label": "Classification · Energy",
      "description": "RFC-0207 energy classification root.",
      "allowedParentTypes": [],
      "isActive": true
    },
    {
      "entityType": "CLASSIFICATION_NODE",
      "label": "Classification · Node",
      "description": "RFC-0207 classification descendant (any depth).",
      "allowedParentTypes": [
        "CLASSIFICATION_ENERGY", "CLASSIFICATION_WATER",
        "CLASSIFICATION_TEMPERATURE", "CLASSIFICATION_NODE"
      ],
      "isActive": true
    },
    { "entityType": "CLASSIFICATION_TEMPERATURE", "allowedParentTypes": [], "isActive": true, "...": "..." },
    { "entityType": "CLASSIFICATION_WATER", "allowedParentTypes": [], "isActive": true, "...": "..." },
    {
      "entityType": "EQUIPMENT",
      "label": "Equipment",
      "description": "An equipment node under a profile.",
      "allowedParentTypes": ["PROFILE"],
      "isActive": true
    },
    {
      "entityType": "GROUP",
      "label": "Group",
      "description": "Top-level telemetry grouping (root-only).",
      "allowedParentTypes": ["GROUP", ""],
      "isActive": true
    },
    {
      "entityType": "PROFILE",
      "label": "Profile",
      "description": "A profile under a group (e.g. CHILLER, FANCOIL).",
      "allowedParentTypes": ["GROUP"],
      "isActive": true
    }
  ],
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

### `POST /entity-types` (admin)

Registers a new type. Requires the **admin tier** (§2).

```
POST /api/v1/entity-types
Content-Type: application/json
Authorization: Bearer <jwt, role:super-admin>

{
  "entityType": "MY_NEW_TYPE",
  "label": "My New Type",
  "description": "optional",
  "allowedParentTypes": ["GROUP"]
}
```
`201` → the created type. `403 FORBIDDEN` without admin. `409 DUPLICATE_KEY`
if `entityType` already exists.

### `PATCH /entity-types/:type` (admin)

Merge-patch `label`/`description`/`allowedParentTypes`/`isActive`; at least
one field required. `404` if the type doesn't exist.

### `DELETE /entity-types/:type` (admin)

`204` on success. **`409 TYPE_IN_USE`** if any entity still references it.

---

## 5. Read entities

### 5.1 `GET /entities/resolve` — effective config for a customer

The **consumer-facing** call: "give me this customer's active tree — their
own override if they have one, else the system default." Mirrors the
alarm-bundle versioning pattern (`X-Version-Id` + `If-None-Match` → `304`).

```
GET /api/v1/entities/resolve?customerId=<uuid>&deep=<0|1|N|all>&state=<active|inactive|all>
Authorization: Bearer <jwt or gcdr_cust_*>
```

| Query param | Required | Notes |
|---|---|---|
| `customerId` | **yes** | `400 VALIDATION_ERROR` if missing. |
| `deep` | no | `0` (default, root only) · `1` (direct children) · `N` · `all` — bounded subtree, recursively embedded under `children`. |
| `state` | no | `all` (default — the repository's `resolve()` explicitly widens the shared `active`-by-default filter for this one endpoint) \| `active` \| `inactive`. |

> **This endpoint has no `type` filter.** It always returns the customer's
> **entire** forest — every root, every `entityType`, mixed together (e.g.
> `GROUP` roots *and* `CLASSIFICATION_*` roots in the same `data.roots` array
> if both exist). RFC-0207's own design doc documents this endpoint as
> accepting `&type=CLASSIFICATION_<DOMAIN>` — **that parameter does not exist
> in the current implementation**; a caller that wants only one domain's tree
> must filter client-side, or use `GET /entities` (§5.2) with `type=` instead.
> Flagged as a real gap in RFC-0064, unresolved as of 2026-09-18.

**Response `200`** — real production example,
`GET /entities/resolve?customerId=e04046d4-baa4-44e9-a378-4dfebe4140f1&deep=all`
(customer "Mestre Álvaro", no own override → falls back to system):

```json
{
  "success": true,
  "data": {
    "source": "system",
    "version": "v_...",
    "roots": [
      {
        "id": "6ec95388-6210-4a58-916f-d5588c266cc3",
        "tenantId": "11111111-1111-1111-1111-111111111111",
        "customerId": null,
        "entityType": "GROUP",
        "entityKey": "energy",
        "entityValue": "Energia",
        "parentEntityId": null,
        "sortOrder": 10,
        "cloneScopeKey": "*",
        "isSystem": true,
        "isActive": true,
        "isDeleted": false,
        "metadata": {},
        "version": 3,
        "children": [
          {
            "entityType": "GROUP",
            "entityKey": "energy-transformers",
            "entityValue": "Transformadores",
            "isSystem": false,
            "children": [
              { "entityType": "PROFILE", "entityKey": "TRANSFORMADOR", "entityValue": "TRANSFORMADOR", "children": [] }
            ]
          },
          {
            "entityType": "GROUP",
            "entityKey": "energy-entry",
            "entityValue": "Entrada de Energia",
            "isSystem": true,
            "children": [
              { "entityType": "PROFILE", "entityKey": "ENTRADA", "entityValue": "Entrada", "children": [] },
              { "entityType": "PROFILE", "entityKey": "RELOGIO", "entityValue": "Relógio", "children": [] },
              { "entityType": "PROFILE", "entityKey": "SUBESTACAO", "entityValue": "Subestação", "children": [] }
            ]
          }
        ]
      }
    ]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```
(`...` above elides fields shown in full in §1's table, and the `water`/
`temperature` root siblings, for brevity — the real response repeats the
same shape per root.)

**`source`** is `"system"` (no customer override exists — this is the
common case) or `"customer"` (the customer has cloned and this is their own
tree). **`version`** is a hash of the whole returned forest — send it back
as `If-None-Match` on the next call to get `304 Not Modified` (no body) when
nothing changed.

> `source` is **whole-customer**, never per-domain — a customer is either
> entirely `"system"` or entirely `"customer"` for this call, across every
> `entityType` at once. Before writing a customization for a customer whose
> `source` reads `"system"`, `clone` first — see the ⚠️ callout in §6.7 for
> exactly what breaks if you skip it.

**Conditional request:**
```
GET /entities/resolve?customerId=<uuid>
If-None-Match: "v_previously-seen-version"
```
→ `304` with no body if unchanged, else `200` with the fresh tree and a new
`X-Version-Id`.

### 5.2 `GET /entities` — generic list / search

The admin/broad-query surface — paginated, filterable, **supports `type`**
(unlike `/resolve`).

```
GET /api/v1/entities?type=CLASSIFICATION_ENERGY&customerId=<uuid>&deep=all&parentId=null&scope=system
Authorization: Bearer <jwt>
```

| Query param | Notes |
|---|---|
| `type` | One or more `entityType` tokens (repeatable: `?type=GROUP&type=PROFILE`, or a single value). |
| `key` | Exact `entityKey` match. |
| `value` | Exact `entityValue` match. |
| `q` | Partial, case-insensitive, over `key`+`value`. |
| `id` | One or more entity UUIDs (batch fetch). |
| `parentId` | A UUID, or the literal string `"null"` → roots only. |
| `customerId` | Scope to one customer's rows. |
| `scope` | `system` (default) \| `customer` \| `all`. |
| `state` | `active` (default) \| `inactive` \| `all`. |
| `includeDeleted` | boolean, default `false`. |
| `deep` | `0` (default) · `1` · `N` · `all`. |
| `page` / `pageSize` | Default `1` / `50`, max page size `200`. |
| `sort` | `<field>_<asc\|desc>` — fields: `sort_order`, `entity_key`, `entity_type`, `created_at`, `updated_at`, `version`. Default `sort_order_asc`. |
| `metadata.<path>` | Extra query keys (e.g. `metadata.icon=chip`) — containment filter over top-level scalar `metadata` fields. Nested objects/arrays (e.g. `rules`) are **not** filterable this way. |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "items": [ { "...": "one or more RegistryEntity objects, same shape as §5.1" } ],
    "pagination": { "total": 42, "totalPages": 1, "hasMore": false }
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Real example** — confirming zero `CLASSIFICATION_ENERGY` data exists in
production today (2026-09-18):
```
GET /entities?parentId=null&scope=system&deep=all&type=CLASSIFICATION_ENERGY
```
```json
{ "success": true, "data": { "items": [], "pagination": { "total": 0, "totalPages": 0, "hasMore": false } } }
```

### 5.3 `GET /entities/:id` — one node

```
GET /api/v1/entities/{id}?deep=1&state=active
```
`200` → one `RegistryEntity` (same shape as above), with `children` embedded
per `deep`. `404` if not found (or soft-deleted and `state` excludes it).

### 5.4 `GET /entities/:id/children` — direct children (or bounded subtree)

```
GET /api/v1/entities/{id}/children?deep=0&state=active
```
`200` → `RegistryEntity[]` (not wrapped in `items`/`pagination` — a flat
array). `404 NOT_FOUND` if the **parent itself** doesn't exist (children are
never silently `[]` for a missing parent).

---

## 6. Write entities

All require **`entities:write`** (see the JWT-enforcement gap in §2).

### 6.1 `POST /entities` — create one node

```
POST /api/v1/entities
Content-Type: application/json

{
  "entityType": "PROFILE",
  "entityKey": "TRANSFORMADOR",
  "entityValue": "TRANSFORMADOR",
  "parentEntityId": "15c7483c-f23e-4204-8b21-d5afb92f83e5",
  "customerId": null,
  "sortOrder": 0,
  "isActive": true,
  "isSystem": false,
  "metadata": {}
}
```

| Field | Required | Notes |
|---|---|---|
| `entityType` | yes | Must match a registered type (`GET /entity-types`). |
| `entityKey` | yes | 1–255 chars. |
| `entityValue` | no | ≤ 1000 chars, nullable. |
| `parentEntityId` | no | Must satisfy the parent type's `allowedParentTypes`, same tenant/scope — else `400`. |
| `customerId` | no | `null`/omitted = system default; a UUID = customer override. |
| `sortOrder` | no | Default `0`. |
| `isActive` | no | Default `true`. |
| `isSystem` | no | Default `false`. **Setting `true` requires the admin tier** (§2) and `customerId` must be `null` — else `403 FORBIDDEN` / `400`. |
| `metadata` | no | Default `{}`. **Shape-validated per `entityType`** if a schema is registered (§7) — else free-form. |

`201` → the created `RegistryEntity`. Errors: `400 VALIDATION_ERROR`
(bad shape, unknown `entityType`, bad metadata), `404 NOT_FOUND` (parent
doesn't exist), `403 FORBIDDEN` (`isSystem:true` without admin),
`409 DUPLICATE_KEY` ((scope, type, key, parent) collision).

### 6.2 `PATCH /entities/:id` — partial update

```
PATCH /api/v1/entities/{id}?metadataMode=merge
Content-Type: application/json

{ "entityValue": "New label", "sortOrder": 20, "version": 3 }
```

- `metadata`: **JSON Merge Patch (RFC 7396)** by default — a top-level key
  set to `null` removes it; `?metadataMode=replace` swaps the whole object.
- `version`: optional optimistic lock. **Sent and stale → `409 VERSION_CONFLICT`.**
  **Absent → last-write-wins.**
- Editing an `is_system` row requires the admin tier → else `409 SYSTEM_PROTECTED`.

`200` → the updated entity. `404 NOT_FOUND` · `400 ENTITY_CYCLE` (re-parent
would create a cycle) · `409 SYSTEM_PROTECTED` · `409 VERSION_CONFLICT`.

### 6.3 `DELETE /entities/:id` — soft delete (default) or hard

```
DELETE /api/v1/entities/{id}?hard=false&cascade=false
```
`204` on success. `is_system` rows can never be deleted (soft or hard) →
`409 SYSTEM_PROTECTED`. A hard delete with children present is refused
unless `cascade=true`.

### 6.4 `POST /entities/:id/restore` — un-delete

```
POST /api/v1/entities/{id}/restore
```
`200` → the restored entity. **`409 RESTORE_CONFLICT`** if a live row now
occupies the same `(scope, type, key, parent)` the restored row would
collide with.

### 6.5 `POST /entities/clone` — materialize the system tree under a customer

```
POST /api/v1/entities/clone
{ "customerId": "<uuid>" }
```
`201` → `{ "cloned": <n>, "customerId": "<uuid>" }`. **`409 ALREADY_CLONED`**
if the customer already has any of their own rows (re-clone is refused —
would destroy their customizations).

### 6.6 `POST /entities/revert` — fall back to system

```
POST /api/v1/entities/revert
{ "customerId": "<uuid>" }
```
`200` → `{ "reverted": <n>, "customerId": "<uuid>" }`. Soft-deletes **all**
of the customer's rows in one transaction; `/resolve` for that customer
starts returning `source: "system"` again immediately.

### 6.7 `PUT /entities/bulk-replace` — atomic whole-subtree swap

The editor-saves-a-whole-tree-at-once operation. Replaces **every** node
under `(customerId, type)` in **one transaction** — never `revert`+`clone`+
`PATCH` from the client (non-atomic, racy).

> ⚠️ **Resolution is binary per customer, not per domain — clone before your
> first `bulk-replace` on a customer, or every OTHER domain disappears.**
> `resolve()`'s scope switch (`src/repositories/EntityRepository.ts` line
> 337-339) is driven by `hasCustomerRows()` (line 528), which checks *"does
> this customer have ANY row at all, of ANY `entityType`"* — not "does this
> customer have a row for the domain I'm asking about." The moment that's
> `true`, **every** `/resolve` and `GET /entities?customerId=…` call for
> that customer switches from serving system defaults to serving **only**
> that customer's own rows, for **every** type — per RFC-0047's own design,
> there is no per-node/per-domain merge ("no hybrid tree — forbidden by
> construction").
>
> Concretely: a customer previously 100% on system defaults, whose
> `CLASSIFICATION_ENERGY` domain is `bulk-replace`d directly (no prior
> `clone`), will have a correct new energy tree — but their
> `CLASSIFICATION_WATER`/`CLASSIFICATION_TEMPERATURE`/`GROUP`/`PROFILE`
> roots, never customized, **vanish** from every subsequent `/resolve` call
> instead of falling back to system. The fix is always `POST /entities/clone`
> **first** (§6.5) — it snapshots the whole system tree, every domain, under
> the customer in one transaction — so every domain already has its own
> (initially system-identical) rows before any single-domain edit happens.
> See §0 for the two-call recipe.

```
PUT /api/v1/entities/bulk-replace?customerId=<uuid>&type=CLASSIFICATION_ENERGY
If-Match: "v_previous-subtree-version"
Content-Type: application/json

{
  "roots": [
    {
      "entityKey": "climatizacao",
      "entityValue": "Climatização",
      "sortOrder": 10,
      "metadata": { "label": "Climatização", "icon": "hvac", "role": "category" },
      "children": [
        { "entityKey": "CHILLER", "metadata": { "label": "Chiller" }, "children": [] }
      ]
    }
  ]
}
```

| Query param | Required |
|---|---|
| `customerId` | yes |
| `type` | yes — the **root type** being replaced (the delete/insert scope). |

- Each node's own `entityType` is **optional** and inherits the query
  `type` when omitted — needed because the forest can be **multi-type**
  (e.g. a `GROUP` root with `PROFILE` leaves); single-type callers (RFC-0207's
  classification tree) can omit it entirely.
- **`If-Match`**: the previous subtree version (from `X-Version-Id` on a
  prior read). **Scoped at the domain-root level, not per-node.** Stale →
  `409 VERSION_CONFLICT` with `.details.currentVersion` in the body,
  **before any write**.
- **Known gap (RFC-0064, unresolved):** cross-tree structural validation is
  **partial** — per-node `metadata` shape is validated before any write
  (zero-write on failure), and a duplicate `(scope, type, key, parent)`
  anywhere in the payload rolls the whole transaction back via the DB's
  unique index (surfaces as `409 DUPLICATE_KEY`, not the `422` the original
  design draft specified — this codebase uses `400`/`409`, never `422`,
  anywhere in `/entities`). But **`allowedParentTypes` and the max-depth
  bound (`ENTITY_MAX_DEPTH = 5`) are not checked before the write** — an
  invalid nesting or an over-deep payload is accepted and written today.

`200` → `{ "source", "version", "roots" }` (same shape as `/resolve`) for
the **whole customer**, with `X-Version-Id` set to the new version. Errors:
`400 VALIDATION_ERROR` (bad node shape / bad metadata) · `409 VERSION_CONFLICT`
(stale `If-Match`) · `409 DUPLICATE_KEY` (payload collision).

---

## 7. Per-`entityType` metadata validation

`metadata` is opaque `jsonb` — the DB enforces no shape. On every write, the
service validates it against a **registered Zod schema keyed by
`entityType`** (`ENTITY_METADATA_SCHEMAS`, `src/dto/request/EntityDTO.ts`):

| `entityType` | Schema | Notes |
|---|---|---|
| `CLASSIFICATION_ENERGY` / `_WATER` / `_TEMPERATURE` / `CLASSIFICATION_NODE` | `ClassificationMetadataSchema` — `.strict()` | `{ label (required, 1-255), domain?, icon? (≤128 chars — **not yet checked against a curated catalog, see below**), role?, rules? (opaque), formula? (opaque) }`. Unknown keys → `400 VALIDATION_ERROR`. |
| every other type (`GROUP`, `PROFILE`, `EQUIPMENT`, …) | *(none registered)* | Free-form — any JSON object is accepted, back-compat. |

> **`icon` catalog validation — confirmed gap (RFC-0064 item A.4).** Today
> `icon` is just `z.string().max(128).optional()` — no check against
> RFC-0200's (`deviceIcons`, `myio-js-library-PROD.git`) curated token
> catalog. A picker built against that catalog can currently write an
> icon token the design system doesn't recognize.

---

## 8. Which tree does the live dashboard actually read? (verified 2026-09-18)

If you're integrating a **new** consumer, or wondering whether writing to
`entities` will show up somewhere visible, the honest current state,
verified against both the API and RFC-0207's own documented status:

1. **`GROUP`/`PROFILE`/`EQUIPMENT` data in GCDR is NOT read by the live
   ThingsBoard dashboard at all**, regardless of how correctly it's
   structured. RFC-0207's classification engine (`resolveGroup`/`resolveCategory`)
   only reads `CLASSIFICATION_*` types — it has no code path for `GROUP`/`PROFILE`.
2. **`CLASSIFICATION_*` data in GCDR is also NOT read by the live dashboard
   today**, even though the consumer's adapter code (`GcdrResolveProfileSource`)
   exists — it sits behind an **off-by-default flag**
   (`window.MyIOUtils.rfc0207UseGcdrStore`). The live dashboard currently
   loads classification from a ThingsBoard `SERVER_SCOPE` customer attribute
   (`deviceClassificationProfile`), not from GCDR.
3. **Zero `CLASSIFICATION_*` rows exist in production as of 2026-09-18**
   (`GET /entities?type=CLASSIFICATION_ENERGY&scope=system` → `total: 0`) —
   so even flipping the flag on today would resolve an empty tree.

**Practical takeaway:** writing to `entities` today is safe to experiment
with (nothing user-facing reads it yet) but also currently inert — it will
not change what any customer sees on the dashboard until (a) the flag is
turned on **and** (b) the relevant `CLASSIFICATION_*` data is actually
seeded. If your goal is a display-only taxonomy label (e.g. `TRANSFORMADOR`
as a `PROFILE`, per RFC-0064 Part B), that is intentionally decoupled from
this consumer and does not need `CLASSIFICATION_*` at all.

---

## 9. Error code reference

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad request shape, unknown `entityType`, metadata fails its registered schema, missing required query param. |
| `ENTITY_CYCLE` | 400 | A re-parent (`PATCH .../:id`) would create a cycle. |
| `NOT_FOUND` | 404 | Entity / entity-type / parent not found. |
| `FORBIDDEN` | 403 | `isSystem:true` create, `entity_type` create/edit/delete without the admin tier, or (RFC-0064 A.5) **any `/entities` write** from a JWT caller that isn't `isAdminContext` — see §2. |
| `SYSTEM_PROTECTED` | 409 | Non-admin edit/delete/deactivate of an `is_system` row. |
| `DUPLICATE_KEY` | 409 | `(scope, type, key, parent)` collision on create or bulk-replace insert. |
| `TYPE_IN_USE` | 409 | Deleting an `entity_type` still referenced by entities. |
| `VERSION_CONFLICT` | 409 | Stale `version` (`PATCH`) or stale `If-Match` (`bulk-replace`). Body carries `.details.currentVersion` on the bulk-replace path. |
| `ALREADY_CLONED` | 409 | `clone` when the customer already has its own rows. |
| `RESTORE_CONFLICT` | 409 | `restore` collides with a live row at the same `(scope, type, key, parent)`. |

---

## 10. Notes

- **Arrays are `[]` when empty, never omitted** — e.g. `GET .../children`
  on a leaf node returns `[]`, not `null`/absent.
- **`sortOrder` is system-locked on `is_system` rows** — reordering a system
  default is itself a protected mutation (`409 SYSTEM_PROTECTED`).
- **`metadata.<path>` filters are parameterized** (`@>` containment) and
  scoped to top-level scalar keys only — never a raw predicate, and never
  usable against nested fields like `rules`/`formula`.
- **A customer's effective config is binary in v1**: either fully on system
  defaults (zero own rows) or fully cloned/customized — there is no partial/
  per-node merge. Deleting one override row does **not** fall back to system
  for just that node; only deleting **all** of the customer's rows does.
