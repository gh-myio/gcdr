# RFC-0047 — Generic Entity Registry (typed key/value tree + system defaults & per-customer clone)

- **Status:** Draft — **design closed** via a BMAD party-mode review (Winston · Amelia · John · Sally), 2026-06-23. Ready for implementation.
- **Created:** 2026-06-23
- **Updated:** 2026-06-23 (v2 — adds the `entity_types` registry, `is_system`, per-customer override via clone, and the must-fix/defer split; **v3 sync** — `sort_order` (deterministic sibling order), MYIO-only writes, membership-as-data, resolving the sibling-ordering open question)
- **Author:** MYIO Engineering
- **Domain:** Platform / Master Data (cross-cutting)
- **Migration:** next free runner migration, e.g. `00NN_entities.sql` (≥ 0049 — 0047/0048 are taken by RFC-0046). See `docs/DB-MIGRATIONS.md`.
- **Companion docs:**
  - `RFC-0047-Entity-API.md` — the authoritative wire contract (endpoints, filters, errors).
  - `RFC-0047-Entity-schema.md` — the Drizzle/SQL schema snippet.
- **Related:** RFC-0016 (TB Entity Mapping, integration ids in metadata) · RFC-0028 (JSONB envelope precedent) · RFC-0009 (audit logs) · RFC-0046 (system-default + per-customer pattern adjacency).

---

## Why this matters

Across the MYIO ecosystem we keep inventing the *same shape* over and over: a small, typed, named record that (a) has stable audit columns, (b) can be soft-deleted and deactivated without losing history, (c) occasionally points at a *parent* record of the same kind, and (d) carries a little free-form JSON for integration ids. Telemetry groups (energy-entry, energy-store, energy-commonarea, water-*, temperature-*, and later gas/humidity/pulses) with their **profile** children (CHILLER, FANCOIL, HVAC under energy-commonarea) are exactly this shape. Each new variant today gets either a brand-new table (migration + controller + DTO + repo + tests) or gets stuffed into a `metadata` blob where it can't be queried, related, or audited.

This RFC proposes **one generic table** — `entities` — that models a *typed key/value node in a forest*, governed by a small **type registry**, with **system defaults** that every customer inherits and an opt-in **per-customer clone** so a customer can diverge and customize. A team adds a new grouping/profile concept by inserting rows (and, for a genuinely new *type*, an admin adds one registry row) — no per-concept migration — and gets listing, filtering, hierarchy traversal, soft-delete, full audit, and the system-default/override resolution for free from a single shared controller/service.

This is **not** EAV and **not** a home for hot, high-cardinality domain aggregates (devices, work orders, customers keep their own tables). It is the pragmatic home for the long tail of *configuration-shaped, low-cardinality, hierarchical lookup data* — see *Drawbacks* and the explicit **promotion criterion**.

---

## Summary

A single multi-tenant table `entities`:

- **Identity** — `id` (uuid), plus a typed natural key `(entity_type, entity_key)`.
- **Type registry** — `entity_type` is a FK into `entity_types` (a small seed/admin-governed table that also encodes allowed parent/child types). **Creating a type is admin-only**; operators only *choose* existing types.
- **Value** — optional `entity_value` (the "value" half of key/value).
- **Hierarchy** — `parent_entity_id` (nullable self-FK) forms an adjacency-list forest (shallow: domain×role → profile → equipment).
- **Scope** — `customer_id` (nullable). **NULL = system default** (inherited by all customers); **set = a customer's own override** — `customer_id` says who the taxonomy is *for*, **never who may edit it**. `is_system` marks the protected, never-deletable system rows. `clone_scope_key` (default `'*'`) reserves the future per-axis override granularity without a v1 cost.
- **Ordering** — `sort_order` (int) gives **deterministic sibling order**; system-locked on `is_system` rows.
- **Who writes — MYIO only.** Every mutation (create/edit/delete/clone/revert) is **MYIO-operator-only**; a **customer API key is read/resolve-only** and never carries `entities:write`. No customer-editable surface, no "request reclassification" flow — whoever classifies, reclassifies: a MYIO operator edits the tree directly and it is done.
- **Lifecycle** — `is_active` (toggle) and `is_deleted` (soft delete), independent.
- **Audit** — `created_at/by`, `updated_at/by`, `version` (optimistic).
- **Extensibility** — `metadata` JSONB (e.g. `ingestionId`).

