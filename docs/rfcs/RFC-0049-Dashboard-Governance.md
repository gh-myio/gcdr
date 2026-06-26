# RFC-0049 — Dashboard Governance, Catalog & Access Profiles

- **Feature Name:** `dashboard-governance`
- **Start Date:** 2026-06-26
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Domain:** Platform / Master Data + Authorization (cross-cutting)
- **Migration:** next free runner migration, e.g. `00NN_dashboards.sql` (≥ next free; see `docs/DB-MIGRATIONS.md`).
- **Related RFCs:**
  - [RFC-0002](./RFC-0002-GCDR-Authorization-Model.md) — Authorization Model (RBAC + lightweight ABAC). **Hard dependency** — dashboard permissions are expressed in its vocabulary.
  - [RFC-0012](./RFC-0012-Features-Registry.md) — Features Registry (feature flags gating UI capability).
  - [RFC-0013](./RFC-0013-User-Access-Profile-Bundle.md) — Access Profile Bundle (the bundle gains a `dashboards` section).
  - [RFC-0047](./RFC-0047-Generic-Entity-Registry.md) — Generic Entity Registry (the **system-default + per-customer clone** pattern is reused verbatim for default dashboards).
  - [RFC-0009](./RFC-0009-Events-Audit-Logs.md) — Audit Logs (every governance mutation is audited).
  - [RFC-0016](./RFC-0016-ThingsBoard-Entity-Mapping.md) — ThingsBoard Entity Mapping (alias resolution targets GCDR entity ids; TB ids live in `metadata`).
- **Stakeholders:** Platform, Frontend, Mobile, Security, Customer Success, IoT Integration.
- **Prior art:** ThingsBoard PE *Dashboards*, *Entity Groups*, *Roles (Generic & Group)*, *White-Labeling*, *Public Dashboards*, *Dashboard States & Entity Aliases*. This RFC adapts those concepts onto GCDR's existing primitives rather than importing ThingsBoard's data model wholesale.

---

## Why this matters

Today there is **no first-class notion of a dashboard inside GCDR**. Dashboards live as ad-hoc artifacts in the frontend and in ThingsBoard, their visibility is decided by scattered frontend conditionals and per-deployment configuration, and "who may see which dashboard" is neither auditable, versioned, nor portable across the customer hierarchy. As MYIO onboards resellers and enterprise customers who each want their **own catalog of dashboards** — some inherited from MYIO defaults, some private, some shared down their sub-customer tree, some published to anonymous public links — the lack of a governance layer becomes the bottleneck.

ThingsBoard solved a structurally identical problem with a small set of orthogonal concepts: a *dashboard* is an entity; entities are placed in *groups*; *roles* grant operations either generically (across a whole entity type) or per-group; dashboards are *assigned to customers*; and a dashboard can be made *public* for unauthenticated access. We already have the building blocks to express every one of these in GCDR — RBAC (RFC-0002), the customer hierarchy (ROOT→RESELLER→ENTERPRISE→BUSINESS→INDIVIDUAL), the system-default/clone pattern (RFC-0047), and the access bundle (RFC-0013). This RFC ties them together into a **complete dashboard governance solution** so that dashboard visibility becomes governed master data: declarative, scoped, inheritable, auditable, and consumable by every client (web, mobile, M2M) from one source of truth.

This RFC governs **dashboard identity, cataloguing, ownership, sharing, and access** — it is **not** a widget/rendering engine and does not prescribe how a dashboard is drawn. The `layout` blob is opaque to GCDR (see *Non-Goals*).

---

## Summary

Introduce three governed tables plus a thin permission projection:

