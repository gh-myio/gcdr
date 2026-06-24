# RFC-0047 — Generic Entity Registry · API contract

**Contract document** shared by the GCDR backend and frontend teams. Derived from
[`RFC-0047-Generic-Entity-Registry.md`](./RFC-0047-Generic-Entity-Registry.md); to be **kept in sync with the
implementation** (`src/controllers/entities.controller.ts`, `src/dto/request/EntityDTO.ts`,
`src/services/entityService.ts`). If this doc and the code disagree, the code wins — open a PR to reconcile.

- **Status:** Draft (design closed 2026-06-23). Not yet implemented.
- **Base path:** `/api/v1`
- **Auth:** hybrid (`hybridAuthByMethod`) — JWT Bearer **or** customer API key (`X-API-Key: gcdr_cust_*`).
- **Who writes — MYIO only.** All mutations (`POST`/`PATCH`/`DELETE`/`restore`/`clone`/`revert`) are **MYIO-operator-only**. **A customer API key (`gcdr_cust_*`) is read/resolve-only and is never granted `entities:write`** — a customer key hitting any write endpoint gets `403 FORBIDDEN`. The `customer_id` on a row says **who the taxonomy is _for_**, never **who may edit it** (editing is always a MYIO operator). There is **no customer-editable surface** and **no "request reclassification" flow**: whoever classifies, reclassifies — a MYIO operator edits the tree directly and it is done.
- **Scopes:** reads/resolve need `entities:read` (or `*:read`); writes need `entities:write` (**MYIO staff only**). **Creating an `entity_type`** and **mutating `is_system` rows** additionally require an **admin** scope (`entities:admin` / `*:*`); a non-admin write to a system row is `409 SYSTEM_PROTECTED`. `sort_order` on an `is_system` row is itself system-locked (reordering = rewriting classification order).
- **Tenant:** every request is tenant-scoped from the auth context; `tenant_id` is never a body/query field.
- **Envelope:** `{ "success": boolean, "data": T, "pagination"?: {...}, "error"?: {...} }`. Lists include `total` and `totalPages`.

---

## 1. Resource shape

```jsonc
// RegistryEntity
{
  "id": "7f1c…",
  "customerId": null,                 // null = system default; uuid = a customer override
  "entityType": "GROUP",              // FK → entity_types
  "entityKey": "energy-commonarea",   // taxonomy value
  "entityValue": null,
  "parentEntityId": null,             // null = root
  "sortOrder": 10,                    // deterministic sibling order; system-locked on is_system rows
  "cloneScopeKey": "*",               // v1 always "*"
  "isSystem": true,                   // protected, never deletable
  "isActive": true,
  "isDeleted": false,
  "metadata": { "ingestionId": "ing_123" },
  "createdAt": "2026-06-23T12:00:00Z", "createdBy": "…",
  "updatedAt": "2026-06-23T12:00:00Z", "updatedBy": "…",
  "version": 1,
  "children": [ /* present only when deep≥1; each cut parent carries "truncated": true */ ]
}
```

```jsonc
// EntityType (registry)
{ "entityType": "PROFILE", "label": "Profile", "description": "…",
  "allowedParentTypes": ["GROUP"], "isActive": true }
```

---

## 2. Endpoints

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| `GET` | `/entity-types` | read | List the type registry. |
| `POST` | `/entity-types` | **admin** | Register a new type. |
| `PATCH` | `/entity-types/:type` | **admin** | Merge-patch a type (`label`/`description`/`allowedParentTypes`/`isActive`). |
| `DELETE` | `/entity-types/:type` | **admin** | Remove a type (`409 TYPE_IN_USE` while any entity references it). |
| `POST` | `/entities` | write (**admin** for `isSystem`) | Create a node. `isSystem:true` mints a protected system default (admin-only, `customerId` must be null). |
| `GET` | `/entities/:id` | read | Fetch one node; `deep` controls children. |
| `GET` | `/entities` | read | List/search with filters + pagination. |
| `GET` | `/entities/:id/children` | read | Direct (or bounded subtree) of one node. |
| `GET` | `/entities/resolve` | read | **Effective config** for a customer (own rows if any, else system). |
| `PATCH` | `/entities/:id` | write (admin for `is_system`) | Partial update; optimistic `version`. |
| `DELETE` | `/entities/:id` | write | Soft delete (default); `?hard=true`, `?cascade=true`. |
| `POST` | `/entities/:id/restore` | write | Un-delete a soft-deleted node. |
| `POST` | `/entities/clone` | write | Materialize the system tree under a customer. |
| `POST` | `/entities/revert` | write | Soft-delete all of a customer's rows → back to system. |
| `PUT` | `/entities/bulk-replace` | write | **Atomic whole-subtree replace** for a `(customerId, type)`; optimistic `If-Match`. |

