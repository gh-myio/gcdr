# RFC-0041 — Work Order Rules Engine

- **Status:** Draft
- **Date:** 2026-06-14
- **Domain:** Work Orders (`wo` / OS)
- **Depends on:** [RFC-0037 — Work Orders Event Model](./RFC-0037-Work-Orders-Event-Model.md)
- **Companion:** [WO-OS-MAP.md](./WO-OS-MAP.md), [WO-OS-API-GUIDE.md](./WO-OS-API-GUIDE.md)

## 1. Summary

Introduce a single **Work Order Rules Engine** as the *one* place that knows the
WO state machine. It owns two responsibilities that today are split (status on
the backend, transition guards hardcoded in the frontend):

1. **Status projection** — derive `work_orders.status` from the latest lifecycle
   event (moves the existing `lifecycleStateForCode` into the engine).
2. **Transition evaluation** — given a WO's current status, decide which
   event-types **can** be appended and which are **blocked**, each blocked one
   carrying a machine `reasonCode` (+ context) explaining *why*.

A new read endpoint exposes the evaluation so the UI can render **every** type
but show the non-actionable ones struck-through with a subtle reason — without
duplicating any rule.

## 2. Motivation

- **Single source of truth.** The transition guards currently live in the
  frontend (`QUICK_ACTION_DEFS` with `when: [...]` arrays in
  `WorkOrderDetail.tsx`). Any drift between that and the backend's projection is
  a correctness bug. The engine removes the duplication.