- **`dashboards`** — the dashboard record: identity, owner, an opaque `layout` JSONB, lifecycle, audit, optimistic `version`, and **system-default + per-customer clone** semantics borrowed wholesale from RFC-0047.
- **`dashboard_groups`** — named collections of dashboards (the GCDR analogue of ThingsBoard *Entity Groups*) that are the **unit of sharing and the unit of role assignment**. A dashboard may belong to many groups.
- **`dashboard_assignments`** — the binding of a dashboard (or group) to a **principal scope** (a customer subtree, an RBAC role, a specific user, or `PUBLIC`) with an **access level** (`VIEW` | `EDIT` | `MANAGE`).

On top of these:

- **Access profiles** are expressed entirely in RFC-0002 RBAC vocabulary. We add a `dashboard` resource type with operations `read|create|update|delete|share|publish`, evaluable both *generically* (all dashboards in a scope) and *per-group* (group-scoped roles) — the Generic-vs-Group role distinction from ThingsBoard PE.
- **System-default dashboards** (`customer_id = NULL`, `is_system = true`) are inherited by every customer; a customer may **clone & edit** to diverge (RFC-0047 resolution, verbatim).
- **Public dashboards** get a signed, revocable public token for unauthenticated read (aligned with RFC-0020 Public Single Apps).
- The **Access Profile Bundle** (RFC-0013) grows a `dashboards` section so offline/M2M clients receive their resolved, visible catalog in one payload.
- A REST surface under `/api/v1/dashboards` (CRUD, `share`, `publish`, `clone`, `revert`, group management, and an **effective-catalog** resolution endpoint).

---

## Guide-level explanation

### The mental model

Four nouns, each orthogonal:

```
DASHBOARD            a governed record with an opaque layout
  └─ belongs to many DASHBOARD_GROUPs        (collection / sharing unit)
       └─ shared via DASHBOARD_ASSIGNMENT    (who + how)
            └─ enforced by RBAC ROLE         (RFC-0002 operations)
```

A **dashboard** answers *"what"*. A **group** answers *"which bundle of them travels together"*. An **assignment** answers *"to whom, and at what level"*. A **role** answers *"which operations that principal may perform"*. Keeping these four separate is the whole design — it is what lets MYIO ship a default fleet, a reseller curate a sub-catalog, and an enterprise customer publish one read-only dashboard to a lobby screen, all without code changes.

### Ownership & the four scopes an assignment can target

Every dashboard has exactly one **owner**: either **MYIO/system** (`owner_customer_id = NULL`, `is_system = true`) or a **customer** (`owner_customer_id` set). Ownership confers implicit `MANAGE`. An owner shares access *downward and sideways* by creating assignments whose target is one of:

| Target kind | Meaning | Example |
| --- | --- | --- |
| `CUSTOMER_SUBTREE` | every customer at/under a node in the hierarchy | a RESELLER shares a group with all its ENTERPRISE children |
| `ROLE` | every principal holding an RBAC role (group-scoped role = ThingsBoard "Group role") | "Energy Analyst" role gets `VIEW` on the *Energy* group |
| `USER` | one named user | a one-off `EDIT` grant to a contractor |
| `PUBLIC` | anonymous, token-gated read | a kiosk/lobby screen |

`access_level` is a coarse ladder on top of fine-grained RBAC: `VIEW` ⊂ `EDIT` ⊂ `MANAGE`. The ladder is a **convenience projection**; the authoritative check is always the RFC-0002 evaluator (see *Reference-level*). The ladder never *grants beyond* what RBAC allows — it only narrows.

### System defaults vs per-customer override (reused from RFC-0047)

Identical resolution to the Entity Registry, so there is one mental model across the platform:

- A **system-default dashboard** has `owner_customer_id = NULL`, `is_system = true`. Every customer inherits it (read-only) and it is **never deletable/deactivatable** by a customer; only an admin path edits it.
- A customer is **binary per dashboard-key** (v1): either **using the system default** (no own row → read-fallback) or **customized** (its own cloned copy materialized under its `owner_customer_id`).
- **Resolution:** *does the customer have a non-deleted dashboard with this `dashboard_key`? serve theirs; else serve the system's.*
- **Clone** ("copy & edit") materializes the system dashboard (new id, `is_system = false`, layout deep-copied, aliases remapped). From then on it is a **snapshot** — later system-default changes do **not** propagate (documented drift; re-sync = revert + re-clone).
- **Revert** soft-deletes the customer's copy → resolution falls back to the system default again.

