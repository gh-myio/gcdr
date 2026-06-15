# RFC-0044 — Chamados (Work Order type `CHAMADO`)

- **Status:** Draft
- **Date:** 2026-06-15
- **Domain:** Work Orders (`wo` / OS) — extends RFC-0037
- **Depends on:** [RFC-0037 WO Event Model], [RFC-0041 Rules Engine], [RFC-0036/0037 file_assets owner types]
- **Related:** `docs/integracao_freshdesk_myio.md` (Freshdesk × Myio ticket views)

## 1. Summary

Bring **support tickets ("chamados")** into GCDR natively, modeled as a new
**Work Order type `CHAMADO`** rather than a separate domain. A chamado is a
parent/aggregate that **fans out into N execution Work Orders** (INSTALACAO,
MANUTENCAO, VISITA_TECNICA), with full **traceability**, an **aggregated
timeline**, **status roll-up** from its children, and **per-profile visibility**
(Técnico / Supervisor / Holding) as described in the Freshdesk integration deck.

A chamado IS a `work_order`, so parent↔child is a self-referential edge in the
same table and the engine/UI/Copiloto operate on one uniform model.

## 2. Why extend Work Orders (not a new domain)

- The WO model is already event-sourced with **status projected by events** and a
  **per-`wo_type` data-driven lifecycle** (RFC-0041) — a chamado is just another
  type with its own flow, no engine change.
- Reuses, with zero new structure: `customer_id` (the ticket "empresa"/unit),
  `assigned_to` (the agent/responsible), `work_orders_devices` (open a ticket
  about 1+ devices), `work_orders_files` → `file_assets` (attachments),
  **annotations** (the human thread: replies/notes with mentions + attachments),
  Audit Logs (RFC-0009).
- Parent→child fan-out is a self-reference (`work_orders.ticket_id`), so
  traceability queries are trivial joins.

If a chamado ever needs a radically different lifecycle, it can be promoted to a
standalone domain later without losing the edge (it stays an id).

## 3. Data model

### 3.1 New: ticket-specific 1:1 extension
```
work_orders_ticket_meta              -- only rows where work_orders.type = 'CHAMADO'
  work_order_id   uuid PK -> work_orders.id (cascade)
  tenant_id       uuid
  subject         varchar(255)       -- "Assunto"
  priority        text  (BAIXA|MEDIA|ALTA|URGENTE)  default MEDIA
  reason          text               -- "Motivo" (free / catalog)
  source          text  (PAINEL|EMAIL|FRESHDESK|API) default PAINEL
  requester_email   varchar(255)     -- key for the 3 views
  requester_user_id uuid? -> users.id  -- resolved if the email exists in the base
  requester_domain  text             -- derived from requester_email (idx) -> Holding view
  external_id     text               -- Freshdesk ticket id (migration hook, idx)
  first_response_at timestamptz?
  resolved_at     timestamptz?
  created_at / updated_at
```

A 1:1 side table (instead of nullable columns on `work_orders`) keeps the main
table lean and untouched for field-service OS.

### 3.2 New: CC / watchers
```
work_orders_watchers
  id, tenant_id, work_order_id -> work_orders.id (cascade)
  email varchar(255), user_id uuid?
  unique(work_order_id, email)
```

### 3.3 New: the parent edge (managed, mutable)
```
work_orders.ticket_id  uuid? -> work_orders.id   (idx)   -- the CHAMADO this OS hangs on
```
- **Managed from OS management**: `PUT /wo/work-orders/:id/ticket` attaches/detaches.
  Each attach/detach **emits an event on both sides** (`CHAMADO_OS_VINCULADA` /
  `CHAMADO_OS_DESVINCULADA`), so the link history lives in the event log — the
  "origin" is reconstructable from events, no separate provenance column.
