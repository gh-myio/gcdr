# RFC-0037: Work Orders — Event Model

- **Feature Name**: `work-orders-event-model`
- **Start Date**: 2026-06-09
- **Status**: Draft
- **Related RFCs**:
  [RFC-0032 QR Checker Migration](./RFC-0032-QR-Checker-Migration-to-GCDR.md) (the `wo_*`/QR-Checker tables this RFC **replaces**) ·
  [RFC-0036 Device Annotations](./RFC-0036-Device-Annotations-Migration.md) (**generalized** here: annotations become polymorphic) ·
  [RFC-0009 Events & Audit Logs](./RFC-0009-Events-Audit-Logs.md) ·
  [RFC-0030/0031 S3 / file_assets](./RFC-0030-S3-Bucket-Setup.md) ·
  [RFC-0016 ThingsBoard Entity Mapping](./RFC-0016-ThingsBoard-Entity-Mapping.md)

---

## Summary

Replace the rigid, workflow-specific Work-Orders schema inherited from QR Checker
(12 `wo_*` tables: installations, visitas, ambientes, products, observations,
audits, images) with an **event-log model**: a Work Order has **N events**, each
authored by a user or the system, each carrying an `event_type` and a flexible
`payload`. Files/evidence attach to a Work Order or to an event. Observations
reuse the (generalized) **RFC-0036 annotation** subsystem.

The migration is **greenfield** — the QR-Checker tables hold no production data
(the feature was never put in active use), so the 12 tables are **dropped** and
the new model created from scratch. No data migration script.

This RFC defines: the relational schema, the **event-type catalog**, the
**status projection** on `work_orders`, the **event ↔ annotation** relationship,
the (pontual) change to RFC-0036 that makes annotations polymorphic, and the
redesigned `/api/v1/wo` surface.

---

## Motivation

The current Work-Orders domain (`wo_*`) is a near-1:1 port of the legacy QR
Checker SQLite app: one table per sub-entity (`wo_installations`,
`wo_visitas_tecnicas`, `wo_visita_ambientes`, `wo_visita_products`, their
`*_images` and `*_audit` siblings, plus `wo_*_observations`). Problems:

- **Rigid lifecycle.** Status lives as a single column with a fixed enum; there
  is no record of *who* moved it *when* and *why*. Each new state (interrupted,
  rescheduled, waiting-on-client) needs schema churn.
- **Duplicated concepts.** `wo_visita_ambientes` ≈ an **asset**; `wo_visita_products`
  ≈ a **device**. The platform already models assets/devices, hierarchically.
- **No unified timeline.** Installation progress, technical visits and
  maintenance are separate table families; there is no single "what happened on
  this WO" stream.
- **Multi-device WOs.** A real WO targets *N* devices; the technician reports
  partial progress per device. The current model has no clean place for that.

An **event log** fits a work-order lifecycle (multi-actor, state transitions,
evidence) far better, and reusing **assets/devices** and **RFC-0036 annotations**
removes the duplicated tables.

---

## Guide-level explanation

### Conceptual model

```
Customer
  └── Work Order ──N── Event        (event_type, actor[user|system], payload, asset?/device?)
        │  root_asset_id?  (anchor: prédio/loja/área)
        │  status          (projection of the latest lifecycle event)
        ├──N── Device      (work_orders_devices — scope; pre-set or added on-site)
        ├──N── File        (work_order_files → file_assets; evidence, optionally tied to an event)
        └──N── Annotation  (RFC-0036, generalized → on the WO or on a specific Event)
```

- **Ambiente = asset, Produto = device.** Creating an "ambiente" on-site = creating
  an `asset` under the WO's root; creating a "produto" = creating a `device` in
  that asset. No `ambientes`/`products` tables.
- **Visita técnica = events.** A visit is not a table; it is a stream of
  `VISITA_TECNICA_*` events on the WO.
- **Asset scope is derived**, not declared: `root_asset_id` subtree ∪ the assets
  of the devices in `work_orders_devices` ∪ `asset_id`s referenced by events.
  (No `work_orders_assets` table.)

### The two logs (event ↔ annotation)