### States & entity aliases (what lives in `layout`, what GCDR governs)

A dashboard's `layout` JSONB carries the ThingsBoard-style **states** (named views the user can drill between) and **widget config** — **opaque** to GCDR. What GCDR *does* govern is the **entity-alias bindings**: a sidecar `aliases` JSONB whose alias targets are **GCDR entity ids / filters** (RFC-0047) rather than free text. On clone and on cross-customer share, GCDR **remaps or validates** these aliases so a shared dashboard resolves against the *recipient's* entities, never the owner's. This is the one piece of layout semantics GCDR understands, because it is the one that has a governance consequence (data leakage across tenants).

### Public dashboards

`POST /dashboards/:id/publish` mints a **revocable, signed public token** and an assignment with target `PUBLIC`, level `VIEW`. Anonymous reads hit `GET /public/dashboards/:token`. Publishing is itself an RBAC-gated operation (`dashboard:publish`) and a high-signal audit event. Aliases that resolve to non-public entities are stripped/denied at publish time (a public dashboard cannot leak a private device list).

### What you get for free

No per-dashboard migration; soft-delete ≠ deactivate; built-in audit (RFC-0009); hierarchy-scoped sharing without a bespoke join; system-default inheritance with opt-in override; one resolution rule shared with RFC-0047; one bundle payload for offline/M2M (RFC-0013).

### When *not* to use this

This is governance, not rendering. Do **not** push high-frequency widget state, per-user layout tweaks that aren't shared, or telemetry into these tables. If a "dashboard" is really a single embedded public app, it may belong under RFC-0020 instead — see *Rationale and alternatives*.

---

## Reference-level explanation

### Tables

**`dashboards`** — the record:

| Column | Notes |
| --- | --- |
| `id uuid` PK | `gen_random_uuid()` |
| `tenant_id uuid` NOT NULL | scopes everything |
| `owner_customer_id uuid NULL` | **NULL = system default**, set = customer-owned |
| `dashboard_key text` NOT NULL | stable natural key (for system-default ↔ clone resolution), e.g. `energy-overview` |
| `title text` NOT NULL | display |
| `description text NULL` | |
| `layout jsonb` NOT NULL DEFAULT `'{}'` | **opaque** — states, widgets, widget config |
| `aliases jsonb` NOT NULL DEFAULT `'{}'` | entity-alias bindings → GCDR entity ids/filters (governed; remapped on clone/share) |
| `is_system boolean` NOT NULL DEFAULT `false` | protected system rows (never customer-deletable) |
| `is_public boolean` NOT NULL DEFAULT `false` | derived/cached from a `PUBLIC` assignment |
| `public_token text NULL UNIQUE` | signed token for anonymous read; rotated on republish |
| `is_active boolean` NOT NULL DEFAULT `true` | toggle (independent of delete) |
| `is_deleted boolean` NOT NULL DEFAULT `false` | soft delete |
| `metadata jsonb` NOT NULL DEFAULT `'{}'` | extensibility (e.g. ThingsBoard `tbDashboardId`) |
| `version int` NOT NULL DEFAULT 1 | optimistic concurrency |
| `created_at/by`, `updated_at/by` | audit columns |

Constraints: `UNIQUE (tenant_id, owner_customer_id, dashboard_key)` (with `owner_customer_id IS NULL` treated as the system slot). Partial unique index on `public_token WHERE public_token IS NOT NULL`.

**`dashboard_groups`** — collections (the sharing/role-assignment unit):