- Cardinality **1 chamado : N OS** (an OS belongs to at most one chamado at a
  time). If N:N is ever needed (an OS under several chamados, or RELATED/DUPLICATE
  links), introduce a generic `work_order_relations(from, to, relation)`; `ticket_id`
  covers the dominant case for now.

### 3.4 Catalog + lifecycle for `CHAMADO`
- `work_orders_event_types` gains category `CHAMADO` codes (seeded in migration
  0043): `CHAMADO_ABERTO` (entry), `CHAMADO_PENDENTE`,
  `CHAMADO_AGUARDANDO_SOLICITANTE`, `CHAMADO_RESOLVIDO`, `CHAMADO_REABERTO`,
  `CHAMADO_OS_VINCULADA`, `CHAMADO_OS_DESVINCULADA`, `CHAMADO_CANCELADO`
  (terminal), `CHAMADO_FECHADO` (terminal).
- Status vocabulary (projected): `ABERTO | PENDENTE | AGUARDANDO | RESOLVIDO |
  FECHADO | CANCELADO` (AGUARDANDO and CANCELADO already exist in the WO status
  set; the rest are new projected strings — the `status` column is free text).
- `work_orders.type` CHECK is widened to include `CHAMADO`.
- Per-tenant lifecycle rows (RFC-0041) define the flow; a default set is seeded
  for the test tenant (`scripts/db/seeds/30-chamado-lifecycle.sql`). The
  `LIFECYCLE_CATEGORIES` set in `workOrderRules.ts` gains `CHAMADO` (Phase 2).

## 4. Traceability, roll-up and aggregated timeline

### 4.1 Traceability (both directions)
- From a chamado: `SELECT … FROM work_orders WHERE ticket_id = :id` → all derived
  OS + their status.
- From an OS: `ticket_id` → its chamado.

### 4.2 "Derivar OS" — first-class action
`POST /wo/tickets/:id/work-orders` (or `POST /wo/work-orders` with `ticketId`):
1. creates the child OS with `ticket_id` set;
2. inherits context (customer, a **subset** of the chamado's
   `work_orders_devices`, requester);
3. emits `CHAMADO_OS_VINCULADA` on the chamado timeline (and the inverse on
   detach).

### 4.3 Status roll-up (configurable, via the engine)
A `WorkOrderAggregationService` recomputes the chamado's aggregate on **every
child transition and every attach/detach** (counting only currently-linked OS),
and may **auto-append a `CHAMADO` lifecycle event** (so it goes through the
RFC-0041 engine — auditable, configurable, disableable):

| Aggregate condition (linked OS only) | Effect on the chamado |
|---|---|
| All linked OS `CANCELADA`, none active | auto `CHAMADO_CANCELADO` → **CANCELADO** (e.g. the sole OS was cancelled) |
| All terminal, ≥1 `FINALIZADA` | mark **resolvable** (suggest `CHAMADO_RESOLVIDO`; close stays human-confirmed) |
| Any linked OS active | chamado **blocked** from RESOLVIDO/FECHADO (reason surfaced like the event picker) |

Defaults: **auto-cancel ON**, **auto-resolve as a suggestion** (human confirms).
The communication axis (AGUARDANDO solicitante, etc.) stays manual and
independent; aggregation only drives the transitions it governs. All rules are
per-tenant config.

### 4.4 Aggregated timeline
The chamado timeline = its own events/annotations **∪** all events of its
currently-linked OS, by **query-time union** (no write amplification, always
fresh), chronological, each item tagged with its source OS code:
```
GET /wo/work-orders/:ticketId/timeline?include=derived
  -> own events ⊕ work_orders_events WHERE work_order_id IN (OS WHERE ticket_id = :ticketId)
```
Attach/detach markers and the automatic aggregation events appear here too — the
chamado tells the whole story: opening → each derived OS → every event inside
them → outcome.

### 4.5 Edge cases
Recompute the aggregate on every child transition and every attach/detach;
detaching the last OS; re-linking to another chamado; an OS cancelled then
reopened; a terminal chamado receiving a child event (ignore or reopen per rule).