### 2.1 `GET /entities` — list / search

Query parameters:

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | string (repeatable) | — | Exact `entity_type` (IN list). |
| `key` | string | — | Exact `entity_key`. |
| `value` | string | — | Exact `entity_value`. |
| `q` | string | — | Partial, case-insensitive over `key`+`value` (`%`/`_` escaped). |
| `id` | uuid (repeatable) | — | Fetch by id (IN list). |
| `parentId` | uuid \| `null` | — | Children of a parent; literal `null` → roots. |
| `customerId` | uuid | — | Scope to a customer's **own** rows (raw; for resolution use `/resolve`). |
| `scope` | enum | `system` | `system` (customer_id NULL) \| `customer` (needs `customerId`) \| `all`. |
| `state` | enum | `active` | `active` \| `inactive` \| `all` (filters `is_active`). |
| `includeDeleted` | bool | `false` | Also return `is_deleted=true`. |
| `metadata.<path>` | string | — | JSONB **containment** match, e.g. `metadata.ingestionId=ing_123` (`@>`). |
| `deep` | int \| `all` | `0` | Embed children (bounded by `ENTITY_MAX_DEPTH=5`). |
| `page` / `pageSize` | int | `1` / `50` | `pageSize` max 200. |
| `sort` | string | `sort_order_asc` | `<field>_<asc\|desc>`: `sort_order`, `entity_key`, `entity_type`, `created_at`, `updated_at`, `version`. Default and every `deep` traversal order siblings by `sort_order` then `entity_key`. |

### 2.2 `GET /entities/resolve` — effective config (whole-config)

```http
GET /api/v1/entities/resolve?customerId=<uuid>&deep=all&state=active
If-None-Match: "v_2026_06_23_a"        # optional — see versioning below
```
Returns the customer's own forest **if it has any non-deleted rows** (a whole-tree clone a MYIO operator has been editing), else the system-default forest. No per-node merge — it is the **saved** tree, verbatim. `data` is the resolved root list (with `children` when `deep≥1`), plus:
```jsonc
{ "success": true,
  "data": { "source": "customer" | "system", "version": "v_2026_06_23_a", "roots": [ /* RegistryEntity[] */ ] } }
```

**How `source` flips (the editing model).** A customer starts on `source:"system"`. When a MYIO operator needs a per-customer variant, they `POST /entities/clone` (whole tree, §2.4) → the customer now owns its rows and `/resolve` returns `source:"customer"`; the operator then `PATCH`/`DELETE`s those rows freely (add/rename/remove nodes). `POST /entities/revert` soft-deletes them and resolution falls back to `system`. The customer never writes any of this — the backend simply returns whatever is saved.

**Deterministic order.** Siblings at every level come back **ordered by `sort_order` asc, then `entity_key`** — never relying on row/insertion/JSON-key order. A consumer that classifies in order (e.g. an evaluator whose catch-all "fallback" node must be evaluated last) depends on this; by convention the fallback carries the highest `sort_order`.

**Versioning (`X-Version-Id` / 304).** `/resolve` returns an **`X-Version-Id`** response header (mirrored as `data.version`) = a stable hash of the resolved tree for that customer. A client may send **`If-None-Match: "<version>"`**; if nothing changed, the server replies **`304 Not Modified`** with no body. This reuses the alarm-bundle versioning pattern — downstream dashboards cache the tree and refetch only on change.

### 2.3 `POST /entities` / `PATCH /entities/:id`

```jsonc
// POST
{ "entityType": "PROFILE", "entityKey": "CHILLER", "entityValue": "Chiller 01",
  "parentEntityId": "7f1c…", "customerId": null, "isActive": true, "metadata": { "slaveId": 1 } }

// PATCH — any subset; metadata is a top-level merge (JSON Merge Patch: null = remove a key)
{ "entityValue": "Chiller A", "isActive": false, "metadata": { "slaveId": null }, "version": 3 }
```
`?metadataMode=replace` swaps metadata wholesale. **`version` semantics:** if `version` is sent and stale → `409 VERSION_CONFLICT`; if **absent** → last-write-wins (the field is then informational). Editing an `is_system` row requires **admin** scope; otherwise `409 SYSTEM_PROTECTED`.