| Column | Notes |
| --- | --- |
| `id uuid` PK | |
| `tenant_id uuid` NOT NULL | |
| `owner_customer_id uuid NULL` | NULL = system group |
| `group_key text` NOT NULL | stable key, e.g. `energy`, `water`, `executive` |
| `title text` NOT NULL | |
| `is_system`, `is_active`, `is_deleted`, audit, `version` | as above |

**`dashboard_group_members`** — many-to-many dashboard↔group:

| Column | Notes |
| --- | --- |
| `group_id uuid` FK → dashboard_groups | `ON DELETE CASCADE` |
| `dashboard_id uuid` FK → dashboards | `ON DELETE CASCADE` |
| `sort_order int` NOT NULL DEFAULT 0 | deterministic order within the group |
| PK `(group_id, dashboard_id)` | |

**`dashboard_assignments`** — who + how:

| Column | Notes |
| --- | --- |
| `id uuid` PK | |
| `tenant_id uuid` NOT NULL | |
| `subject_kind text` NOT NULL | `DASHBOARD` \| `GROUP` (what is being shared) |
| `subject_id uuid` NOT NULL | FK to dashboards or dashboard_groups (by `subject_kind`) |
| `target_kind text` NOT NULL | `CUSTOMER_SUBTREE` \| `ROLE` \| `USER` \| `PUBLIC` |
| `target_id uuid NULL` | customer/role/user id; NULL for `PUBLIC` |
| `access_level text` NOT NULL | `VIEW` \| `EDIT` \| `MANAGE` |
| `is_active`, audit columns | |

Constraints: `UNIQUE (tenant_id, subject_kind, subject_id, target_kind, target_id)`; `target_id` NULL only when `target_kind = 'PUBLIC'`.

### Permission model (RFC-0002, not a parallel system)

We register **one resource type** `dashboard` and **one** `dashboard_group` with operations `read | create | update | delete | share | publish`. RBAC policies may be written:

- **Generically** — `dashboard:read` scoped to a customer subtree → "read any dashboard owned by/assigned within this subtree" (ThingsBoard *Generic role*).
- **Per-group** — a policy whose `scope_entity_ids` reference `dashboard_group` ids → "read only dashboards in these groups" (ThingsBoard *Group role*).

The **effective decision** for *(principal, dashboard, operation)* is:

```
ALLOW  iff  RFC-0002 evaluator returns ALLOW for (principal, dashboard:<op>, scope)
            AND an assignment chain exists granting access_level ≥ required(op)
            AND no explicit DENY (RFC-0002 deny wins)
required(read)=VIEW · required(update)=EDIT · required(share|publish|delete)=MANAGE
```

The `access_level` ladder **narrows** RBAC; it never widens it. Ownership implies a synthetic `MANAGE` self-assignment. Evaluation reuses `POST /authorization/check` and `/check/batch` (RFC-0002) — **no new evaluator**.

### REST surface (`/api/v1`)

| Method & path | Op | Notes |
| --- | --- | --- |
| `GET /dashboards` | read | list with filters (`groupId`, `ownerCustomerId`, `isSystem`, `isPublic`, `q`); paginated (`total`,`totalPages` per house standard) |
| `GET /dashboards/:id` | read | single |
| `POST /dashboards` | create | owner = caller's customer (or system if admin) |
| `PUT /dashboards/:id` | update | optimistic `expectedVersion` → `409` with `currentVersion` on mismatch |
| `DELETE /dashboards/:id` | delete | soft delete; system rows protected |
| `POST /dashboards/:id/clone` | create | customer copy of a system default (RFC-0047 semantics) |
| `POST /dashboards/:id/revert` | delete | drop customer copy → fall back to system default |
| `POST /dashboards/:id/share` | share | body: `{ targetKind, targetId, accessLevel }` |
| `DELETE /dashboards/:id/share/:assignmentId` | share | revoke |
| `POST /dashboards/:id/publish` | publish | mint/rotate `public_token`; strips non-public aliases |
| `DELETE /dashboards/:id/publish` | publish | unpublish (revoke token + PUBLIC assignment) |
| `GET /public/dashboards/:token` | — | unauthenticated read; rate-limited; layout + resolved public aliases only |
| `GET /dashboards/effective` | read | **resolution endpoint** — the caller's fully-resolved, visible catalog (system defaults + own + shared), already de-duplicated by `dashboard_key`, grouped |
| `… /dashboard-groups` (CRUD + members) | per-op | mirrors the above for groups |