- **Explainable UI.** Today blocked actions are simply hidden. Product wants the
  full catalog always visible, with disabled items struck-through and a reason
  ("disponível apenas quando a OS está EM_ANDAMENTO", "OS finalizada não aceita
  novos eventos", …).
- **Server-authoritative.** Status must never be computed in the client. The
  engine guarantees the same result on load and after every appended event.

## 3. The state machine

States (terminal marked †): `PLANEJADA`, `EM_ANDAMENTO`, `INTERROMPIDA`,
`AGUARDANDO`, `REAGENDADA`, `FINALIZADA †`, `CANCELADA †`.

Lifecycle event **suffix → target status** (a code is `<TYPE>_<SUFFIX>`):

| Suffix | Target |
|---|---|
| `PLANEJADA` | PLANEJADA |
| `INICIADA` · `REINICIADA` · `EXECUTADA_PARCIAL` | EM_ANDAMENTO |
| `INTERROMPIDA` | INTERROMPIDA |
| `REAGENDADA` | REAGENDADA |
| `AGUARDANDO_AGENDA_CLIENTE` · `AGUARDANDO_AGENDA_TECNICO` · `AGUARDANDO_OUTROS_MOTIVOS` | AGUARDANDO |
| `FINALIZADA` | FINALIZADA † |
| `CANCELADA` | CANCELADA † |

**Allowed source statuses per suffix** (the transition guard matrix):

| Suffix | Allowed from |
|---|---|
| `INICIADA` | PLANEJADA, REAGENDADA, AGUARDANDO |
| `REINICIADA` | INTERROMPIDA |
| `EXECUTADA_PARCIAL` | EM_ANDAMENTO |
| `INTERROMPIDA` | EM_ANDAMENTO |
| `REAGENDADA` | PLANEJADA, EM_ANDAMENTO, AGUARDANDO, INTERROMPIDA |
| `AGUARDANDO_*` | PLANEJADA, EM_ANDAMENTO, REAGENDADA, INTERROMPIDA |
| `FINALIZADA` | PLANEJADA, EM_ANDAMENTO, REAGENDADA, AGUARDANDO, INTERROMPIDA |
| `CANCELADA` | PLANEJADA, EM_ANDAMENTO, REAGENDADA, AGUARDANDO, INTERROMPIDA |

Cross-cutting rules:

- **Terminal lock.** From `FINALIZADA`/`CANCELADA`, *no* lifecycle event is
  allowed → `reasonCode: TERMINAL`.
- **Type match.** A lifecycle event-type's category must equal the WO `type`
  (an `INSTALACAO` WO only accepts `INSTALACAO_*` lifecycle events) →
  `reasonCode: TYPE_MISMATCH`.
- **Non-lifecycle always allowed.** `ESTRUTURA`, `OBSERVACAO`, `ANEXO` are
  markers — never gated by status (they don't move it).
- **Wrong source.** A lifecycle event whose suffix isn't allowed from the
  current status → `reasonCode: WRONG_STATE` (+ `allowedFrom`).

## 4. Engine API (backend)

New pure module `src/services/work-orders/workOrderRules.ts`:

```ts
type Status = 'PLANEJADA' | 'EM_ANDAMENTO' | 'INTERROMPIDA' | 'AGUARDANDO'
            | 'REAGENDADA' | 'FINALIZADA' | 'CANCELADA';

// Status projection (moved from WorkOrderService).
function lifecycleStateForCode(code: string, category: string): Status | null;
function projectStatus(events: {eventType:string; category:string}[]): Status;  // latest wins
function isTerminal(status: Status): boolean;

type ReasonCode = 'TERMINAL' | 'TYPE_MISMATCH' | 'WRONG_STATE';
interface Evaluation {
  code: string;
  category: string;
  label: string;
  targetStatus: Status | null;   // null for non-lifecycle markers
  allowed: boolean;
  reasonCode?: ReasonCode;
  allowedFrom?: Status[];        // present when reasonCode = WRONG_STATE
}

// Evaluate one event-type against a WO.
function evaluateEventType(et: EventType, wo: {type:string; status:Status}): Evaluation;

// Evaluate the whole catalog (filtered to the WO type + ESTRUTURA, as the
// composer offers) → ordered list of allowed + blocked.
function evaluateTransitions(wo, catalog: EventType[]): Evaluation[];
```

`WorkOrderService` is refactored to **delegate** status projection to the engine
(`appendEvent` keeps doing the write; it just calls `engine.lifecycleStateForCode`).
No behavioral change to existing writes.

## 5. Endpoint

```
GET /api/v1/wo/work-orders/:id/transitions
```

Auth: same as the rest of `/wo/work-orders` (JWT or API key). Response:

```json
{
  "success": true,
  "data": {
    "status": "EM_ANDAMENTO",
    "transitions": [
      { "code": "INSTALACAO_FINALIZADA", "category": "INSTALACAO", "label": "Instalação finalizada",
        "targetStatus": "FINALIZADA", "allowed": true },
      { "code": "INSTALACAO_INICIADA", "category": "INSTALACAO", "label": "Instalação iniciada",
        "targetStatus": "EM_ANDAMENTO", "allowed": false,
        "reasonCode": "WRONG_STATE", "allowedFrom": ["PLANEJADA","REAGENDADA","AGUARDANDO"] },
      { "code": "PRODUTO_INSTALADO", "category": "ESTRUTURA", "label": "Produto instalado",
        "targetStatus": null, "allowed": true }
    ]
  }
}
```

The WO detail (`GET /wo/work-orders/:id`) keeps returning the already-projected
`status` — no client computation. The transitions list is fetched separately
(and re-fetched by the UI after appending an event).

## 6. Frontend usage

- **Record-event card.** The event-type picker shows the full catalog; entries
  with `allowed:false` render **struck-through** with a subtle reason derived
  from `reasonCode`/`allowedFrom` (i18n). Selecting a blocked type is disabled.
- **Quick actions.** `QUICK_ACTION_DEFS` guard arrays are removed; the quick
  actions are derived from `transitions` (allowed lifecycle termin�/state moves).
- **After append.** The UI appends the event (server recomputes status), then
  refetches the WO + `/transitions`. No status math in the client.

## 7. Rollout

1. Backend: engine module + `WorkOrderService` delegation + endpoint. Pure
   refactor of status projection (no migration, no data change).
2. Frontend: consume `/transitions` in the composer/picker; drop the local
   guard arrays.
3. Tests: unit-test the engine matrix (every status × suffix), plus the terminal
   and type-mismatch rules.

## 8. Out of scope

- Per-customer/custom rule overrides (future: rules could be data-driven).
- Role-based gating (who *may* trigger a transition) — orthogonal to *what* is
  state-valid.