## 5. Per-profile visibility (lightweight resolver first)

`WorkOrderVisibilityService.scopeForTickets(ctx)` returns a Drizzle `where`
appended to chamado queries, by the viewer's profile:

| Profile | Predicate (tenant always fixed) |
|---|---|
| **Técnico** | `meta.requester_email = me.email OR wo.assigned_to = me.id` |
| **Supervisor** | `wo.customer_id IN (me.units)` (customer/asset subtree) |
| **Holding** | `meta.requester_domain = me.domain` (or customer ∈ subtree of `me.customer`) |

Reuses `users.profile` (role) + the `customers` hierarchy. Starts as a dedicated
service; can graduate to a formal `tickets:read` policy (scope USER/UNIT/DOMAIN)
in the Authorization module later — the "ready to evolve" goal of the deck.

## 6. API surface (GCDR patterns, behind authMiddleware)

- `GET /wo/tickets` — list chamados (already scoped by the visibility resolver),
  with the status board counts (Abertos/Pendentes/Aguardando + total).
- `POST /wo/tickets` — open a chamado (subject/type/reason/priority/requester +
  optional device selection).
- `GET /wo/tickets/:id` — detail (the 8 fields) + derived OS + roll-up progress.
- `GET /wo/work-orders/:id/timeline?include=derived` — aggregated timeline.
- `POST /wo/tickets/:id/work-orders` — derive an OS.
- `PUT /wo/work-orders/:id/ticket` — attach/detach an OS to a chamado.
- `POST /wo/tickets/:id/messages` — comment (maps to annotations).
- `POST /wo/tickets/:id/cancel`, `/resolve`, `/close`, `/reopen`.
- Catalogs: `GET /wo/ticket-reasons` (+ types via the event-type catalog).

The Copiloto (RFC-0043) gains `list_tickets` / `get_ticket` tools that return the
derived OS + progress, and `get_work_order` returns its `ticket_id` — so
traceability is available conversationally.

## 7. UI

Backend is single (`wo_*`); the UI exposes a **"Chamados"** surface (a `/os` tab
or `/chamados`) filtering `type=CHAMADO`: the status board, the 2-step open flow
(form + device selection, reusing the OS create wizard), the detail with the 8
fields + a **"OS derivadas"** card (mini-status + "Derivar nova OS"), and the
aggregated timeline. Each derived OS detail shows "Origem: Chamado #…".

## 8. Freshdesk migration (deferred — design only)

`external_id` on `work_orders_ticket_meta` is the hook. When chosen, an
idempotent importer upserts by `external_id`: Freshdesk status → CHAMADO flow,
conversations → annotations, attachments → `file_assets`, `cc_emails` →
watchers, `company_id` → `customer_id`. Cutover vs coexistence (webhook sync) is
a later decision; see `docs/integracao_freshdesk_myio.md`.

## 9. Rollout

- **Phase 1 (this RFC — migration 0043 + schema):** `work_orders_ticket_meta`,
  `work_orders_watchers`, `work_orders.ticket_id`, widen the type CHECK, seed the
  `CHAMADO` event types; default lifecycle seed for the test tenant. No behavior
  change to existing OS.
- **Phase 2:** add `CHAMADO` to `LIFECYCLE_CATEGORIES`; ticket service/controller
  (open/detail/messages/derive/attach/cancel/resolve/close), the
  `WorkOrderVisibilityService`, the `WorkOrderAggregationService`, and the
  aggregated timeline query.
- **Phase 3:** the "Chamados" UI surface + Copiloto tools.
- **Phase 4:** Freshdesk importer (+ optional sync).

## 10. Out of scope

- Two-way Freshdesk sync mechanics (separate RFC if coexistence is chosen).
- N:N ticket↔OS links and RELATED/DUPLICATE relation types (`work_order_relations`)
  — only the dominant 1:N `ticket_id` ships now.
