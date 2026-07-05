# RFC-0051 — Work Order Groups ("Grupo de OS") & Parent/Child Work Orders

- **Feature Name:** `work-order-groups`
- **Start Date:** 2026-07-03
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft — urgent
- **Authors:** Rodrigo Lago (rplago@gmail.com), MYIO Platform Team
- **Domain:** Work Orders (`wo` / OS) — extends RFC-0037
- **Depends on:** [RFC-0037](./RFC-0037-Work-Orders-Event-Model.md) (event model), [RFC-0041](./RFC-0041-Work-Order-Rules-Engine.md) (data-driven lifecycle), [RFC-0044](./RFC-0044-Chamados-Work-Order-Type.md) (Chamados — the pattern this RFC generalizes)
- **Migration:** next free runner slot (`0057_work_order_groups.sql` as of authoring; renumber at integration if taken)
- **Stakeholders:** Field Operations, Platform Backend, Platform Frontend

---

## 1. Summary

Introduce **Work Order Groups** ("Grupo de OS"): a way to organize OS hierarchically, modeled the same way Chamados were (RFC-0044) — inside the existing `work_orders` table, not as a new domain. Two things ship together:

1. A **generic parent edge**: `work_orders.parent_id` (self-FK). **Any OS can have child OS** ("filhas") — an INSTALACAO can have sub-OS, and groups can nest.
2. A new **WO type `GRUPO`**: a pure container/aggregate OS — no field execution of its own — whose purpose is to group N child OS, with **status roll-up** from the children and an **aggregated timeline**, exactly like a CHAMADO does for its derived OS.

A Grupo IS a `work_order`: it gets a `code`, an `assigned_to` (the coordinator), `customer_id`, events, annotations, files and audit for free, and the RFC-0041 engine drives its lifecycle with zero engine changes.

## 2. Motivation

Chamados proved the aggregate-OS pattern works: one parent that fans out into N execution OS, with traceability, roll-up and an aggregated timeline. But that structure is only reachable through a CHAMADO — which drags along ticket semantics (requester, priority, SLA views) that pure field-work orchestration doesn't want. Operations needs to say "these 8 OS are one delivery" (a floor retrofit, a multi-asset installation, a maintenance campaign) without opening a support ticket, and needs an OS to break into smaller filhas when execution demands it.

## 3. Data model

### 3.1 The generic parent edge

```
work_orders.parent_id  uuid? -> work_orders.id   (partial idx on (tenant_id, parent_id))
```

- **Cardinality:** 1 parent : N children; a WO has at most one `parent_id`.
- **Any type can be a parent.** `GRUPO` is the dedicated container type, but an INSTALACAO may have filhas too (execution breakdown).
- **Nesting:** multi-level allowed (grupo → grupo → OS → sub-OS). Service-level guards: **cycle rejection** (walk ancestors on attach) and **max depth 5** (configurable constant; see Q2).
- **Same tenant + same `customer_id`** required between parent and child (mirrors the chamado rule). Cross-customer grouping is a non-goal.
- Soft-deleted WOs cannot be attached to or gain children; deleting a parent **detaches** its children (with events), never cascades deletion.

### 3.2 Relationship to `ticket_id` (RFC-0044)

`ticket_id` (chamado membership) and `parent_id` (structural hierarchy) are **orthogonal axes and both stay**: an OS can hang on a chamado *and* be part of a grupo (e.g., a chamado derives an OS that the operations team executes inside a campaign group). Unifying the two edges into a typed relation is explicitly deferred (Q1) — non-breaking now beats elegant later, and RFC-0044 already reserved `work_order_relations(from, to, relation)` as the escape hatch if N:N or typed links become real needs.

### 3.3 New WO type

`work_orders_type_check` widens to `('INSTALACAO','MANUTENCAO','VISITA_TECNICA','CHAMADO','GRUPO')`.

`GRUPO` needs **no side table** (contrast: chamados needed `work_orders_ticket_meta` for requester/priority/source). If group-specific fields appear later (e.g., campaign window), add a 1:1 side table then — same playbook as RFC-0044 §3.1.

### 3.4 Events (link history lives in the event log)

Two new marker event types, emitted **on both sides** of every attach/detach — the mirror of `CHAMADO_OS_VINCULADA`/`_DESVINCULADA`:

- `OS_FILHA_VINCULADA` — on the parent (payload: child id/code) and on the child (payload: parent id/code)
- `OS_FILHA_DESVINCULADA` — inverse

No provenance column: "who grouped what when" is reconstructable from events, as with chamados.

### 3.5 Lifecycle for `GRUPO` (data-driven, RFC-0041)

Seeded lifecycle rules, no engine change: `PLANEJADA → EM_ANDAMENTO → FINALIZADA | CANCELADA`. Transitions may be human or produced by roll-up (below).

## 4. Behavior

### 4.1 Roll-up (GRUPO only)

Reuses the RFC-0044 §4.3 mechanism: the `WorkOrderAggregationService` recomputes on **every child transition and every attach/detach**, counting only currently-linked children, and appends lifecycle events through the engine (auditable, per-tenant configurable):

| Aggregate condition (linked children only) | Effect on the grupo |
|---|---|
| Any child active | grupo auto `EM_ANDAMENTO`; blocked from FINALIZADA |
| All terminal, ≥1 `FINALIZADA` | **suggest** `FINALIZADA` (human confirms — same default as chamado auto-resolve) |
| All `CANCELADA`, none active | auto `CANCELADA` |

**Non-GRUPO parents get NO automatic roll-up.** An INSTALACAO with filhas has its own execution and its own status; children progress is surfaced as an informational badge (`childrenCount` / `childrenDone`) in DTOs and UI only. This is the key semantic line: *GRUPO status IS its children; other types merely HAVE children.*