**Per-type `metadata` validation (write path).** Because `metadata` is opaque jsonb, the service validates it on every write with a **Zod schema discriminated by `entity_type`** (`.strict()` — unknown keys rejected) → `400 VALIDATION_ERROR` on mismatch. A type with no registered schema accepts free-form metadata (back-compat). This is the **mandatory guard** when a consumer's classifier or logic reads structured fields out of `metadata` (e.g. RFC-0207's `rules`/`formula`) — the DB doesn't enforce shape, so the write path must, or a malformed write silently corrupts the consumer. **Containment filters (`metadata.<path>=…`) are only valid over top-level scalar keys** (e.g. `role`, `icon`, `domain`); nested objects/arrays like `rules`/`formula` are read payload, never filter predicates.

### 2.4 `POST /entities/clone` / `POST /entities/revert`

```jsonc
// clone — materialize the whole system tree for a customer (v1: scope = "*")
POST /entities/clone        { "customerId": "<uuid>" }
// 201 → { success, data: { cloned: 17, customerId } }
// 409 ALREADY_CLONED if the customer already has rows

// revert — soft-delete ALL the customer's rows; resolution falls back to system
POST /entities/revert       { "customerId": "<uuid>" }
// 200 → { success, data: { reverted: 17, customerId } }
```

### 2.5 `PUT /entities/bulk-replace` — atomic whole-subtree replace

