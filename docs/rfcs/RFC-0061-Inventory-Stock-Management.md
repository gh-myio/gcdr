# RFC-0061: Inventory & Warehouse Management ("Menu de Estoque")

- Feature Name: `inventory_stock_management`
- Start Date: 2026-08-25
- RFC PR: (leave this empty)
- Tracking Issue: (leave this empty)
- Status: **Draft v2 — revised after BMAD roundtable session (2026-08-25, §BMAD Session). Nothing implemented.**
- Related package: `packages/backend` (GCDR) + `gcdr-frontend` (new top-level menu **"Estoque"**; frontend counterpart RFC to be opened in `gcdr-frontend.git` and kept branch-paired)
- Source system: **"Myio Compras"** — `https://comprasmyio.lovable.app` (Lovable app, React + TanStack Start + Supabase project `iopocsjiseduqevrjvkj`), public repo `https://github.com/brunodantas-code/comprasmyio.git`
- Builds on: hybrid auth + RBAC (roles/policies/assignments), audit logs (RFC-0009), `file_assets` generic storage (RFC-0030/0031, S3/MinIO/LOCAL), WO event model (RFC-0037), custom migration runner (`db:mig:*`, `docs/DB-MIGRATIONS.md`)
- UI language note: RFC in English per repo convention; UI labels stay in pt-BR (as quoted).

> **Changelog v2 (BMAD roundtable, 2026-08-25):** stock-authority invariants +
> consistency check (W1); derived-balance cost plan — covering index, lock
> semantics, snapshot escape hatch (W2); outbox claim via `SKIP LOCKED` + per-QR
> FIFO (W3); domain×movement requirements matrix + `is_manufactured` CHECK (W4);
> cutover reordered — old sync disabled first (W5); receipt-entry idempotency
> UNIQUE + repeated-transition semantics (A1); new `inv_qr_registry` (A2); error
> contract Appendix D + `ConflictError` + P0/P1 DTOs pre-kickoff (A3); phase fix —
> P0 ships all migrations, demand resolution moved to P3 (A4); import order,
> `--raw-ledger` mode, freeze parity snapshot (A5); **two-wave cutover** with
> Compras MVP after P1 (J1); weekly import rehearsals from P1 (J2); mobile-first
> frontend contract + factory pilot gate (J3); M8 shadow mode from P2 (J4);
> simulator becomes preview-only (DEC-13, J5); mutation idempotency keys,
> two-phase uploads, server-side destructive confirmation, `/qr/validate`,
> `allowedTransitions`, trace envelope + latency budgets (S1–S5).

---

## Summary

Port the entire **"Myio Compras"** operation — purchase requests, buyer queue, a
multi-location stock ledger, BOM-driven production, QR homologation/traceability,
expedition orders, field tracking (client units / technicians / damaged items) and
the external product-tracking sync — into GCDR as a first-class **Inventory domain**
(`/api/v1/inventory/*`, tables `inv_*`), surfaced in `gcdr-frontend` as a new
top-level menu **"Estoque"**.

The source app is a single-company Lovable/Supabase system where the browser talks
PostgREST directly under RLS. GCDR absorbs it with its standard architecture
(Controllers → Services → Repositories → Drizzle/PostgreSQL), multi-tenant scoping,
governed RBAC, audit, pagination, and server-side state machines — fixing the
source's known security and modeling gaps rather than replicating them
(Appendix C).

## Motivation

- **Shadow IT / single point of fragility.** The operation that physically moves
  every Myio product (purchases → production → homologation → expedition → client)
  lives in a Lovable prototype with an anonymous-key-protected webhook, several
  wide-open RLS policies (`production_demands`/`purchase_demands` are `ALL true`),
  no pagination, no tenant isolation, and no governed backup.
- **GCDR is the master-data registry.** Materials, BOMs, QR identities, clients and
  projects are master data; the QR registry already intersects GCDR concerns
  (devices shipped to customers, RFC-0016 ThingsBoard mapping).
- **The flows are mature and validated.** The Lovable app encodes ~2 months of real
  operating rules (state machines, anti-double-count QR ledger, box-is-master sync
  semantics). This RFC ports those rules as an explicit spec instead of implicit
  frontend behavior.

### Non-goals

- Changing the external product-tracking platform (`produto.myio.com.br` API) — we
  keep consuming its 3 endpoints as-is (§M8).
- Absorbing Work Orders (`wo_*`) — WO "OS" and inventory purchase orders remain
  separate domains (a purchase order here is a buy-request, not a service order).
- Real-time push to browsers — the source app has **zero** realtime subscriptions;
  polling + cache invalidation is enough.
- Financials (prices, invoices, payment) — the source never tracks money; out of
  scope for v1.

---

## Source system analysis (evidence)

Explored 2026-08-25 via Chrome DevTools (CDP, read-only), captured network
(`https://iopocsjiseduqevrjvkj.supabase.co/rest/v1/...` PostgREST calls per tab),
plus a full read of the public repo (59 SQL migrations, generated `types.ts`,
18 feature components, server functions, public webhook).

- **Architecture**: browser → Supabase PostgREST/Auth/Storage under RLS; TanStack
  server functions only for admin backup, QR generation and the external push; a
  public webhook (`/api/public/hooks/sync-product-status`) runs the 5-min sync with
  the service-role key, "protected" by the public anon key.
- **32 tables, 3 views, 5 enums, 7 trigger functions** (full model in Appendix A).
- **UI**: 6 top-level tabs — Solicitações de Compras, Fila de compras, Armazém
  (with sub-tabs Fábrica / Homologação / Estoque Myio / Expedição / Transporte /
  Cliente / Técnico / Perdido / Itens Avariados / Checar QR Code / Almoxarifado /
  Ferramentas-Ativos), Projetos e clientes, Ordem de Expedição, Usuários e logs.
- **Roles**: `admin`, `comprador`, `solicitante`, `fabrica` (multi-role per user;
  first signup auto-becomes admin).

---

## Guide-level explanation — the "Estoque" menu and its modules

The GCDR frontend gains a top-level menu **Estoque** with pages mirroring the
modules below. Everything ships behind the new RBAC policies of §RBAC.

### Module map

| # | Module | Source tabs/components | Core tables (new) |
|---|--------|------------------------|-------------------|
| M1 | **Catálogo & BOM** | Armazém cadastros, `bom-settings` | `inv_items`, `inv_boms` |
| M2 | **Livro-razão de estoque** | Armazém (todas as sub-abas de saldo), `stock-tab` | `inv_stock_movements`, `inv_movement_qrs` |
| M3 | **Compras** (Solicitações + Fila) | `pedidos`, `queue` | `inv_purchase_orders`, `inv_purchase_order_events`, `inv_purchase_order_files` |
| M4 | **Produção** | Fila de Produção, Liberação de Montagem, Capacidade, Simulador | `inv_production_demands`, `inv_purchase_demands`, `inv_assembly_releases(+items,+issues)` |
| M5 | **Homologação & QR** | Homologação, caixas, Checar QR | `inv_homologations`, `inv_homologation_units` |
| M6 | **Expedição** (Pedidos Myio) | Ordem de Expedição, Expedição/Transporte/Perdido, baixas | `inv_expedition_orders(+items)`, `inv_item_deliveries`, `inv_delivery_qrs`, `inv_shipments` |
| M7 | **Campo** (Cliente/Técnico/Avarias) | Cliente, Técnico, Itens Avariados | `inv_unit_products`, `inv_technician_moves`, `inv_damaged_items` |
| M8 | **Sync externo** | `external-sync`, webhook, push | `inv_external_states`, `inv_external_sync_state`, `inv_external_push_outbox` |
| M9 | **Projetos** | Projetos e clientes | `inv_projects` (clients → GCDR `customers`) |
| M10 | **RBAC, auditoria, importação** | Usuários e logs, Backup | (reuses RBAC + RFC-0009 audit; one-shot import job) |