…plus a REST surface under `/api/v1/entities` (CRUD, `deep` traversal, rich filters), an **effective-config** resolution endpoint (customer's own rows if any, else system), **clone** / **revert** operations, an admin tree UI, and a **per-customer "Taxonomy" tab** that toggles *use system* vs *clone & edit*.

---

## Guide-level explanation

### The mental model

An **entity** is a node. It has a **type** (from the registry — e.g. `GROUP`, `PROFILE`, `EQUIPMENT`) and a **key** (the taxonomy value within that type — e.g. `energy-commonarea`, `CHILLER`). It may carry a **value** and may point at a **parent** of the same kind. Roots have `parent_entity_id = NULL`.

```
GROUP / energy-commonarea          (root, system default)
├── PROFILE / CHILLER
├── PROFILE / FANCOIL
└── PROFILE / HVAC
```

> **Shape A (chosen).** Few *types* (`GROUP`, `PROFILE`, `EQUIPMENT`); the rich telemetry taxonomy lives in `entity_key`. The registry encodes "a `PROFILE` may only hang under a `GROUP`". This keeps the type set tiny and governable instead of turning every taxonomy string into a type.

> **Membership is data, not code (for downstream classifiers).** When a consumer classifies devices into these profiles (e.g. the climatização engine), the **per-node matching rules live in `metadata`** (e.g. `metadata.match: { deviceProfiles, identifierContains }`) and are evaluated by a **generic engine** in the consumer. Adding a profile/subcategory is therefore a **data** insert here — **no new per-key code** downstream. The *engine semantics* (how the rules evaluate, and `sort_order` as evaluation order) stay in the consumer's golden-tested code; this registry supplies only the typed tree + ordering. (A consumer that runs offline should ship a build-time **baked copy** of the system-default tree and keep a checked-in list of system `entity_key`s for CI parity — see `RFC-0047-Entity-API.md` §5.)

> **Worked example — RFC-0207 device-classification (no bespoke API).** The dashboard classification tree is served entirely by this registry: types `CLASSIFICATION_ENERGY|WATER|TEMPERATURE` (roots) + `CLASSIFICATION_NODE` (descendants); `entity_key` = stable classifier key, `metadata.label` = display, `sort_order` = evaluation order, `metadata.{icon,role,rules,formula}` = the rest — validated by the per-type Zod schema (must-fix #10). The editor saves via `PUT /entities/bulk-replace`; `metadata.icon` is checked against a curated token set synced from MYIO-Design (a checked-in mirror, not a hard-coded enum). Full mapping in `RFC-0047-Entity-API.md` §5.1. This is the template for *any* consumer: register types, register a metadata schema, consume `/resolve`.

### System defaults vs per-customer override

- A **system default** row has `customer_id = NULL` and `is_system = true`. Every customer **inherits** it. It is **never deletable/deactivatable**; only an admin path may edit it.
- A customer is **binary** (v1, *whole-config*): either **using system defaults** (zero own rows → read-fallback) or **customized** (its entire taxonomy materialized under its `customer_id`).
- **Resolution** is dead simple: *does the customer have ≥1 non-deleted row? serve the customer's; else serve the system's.*
- **Clone** ("create a copy and edit") materializes the system tree under the customer (new ids, remapped parents, `is_system = false`). From then on it is a **snapshot** — later changes to the system default do **not** propagate (documented drift; re-sync is a manual revert + re-clone).
- **Revert** ("go back to system") soft-deletes all the customer's rows in one tx → resolution falls back to system again. Re-clone later picks up the *current* system.

> `clone_scope_key` is `'*'` for everyone in v1 (whole-config). It is carried in the schema so the future **per-root-tree** granularity (a customer customizes `energy-commonarea` while still receiving system updates on `water-*`/`temperature-*`) becomes a **data migration, not a redesign**.

### What you get for free

No per-concept migration; soft-delete ≠ deactivate; built-in audit; hierarchy without a join table; system-default inheritance with opt-in override.

### When *not* to use it (promotion criterion)

Promote an `entity_type` to its **own real table** the moment **any** of these fire:
1. The service starts branching on it (`if entity_type === 'X'` business logic) — it has behavior.
2. It needs a typed FK *from* another domain (real referential integrity).
3. It becomes hot/high-cardinality (rule of thumb: thousands of rows per tenant, or a hot read path).
4. A field in `entity_value`/`metadata` needs its own index + semantics for recurring filter/aggregate.
5. The tree stops being shallow (ancestors/descendants as a first-class operation → closure table or promotion).

Rule of thumb: **`entities` is for nodes the system reads and displays but does not reason about and does not relate to strongly.**

---

## Reference-level explanation

> The authoritative wire contract is `RFC-0047-Entity-API.md`; the DDL/Drizzle is `RFC-0047-Entity-schema.md`. This section states the model and the rules they implement.

### Tables

**`entity_types`** — the governed type registry (seed-driven; admin adds rows):

| Column | Notes |
| --- | --- |
| `entity_type` (PK, text) | e.g. `GROUP`, `PROFILE`, `EQUIPMENT` |
| `tenant_id` | scope |
| `label`, `description` | for the admin UI |
| `allowed_parent_types text[]` | which types may be this node's parent (`{}` = root-only) |
| `is_active` | retire a type without deleting |

**`entities`** — the nodes:

| Column | Notes |
| --- | --- |
| `id uuid` PK | `gen_random_uuid()` |
| `tenant_id uuid` | mandatory, scopes everything |
| `customer_id uuid NULL` | **NULL = system default**, set = customer override |
| `entity_type text` | **FK → entity_types** |
| `entity_key text` | taxonomy value (e.g. `energy-commonarea`, `CHILLER`) |
| `entity_value text NULL` | optional payload |
| `parent_entity_id uuid NULL` | self-FK, `ON DELETE RESTRICT` |
| `sort_order int NOT NULL DEFAULT 0` | deterministic sibling order; **system-locked** on `is_system` rows |
| `clone_scope_key text NOT NULL DEFAULT '*'` | v1 always `'*'`; reserves per-axis override |
| `is_system boolean NOT NULL DEFAULT false` | protected system rows |
| `is_active boolean NOT NULL DEFAULT true` | |
| `is_deleted boolean NOT NULL DEFAULT false` | soft delete |
| `metadata jsonb NOT NULL DEFAULT '{}'` | e.g. `ingestionId` |
| `created_at/by`, `updated_at/by`, `version` | audit + optimistic lock |

**Invariants (enforced — CHECK + trigger + service):**
- **Writes are MYIO-only** — a customer API key (`gcdr_cust_*`) on any write endpoint → **`403 FORBIDDEN`**; `entities:write` is a MYIO-staff scope. Customer keys read/resolve only.
- `is_system = true` ⇒ `customer_id IS NULL` (no "system row of a customer").
- `is_system = true` rows are **immutable to non-admin writers**: DELETE (soft/hard), deactivate, and edit all return **`409 SYSTEM_PROTECTED`** — including changing `sort_order` (reordering a system row = rewriting classification order). A `BEFORE DELETE/UPDATE` **trigger** is the source of truth; the service returns the friendly status. Admin-only paths may edit system rows.
- `parent_entity_id <> id` (CHECK); deeper cycles + parent-type rules (`allowed_parent_types`) + same-tenant/same-scope parent enforced in the **service** (cycle check is synchronous).

### Uniqueness

Two partial unique indexes (system vs customer namespaces), excluding soft-deleted rows so a key frees on delete and re-clone works:

```sql
-- system defaults: one default per (type, key, parent)
CREATE UNIQUE INDEX entities_system_uq ON entities
  (tenant_id, COALESCE(parent_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_key)
  WHERE customer_id IS NULL AND is_deleted = false;

-- customer overrides: one per customer namespace
CREATE UNIQUE INDEX entities_customer_uq ON entities
  (tenant_id, customer_id, COALESCE(parent_entity_id,'00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_key)
  WHERE customer_id IS NOT NULL AND is_deleted = false;
```

A customer override **coexists** with the system row (same `entity_key`); the "shadow" is **logical** — done in resolution, not by the index.

### Effective-config resolution (whole-config)

```
hasCustom = EXISTS(SELECT 1 FROM entities
                   WHERE tenant_id=:t AND customer_id=:cid AND is_deleted=false)
served = hasCustom ? rows WHERE customer_id=:cid
                   : rows WHERE customer_id IS NULL AND is_system=true   -- + non-system system-scope rows, see note
       AND is_deleted=false
```

No per-node merge, no hybrid tree (a mixed tree would orphan a customer profile under a system parent — forbidden by construction). *(Note: "system scope" = `customer_id IS NULL`, which includes both `is_system` defaults and any non-protected system-scope rows an admin added.)*

### Clone & revert

- **Clone** (`POST /entities/clone` for a customer): one transaction — `SELECT … FOR SHARE` the system rows, build an `old_id → new_id` map, remap `parent_entity_id` (NULL stays NULL), set `customer_id`, `is_system = false`, reset `version`/audit, insert in topological order. **Re-clone is refused → `409 ALREADY_CLONED`** (overwrite would destroy customizations). An advisory lock on `(tenant, customer)` serializes concurrent clones.
- **Revert** (`POST /entities/revert` for a customer): one transaction soft-deleting **all** the customer's rows → resolution falls back to system. **Soft delete** (recoverable, audited); the partial unique `WHERE is_deleted=false` lets a later clone insert fresh rows without colliding with the dead layer. (Optional ops housekeeping: purge clone rows soft-deleted > N days.)
- **Drift:** a clone is a snapshot; later system-default changes do **not** propagate. Re-sync = revert + re-clone. Stated as a contract, not a TODO.
- **Bulk-replace** (`PUT /entities/bulk-replace?customerId=&type=`): for a consumer whose editor saves a **whole tree at once**, doing `revert`+`clone`+`PATCH` from the client is non-atomic and racy. This is the atomic alternative — **one transaction** soft-deletes the customer's rows for `(customer_id, entity_type)` and inserts the new forest in topological order. **Optimistic concurrency is at the *subtree* level**: the server recomputes the `(customer, type)` version inside the tx and rejects a stale `If-Match` with `409 VERSION_CONFLICT` (zero writes) — the per-row `version` does not apply to a whole-tree replace.

### `deep` semantics

`deep` embeds children under `data.children` (recursively), bounded by `ENTITY_MAX_DEPTH` (default 5):
- `deep=0` (default) — the entity only.
- `deep=1` — entity + direct children.
- `deep=N` / `deep=all` — bounded subtree; each cut parent carries **`truncated:true`** (per-node, not a global flag). At this scale `deep` loads the whole subtree in one query and assembles in memory (no lazy-per-level, no N+1 by construction).

**Sibling order is deterministic** — children come back ordered by `sort_order` asc, then `entity_key` — never relying on row/insertion/JSON-key order. Order-sensitive consumers (e.g. a classifier whose catch-all node must evaluate last) depend on this; by convention the fallback carries the highest `sort_order`.

### List / search filters

`type`, `key`, `value`, `q` (partial, case-insensitive over `key`+`value`), `id` (batch), `parentId` (`null` = roots), `customerId` (resolve effective config), `state` (`active|inactive|all`), `includeDeleted`, `metadata.<path>` (containment), `deep`, `page`/`pageSize`, `sort`. Standard envelope `{ success, data, pagination }` with `total`/`totalPages`. Full table in `RFC-0047-Entity-API.md`.

### Validation & correctness rules (the must-fix set)

From the implementation review — these are **must-fix v1**, scale-independent:
1. **`RESTORE_CONFLICT`** — restoring a soft-deleted node whose `(scope, key, parent)` was re-created returns **409**, never a raw 500 from the unique constraint.
2. **`SYSTEM_PROTECTED`** — any non-admin delete/deactivate/edit of an `is_system` row → 409 (trigger + service).
3. **`ALREADY_CLONED`** — re-clone of an already-customized customer → 409.
4. **metadata merge** — `PATCH metadata` is a strict **top-level** merge; define the delete-key sentinel (recommend **JSON Merge Patch / RFC 7396**: `null` = remove). `?metadataMode=replace` swaps wholesale.
5. **`version` semantics** — fixed and documented: absent `version` on `PATCH` = **last-write-wins** (field then informational) **or** required (412) — pick one in the API doc; mismatch = `409 VERSION_CONFLICT`.
6. **cycle check is synchronous** — a re-parent that would create a cycle → `400 ENTITY_CYCLE` (walk ancestors); `parent_type` must be in `allowed_parent_types`.
7. **`metadata.<path>` is parameterized** — path passed as a `text[]` (`#> $1::text[]`) / containment (`@>`), never string-interpolated; allow-list chars, cap segments.
8. **`q` escapes `%`/`_`**.
9. **revert is whole-scope** — deleting one override row keeps the customer in customer-mode (no partial fallback / no node-mixing); only deleting **all** rows resumes system.
10. **per-type `metadata` validation** — when a consumer reads structured fields out of `metadata` (e.g. a classifier reading `rules`/`formula`), the service validates `metadata` on write with a **Zod schema discriminated by `entity_type`** (`.strict()`, unknown keys rejected) → `400 VALIDATION_ERROR`. The DB cannot enforce jsonb shape, so the write path must — otherwise a malformed write silently corrupts the consumer (the failure mode behind the Moxuara double-serialization bug). Types with no registered schema accept free-form metadata (back-compat). Containment filters stay over **top-level scalars** only.

**Deferred at this scale (<1000, internal-UI writer)** — accept/defer with a one-line note: concurrent-re-parent lock (advisory only on clone), GIN index on `metadata`, `pg_trgm`/`tsvector` for `q` (accept seq-scan), `ENTITY_MAX_NODES` cap, the no-N+1 query-count test. Add a plain B-tree index on `customer_id`.

### Management UI

**Admin (system defaults):** tree/forest browser (lazy one-level expand at this scale is fine), `entity_type` = **SELECT** (never free text), `entity_key` with live duplicate-check showing the **scope** of uniqueness, `parent` picker showing the **full path** (breadcrumb), `entity_value`, `is_active`, a **validated** JSON metadata editor, cycle-checked re-parent, soft-delete/restore, and a hard-delete that **shows the impact** (descendant count + references) with type-to-confirm. `is_system` rows are non-deletable in the UI.

**Per-customer "Taxonomy" tab** (inside a customer's detail; operated by MYIO staff):
- A **full-width state banner**: 🔵 *Using system default* (`[Create copy & customize]`) or 🟠 *Customized (copy)* with **who + when** and `[Revert to system default]`.
- **Create copy** opens a modal naming the consequences (edit freely / stops receiving system updates / revertible-but-loses-edits) + the **item count** to be copied; the state flip is visible (banner color + toast).
- Once cloned, the same tree UI scoped to the customer, with per-node **"modified" / "new"** markers (a full side-by-side diff vs system is **v2**, on real pain).
- **Revert** lists, item by item, what is lost + type-the-customer-name to confirm (soft-delete = recoverable by support).
- **Cut from v1:** partial clone, mass re-parent, type creation (admin-only, separate). `is_system` items stay non-deletable inside a clone.

---

## Drawbacks

- **Genericity erodes type-safety.** Mitigated by the `entity_types` registry (no free type strings) + admin-only type creation; integrity *into* the data still uses the uuid, not the natural key.
- **Adjacency-list = app-side recursion.** Fine for the shallow trees here; bounded depth + whole-subtree-in-one-query avoid N+1. Deep analytics would want a closure table (promotion).
- **JSONB metadata is second-class to query.** Containment only; not a substitute for real columns when a field becomes a first-class filter.
- **Clone drift.** A clone is a snapshot; system changes don't propagate. Accepted (re-sync = revert + re-clone); whole-config keeps it to one decision point per customer.

## Alternatives considered

- **A real table per concept** — best type-safety/query power, worst velocity. The taxonomy here is 8+ open-ended group types with profile children — the pattern is already proven (rule-of-three met many times over), so a generic registry is justified, not premature.
- **Pure EAV** — rejected; `entity_value` + bounded `metadata` cover "a few extra fields" without exploding structure into rows.
- **Closure table / `ltree`** — superior for deep/heavy trees; deferred (shallow, low-cardinality) and named as the promotion path.
- **Per-root-tree override granularity** — endorsed as the *future* shape; deferred behind `clone_scope_key='*'` because at this scale (internal writer, tiny volume, one-toggle UI) whole-config is simpler and the upgrade is a data migration.

## Resolved decisions

| Question | Decision |
| --- | --- |
| Type as free string? | **No** — `entity_types` registry (FK), admin-only creation. Shape A (taxonomy in `entity_key`). |
| Multi-tenant? | **Yes** — `tenant_id` mandatory. |
| System defaults | `customer_id IS NULL AND is_system=true`; **never deletable/deactivatable** (trigger + 409 `SYSTEM_PROTECTED`). |
| Override unit (v1) | **Whole-customer-config** — customer is binary (system vs cloned). `clone_scope_key='*'` reserves per-root-tree for later. |
| Resolution | `customer has ≥1 non-deleted row ? customer : system` — no per-node merge, no mixing. |
| Clone | Snapshot copy (id/parent remap, `is_system=false`, version reset); re-clone = `409 ALREADY_CLONED`. |
| Revert | **Soft delete** all customer rows → fallback resumes; re-clone picks up current system. |
| Drift | **No auto-sync** (contract); re-sync = revert + re-clone. |
| Soft vs hard delete | Soft default; hard refused with children unless `cascade=true`; `is_system` never. |
| Hierarchy | Adjacency-list (`parent_entity_id`), depth-bounded; closure table deferred. |
| `deep` default | `0`; `1` = direct children; `N`/`all` bounded, `truncated` per-node. |
| Sibling ordering | **Explicit `sort_order` int** — siblings resolve by `sort_order` then `entity_key`; system-locked on `is_system` rows. |
| Who edits | **MYIO only** — customer keys read/resolve-only (`403` on writes); no customer-editable surface, no reclassification flow. |
| Membership rules | **Data on the node (`metadata`)**, evaluated by a generic engine in the consumer — new subcategory = data insert, no per-key code. |
| `metadata.<path>` | Parameterized **containment (`@>`)**; B-tree on `customer_id`; GIN deferred at this scale. |

## Unresolved questions

- **Type ownership UI** — admin creates types; do we need a tiny `entity_types` admin screen in v1, or seed + migration only? (Lean: seed/migration; UI later.)
- **Per-field audit** — audit columns vs a `metadata.changelog` (RFC-0028 style) / `entity_history` table. (Defer.)
- **Value typing** — `entity_value` is text; a typed value (`value_number`/`value_bool`) may emerge.
- **Cross-tenant global types** — types are tenant-scoped for now.

## Implementation plan

1. **Migration** `00NN_entities.sql` — `entity_types` + `entities` (+ `customer_id`, `is_system`, `clone_scope_key`, `sort_order`), the two partial unique indexes (the parent index carries `sort_order`), the FK and CHECK invariants, the `BEFORE DELETE/UPDATE` `is_system` trigger, and a B-tree on `customer_id`. Seed the initial `entity_types` (`GROUP`/`PROFILE`/`EQUIPMENT`) and the system-default taxonomy.
2. **Schema/types** — Drizzle (`RFC-0047-Entity-schema.md`); `RegistryEntity`, `EntityType` domain types.
3. **DTOs** — Zod request/response (`CreateEntityDTO`, `UpdateEntityDTO`, `ListEntitiesQuery`, `CloneDTO`, `BulkReplaceDTO`) enforcing the validation rules, plus a **per-`entity_type` `metadata` schema registry** (`.strict()`) applied on every write (must-fix #10).
4. **Repository** — tenant-scoped CRUD, filtered list, batched `deep` loader, effective-config resolution, clone/revert, **bulk-replace (single-tx whole-subtree swap)**, cycle check; soft-delete + `is_system` aware.
5. **Service** — uniqueness, parent/tenant/type-rule checks, cycle prevention, `SYSTEM_PROTECTED`/`RESTORE_CONFLICT`/`ALREADY_CLONED`, per-type metadata validation, clone/revert, **bulk-replace with subtree-level `If-Match` → `VERSION_CONFLICT`**, optimistic `version`.
6. **Controller** — `/api/v1/entities` with hybrid auth; `entities:read` for reads/resolve, `entities:write` (**MYIO-only** — customer keys get `403` on writes) for mutations; envelope + pagination (`RFC-0047-Entity-API.md`).
7. **Tests** — unit (cycles, uniqueness, deep assembly, soft-delete, resolution, `is_system` protection ×4, clone remap integrity, re-clone refused, revert/fallback, drift no-propagation, no-node-mixing) + integration (endpoints, filters, `deep`, pagination, tenant isolation).
8. **Frontend** — admin tree UI + per-customer Taxonomy tab (banner, clone/revert modals, "modified/new" markers) reusing existing list/modal/JSON-editor components.
9. **Docs** — keep `RFC-0047-Entity-API.md` in sync with the controller.