**Auth:** hybrid (`hybridAuthByMethod`) — JWT Bearer *or* customer API key. Reads need `dashboards:read` (or `*:read`); mutations need the matching op scope. Public read needs no auth but a valid, non-revoked token.

**Envelope & errors:** standard GCDR envelope (`sendSuccess`/`sendCreated`, `AppError`/`NotFoundError`/`ValidationError`). `409` for version conflicts; `403` for RBAC denials; `410 Gone` for a revoked public token.

### Bundle integration (RFC-0013)

The Access Profile Bundle gains a `dashboards` section:

```json
{
  "dashboards": {
    "groups": [{ "groupKey": "energy", "title": "Energy", "dashboardKeys": ["energy-overview", "energy-detail"] }],
    "catalog": [
      { "dashboardKey": "energy-overview", "id": "…", "source": "SYSTEM", "accessLevel": "VIEW", "version": 7 },
      { "dashboardKey": "executive-kpi", "id": "…", "source": "CUSTOMER", "accessLevel": "EDIT", "version": 3 }
    ]
  }
}
```

`source ∈ { SYSTEM, CUSTOMER, SHARED }` makes the resolution outcome explicit to offline clients; `version` lets a client cache-bust.

### Audit (RFC-0009)

Every mutation appends an audit row. High-signal events get dedicated types: `DASHBOARD_CREATED|UPDATED|DELETED|CLONED|REVERTED`, `DASHBOARD_SHARED|UNSHARED`, `DASHBOARD_PUBLISHED|UNPUBLISHED` (the last two are security-relevant — anonymous exposure). Audit captures actor, target, before/after for `share`/`publish`, and the assignment delta.

### Transactional invariants

- Clone (insert dashboard + remap aliases + copy group memberships) runs in **one transaction**.
- Publish (mint token + upsert PUBLIC assignment + set `is_public` + strip aliases) runs in **one transaction**.
- The layout upsert, the `version` bump, and the audit append run in **one transaction** (RFC-0046 pattern).

---

## Drawbacks

- **Another governance surface to learn.** Four tables + a permission projection is real conceptual weight. Mitigation: the resolution rule and clone/revert are *identical* to RFC-0047, so there is one model to learn, not two.
- **Alias remapping is the hard part.** Cross-customer share and publish must rewrite/validate alias targets or risk tenant data leakage. This is genuinely non-trivial and is the main implementation risk (see *Unresolved questions*).
- **`access_level` ladder vs RBAC could confuse.** Two notions of "permission" (coarse ladder + fine RBAC) coexist. We keep the ladder strictly *narrowing* and make RBAC authoritative to avoid two sources of truth, but the dual model still needs clear docs.
- **Opaque `layout` limits server-side validation.** GCDR can't validate widget config it doesn't understand; a malformed layout fails only at render time on the client. Accepted: GCDR governs *who/what*, the client owns *how*.
- **System-default drift.** Clones are snapshots; system improvements don't propagate. Same documented trade-off as RFC-0047.

---

## Rationale and alternatives