### 4.2 Aggregated timeline

`GET /wo/work-orders/:id/timeline?include=children` — query-time union of own events/annotations with all currently-linked children's events, chronological, each item tagged with the source OS code. Identical mechanics to RFC-0044 §4.4 (`include=derived` for chamados; `children` for the structural axis).

### 4.3 Creating children ("Derivar OS" generalized)

`POST /wo/work-orders` with `parentId` set: creates the child already linked, inheriting `customer_id` (mandatory) and optionally a subset of the parent's `work_orders_devices` — the same first-class action chamados have (RFC-0044 §4.2), now available from any OS.

## 5. API

| Endpoint | Change |
|---|---|
| `POST /wo/work-orders` | accepts `type: GRUPO`; accepts optional `parentId` on any create |
| `PUT /wo/work-orders/:id/parent` `{parentId \| null}` | attach / detach / move (move = detach+attach, two event pairs) |
| `GET /wo/work-orders/:id/children` | paginated children list (status filter) |
| `GET /wo/work-orders/:id/tree` | bounded subtree (≤ max depth) for the UI tree view |
| `GET /wo/work-orders` (list) | new filters `parentId=`, `rootOnly=true`; list DTO gains `parentId`, `childrenCount`, `childrenDone` |
| `GET /wo/work-orders/:id/timeline` | new `include=children` |

Auth/visibility: unchanged — same guards as every WO route (JWT/customer scoping per RFC-0037/0013). A child invisible to the viewer is **counted** in roll-up numbers but not listed (counts are server-side).

## 6. Migration (single file, additive)

`0057_work_order_groups.sql`:

1. `ALTER TABLE work_orders ADD COLUMN parent_id uuid REFERENCES work_orders(id);`
2. Partial index `(tenant_id, parent_id) WHERE parent_id IS NOT NULL`.
3. Widen `work_orders_type_check` with `'GRUPO'` (drop + re-add constraint).
4. Insert `OS_FILHA_VINCULADA` / `OS_FILHA_DESVINCULADA` into the event-type catalog.
5. Seed RFC-0041 lifecycle rules for `wo_type = 'GRUPO'`.

No backfill needed; existing rows are untouched (`parent_id` NULL = root, today's universal state).

## 7. UI (gcdr-frontend `/os`) — what "refletir na UI" means

> Companion frontend RFC can split this out if the team prefers; the spec lives here for now to keep the urgent path single-document.

1. **List (Clientes / OS tabs):** default to `rootOnly=true`; rows with children render an **expander chevron** that lazily loads `GET .../children` as indented sub-rows (one level per expand — no full-tree fetch). `GRUPO` rows get a distinct type icon/chip and a **progress badge `childrenDone/childrenCount`** (e.g. `3/5`). The badge also appears on non-GRUPO parents.
2. **WO detail:** new **"OS filhas"** section — table of children (code, type, status, assignee) with three actions: **Criar OS filha** (opens the existing `WorkOrderCreateWizard` pre-filled with customer + `parentId`), **Vincular existente** (search modal restricted to same customer, root or reparent-with-confirm), **Desvincular** (confirm dialog; emits the marker events). Parent/ancestry rendered as a **breadcrumb** above the header (`GRP-012 › OS-340 › this`).
3. **Timeline:** toggle **"Incluir OS filhas"** (mirrors the chamado `include=derived` toggle), items tagged with the source OS code.
4. **Wizard:** `WorkOrderCreateWizard` gains the `GRUPO` type; when creating a GRUPO, an optional step **"Criar filhas em lote"** (repeat a template N times / one per selected asset) — batch step may land in a later phase (see Phases).
5. **Guards in UI:** moving a child between parents always confirms; attaching shows the cycle/depth/customer errors from the API verbatim (they are user-actionable).

## 8. Phases

| Phase | Deliverable |
|---|---|
| G1 | Migration 0057 + entity/DTO plumbing + marker events |
| G2 | Service + endpoints: attach/detach/move (cycle+depth+customer guards), children/tree, list filters, timeline union, GRUPO roll-up via aggregation service |
| G3 | UI: list expander + badges, detail "OS filhas" section, breadcrumb, timeline toggle |
| G4 | Wizard GRUPO type + batch child creation; polish (Copiloto/assistant awareness of groups) |

G1+G2 are independently shippable (API-first); G3 is the minimum UI to call the feature done.

## 9. Non-goals

- N:N / typed relations (RELATED, DUPLICATE, BLOCKS) — `work_order_relations` remains the future escape hatch (RFC-0044 §3.3).
- Cross-customer or cross-tenant grouping.
- Migrating `ticket_id` onto `parent_id` (Q1).
- Roll-up for non-GRUPO parents (informational badge only, by design).

## 10. Open questions

- **Q1:** Unify `ticket_id` into a typed relation later, or keep two edges permanently? (Proposal: keep both; revisit only if a third axis appears.)
- **Q2:** Max depth — is 5 right? Field ops likely uses 2–3 (grupo → OS → sub-OS); the cap exists to keep `tree` queries and breadcrumbs bounded.
- **Q3:** Should a GRUPO's device scope be the **union of children's devices** (computed, read-only) or independently managed? (Proposal: computed union in the detail view, nothing stored.)
- **Q4:** Roll-up defaults — auto-`EM_ANDAMENTO` ON, suggest-`FINALIZADA`, auto-`CANCELADA` ON (mirroring chamado defaults). Per-tenant override via the same config the chamado aggregation uses.

---

*Draft for approval.*