For a consumer whose editor replaces a **whole tree** at once (e.g. RFC-0207's classification modal), orchestrating `revert`+`clone`+`PATCH` client-side is **non-atomic and racy** — a crash mid-way leaves the customer with a partial tree and `/resolve` can observe an intermediate state. This endpoint does the replace in **one transaction**.

```http
PUT /api/v1/entities/bulk-replace?customerId=<uuid>&type=<entity_type>
If-Match: "v_2026_06_23_a"          # the X-Version-Id of the subtree being replaced
Content-Type: application/json
{ "roots": [ /* the full new forest for (customerId, type), each node with children */ ] }
```

- **One transaction:** soft-delete every existing customer row for `(customerId, entity_type)`, insert the new set in topological order (remapping `parentEntityId`, `sortOrder` from each node's order). The `/resolve` view never sees a partial tree.
- **Optimistic concurrency at the *subtree* level** (not per-row): the server recomputes the current `X-Version-Id` for `(customerId, type)` inside the transaction; if it differs from `If-Match` → **`409 VERSION_CONFLICT`** (body carries `currentVersion`), rollback, **zero writes**. "Someone saved while you were editing" is deterministic, never last-write-wins. (The per-row `PATCH` `version` does not apply — the unit of concurrency here is the whole subtree.)
- **MYIO-only** (`entities:write`); the new set is validated as a unit: per-type `metadata` Zod (above), key uniqueness, depth ≤ `ENTITY_MAX_DEPTH`, cycle-free, parent-type rules.
- `200 → { success, data: { version: "<new>", source: "customer", replaced: <n> } }`.

### 2.6 `DELETE /entities/:id`

Soft delete by default. `?hard=true` (refused if children exist unless `?cascade=true`). `is_system` rows are never deletable → `409 SYSTEM_PROTECTED`.

---

## 3. Examples

```http
# all active GROUP system defaults
GET /api/v1/entities?type=GROUP&scope=system&state=active

# energy-commonarea with its direct profiles, active only
GET /api/v1/entities/7f1c…?deep=1&state=active

# the effective taxonomy a given customer should see
GET /api/v1/entities/resolve?customerId=84e0…&deep=all

# find a node by integration id (containment)
GET /api/v1/entities?metadata.ingestionId=ing_123

# partial search across key/value, including inactive, page 2
GET /api/v1/entities?q=chiller&state=all&page=2&pageSize=25
```

---

## 4. Errors

| HTTP | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod failure (bad type/key, bad metadata path, etc.). |
| 400 | `ENTITY_CYCLE` | A re-parent would create a cycle. |
| 400 | `INVALID_PARENT_TYPE` | `parent.entity_type` not in the child type's `allowedParentTypes`. |
| 400 | `PARTIAL_CLONE` | Attempt to clone a sub-tree (v1 clone is whole-config). |
| 403 | `FORBIDDEN` | Missing scope — a customer key on any write endpoint, a non-MYIO caller writing, a non-admin creating a type. |
| 404 | `NOT_FOUND` | Unknown id / parent / customer / type. |
| 409 | `VERSION_CONFLICT` | Optimistic mismatch — `version` on `PATCH`, or `If-Match` subtree version on `PUT /bulk-replace` (body carries `currentVersion`). |
| 409 | `DUPLICATE_KEY` | `(scope, type, key, parent)` already exists (non-deleted). |
| 409 | `RESTORE_CONFLICT` | Restoring would collide with a live `(scope, type, key, parent)`. |
| 409 | `SYSTEM_PROTECTED` | Delete/deactivate/edit of an `is_system` row by a non-admin. |
| 409 | `ALREADY_CLONED` | `clone` on a customer that already has rows. |
| 409 | `HAS_CHILDREN` | Hard delete of a node with children without `cascade=true`. |

---

## 5. Notes for consumers

- **Effective config:** downstream readers (bundles, dashboards) should call `GET /entities/resolve?customerId=` and treat `data.source` as informational. A customer with no override transparently gets system defaults.
- **Cache on `X-Version-Id`:** store the version alongside the resolved tree and send `If-None-Match` on refetch; treat `304` as "use cache". Don't re-pull the body while the version is unchanged.
- **Offline floor (baked default):** a consumer that runs where GCDR can be unreachable (e.g. an in-browser widget) should ship a **baked copy of the system-default tree** generated at build time, and fall back to it (logging `source:"baked"`) when `/resolve` fails — never blank the UI. The baked copy carries the `version` it was generated at. Regenerate it **in a PR** when the system-default tree changes: it is a **build step, not a runtime sync** — GCDR is never a build-time dependency.
- **Canonical keys (parity):** if a consumer pairs each `entity_key` with code (e.g. a classification engine evaluating a node's rules), keep a **checked-in list of the system-default `entity_key`s** so the consumer's CI can assert parity without calling GCDR. Membership rules travel **as data on the node** (`metadata`), evaluated by a **generic** engine — so adding a subcategory needs **no new per-key code**, only a baked regenerate.
- **Drift:** a customer's clone is a **snapshot** — system-default changes after a clone do **not** reach it. Re-sync is an explicit `revert` + `clone`.
- **Pagination + `deep`:** prefer `deep` for trees and pagination for flat lists; deep responses are not paginated (tiny data).

### 5.1 Example consumer — RFC-0207 device-classification tree

The dashboard classification profile (RFC-0207) is served **entirely by this generic registry** — no bespoke `/classification-profile` API. The integration registers its own types and a per-type metadata schema:

- **Types** (seeded in `entity_types`): `CLASSIFICATION_ENERGY` / `CLASSIFICATION_WATER` / `CLASSIFICATION_TEMPERATURE` for the domain roots (`allowedParentTypes: '{}'`), and `CLASSIFICATION_NODE` for every descendant (`allowedParentTypes: '{CLASSIFICATION_ENERGY,CLASSIFICATION_WATER,CLASSIFICATION_TEMPERATURE,CLASSIFICATION_NODE}'`). Depth = `parentEntityId`; the node's *role* lives in `metadata.role`, **not** in the type — so the tree topology stays arbitrary.
- **Field mapping:** `entity_key` = the stable classifier key (key-parity with the lib's golden engine); `metadata.label` = display name (i18n-friendly, not `entity_value`); `sort_order` = evaluation order; `metadata.{icon,role,rules,formula}` = the rest.
- **Per-type metadata schema** validates `{ label, domain?, icon?, role?, rules?, formula? }` `.strict()` on write. The `icon` field is validated against a **synced curated token set** (the canonical catalog is owned by MYIO-Design; GCDR mirrors it via a checked-in file — like the key-parity list, not a hard-coded enum — and rejects an off-catalog `icon` with `400 VALIDATION_ERROR`, so a free emoji can never enter via any write path).
- **Editing:** the operator's modal replaces the whole tree → `PUT /entities/bulk-replace?type=CLASSIFICATION_ENERGY` (§2.5). Load is `GET /entities/resolve` (304-aware, baked fallback in the widget).
