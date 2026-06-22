# RFC-0041 — Work Order Rules Engine (data-driven, per-tenant lifecycle)

- **Status:** Draft
- **Date:** 2026-06-14
- **Domain:** Work Orders (`wo` / OS)
- **Depends on:** [RFC-0037 — Work Orders Event Model](./RFC-0037-Work-Orders-Event-Model.md)
- **Companion:** [WO-OS-MAP.md](../WO-OS-MAP.md), [WO-OS-API-GUIDE.md](../WO-OS-API-GUIDE.md)

## 1. Summary

Make the WO state machine **data-driven and editable per tenant**. A
`work_orders_lifecycle_rules` table describes, for each event-type, its
**predecessors**, the **rule** over them (none / at least one / all), the
**types it activates next**, and the **status it projects**. A single Work Order
Rules Engine reads this table + a WO's event history to:

1. **project the WO status** (data-driven, no hardcoded mapping), and
2. **evaluate transitions** — which event-types are currently *allowed* and which
   are *blocked*, each blocked one carrying a machine reason (missing
   predecessors / not yet active / terminal).

A read endpoint exposes the evaluation so the UI shows the **full catalog** with
non-actionable types struck-through and a subtle reason — without duplicating any
rule. Because the flow lives in data, a tenant can reshape it (add steps, change
predecessors, allow repeats) without a deploy.

## 2. Motivation

- **Flexibility.** Different operations have different flows. A hardcoded
  suffix→status matrix (the Phase-1 engine) can't express "this customer
  requires a vistoria before finishing" or "allow partial executions to repeat".
  A per-tenant table gives the user full control of the flow.
- **Single source of truth.** Today the transition guards are duplicated in the
  frontend (`QUICK_ACTION_DEFS`). The engine + table removes the duplication and
  the client never computes status.
- **Explainability.** Blocked steps stay visible with a reason derived from the
  rule ("requer: Instalação iniciada", "aguarda ao menos um de …").

## 3. Data model

### 3.1 `work_orders_lifecycle_rules`

One row = one **node** of a tenant's flow (a governed event-type within a WO
type). Seeded with the current defaults so behavior is unchanged out of the box.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | per-tenant flow |
| `wo_type` | text NULL | `INSTALACAO` / `MANUTENCAO` / `VISITA_TECNICA`; **NULL = applies to every type** |
| `event_type` | text → `work_orders_event_types.code` | the node this rule governs |
| `predecessors` | text[] (default `{}`) | event-type codes that may gate this node |
| `predecessor_rule` | text | `NONE` · `ANY` · `ALL` (see §4) |
| `activates` | text[] (default `{}`) | event-types that become active **after** this node fires (forward edges; repeats allowed) |
| `projects_status` | text NULL | the WO status this event projects; **NULL = marker** (never moves status) |
| `is_entry` | boolean (default false) | true = available from the start (no predecessor needed) |
| `is_terminal` | boolean (default false) | true = firing this node **closes** the WO (no further lifecycle events) |
| `sort_order` | int (default 0) | display order in the composer |
| `active` | boolean (default true) | soft toggle |

Constraints: `UNIQUE(tenant_id, wo_type, event_type)`,
`predecessor_rule IN ('NONE','ANY','ALL')`. Resolution precedence: a row with a
specific `wo_type` overrides a `wo_type IS NULL` row for the same
`(tenant, event_type)`.

> **Terminal handling.** A rule's `is_terminal` flag marks a closing node: once
> it fires, the WO is closed and no further lifecycle events are allowed. The
> tenant's terminal *statuses* are derived from the `projects_status` of its
> terminal rules; when none is flagged, the engine falls back to the built-in
> `FINALIZADA`/`CANCELADA`.

### 3.2 Example (default INSTALACAO flow, abbreviated)

| event_type | predecessors | rule | activates | projects_status | entry |
|---|---|---|---|---|---|
| `INSTALACAO_PLANEJADA` | `{}` | NONE | `{INSTALACAO_INICIADA, INSTALACAO_REAGENDADA, INSTALACAO_CANCELADA}` | PLANEJADA | ✓ |
| `INSTALACAO_INICIADA` | `{INSTALACAO_PLANEJADA, INSTALACAO_REAGENDADA}` | ANY | `{PRODUTO_INSTALADO, INSTALACAO_INTERROMPIDA, INSTALACAO_FINALIZADA}` | EM_ANDAMENTO | |
| `PRODUTO_INSTALADO` | `{INSTALACAO_INICIADA}` | ALL | `{PRODUTO_INSTALADO, INSTALACAO_FINALIZADA}` | *(null marker)* | |
| `INSTALACAO_INTERROMPIDA` | `{INSTALACAO_INICIADA}` | ANY | `{INSTALACAO_REINICIADA}` | INTERROMPIDA | |
| `INSTALACAO_FINALIZADA` | `{INSTALACAO_INICIADA}` | ANY | `{}` | FINALIZADA | |