- **Why not store dashboards only in ThingsBoard?** TB owns rendering but not MYIO's cross-platform governance (mobile, M2M, public apps, the access bundle). GCDR is already the master-data source of truth; dashboards as governed records keep visibility auditable and portable. TB ids live in `metadata.tbDashboardId` for sync (RFC-0016).
- **Why not fold dashboards into the RFC-0047 generic entity registry?** Dashboards have *behavior* (publish/share/clone with alias remapping), a hot-ish read path (the effective catalog), and strong relations (groups, assignments, RBAC scope) — they trip the RFC-0047 **promotion criterion** (#1, #2, #5). They get their own tables by design.
- **Why a coarse `access_level` on top of RBAC instead of pure RBAC?** Pure RBAC is expressive but verbose for the 90% case ("share this group, read-only, with my child customers"). The ladder is the ergonomic front door; RBAC remains the authoritative back-stop. This mirrors ThingsBoard's Generic/Group-role + assignment split, which has proven usable at scale.
- **Why not per-user dashboard copies (like personal TB dashboards)?** Out of scope for v1; personal un-shared tweaks belong in client-side state, not governed master data. Revisit if demand appears.
- **Alternative: lean on RFC-0020 Public Single Apps for everything public.** RFC-0020 is the right home for a *standalone embedded app*; this RFC's public dashboards are the *same governed record* exposed read-only. They share the signed-token mechanism but the dashboard remains a first-class governed entity.

---

## Prior art

- **ThingsBoard PE** — *Dashboards* (entity), *Entity Groups* (collections + sharing unit), *Roles* split into **Generic** (entity-type-wide) and **Group** (group-scoped) — adopted as our generic-vs-group permission split; *Customer assignment* of dashboards (adopted as `CUSTOMER_SUBTREE` assignment); *Public dashboards* via shareable link (adopted as signed `PUBLIC` token); *Dashboard states & entity aliases* (kept opaque in `layout`, except governed `aliases`); *White-labeling* (deferred — see *Future possibilities*).
- **GCDR internal** — RFC-0047 (system-default + clone resolution, reused verbatim), RFC-0002 (RBAC vocabulary, reused as-is), RFC-0013 (bundle projection), RFC-0046 (transactional version+audit pattern), RFC-0020 (public token mechanism).
- **Grafana** — folder + folder-permission model and "default home dashboard" informed the group-as-permission-unit and system-default-home choices.

---

## Unresolved questions

1. **Alias remapping policy on cross-customer share.** Auto-remap by entity-key match, require explicit mapping, or strip-and-warn? Leaning: validate + strip-with-warning on share; explicit remap on clone. *To resolve before implementation.*
2. **Group ownership across the hierarchy.** May a RESELLER's group contain a system-default dashboard, or only owned/cloned ones? Leaning: groups may *reference* system defaults (membership = data), but sharing a group resolves each member through the recipient's view.
3. **`dashboard_key` collision between a customer clone and a later system default of the same key.** Resolution already prefers the customer row; confirm we never want a customer to see *both*.
4. **Per-root override granularity** (the RFC-0047 `clone_scope_key` analogue) — do we need partial clone (clone one group, inherit the rest) in v1, or defer? Leaning: defer; carry no schema cost in v1.
5. **Public token rotation & expiry policy** — TTL, max public dashboards per customer, rate limits on `/public/dashboards/:token`.
6. **Versioned dashboard history** — do we want RFC-0015-style version snapshots of `layout` for rollback, or is optimistic `version` enough for v1?

---

## Future possibilities

- **White-labeling / theming per customer or per group** (ThingsBoard parity) — a `theme` reference (RFC theme/Themes module) resolved alongside the dashboard.
- **Dashboard version history & rollback** (RFC-0015 pattern) for the `layout` blob.
- **Scheduled/snapshot exports** (PDF/PNG) and email/Slack delivery of a dashboard view.
- **Per-root partial clone** via `clone_scope_key`, enabling a customer to customize one group while still receiving system updates on the rest.
- **Dashboard templates & a marketplace** (tie-in with RFC-0001 Integration Marketplace) — MYIO and partners publish reusable dashboard templates customers instantiate via clone.
- **MCP server for dashboards** (RFC-0042 pattern) so an agent can list/clone/share dashboards on an operator's behalf.
- **Embed/iframe governance** — domain allow-lists for where a public dashboard token may be embedded.