There are deliberately **two append-only logs**, each with a clear owner:

- **`work_orders_events`** — "*what happened, in order*": lifecycle transitions
  (`VISITA_TECNICA_*`, `INSTALACAO_*`, `MANUTENCAO_*`), structural events
  (`AMBIENTE_CRIADO`, `PRODUTO_CRIADO`, `DEVICE_MOVIDO`), and **markers** for
  observations/attachments (`OBSERVACAO_INSERIDA`, `ANEXO_INSERIDO`, …) that
  carry the `annotation_id` in their payload.
- **RFC-0036 `annotations` + `annotation_events`** — "*the note and its life*":
  the observation's text, status, edits, attachments and mentions.

The UI **Work-Order timeline** is the merge of `work_orders_events` ∪ the
annotations targeting the WO/its events, ordered by `created_at`. Each log stays
single-purpose; observations are not double-modelled.

### Actor identity

Every event records `actor_type` (`USER` | `SYSTEM` | `API_KEY`) and, when a
user, `actor_user_id`. Following RFC-0036's rationale, an `actor` JSONB snapshot
`{ id, email, name }` is also stored so the timeline survives user deletion
without a join.

---

## Reference-level explanation

### Tables

```sql
-- 1) Work Order ------------------------------------------------------------
CREATE TABLE work_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  root_asset_id   uuid REFERENCES assets(id),            -- anchor (prédio/loja); nullable
  type            text NOT NULL,                          -- INSTALACAO | MANUTENCAO | VISITA_TECNICA
  status          text NOT NULL DEFAULT 'PLANEJADA',      -- PROJECTION of the latest lifecycle event
  code            text NOT NULL,                          -- human number, unique per tenant (migration 0035); auto-generated OS-<Mercosul plate> (no I/O/1/0) when omitted
  assigned_to     uuid REFERENCES users(id),
  scheduled_at    timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (type IN ('INSTALACAO','MANUTENCAO','VISITA_TECNICA'))
);
CREATE INDEX work_orders_tenant_customer_idx ON work_orders (tenant_id, customer_id);
CREATE INDEX work_orders_tenant_status_idx   ON work_orders (tenant_id, status);
CREATE INDEX work_orders_root_asset_idx      ON work_orders (root_asset_id);
CREATE UNIQUE INDEX work_orders_tenant_code_unique ON work_orders (tenant_id, code) WHERE deleted_at IS NULL;

-- 2) Device scope (junction) ----------------------------------------------
CREATE TABLE work_orders_devices (
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id)     ON DELETE RESTRICT,
  added_by      uuid NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, device_id)
);
CREATE INDEX work_orders_devices_device_idx ON work_orders_devices (device_id);

-- 3) Event types catalog (extensible, no migration to add a type) ---------
CREATE TABLE work_orders_event_types (
  code        text PRIMARY KEY,
  category    text NOT NULL,        -- VISITA_TECNICA | INSTALACAO | MANUTENCAO | OBSERVACAO | ANEXO | ESTRUTURA
  label       text NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

-- 4) Events ----------------------------------------------------------------
CREATE TABLE work_orders_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  event_type    text NOT NULL REFERENCES work_orders_event_types(code),
  actor_type    text NOT NULL,                         -- USER | SYSTEM | API_KEY
  actor_user_id uuid REFERENCES users(id),             -- null when SYSTEM
  actor         jsonb,                                 -- {id,email,name} snapshot (survives delete)
  asset_id      uuid REFERENCES assets(id),            -- e.g. AMBIENTE_CRIADO
  device_id     uuid REFERENCES devices(id),           -- e.g. INSTALACAO_EXECUTADA_PARCIAL
  payload       jsonb NOT NULL DEFAULT '{}',           -- type-specific: reason, schedule, annotation_id, …
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_orders_events_wo_chrono_idx ON work_orders_events (work_order_id, created_at);
CREATE INDEX work_orders_events_type_idx      ON work_orders_events (tenant_id, event_type);
CREATE INDEX work_orders_events_device_idx    ON work_orders_events (device_id) WHERE device_id IS NOT NULL;

-- 5) Files / evidence ------------------------------------------------------
CREATE TABLE work_order_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  work_order_id       uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  work_order_event_id uuid REFERENCES work_orders_events(id) ON DELETE SET NULL,  -- the event that added it
  file_asset_id       uuid NOT NULL REFERENCES file_assets(id),
  image_order         integer NOT NULL DEFAULT 0,
  caption             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, file_asset_id)
);
CREATE INDEX work_order_files_wo_idx    ON work_order_files (work_order_id, image_order);
CREATE INDEX work_order_files_event_idx ON work_order_files (work_order_event_id);

-- 6) Customer opt-in (renamed from wo_customer_settings; unchanged shape) ---
ALTER TABLE wo_customer_settings RENAME TO work_orders_customer_settings;
--   customer_id PK, tenant_id, viewer_password_hash, default_central_id,
--   wo_metadata jsonb, created_by, created_at, updated_at
```

