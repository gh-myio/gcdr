# RFC-0061 — Implementation Plan (Inventory & Warehouse Management)

- Status: **P0 kickoff landed (contract-first)** — schema, DTOs, OpenAPI, thin
  routes and contract tests are in place; module business logic follows the
  phases below.
- Branch (backend): `feat/rfc-0061-inventory-backend` (based on `origin/desenv`).
- Paired frontend: `feat/rfc-0061-*` in `gcdr-frontend.git` (menu **Estoque**).
- Source of truth: `docs/rfcs/RFC-0061-Inventory-Stock-Management.md`.

This plan maps the RFC's §Delivery phases to concrete backend work items — which
modules/endpoints per phase, dependencies, migration order, and what is
**stubbed now** vs. built later. It is the roadmap the later phases follow.

---

## What shipped in this kickoff (contract-first slice)

The goal of this slice is to let the **frontend team build against known shapes
in parallel**. It establishes the contract and its guard tests — not the
business logic.

| Deliverable | File(s) | State |
|---|---|---|
| Data model — all `inv_*` tables | `src/infrastructure/database/drizzle/schema.ts` (+27 tables) | **Complete (P0)** — all migrations up front so later phases have no dangling FKs (A4) |
| Migration | `drizzle/migrations/0067_inventory_tables.sql` | **Complete** — 27 tables + `inv_item_stock` view; covering index, partial UNIQUEs |
| Domain types + state machines | `src/domain/entities/Inventory.ts` | **Complete** — enums, `PURCHASE_ORDER_TRANSITIONS`, `EXPEDITION_ORDER_TRANSITIONS` |
| Error contract (Appendix D) | `src/shared/errors/InventoryError.ts` | **Complete** — typed factories + `INV_NOT_IMPLEMENTED` (501) |
| Request DTOs (P0/P1) | `src/dto/request/InventoryDTO.ts` | **Complete for P0/P1**; later phases finalize theirs at build time |
| Response DTOs | `src/dto/response/InventoryResponseDTO.ts` | Read models + `/meta` + qr trace/validate shapes |
| OpenAPI | `docs/openapi.yaml` — 53 `/api/v1/inventory/*` paths + `Inv*` request schemas | **Complete** — every endpoint documented with the error contract |
| Route wiring + thin controllers | `src/controllers/inventory.controller.ts`, `src/app.ts` | Mounted with `hybridAuthByMethod('inventory:read','inventory:write')`; validates DTOs then `501` for deferred modules; `GET /meta` concrete |
| API-key scopes | `src/domain/entities/CustomerApiKey.ts` | `inventory:read` / `inventory:write` added |
| Tests | `tests/unit/dto/InventoryDTO.test.ts`, `tests/unit/controllers/inventory.contract.test.ts` | 40 tests — DTO validation + endpoint/auth/501/idempotency/confirmation |

**Contracted now (real behavior):** route mounting + auth/RBAC class; request-DTO
validation at the HTTP boundary (real `400`s); the error contract (machine
codes + params); `GET /inventory/meta` (enums + state machines + error codes);
idempotency-key guard (`400 INV_IDEMPOTENCY_KEY_MISSING`) and destructive
confirmation guard (`428 INV_CONFIRMATION_REQUIRED`).

**Stubbed now (deferred to a phase):** every module's service/repository. Those
endpoints validate input then return `501 INV_NOT_IMPLEMENTED` with
`{ module, phase }`, so the contract is exercisable and the frontend sees stable
shapes and error codes.

---

## Migration order

- **0067** — `inventory_tables.sql` (this slice): all `inv_*` tables + the
  `inv_item_stock` view, created in topological FK order. Uses the custom runner
  (`db:mig:*`); the drizzle journal is **not** touched (frozen at 0012).
- **⚠ Collision flag:** PR #20 (open) also intends to use 0067/0068. Coordinate
  before merge. If PR #20 lands first, renumber this migration to the next free
  number and update no schema code (schema.ts is number-agnostic).
- No further migrations are expected for v1 — the whole model is in 0067 (A4).
  A per-item balance-snapshot table is only added if movement-commit p95 > 500ms
  (DEC-2 escape hatch), and would be a later additive migration.

---

## Phased plan (maps RFC §Delivery phases → backend work items)

### P0 — Foundation (schema, catalog, ledger) — *this slice + services*
- **Done in kickoff:** all migrations; DTOs (P0/P1); RBAC scope constants;
  contract routes + tests; error contract; `/meta`.