### M1 — Catálogo & BOM

One unified item catalog replaces the source's **three parallel families**
(`materials`, `terceiros_materials`, `tool_assets`) — see DEC-1:

- `inv_items.domain`: `COMPONENT` (fábrica components), `PRODUCT` (manufactured
  Myio products), `THIRD_PARTY` (resold items), `TOOL` (tools/assets).
- Metadata kept from source: `name`, `link`, `description`, `lot_quantity`,
  `purchase_type` (`NACIONAL`/`IMPORTACAO`), `loss_percent`, `is_manufactured`,
  photo via `file_assets`.
- **BOM** (`inv_boms`): product → component with `quantity numeric(12,3) > 0`,
  unique pair. Loss factor applied as `qty × (1 + loss_percent/100)` exactly as the
  source does (assembly consumption, capacity, simulator).
- Source rule kept: an item name is unique per tenant+domain
  (`lower(btrim(name))`); "— Caixa de N" synthetic rows are **not** ported (boxes
  live in M5, where they belong).

### M2 — Livro-razão de estoque (ledger)

- **Balance is always derived** from `inv_stock_movements` — never a column
  (DEC-2). Movement types: `ENTRADA`, `SAIDA`, `AJUSTE` (adds), plus explicit
  `TRANSFERENCIA` between locations (new; the source moved items between locations
  by duplicating catalog rows).
- **Locations** become a column of the movement, not of the item (DEC-3):
  `FABRICA`, `ALMOXARIFADO` (Estoque Myio), `ALMOXARIFADO_GERAL`, plus the tracking
  stages that are *not* stock locations (client/technician/lost live in M7).
- **Negative-stock guard**: service-layer check inside the movement transaction
  with `SELECT … FOR UPDATE` on the item row (the source's trigger sums without a
  lock — race-prone), plus the same friendly error ("Estoque insuficiente").
- **Exit rules by domain** (ported verbatim from the source UI, now enforced
  server-side): manufactured item exits require linked QRs (count defines
  quantity) **and** a photo; non-manufactured require QR **or** photo;
  `THIRD_PARTY` exits require photo (no QRs); `TOOL` exits require a destination.
- `inv_movement_qrs` links each exit to unit/box QRs (anti-double-exit ledger,
  M5/M8 depend on it).
- Endpoints expose per-location balances (`GET /inventory/stock/balances?location=`)
  and paginated movement history.

**Stock-authority invariants (W1).** For manufactured `PRODUCT` items the **QR
unit registry is the authority** and the quantitative ledger is a projection of
it; for every other domain the **ledger is the authority**. Divergence is a
defect, not an operating mode: besides the M8 sync auto-corrections, a
consistency check (`GET /inventory/stock/consistency`, also run as a daily job)
reports `Σ ledger balance vs count(active QRs)` per item×location, so drift is
surfaced instead of silently patched.

**Exit-requirements matrix (W4)** — the contract of the movement service and its
tests:

| Domain | `is_manufactured` | Exit requires |
|---|---|---|
| `PRODUCT` | true | linked QRs (count = quantity) **and** photo |
| `PRODUCT`/`COMPONENT` | false | QR **or** photo |
| `THIRD_PARTY` | false | photo (no QRs) |
| `TOOL` | false | destination (photo optional) |

Invariant enforced by CHECK: `is_manufactured = true ⇒ domain = 'PRODUCT'`.

### M3 — Compras (purchase requests + buyer queue)

Ported state machine (server-enforced transition map, DEC-4):

```
PENDENTE → COMPRADO_AGUARDANDO → ENTREGUE → RECEBIDO_OK | RECEBIDO_PROBLEMA
    └────────────→ CANCELADO ←──────┘
```

- Requester creates against a **catalog item** (any domain) with project, quantity,
  recipient, delivery point, deadline (`URGENTE`/`ESTA_SEMANA`/`ESTE_MES`/
  `CUSTOMIZADO`+date), notes, attachments (`file_assets`).
- Requester may edit only while `PENDENTE`; only the requester confirms
  `ENTREGUE → RECEBIDO_OK|RECEBIDO_PROBLEMA`; buyer/admin manage the four buyer
  statuses, `buyer_notes`, `passphrase` (delivery pass-phrase — plain text, low
  sensitivity, DEC-10), `delivery_forecast`, attachments.
- **On `RECEBIDO_OK`** the service creates exactly one idempotent `ENTRADA`
  movement for the linked item (source trigger `stock_entry_on_receipt`, ported to
  the service transaction).
- **Event timeline** (`inv_purchase_order_events`, WO-style event model per
  RFC-0037) replaces the source's `order_logs` trigger — `CRIADO`,
  `STATUS_ALTERADO {from,to}`, `OBSERVACAO_ATUALIZADA`, with actor from
  `req.context.userId`. (The source has a *duplicated* log trigger writing every
  event twice — not ported, Appendix C.)
- Buyer queue = the same collection with buyer-scope filters (`nacional`/
  `importacao` via the item's `purchase_type`, project, status, delivered-window,
  group-by-project) — server-side filters, paginated.

### M4 — Produção

- **Demand resolution** (source `MyioDemandCard`): for expedition-order items
  lacking stock, generate `inv_production_demands` (manufactured) or an automatic
  purchase order + `inv_purchase_demands` (purchasable) — idempotent per order
  item (`order_item_id` unique). *Delivered in P3 together with M6 (A4) — it
  depends on expedition orders; the rest of M4 has no such dependency.*
- **Fila de Produção**: pending production demands grouped by product with Estoque
  Myio balance side-by-side.
- **Liberação de Montagem** (`inv_assembly_releases` + items): requires photo +
  responsibles; consumes the production queue FIFO; explodes the BOM and writes
  component `SAIDA` movements (`Consumo de montagem`) with loss factor, 3-decimal
  rounding — all in one transaction.
- **Divergências** (`inv_assembly_release_issues`): stock/homologation reports an
  issue; factory corrects released quantities with a floor at
  already-homologated units, writing delta movements (`Correção de liberação de
  montagem`) and resolving issues.
- **Capacidade & Simulador**: `GET /inventory/production/capacity` (min over
  components of `floor(balance / (bom_qty × loss_factor))`, limiting components
  flagged) and `POST /inventory/production/simulator/preview|apply` (apply writes
  `ENTRADA` movements, reason `Simulação de estoque`).