### RFC-0036 — pontual change (annotations become polymorphic)

RFC-0036 ships `annotations.device_id NOT NULL`. Since it is **unimplemented
Draft** (no GCDR rows), generalize the attachment target *before* building it:

```sql
-- instead of: device_id uuid NOT NULL REFERENCES devices(id)
  entity_type  text NOT NULL,   -- 'device' | 'work_order' | 'work_order_event'
  entity_id    uuid NOT NULL,
  CHECK (entity_type IN ('device','work_order','work_order_event'))
  -- (no DB FK across polymorphic targets; integrity enforced in the service)
CREATE INDEX annotations_entity_idx ON annotations (tenant_id, entity_type, entity_id);
```

- `entity_type='work_order'` → a general observation on the WO.
- `entity_type='work_order_event'` → a note anchored to one event (e.g. *why* a
  `VISITA_TECNICA_INTERROMPIDA` happened).
- `entity_type='device'` → RFC-0036's original device annotation.

`annotation_responses`, `annotation_events`, `annotation_mentions`,
`annotation_attachments` are unchanged — they already hang off the annotation.
The legacy `log_annotations` backfill (RFC-0036 Phase 1) maps to
`entity_type='device'`.

### Event-type catalog (seed)

| Category | Codes |
|---|---|
| **VISITA_TECNICA** | PLANEJADA, INICIADA, INTERROMPIDA, REINICIADA, REAGENDADA, AGUARDANDO_AGENDA_CLIENTE, AGUARDANDO_AGENDA_TECNICO, AGUARDANDO_OUTROS_MOTIVOS, CANCELADA*, FINALIZADA* |
| **INSTALACAO** | PLANEJADA, INICIADA, EXECUTADA_PARCIAL, INTERROMPIDA, REINICIADA, REAGENDADA, AGUARDANDO_AGENDA_CLIENTE, AGUARDANDO_AGENDA_TECNICO, AGUARDANDO_OUTROS_MOTIVOS, CANCELADA*, FINALIZADA* |
| **MANUTENCAO** | PLANEJADA, INICIADA, EXECUTADA_PARCIAL, INTERROMPIDA, REINICIADA, REAGENDADA, AGUARDANDO_*, CANCELADA*, FINALIZADA* |
| **OBSERVACAO** | INSERIDA, EDITADA, DELETADA, ARQUIVADA |
| **ANEXO** | INSERIDO, EDITADO, DELETADO, ARQUIVADO |
| **ESTRUTURA** | WO_CRIADA, WO_ATRIBUIDA, AMBIENTE_CRIADO, PRODUTO_CRIADO, DEVICE_MOVIDO, WO_REAJUSTADA |

`*` = `is_terminal = true`. Per-device events (`*_EXECUTADA_PARCIAL`,
`PRODUTO_CRIADO`, `DEVICE_MOVIDO`) set `device_id`; `AMBIENTE_CRIADO` sets `asset_id`.

### Status projection

`work_orders.status` is maintained by the service: appending a lifecycle event
of the WO's `type` updates `status` to that event's mapped state
(`PLANEJADA / EM_ANDAMENTO / INTERROMPIDA / AGUARDANDO / REAGENDADA /
FINALIZADA / CANCELADA`). This keeps list/filter queries cheap (no event replay).
`is_terminal` types lock the WO (no further lifecycle events).