- **Remaining P0 work (next):**
  - M1 services/repositories: `inv_items` CRUD + BOM; unique-name enforcement;
    W4 CHECK surfaced as friendly `400`.
  - M2 ledger service: movement create/list, `inv_item_stock` balances,
    `TRANSFERENCIA` paired legs, negative-stock guard via `SELECT … FOR UPDATE`
    on the item row, exit-requirements matrix (W4), `GET /stock/consistency`
    (W1), `POST /stock/reset` (admin + confirmation).
  - RBAC seed policies/roles (`role:inventory-requester|buyer|factory|admin`) +
    the `gcdr_cust_*` M2M grant — a seed SQL like `04-policies.sql`.
  - **Concurrency-test harness** (A6): two real pg connections proving no
    negative stock and single-winner on concurrent exits (AC-2, AC-3).
- **Depends on:** —

### P1 — Purchases + Projects → Cutover Wave 1 (Compras)
- M3: purchase-order state machine (server-enforced transition map), events
  timeline (`inv_purchase_order_events`), files, **auto-`ENTRADA` on
  `RECEBIDO_OK`** (idempotent by the partial UNIQUE, A1), buyer queue filters.
- M9: projects CRUD; `customer_id` link to GCDR customers.
- **Import script v1** (`scripts/inventory/import-comprasmyio.ts`) + weekly
  rehearsal cadence (J2); `--raw-ledger` mode; parity snapshot report (A5).
- **Cutover Wave 1**: solicitantes + comprador move to GCDR. Open item OI-1
  (interim auto-`ENTRADA` while warehouse still on Lovable) — lean (a): queue as
  pending entries reconciled at Wave 2.
- **Depends on:** P0.

### P2 — Homologation & QR, Production, Sync shadow
- M5: `inv_qr_registry` as QR identity authority; homologations + units; box
  ops; `GET /qr/trace/:code` (S5, p95 < 1s); `POST /qr/validate` (S2, < 300ms);
  `POST /qr/generate` (delegates external).
- M4: assembly releases (BOM explosion + loss factor, FIFO, one transaction),
  divergence issues, `GET /production/capacity`, `simulator/preview` (DEC-13).
- M8 **shadow mode** (J4): pull worker against the real platform, writing
  `inv_external_states` and *logging* the ledger corrections it would make.
- **Depends on:** P0.

### P3 — Expedition + Field + Demand resolution
- M6: expedition-order state machine, deliveries (`stockOnly` QR rules),
  shipments, transit progress, lost/found.
- M7: unit-products (install toggle → external push), technician custody,
  damaged items + recovery.
- M4 **demand resolution** (moved here — A4): `POST /production/resolve-demand`
  (idempotent per `expedition_order_item_id`).
- **Depends on:** P2.

### P4 — Sync live → Cutover Wave 2 (warehouse/factory/expedition)
- M8 live: push outbox drain (`FOR UPDATE SKIP LOCKED` + per-QR FIFO, W3);
  sync writes enabled after shadow-diff sign-off; single-flight lease.
- **Cutover Wave 2** in order (W5): (1) disable Lovable sync, (2) freeze app,
  (3) final import, (4) validate parity, (5) enable GCDR cron + outbox live,
  (6) point operators at Estoque. Gated on the factory mobile pilot (J3).
- **Depends on:** P2–P3.

### P5 — Hardening
- Load/pagination pass, audit coverage (RFC-0009 actions), e2e QR-trace tests,
  frontend Estoque menu complete. Candidates: cycle-count module (OI-3),
  requester notifications (OI-2).
- **Depends on:** all.

---

## Open items carried from the RFC (await Rodrigo's call)

- **OI-1** interim auto-`ENTRADA` handling between Wave 1 and Wave 2 (lean: queue).
- **OI-2** requester notifications via RFC-0025 contacts (lean: v1.1, spec now).
- **OI-3** physical inventory / cycle-count (lean: P5, guided-count over `AJUSTE`).
- **OI-4** keep `POST /stock/reset` vs replace with cycle-count (lean: keep in
  v1 behind admin+confirmation).
- **OI-5** `TOOL` domain endpoints phase placement (lean: P3; schema already in P0).

## Notes for implementers
- Balance is **always derived** from `inv_stock_movements` (never a column). Use
  the `inv_item_stock` view or the covering index for aggregates.
- Illegal transitions → `409 INV_ILLEGAL_TRANSITION` (body carries `current` +
  `allowedTransitions`); transition to current → `409 INV_ALREADY_IN_STATE`.
  `ValidationError` stays `400`; not-found stays `404`.
- Throw `InventoryError` factories from `src/shared/errors/InventoryError.ts`;
  the global `errorHandler` surfaces their `details` as `error.details`.
- Reads that expose a state machine MUST include `allowedTransitions` for the
  caller's role (S3) — the frontend never re-implements DEC-4.
- Replace each endpoint's `defer(...)` stub in `inventory.controller.ts` with a
  service call as its phase lands; the DTO validation already in place stays.