### M5 — Homologação & QR

The QR registry is the traceability backbone:

- **`inv_qr_registry`** (A2) — the single source of QR identity: every QR value
  (unit or box) is inserted here once per tenant (`UNIQUE`), giving cross
  box×unit uniqueness by constraint and the row to `FOR UPDATE` when an exit
  needs to atomically assert "not already used" (used = derived: latest ledger
  event for the QR is an exit). `inv_homologation_units`/`inv_homologations`
  reference it.
- `inv_homologations` (box): `box_size ∈ {1,10,50,100,224}`, `box_qr` (unique per
  tenant when set), responsible, linked release; `inv_homologation_units` (unit):
  `qr_value` unique per tenant, position.
- Rules ported: remaining-to-homologate accounting per release item; box QR
  auto-generation (sequential per size prefix); "generate via API" delegating to
  the external platform (M8); global duplicate detection across box + unit QRs;
  finishing a homologation writes the `ENTRADA` movement into `ALMOXARIFADO`
  (reason `Homologação — unitário/caixa de N`) and enqueues an external push
  (`location: estoque`).
- Box operations: remove unit from box (becomes box_size=1 homologation), add unit
  to an incomplete box or a new box, delete emptied boxes — same validations
  (wrong product, full box, not found).
- **QR trace** (`GET /inventory/qr/trace/:code`): full timeline — release →
  homologation → stock entries/exits → technician moves → deliveries → shipment →
  client install/move → external state — assembled server-side (the source builds
  this with ~8 parallel client queries). **Contract (S5):** accepts the bare code
  *or* the full `https://produto.myio.com.br/<code>` URL (what a camera scan
  yields); response = a **current-state header** (where it is, status, client)
  plus a **normalized event timeline** `{ts, type, actor, location, refs}` so the
  frontend renders generically; explicit semantics for the three limbos —
  unknown QR (404), QR known only to the external platform, and box QR (expands
  its units, flagged as box). Latency budget: p95 < 1s (backed by qr-value
  indexes on `inv_movement_qrs`, `inv_delivery_qrs`, `inv_qr_registry`).
- **Scan-time validation (S2)**: `POST /inventory/qr/validate` — batch of codes +
  context (expected item, order item), per-code verdict in <300ms, so handheld
  scanners can give green/red feedback *per beep* instead of failing a 50-QR
  batch at submit.
- QR formats kept: unit `https://produto.myio.com.br/<code>` with
  `code = \d+(_\d+)+`; box QRs expand to their units everywhere QRs are consumed.

### M6 — Expedição (Pedidos Myio)

State machine (server-enforced; manual transitions gated by role):

```
PENDENTE → PRODUZINDO → PRONTO_ENTREGA → EM_TRANSITO → ENTREGUE_CLIENTE
                                             └───────→ PERDIDO  (↔ encontrado: volta ao setor escolhido)
```

- `inv_expedition_orders` (project required, delivery date, `is_replacement`
  badge) + `inv_expedition_order_items` — **item references `inv_items` by FK**
  (the source uses free-text product names; normalized here, DEC-5).
- **Baixa/separação** (`inv_item_deliveries` + `inv_delivery_qrs`): photo required,
  exactly one QR per manufactured unit (`stockOnly` — QR must exist in the
  homologation registry and not be already used), writes the `SAIDA` movement,
  auto-advances order status (`PRONTO_ENTREGA` when all items delivered, else
  `PRODUZINDO`; never regresses `ENTREGUE_CLIENTE`), pushes `expedicao`.
- **Expedir** (`inv_shipments`): address, method (`AZUL_CARGO`/`CORREIOS`/
  `CARRO_MYIO`/`UBER`), responsible, tracking code, proof file → status
  `EM_TRANSITO`, push `transporte`.
- **Entrega**: creates one `inv_unit_products` row per delivered unit (idempotent,
  labels matched from delivery QRs), applying the source's **"Projeto = Cliente"**
  rule (client name = project name), push `cliente`.
- Return-to-expedition / lost / found flows kept, including timestamped note
  stamps (`[Retornado para Expedição em …]`) and sector mapping on "found".