---

## API surface (`/api/v1/wo`)

Replaces the installation/visita/observation endpoints. Auth: JWT or Customer
API-Key; the public `viewer-login` is preserved.

```
GET    /wo/work-orders                          list (filter: customer, status, type, assignee, device)
POST   /wo/work-orders                          create (customer, type, root_asset_id?, devices[]?, scheduled_at?)
GET    /wo/work-orders/:id                       detail (+ status, scope, latest events)
PATCH  /wo/work-orders/:id                       update (assignee, scheduled_at, root_asset, …)
DELETE /wo/work-orders/:id                       soft delete

GET    /wo/work-orders/:id/events                timeline (events ∪ annotations, merged)
POST   /wo/work-orders/:id/events                append an event (event_type, device_id?, asset_id?, payload)

GET|POST    /wo/work-orders/:id/devices          scope: list / add (device_id)
DELETE      /wo/work-orders/:id/devices/:deviceId  remove from scope

GET|POST    /wo/work-orders/:id/files            files / upload (→ file_assets)
DELETE      /wo/work-orders/:id/files/:fileId

# Observations reuse the (generalized) annotations API:
GET|POST    /annotations?entityType=work_order&entityId=:id
            /annotations?entityType=work_order_event&entityId=:eventId

# Customer opt-in (carried over from the old /wo/customers/*):
GET   /wo/customers · POST /wo/customers/:id/enable|disable · PATCH /wo/customers/:id/settings
POST  /wo/customers/:id/viewer-login   (PUBLIC)
```

---

## Migration (greenfield)

No production data exists in the QR-Checker tables (the OS/WO feature was never
activated). Therefore:

1. **Drop** the 12 legacy tables: `wo_customer_observations`, `wo_installations`,
   `wo_installation_audit`, `wo_installation_images`, `wo_maintenance_tasks`,
   `wo_visitas_tecnicas`, `wo_visita_ambientes`, `wo_visita_ambiente_images`,
   `wo_visita_audit`, `wo_visita_observations`, `wo_visita_products`,
   `wo_visita_product_images`.
2. **Rename** `wo_customer_settings` → `work_orders_customer_settings` (kept).
3. **Create** the 5 new tables above.
4. Implement **RFC-0036 generalized** (polymorphic `entity_type`) from the start.
5. **Seed** `work_orders_event_types`.
6. Rewrite the backend (`src/**/wo/`) and the frontend `/os` module against the
   new model. The `/api/v1/wo/install`, `/visitas/*` etc. endpoints are removed.

A single numbered migration (`00NN_work_orders_event_model.sql`) does the
drop + rename + create, applied via the `schema_migrations` runner
([DB-MIGRATIONS](./DB-MIGRATIONS.md)).

---

## Drawbacks

- **Breaking** for the (currently unused) `/api/v1/wo/install`, `/wo/visitas/*`
  surface and any consumer thereof.
- Event-payload `jsonb` trades schema validation for flexibility — type-specific
  payload shapes must be validated in the service (Zod per event_type).
- Polymorphic `annotations.entity_id` loses a single DB FK; referential
  integrity moves to the service layer.

## Rationale & alternatives

- **Pure event-sourcing (no `status` column)** — rejected: list/filter would
  require event replay. The hybrid (projected `status`) keeps queries cheap.
- **Keep ambientes/products tables** — rejected: they duplicate assets/devices.
- **Separate WO observation tables (not annotations)** — rejected: RFC-0036
  already provides text + status + attachments + mentions + history; generalizing
  it avoids a parallel subsystem.
- **`work_orders_assets` junction** — rejected: asset scope is derivable from
  `root_asset_id` + devices' assets + event `asset_id`s.

## Future possibilities

- SLA timers driven off lifecycle events (waiting/interrupted durations).
- WO templates (pre-seeded device scope + planned events).
- Notifications on assignment / waiting states via RFC-0025 contacts.
- Generalize the annotation engine further (RFC-0036 "Future Possibilities").