Note `PRODUTO_INSTALADO` lists itself in `activates` — **repeats are allowed**.

## 4. Engine semantics

Let `occurred` = the set of event-type codes already present on the WO.

**Allowed?** For a node `n` (resolved row for the WO's type):

- `NONE` → allowed (entry / ungated).
- `ANY` → allowed iff `predecessors ∩ occurred ≠ ∅`.
- `ALL` → allowed iff `predecessors ⊆ occurred`.

Additionally, if the WO is **terminal** (latest projecting event is terminal),
all lifecycle nodes are blocked (`reasonCode: TERMINAL`). Non-lifecycle markers
(`ESTRUTURA`/`OBSERVACAO`/`ANEXO`) without a governing row are always allowed.

`activates` is the **forward set** a node enables; it powers the flow diagram and
lets the UI preview "what becomes available next". (The authoritative gate is
`predecessors`+`rule`; `activates` is the explicit forward declaration and may be
validated against it.)

**Status projection.** Walk the WO events newest→oldest; the status is the
`projects_status` of the most recent event whose node has a non-null
`projects_status`. Fallback `PLANEJADA`.

**Blocked reasons** (machine, UI localizes):

| reasonCode | when | context |
|---|---|---|
| `TERMINAL` | WO already finalizada/cancelada | — |
| `MISSING_PREDECESSORS` | `ANY`/`ALL` rule unmet | `predecessors`, `rule`, `missing[]` |
| `TYPE_MISMATCH` | lifecycle event of another WO type | — |

## 5. Engine API

`src/services/work-orders/workOrderRules.ts` (pure functions; the rule rows are
injected so the engine has no I/O):

```ts
interface LifecycleRule {
  woType: string | null;
  eventType: string;
  predecessors: string[];
  predecessorRule: 'NONE' | 'ANY' | 'ALL';
  activates: string[];
  projectsStatus: string | null;
  isEntry: boolean;
}

function projectStatus(events, rules): Status;
function evaluateTransitions(wo, catalog, occurred, rules): TransitionEvaluation[];
```

`WorkOrderService` loads the tenant's rules (cached) and delegates. A
`WorkOrderLifecycleRepository` reads `work_orders_lifecycle_rules`; when a tenant
has **no** rows, the engine falls back to the **built-in default flow** (the
Phase-1 matrix, kept as the seed), so the table is optional.

## 6. Endpoint

```
GET /api/v1/wo/work-orders/:id/transitions
→ { status, transitions: [ { code, category, label, targetStatus, allowed,
                             reasonCode?, predecessors?, missing?, activates? } ] }
```

WO detail keeps returning the already-projected `status`. The UI re-fetches
`/transitions` after appending an event (the server recomputes everything).

Admin (managing the flow) — Phase 3:

```
GET    /wo/lifecycle-rules           # tenant's rows
PUT    /wo/lifecycle-rules           # replace the tenant's flow (validated DAG-ish)
```

## 7. Frontend usage

- **Record-event picker** shows the whole catalog; `allowed:false` cards render
  struck-through with a subtle reason from `reasonCode` (+ `missing`). Selecting
  a blocked type is disabled.
- **Quick actions** derive from `transitions` (allowed lifecycle moves) — the
  hardcoded `QUICK_ACTION_DEFS` guards are removed.
- No status math in the client.

## 8. Rollout

1. **Phase 1 (shipped):** built-in default engine (suffix matrix) +
   `getTransitions` + endpoint. Behavior baseline.
2. **Phase 2:** `work_orders_lifecycle_rules` table + repository + seed of the
   defaults; engine reads rules, falls back to the built-in default when empty.
   `projects_status` makes status data-driven.
3. **Phase 3:** admin endpoints + UI to edit a tenant's flow; validation
   (no orphan predecessors, reachable terminals).
4. Tests: engine matrix (status × rule), predecessor rules (NONE/ANY/ALL),
   terminal lock, repeats.

## 9. Out of scope

- Role-based gating (who *may* trigger a transition) — orthogonal to *what* is
  state-valid.
- Time/SLA-based automatic transitions.