- **Live transit progress** by QR against `inv_external_states` (badge "X de Y em
  transporte") — a paginated read endpoint, frontend polls.

### M7 — Campo (Cliente / Técnico / Avarias)

- `inv_unit_products`: per-unit record at the client (status `PARADO`/`INSTALADO`,
  install timestamp, label=QR, project/client, move-out fields). Toggle
  install/stop pushes to the external platform. Moves to
  `TECNICO`/`ALMOXARIFADO`/`PERDIDO`/`AVARIADO` are **tracking-only** — no stock
  movement — except destination Estoque, which writes an `ENTRADA` + links the QR
  (so the M8 sync doesn't undo it). Ported anti-double-count rule.
- `inv_technician_moves`: custody control — dispatch = exit movement with
  responsible; per-dispatch remaining = qty − Σ moves; destinations `UNIDADE`/
  `PERDIDO`/`ALMOXARIFADO`/`AVARIADO` (the source's CHECK is missing `avariado`
  and its sync violates it — fixed here, Appendix C).
- `inv_damaged_items`: damage report (from any stock, client, technician or the
  external platform) with qty/reason/photo; **recovery** to
  `ESTOQUE`/`TECNICO`/`UNIDADE` writing the compensating movements and re-linking
  the QR identity (source rule: without re-linking, the 5-min sync would revert
  the recovery).

### M8 — Sync externo (plataforma `produto.myio.com.br`)

- **Client**: 3 endpoints — `GET/POST /api/public/products`,
  `PATCH /api/public/products/:code` — auth `x-api-key` (server-side secret via
  `secretEnvelope`, per-tenant config).
- **Pull worker** (replaces the anon-key webhook): backend cron (node-cron) every
  5 min per enabled tenant, with the source's semantics preserved:
  single-flight lease persisted in `inv_external_sync_state`; 1000-item cap;
  **golden rule** (only QRs present in `inv_homologation_units` are considered);
  **box-is-master** propagation (2 passes; unit reported at client "leaves the
  box"); upsert mirror `inv_external_states`; ledger reconciliation
  (auto `SAIDA`/`ENTRADA` corrections with app-level negative guard);
  client-install upsert into `inv_unit_products` (name matching project → client,
  case-insensitive); damaged auto-report; order auto-transition
  `EM_TRANSITO → ENTREGUE_CLIENTE` when all QRs read `cliente`.
  Run report `ok|parcial|erro` + problems list, exposed at
  `GET /inventory/external/sync/status`; manual trigger
  `POST /inventory/external/sync/run` (admin or `gcdr_cust_*` M2M key — **no
  public anon endpoint**, DEC-7).
- **Push outbox** (DEC-6): the source pushes from the *browser*, fire-and-forget.
  Here every push point (stock exit→tecnico, homologation→estoque,
  delivery→expedicao, ship→transporte, deliver→cliente, moves, recoveries,
  install toggles) enqueues `inv_external_push_outbox` rows in the same
  transaction; a worker drains with retry/backoff; sync reconciliation remains the
  safety net. **Drain semantics (W3):** batch claim via
  `SELECT … FOR UPDATE SKIP LOCKED` (safe under side-by-side instances during
  Dokploy deploys) and **FIFO per QR** — a row is eligible only if no older
  pending/failed row shares any of its `qr_codes`, so a backoff on "tecnico" can
  never let a later "cliente" push overtake it and leave the external platform
  with stale state.
- **Shadow mode first (J4)**: the pull worker ships in **P2** running against the
  real external platform, writing `inv_external_states` and *logging* the ledger
  corrections it would make without applying them. Weeks of diff between "what
  the Lovable sync did" and "what GCDR would do" gate the switch to live writes
  in P4.

### M9 — Projetos (e clientes)

- `inv_projects`: name, description, optional `customer_id` FK → GCDR
  **customers** (the source's `clients` table maps onto GCDR customers; no new
  clients table). Legacy free-text client name/cnpj kept as nullable columns for
  import fidelity only.

### M10 — RBAC, auditoria, importação

- No new user tables — GCDR users + RBAC. Role/policy mapping in §RBAC.
- Purchase-order timeline via `inv_purchase_order_events`; everything else audits
  through RFC-0009 audit logs (actions like `INV_STOCK_MOVEMENT_CREATED`,
  `INV_EXPEDITION_STATUS_CHANGED`, …).
- **One-shot import** from the Supabase system (§Migration & import).

---

## Reference-level explanation

### Data model (Drizzle, `schema.ts`; tables prefixed `inv_`)

Conventions: every table gets `id uuid pk default gen_random_uuid()`,
`tenant_id uuid not null`, `created_at`/`updated_at timestamptz`, `created_by uuid`
(GCDR user id); enums as `varchar` + `CHECK` following existing schema style;
FKs `ON DELETE` mirroring the source (Appendix A) unless noted. `customer_id`
appears where the record is customer-facing (`inv_projects`,
`inv_expedition_orders`, `inv_unit_products`).

| Table | Purpose / key columns (beyond conventions) |
|---|---|
| `inv_items` | `name`, `normalized_name` (generated), `domain` CHECK (`COMPONENT`,`PRODUCT`,`THIRD_PARTY`,`TOOL`), `link`, `description`, `is_manufactured bool`, `loss_percent numeric(6,2) default 0`, `lot_quantity int`, `purchase_type` CHECK (`NACIONAL`,`IMPORTACAO`) null, `photo_file_id` FK file_assets, `active bool`. UNIQUE `(tenant_id, domain, normalized_name)`; CHECK `NOT is_manufactured OR domain = 'PRODUCT'` (W4) |
| `inv_qr_registry` | single QR identity source (A2): `qr_value` UNIQUE per tenant, `kind` CHECK (`UNIT`,`BOX`), `item_id` FK SET NULL. All QR-bearing tables reference it; exits lock its row (`FOR UPDATE`) to assert not-already-used atomically |
| `inv_boms` | `product_item_id`/`component_item_id` FK inv_items CASCADE, `quantity numeric(12,3) CHECK > 0`, UNIQUE pair |
| `inv_stock_movements` | `item_id` FK RESTRICT, `location` CHECK (`FABRICA`,`ALMOXARIFADO`,`ALMOXARIFADO_GERAL`), `quantity numeric(12,3) CHECK > 0`, `type` CHECK (`ENTRADA`,`SAIDA`,`AJUSTE`,`TRANSFERENCIA_IN`,`TRANSFERENCIA_OUT`), `reason`, `responsible` (text — technician name), `photo_file_id`, `purchase_order_id` FK SET NULL, `transfer_group_id uuid` (pairs the two legs). Covering index `(tenant_id, item_id, location, type) INCLUDE (quantity)` (W2); partial UNIQUE `(tenant_id, purchase_order_id) WHERE type='ENTRADA'` — receipt-entry idempotency by constraint (A1) |
| `inv_movement_qrs` | `movement_id` FK CASCADE, `qr_value`, `box_qr`, `homologation_unit_id` FK SET NULL. Index `(qr_value)` |
| `inv_projects` | `name`, `description`, `customer_id` FK customers SET NULL, `legacy_client_name`, `legacy_client_cnpj` |
| `inv_purchase_orders` | `project_id` FK RESTRICT, `requester_id` (user), `item_id` FK inv_items RESTRICT, `item_name_snapshot`, `item_link`, `quantity int CHECK 1..100000`, `recipient`, `delivery_point`, `status` CHECK (§M3), `deadline_type` CHECK, `deadline_date date`, `delivery_forecast date`, `requester_notes`, `buyer_notes`, `passphrase` |
| `inv_purchase_order_files` | link table → `file_assets` (same pattern as `annotation_attachments`) |
| `inv_purchase_order_events` | `order_id` FK CASCADE, `actor_id`, `event_type` CHECK (`CRIADO`,`STATUS_ALTERADO`,`OBSERVACAO_ATUALIZADA`), `details jsonb` |
| `inv_production_demands` | `expedition_order_item_id uuid UNIQUE`, `expedition_order_id` FK CASCADE, `item_id` FK, `quantity int`, `status` CHECK (`PENDENTE`,`CONCLUIDO`) |
| `inv_purchase_demands` | `expedition_order_item_id uuid UNIQUE`, `expedition_order_id` FK CASCADE, `purchase_order_id` FK SET NULL, `item_id` FK, `quantity int` |
| `inv_assembly_releases` | `photo_file_id NOT NULL`, `responsibles uuid[]`, `notes` |
| `inv_assembly_release_items` | `release_id` FK CASCADE, `item_id` FK, `quantity int CHECK > 0` |
| `inv_assembly_release_issues` | `release_id` FK CASCADE, `release_item_id` FK CASCADE null, `item_id` FK SET NULL, `reported_quantity int`, `message`, `status` CHECK (`ABERTA`,`RESOLVIDA`), `resolution_note`, `reported_by`, `resolved_by`, `resolved_at` |
| `inv_homologations` | `release_id` FK CASCADE, `item_id` FK CASCADE, `box_size int CHECK IN (1,10,50,100,224)`, `box_qr` UNIQUE per tenant (partial), `responsible_id`, `notes` |
| `inv_homologation_units` | `homologation_id` FK CASCADE, `position int`, `qr_value` UNIQUE per tenant |
| `inv_expedition_orders` | `title`, `project_id` FK, `customer_id` FK SET NULL, `delivery_date date NOT NULL`, `status` CHECK (§M6), `is_replacement bool`, `notes` |
| `inv_expedition_order_items` | `order_id` FK CASCADE, `item_id` FK inv_items RESTRICT, `quantity int` |
| `inv_item_deliveries` | `order_id` FK CASCADE, `order_item_id` FK CASCADE, `quantity int`, `photo_file_id NOT NULL` |
| `inv_delivery_qrs` | `delivery_id` FK CASCADE, `order_item_id` FK CASCADE, `qr_value`, `box_qr`, `homologation_unit_id` FK SET NULL. Index `(qr_value)` (S5 — trace) |
| `inv_shipments` | `order_id` FK CASCADE, `address`, `shipping_method` CHECK (`AZUL_CARGO`,`CORREIOS`,`CARRO_MYIO`,`UBER`), `responsible`, `tracking_code`, `proof_file_id NOT NULL`, `notes` |
| `inv_unit_products` | `item_id` FK SET NULL, `label` (QR, unique per tenant when set), `status` CHECK (`PARADO`,`INSTALADO`), `installed_at`, `project_id` FK, `customer_id` FK SET NULL, `client_name_snapshot`, `expedition_order_id` FK SET NULL, `moved_to` CHECK (`TECNICO`,`ALMOXARIFADO`,`PERDIDO`,`AVARIADO`) null, `moved_technician`, `move_photo_file_id`, `moved_at`, `move_notes`, `notes` |
| `inv_technician_moves` | `movement_id` FK CASCADE, `item_id` FK CASCADE, `technician`, `destination` CHECK (`UNIDADE`,`PERDIDO`,`ALMOXARIFADO`,`AVARIADO`), `project_id` FK null, `quantity int CHECK > 0`, `notes` |
| `inv_damaged_items` | `item_id` FK SET NULL, `product_name_snapshot`, `quantity int CHECK > 0`, `source`, `source_detail`, `reason`, `photo_file_id`, `status` CHECK (`AVARIADO`,`RECUPERADO`), `recovered_to`, `recovery_notes`, `recovered_by`, `recovered_at` |
| `inv_external_states` | `code` UNIQUE per tenant, `product_type`, `location`, `status`, `technician`, `client_name`, `qr_value`, `item_id` FK SET NULL, `homologation_unit_id` FK SET NULL, `last_change_at`, `payload jsonb` |
| `inv_external_sync_state` | one row per tenant: `lease_until`, `last_run_at`, `last_status` CHECK (`OK`,`PARCIAL`,`ERRO`), `last_message`, `total_items` |
| `inv_external_push_outbox` | `qr_codes text[]`, `location`, `status`, `technician`, `client_name`, `attempts int`, `next_attempt_at`, `last_error`, `dispatched_at` |

**Balances**: implemented as a repository aggregate query (or SQL view
`inv_item_stock`) — `balance`, `total_in`, `total_out`, `last_movement_at` per
`(item_id, location)`; `AJUSTE` counts as in (source semantics).

### API surface (`/api/v1/inventory`, JWT or partner/customer API key per RBAC)

All list endpoints paginated (`page`,`pageSize`,`total`,`totalPages`), Zod DTOs in
`src/dto/`, responses via `sendSuccess`/`sendCreated`, errors via `AppError`
family. **API conventions (A3, S1, S3):**

- **Idempotency**: every mutation POST that creates movements/deliveries/entries
  accepts a required `Idempotency-Key` header; replays return the original result
  (shop-floor Wi-Fi retry safety).
- **Two-phase uploads**: photos/proofs upload first (`file_assets` signed-URL
  flow → `file_id`), then the domain POST references the id — both steps
  independently retryable.
- **Destructive verbs** (`DELETE`, `/stock/reset`) require a server-side
  `confirmationToken`; the frontend "digite excluir" ritual is an extra layer,
  never the only defense.
- **Errors are machine-readable**: `code` + params per Appendix D (new
  `ConflictError` → HTTP 409 in `shared/errors/AppError`); the frontend renders
  pt-BR from codes, never parses messages.
- **State machines are served, not mirrored**: order reads include
  `allowedTransitions` for the caller's role, so the frontend never re-implements
  DEC-4.
- **Latency budgets**: p95 < 1s for movement/delivery commits and `/qr/trace`;
  < 300ms for `/qr/validate`.
- **DTOs**: P0/P1 Zod DTOs are appended to this RFC before implementation kickoff
  (the paired frontend branch depends on them); later phases may finalize DTOs at
  implementation time.

Representative surface:

| Area | Endpoints |
|---|---|
| Items | `GET/POST /items`, `GET/PATCH/DELETE /items/:id`, `GET /items/:id/stock`, `GET/PUT /items/:id/bom` |
| Stock | `GET /stock/balances?location&domain`, `GET/POST /stock/movements`, `POST /stock/transfers`, `GET /stock/consistency` (W1), `POST /stock/reset` (admin; confirmation token), `GET /stock/movements/:id` |
| Purchases | `GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/:id`, `POST /purchase-orders/:id/status`, `GET /purchase-orders/:id/events`, `POST/DELETE /purchase-orders/:id/files`, `DELETE /purchase-orders/:id` (admin) |
| Production | `GET /production/demands`, `POST /production/resolve-demand`, `GET /production/capacity`, `POST /production/simulator/preview` (preview-only — DEC-13) |
| Assembly | `GET/POST /assembly-releases`, `POST /assembly-releases/:id/correct`, `DELETE /assembly-releases/:id` (admin), `GET/POST /assembly-releases/:id/issues`, `POST /issues/:id/resolve` |
| Homologation | `GET/POST /homologations`, `GET /homologations/boxes`, `POST /homologations/boxes/:id/add-unit`, `POST /homologations/units/:id/remove-from-box`, `POST /qr/generate` (delegates external), `GET /qr/trace/:code`, `POST /qr/validate` (S2) |
| Expedition | `GET/POST /expedition-orders`, `GET/PATCH/DELETE /expedition-orders/:id`, `POST /expedition-orders/:id/status`, `POST /expedition-orders/:id/items/:itemId/deliver`, `POST /expedition-orders/:id/ship`, `POST /expedition-orders/:id/return`, `POST /expedition-orders/:id/lost`, `POST /expedition-orders/:id/found`, `GET /expedition-orders/:id/transit-progress` |
| Field | `GET/POST /unit-products`, `PATCH /unit-products/:id` (install toggle), `POST /unit-products/:id/move`, `GET /technician-items`, `POST /technician-moves`, `GET/POST /damaged-items`, `POST /damaged-items/:id/recover` |
| External | `GET /external/states`, `GET /external/sync/status`, `POST /external/sync/run` |
| Projects | `GET/POST /projects`, `PATCH/DELETE /projects/:id` |

### RBAC mapping

New seed policies/roles (following RFC-0057's split-verb lesson — destructive and
admin verbs are **not** reachable from read-only):

| Source role | GCDR role (new) | Policy highlights |
|---|---|---|
| `solicitante` | `role:inventory-requester` | `inventory.purchase-order.create/read-own/update-own-pending/confirm-receipt`; read catalog/stock |
| `comprador` | `role:inventory-buyer` | requester + `inventory.purchase-order.read/manage` (buyer statuses, notes, passphrase, forecast, files) |
| `fabrica` | `role:inventory-factory` | fábrica-scoped stock/BOM/assembly/production read-write; expedition **read-only**; no delete |
| `admin` | `role:inventory-admin` | full inventory domain incl. deletes, stock reset, projects, sync run, simulator apply |
| — (M2M) | customer API key `gcdr_cust_*` | `inventory.external.sync.run` + read states (Node-RED/cron integrations) |

JWT admin detection must match the three forms (scope, role key, RBAC) per the
known gotcha (`reference_gcdr_auth_admin_detection`). Destructive endpoints
(`DELETE`, `/stock/reset`) additionally require the typed-confirmation UX
client-side ("excluir"/"zerar" — kept as a frontend contract, not backend).

### Decisions

- **DEC-1 Unified catalog.** One `inv_items` + one ledger with `domain` replaces
  the source's 3 parallel table families (identical shapes). Domain-specific exit
  rules move to the service layer keyed on `domain`/`is_manufactured`.
- **DEC-2 Event-sourced stock.** Balance derived, never stored; negative guard via
  row-lock in the service transaction (fixes the source's unlocked trigger race).
  Cost plan (W2): covering index on the ledger (§Data model); the `FOR UPDATE` on
  `inv_items` intentionally serializes per item *across all locations*; transfers
  apply the negative guard on the OUT leg with both legs in one transaction;
  escape hatch — if movement-commit p95 exceeds 500ms, introduce a per-item
  balance-snapshot row (checkpoint + tail sum) without changing the API.
- **DEC-3 Location on the movement.** Item identity is location-free; per-location
  balances come from the ledger; `TRANSFERENCIA_*` legs (shared
  `transfer_group_id`) replace catalog-row duplication. Import merges source
  duplicates by normalized name (Appendix B mapping).
- **DEC-4 Server-side state machines.** Transition maps enforced in services for
  purchase orders (§M3) and expedition orders (§M6); illegal transitions → HTTP
  409 via a new `ConflictError` (A3 — `ValidationError` stays 400); transition to
  the *current* state is also 409, body carrying the standing state (A1); order
  reads include `allowedTransitions` per caller role (S3). The source enforces
  these only in the UI.
- **DEC-5 Normalize product references.** `inv_expedition_order_items.item_id` and
  demand tables reference `inv_items` by FK (source uses free-text names matched
  case-insensitively — a standing corruption risk).
- **DEC-6 Transactional outbox for external push.** Push rows enqueued in the same
  DB transaction as the domain write; worker drains with retry/backoff, claiming
  batches with `FOR UPDATE SKIP LOCKED` and honoring per-QR FIFO (W3 — a row
  waits while an older pending row shares any of its QRs). Removes the source's
  browser-dependent fire-and-forget push and stays deploy-safe with overlapping
  instances.
- **DEC-7 Kill the anon webhook.** Sync runs as an internal cron per tenant;
  manual trigger requires admin JWT or `gcdr_cust_*` key. External API key stored
  with `secretEnvelope` (RFC-0056 pattern) per tenant.
- **DEC-8 Files via `file_assets`.** All photos/attachments/proofs reuse RFC-0030
  storage (S3/MinIO/LOCAL) through link tables or `*_file_id` columns; served by
  signed URL. Buckets → prefixes: `order-attachments/`, `assembly-photos/`,
  `product-images/`.
- **DEC-9 WO-style event model** for purchase-order timeline; everything else on
  RFC-0009 audit logs. No DB triggers for auditing (source's `SECURITY DEFINER` +
  `auth.uid()` pattern doesn't exist outside Supabase).
- **DEC-10 Passphrase stays plaintext.** It's a spoken delivery word (e.g.
  "laranja"), not a credential; stored as-is, excluded from audit `details`.
- **DEC-11 No realtime.** Frontend polls (60s where the source polled) +
  invalidation.
- **DEC-12 Tenant scoping now, customer scoping where meaningful.** All tables
  carry `tenant_id`; `customer_id` only where the record faces a customer.
  Single-tenant at launch (Myio ops) but nothing blocks reuse.
- **DEC-13 Simulator is preview-only (J5).** The source's "Abastecer estoque"
  writes real `ENTRADA` movements with reason "Simulação" — ledger pollution.
  v1 ships `simulator/preview` only; seeding real stock is an explicit `AJUSTE`
  with its own reason, audited as such.

### Migration & import (M10)

1. **Schema**: new migrations via the custom runner (`db:mig:*` —
   `docs/DB-MIGRATIONS.md`; journal is frozen at 0012, do **not** touch drizzle
   journal). Numbering: next free after the pending RFC-0046 migrations
   (0060/0061) — coordinate before merging.
2. **Data import (`scripts/inventory/import-comprasmyio.ts`) — a P1 deliverable
   rehearsed weekly, not a one-shot at the end (J2)**: consume the source's
   `exportDatabaseBackup` JSON (30 tables) **plus** direct Supabase REST reads in
   the same window for the tables missing from the backup (`tool_assets`,
   `tool_movements` — known gap), and storage downloads for the 3 buckets →
   `file_assets`. Mapping table in Appendix B; users matched by email, unmatched
   actors imported as label-only strings. Operational contract (A5):
   - **Topological order**: items → boms → customers/projects → movements+QRs →
     releases → homologations → expedition (orders→deliveries→QRs→shipments) →
     field → external states.
   - **`--raw-ledger` mode**: historical movements bypass the M2 service guards
     (no QR/photo requirements on legacy rows), written via repository with
     `imported=true` and importer actor.
   - **Parity snapshot**: step 0 captures the source's three balance views +
     per-table counts; the parity report diffs that snapshot against
     `inv_item_stock` per `(item_id, location)` — zero diff or a named, curated
     exception list. From P1 on, this report runs weekly against a fresh backup
     as the project's health metric; by cutover day it has been green for weeks.
3. **Cutover in two waves (J1)**:
   - **Wave 1 (after P1) — Compras**: solicitantes + comprador move to GCDR
     (purchase flow touches no QR/sync). Interim handling of the automatic
     `ENTRADA` on `RECEBIDO_OK` while the warehouse still lives in Lovable is an
     open item (§BMAD Session OI-1).
   - **Wave 2 (after P4) — warehouse/factory/expedition**, in this exact order
     (W5): (1) disable the Lovable webhook/pg_cron sync, (2) freeze the app
     (read-only), (3) run the final import, (4) validate parity, (5) enable the
     GCDR sync cron + outbox live writes, (6) point operators at "Estoque".
     The old app stays a *frozen photograph* — its sync must never run again —
     retained read-only for 30 days. Wave 2 additionally gates on the factory
     mobile pilot (J3): one week of real-device usage (homologation running in
     parallel) with structured feedback before the switch.

### Delivery phases ("vários itens/módulos")

| Phase | Scope | Depends on |
|---|---|---|
| **P0** | **All `inv_*` schema migrations** (A4 — no dangling FKs later); M1 catalog+BOM; M2 ledger+balances+guards+consistency; RBAC seeds; concurrency-test harness (two real pg connections — A6); P0/P1 DTOs finalized | — |
| **P1** | M3 purchases end-to-end (requests, queue, events, files, auto-entry on receipt); M9 projects; **import script v1 + weekly rehearsal cadence (J2)** → **Cutover Wave 1 (Compras)** | P0 |
| **P2** | M5 homologation & QR registry + trace + `/qr/validate`; M4 production (releases, issues, capacity, simulator preview); **M8 pull worker in shadow mode (J4)** | P0 |
| **P3** | M6 expedition (orders, deliveries, shipments, transit, lost/found) + **demand resolution (moved from M4 — A4)**; M7 field (units, technicians, damaged) | P2 |
| **P4** | M8 live: push outbox + sync writes enabled after shadow-diff sign-off; final import → **Cutover Wave 2** (gated on factory mobile pilot — J3) | P2–P3 |
| **P5** | Hardening: load/pagination pass, audit coverage, e2e QR-trace tests, frontend "Estoque" menu complete | all |

Frontend pairing: each phase lands as matched `feat/rfc-0061-*` branches in both
repos (per working agreement), UI under menu **Estoque**. Frontend contract
(J3/S4): screens that scan or shoot (homologação, baixas, checar QR, avaria) are
**mobile-first with native camera**; keep the source's pt-BR *names* but do NOT
clone its 12 flat Armazém sub-tabs — regroup as **Saldos** (3 locations),
**Rastreamento** (Transporte/Cliente/Técnico/Perdido/Avariados), **Ferramentas &
Ativos**, with **Checar QR Code promoted to a global scan action** in the Estoque
header; grouping validated with operators before freeze (details in the paired
frontend RFC).

### Acceptance criteria (v1)

1. A requester can open, edit-while-pending, and confirm receipt of a purchase
   order; `RECEBIDO_OK` creates exactly one stock entry — two parallel
   confirmations yield one movement row (partial UNIQUE, A1) and the loser gets
   409 with the standing state.
2. Stock can never go negative under concurrent exits (concurrency harness with
   two real pg connections — A6).
3. A QR value can exist only once per tenant across units and boxes
   (`inv_qr_registry` 23505 on duplicate insert), and can never be exited from
   stock twice (two concurrent exits: one success, one `INV_QR_ALREADY_USED`).
4. Assembly release consumes BOM components with loss factor and abates the
   production queue FIFO, atomically.
5. Expedition order auto-advances on full delivery and the external platform
   receives every push (outbox drains; sync reconciles).
6. `GET /inventory/qr/trace/:code` reproduces the source's timeline for imported
   historical QRs.
7. Import report shows balance parity with the source per item/location.
8. `role:inventory-factory` cannot see buyer data or mutate expedition; read-only
   scopes cannot reach any destructive verb.
9. Replaying any mutation POST with the same `Idempotency-Key` returns the
   original result and creates nothing (S1).
10. `GET /inventory/stock/consistency` reports zero drift between ledger balances
    and active-QR counts for manufactured products on a healthy dataset (W1).

## Drawbacks

- Large surface (~25 tables, ~50 endpoints) — mitigated by phasing; each phase is
  independently shippable and testable.
- Dual-write risk during cutover — mitigated by freeze-then-import (no parallel
  running).

## Rationale and alternatives

- *Keep the Lovable app and just integrate*: leaves the security gaps (anon
  webhook, open RLS) and the single-company model in the critical path.
- *Port 1:1 (3 stock families, text product refs, DB triggers)*: replicates known
  defects; the unified model costs one import mapping and removes three code
  paths.

## Unresolved questions

1. Should `inv_projects` eventually merge into a broader GCDR "projects" concept
   (RFC-0051 WO groups touch adjacent ground)? v1 keeps it inventory-local.
2. Box-size list `{1,10,50,100,224}` — config per tenant or constant? v1: constant
   (source parity).
3. QR generation for tenants without the external platform — local sequence
   fallback? v1: external only (source parity).
4. Retention for `inv_external_states.payload jsonb` (source keeps full raw
   responses forever).
5. `TOOL` domain: ledger-quantitative in v1 (source parity), but tools are assets
   with individual custody — evolve to per-unit tracking? (W4) Also: keep TOOL in
   P0 schema but which phase ships its endpoints/UI? (J5 argued deferral.)
6. Open items OI-1..OI-5 from the BMAD session (§BMAD Session) await Rodrigo's
   call.

---

## Appendix D — Error contract (A3, S3)

New `ConflictError` (HTTP 409) added to `shared/errors/AppError`. Codes are the
frontend's rendering keys — messages are never parsed.

| `code` | HTTP | When |
|---|---|---|
| `INV_ILLEGAL_TRANSITION` | 409 | transition not in the state machine for caller's role (body carries current state + `allowedTransitions`) |
| `INV_ALREADY_IN_STATE` | 409 | transition to the current state (A1) |
| `INV_INSUFFICIENT_STOCK` | 409 | exit/transfer would drive balance negative (params: itemId, location, balance, requested) |
| `INV_QR_ALREADY_USED` | 409 | QR's latest ledger event is an exit |
| `INV_QR_DUPLICATE` | 409 | QR value already registered (unit or box) |
| `INV_QR_NOT_IN_REGISTRY` | 422 | `stockOnly` context: QR not homologated |
| `INV_QR_WRONG_ITEM` | 422 | QR belongs to another item than expected |
| `INV_BOX_FULL` / `INV_BOX_EMPTY` / `INV_BOX_TOO_BIG` | 422 | box operations (§M5/M6) |
| `INV_EDIT_LOCKED_STATE` | 409 | requester edit outside `PENDENTE` |
| `INV_CONFIRMATION_REQUIRED` | 428 | destructive verb without valid `confirmationToken` |
| `INV_IDEMPOTENCY_KEY_MISSING` | 400 | mutation POST without `Idempotency-Key` |

(Validation of shapes/ranges stays `ValidationError` 400; not-found stays
`NotFoundError` 404.)

---

## BMAD Session — 2026-08-25

Roundtable over draft v1 with independent BMAD agents: 🏗️ Winston (architecture),
💻 Amelia (engineering), 📋 John (product), 🎨 Sally (UX); orchestrated by
Rodrigo/Claude. Full transcripts in the session log; resolutions below.

### Accepted → applied in this v2

| # | Point (author) | Landed in |
|---|---|---|
| W1 | Ledger vs QR-registry authority + consistency check | §M2 invariants, `GET /stock/consistency`, AC-10 |
| W2 | Derived-balance cost: covering index, lock semantics, snapshot escape hatch | DEC-2, §Data model |
| W3 | Outbox: `SKIP LOCKED` claim + per-QR FIFO | DEC-6, §M8 |
| W4 | Domain×movement requirements matrix; `is_manufactured ⇒ PRODUCT` CHECK | §M2, `inv_items` |
| W5 | Cutover order: disable old sync before freeze/import | §Cutover Wave 2 |
| A1 | Receipt-entry partial UNIQUE; repeated transition = 409 | §Data model, DEC-4, AC-1 |
| A2 | `inv_qr_registry` as single QR identity + lock row for exits | §M5, §Data model, AC-3 |
| A3 | Error matrix + `ConflictError`; P0/P1 DTOs before kickoff | Appendix D, API conventions |
| A4 | P0 = all migrations; demand resolution moved to P3 | §Delivery phases, §M4 |
| A5 | Import: topological order, `--raw-ledger`, freeze parity snapshot | §Migration & import |
| A6 | Concurrency-test harness in P0 | §Delivery phases, AC-2 |
| J1 | Two-wave cutover (Compras after P1) | §Cutover, §Delivery phases |
| J2 | Import as weekly rehearsal from P1 | §Migration & import |
| J3 | Mobile-first contract + factory pilot gate | §Delivery phases (frontend contract) |
| J4 | M8 shadow mode from P2 | §M8, §Delivery phases |
| J5a | Simulator preview-only | DEC-13 |
| S1 | `Idempotency-Key` on mutations; two-phase uploads; latency budgets | API conventions, AC-9 |
| S2 | `POST /qr/validate` per-beep validation | §M5, API surface |
| S3 | Server-side destructive confirmation; error codes; `allowedTransitions` | API conventions, DEC-4, App. D |
| S4 | Don't clone the 12 Armazém sub-tabs; QR scan as global action | §Delivery phases (frontend contract) |
| S5 | Trace envelope, limbo semantics, indexes, p95 budget | §M5, §Data model |

### Open items (await decision)

| ID | Item | Raised by | Options / lean |
|---|---|---|---|
| OI-1 | Interim handling of auto-`ENTRADA` on `RECEBIDO_OK` between Wave 1 and Wave 2 (warehouse still on Lovable) | J1 | (a) queue as pending entries reconciled at Wave 2; (b) manual entry in Lovable during interim. Lean: (a) |
| OI-2 | Requester notifications ("my order arrived") via RFC-0025 contacts | J5 | Add as P5 or v1.1; wire `STATUS_ALTERADO` events to notification contacts. Lean: v1.1, spec'd now |
| OI-3 | Physical inventory / cycle-count flow (count → divergence → audited adjust) — also the operation's tool to validate the import | J5 | New small module (P5) vs post-v1. Lean: P5 — at minimum a guided-count UX over `AJUSTE` with a dedicated reason and report |
| OI-4 | `POST /stock/reset` — keep (source parity, admin+token) vs kill (J5: replace with cycle-count) | J5 | Lean: keep in v1 behind admin+confirmation; revisit after OI-3 lands |
| OI-5 | `TOOL` domain phase placement + eventual per-unit custody | W4/J5 | Schema in P0 either way; endpoints/UI in P3 or deferred. Lean: P3 |

---

## Appendix A — Source data model (as-is, condensed)

32 tables / 3 views / 5 enums. Families: identity (`profiles`, `user_roles`);
catalogs (`clients`, `projects`, `materials`, `terceiros_materials`,
`tool_assets`, `product_boms`, `myio_product_images`); purchases
(`purchase_orders`, `order_logs`, `purchase_demands`); ledgers
(`stock_movements`+`stock_movement_qrs`, `terceiros_movements`, `tool_movements`;
views `material_stock`, `terceiros_material_stock`, `tool_asset_stock` — balance =
in + adjust − out); production (`assembly_releases`+`items`+`issues`,
`production_demands`); homologation (`homologations`, `homologation_units` — unit
QR globally unique); expedition (`myio_orders`+`items`, `myio_item_deliveries`,
`myio_delivery_qrs`, `myio_shipments`); field (`unit_products`,
`technician_moves`, `damaged_items`); external (`external_product_states`,
`external_sync_state` singleton). Enums: `app_role`, `order_status`,
`deadline_type`, `myio_order_status`, `stock_movement_type`. Triggers:
auto-profile+role on signup (first user = admin), `updated_at`, order-change log
(duplicated), stock entry on `recebido_ok`, negative-stock guards (×3).
Storage buckets: `order-attachments`, `assembly-photos`, `product-images`.
External platform: `MYIO_PRODUCTS_API_BASE` (+`x-api-key`), endpoints
`GET/POST /api/public/products`, `PATCH /api/public/products/:code`; QR
`https://produto.myio.com.br/<code>`, `code = \d+(_\d+)+`; locations
`estoque|expedicao|transporte|cliente|tecnico|perdido|avariado`, status
`instalado|parado`.

## Appendix B — Import mapping (source → GCDR)

| Source | Target | Notes |
|---|---|---|
| `materials` (location=`fabrica`) | `inv_items` domain=`COMPONENT` | merge duplicates by normalized name across locations (DEC-3) |
| `materials` (`is_product` or `is_manufactured`, almoxarifado) | `inv_items` domain=`PRODUCT` | |
| `materials` (almoxarifado_geral / non-manufactured) | `inv_items` domain=`COMPONENT` or `THIRD_PARTY` (curated list) | |
| `terceiros_materials`+`terceiros_movements` | `inv_items` domain=`THIRD_PARTY` + ledger | |
| `tool_assets`+`tool_movements` | `inv_items` domain=`TOOL` + ledger | **not in source backup** — read via REST |
| `stock_movements`(+`_qrs`) | `inv_stock_movements`(+`inv_movement_qrs`) | location from the material's row at import time |
| `product_boms` | `inv_boms` | |
| `clients` | GCDR `customers` (match by name/cnpj; create if absent) | |
| `projects` | `inv_projects` | link `customer_id` when client matched |
| `purchase_orders`+`order_logs` | `inv_purchase_orders`+`_events` | de-duplicate doubled log rows; legacy statuses `comprado/aguardando/a_caminho` → `COMPRADO_AGUARDANDO` |
| `assembly_*`, `homologation*`, `production_demands`, `purchase_demands` | 1:1 `inv_*` | product text → `item_id` by normalized name |
| `myio_orders`+`items`+deliveries+qrs+shipments | `inv_expedition_*`, `inv_item_deliveries`, `inv_delivery_qrs`, `inv_shipments` | item text → FK; unmatched names create `PRODUCT` items flagged for curation |
| `unit_products`, `technician_moves`, `damaged_items` | 1:1 `inv_*` | `technician_moves.destination` gains `AVARIADO` |
| `external_product_states`/`external_sync_state` | `inv_external_states`/`inv_external_sync_state` | |
| Storage buckets | `file_assets` (prefix per bucket) | signed-URL rewrite on import |
| `profiles`/`user_roles` | GCDR users + role assignments (§RBAC) | match by email |
| `myio_product_images` | `inv_items.photo_file_id` | keyed by product name |

## Appendix C — Source defects deliberately NOT ported

1. Duplicated order-log trigger (`orders_log_trigger` + `trg_log_order_change`) —
   every purchase-order event logged twice.
2. `technician_moves.destination` CHECK missing `avariado`, violated by the sync
   job (errors swallowed into `problems[]`).
3. RLS wide open on `production_demands`/`purchase_demands` (`ALL true`) and
   `UPDATE true` on `unit_products`, `homologation_units`,
   `assembly_release_issues`, `damaged_items`.
4. Public sync webhook authenticated with the public anon key.
5. Backup server function's hardcoded table list missing `tool_assets`/
   `tool_movements`.
6. Free-text product names in expedition/demand tables (case-insensitive name
   matching at read time).
7. Unlocked negative-stock trigger (read-then-insert race).
8. No pagination anywhere (full tables shipped to the browser).
9. Browser-side fire-and-forget external push (lost when the tab closes).
10. First-signup-becomes-admin bootstrap.
