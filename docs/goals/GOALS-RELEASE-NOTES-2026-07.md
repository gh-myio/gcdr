# Consumption Goals — Release Notes (July 2026)

**Branches:** backend `fix/rfc-0046-feedback-v1` → `feat/rfc-0046-addendum-a-device-goals` · frontend `fix/rfc-0046-feedback-v1` → `feat/rfc-0046-addendum-a-device-goals`
**Specs:** [RFC-0046 Addendum A — Device-Granular Goals](../rfcs/RFC-0046-Addendum-A-Device-Granular-Goals.md) (APPROVED rev. 2) · wire deltas in [RFC-0046-Goals-API.md §7](../rfcs/RFC-0046-Goals-API.md)
**Migrations:** `0060_goals_history_identity.sql`, `0061_device_granular_goals.sql` · ops script `scripts/db/ops/add-goals-management-policy.sql`

This release ships two workstreams: the **RFC-0046 feedback-v1 P0/P1 fixes** (hardening of the existing customer-level goals) and **Addendum A — device-granular goals** (per-entry-meter targets with residual allocation). Everything is **backward compatible**: a goal year never written with a `deviceId` behaves exactly as before, byte-identical reads included.

---

## 1. Hardening (feedback-v1 P0/P1)

### Backend

- **Authorization (P0.1)** — `/customers/:customerId/goals` now enforces access beyond the scope gate, via the new `requireGoalsAccess` middleware:
  - JWT users are evaluated against RBAC permissions `goals.goal.read` / `goals.goal.update` scoped to the target customer (`403` on deny).
  - Customer API keys are checked against their hierarchy reach (`SELF`/`SUBTREE`/`TENANT`); a customer outside the key's reach answers `404` (no existence leak).
  - New seeded policy `policy:goals-management` attached to `role:customer-admin` and `role:energy-analyst`. **Deploy note:** run `scripts/db/ops/add-goals-management-policy.sql` in prod together with the deploy, or non-admin JWT users lose goals access.
- **Residual-aware distribution (P1.1/P1.2)** — a coarse bucket's value is now the **total (SUM) / target mean (AVERAGE) of its scope**: finer buckets in the same payload and operator-confirmed hours keep their values ("pinned") and only the residual is spread across the remaining hours. Inconsistent payloads (negative residual, fully-pinned scope that cannot match) fail `400` instead of silently drifting.
- **Atomic delete (P0.3)** — the whole delete flow (find → version bump → hour removal → history → parent removal) runs in one transaction.
- **First-write guard (P1.4)** — sending `expectedVersion > 0` for a year that does not exist answers `409` (previously created version 1 silently).
- **History survives deletes (P1.5)** — history rows carry their own identity (tenant/customer/domain/year, migration `0060`), so a deleted-and-recreated year keeps one auditable stream.

### Frontend

- **PATCH dirty-only (P0.2/P2.1)** — every grid save sends ONLY the cells the operator changed, as sparse `PATCH` buckets at the grid's level; cleared cells issue scoped bucket `DELETE`s. No more full-year `PUT` collapsing daily/hourly detail.
- **409 reload-and-reapply (P1.3)** — on a version conflict the tree is refetched and the operator's dirty cells are reapplied on top of the fresh values for review, instead of being discarded. Mutations return a discriminated result (`success | conflict | error`) so flows branch on fresh data, not stale state.

---

## 2. Device-granular goals (Addendum A, APPROVED rev. 2)

### Rules (the model)

- A goal year now has a **granularity**: `CUSTOMER` (default, one value per hour) or `DEVICE` (one value per *(hour, entry meter)*). v1 restricts DEVICE to SUM domains (ENERGY/WATER).
- **Explicit ENTRY classification (DEC-11)** — the participating pool is the set of devices registered with `meterRole: ENTRY` + `meterDomain` matching the goal domain. The pair is set/cleared together (service validation + DB CHECK). Classification is **never inferred** from type, name or channel; with no classified meter, device writes fail `422 GOAL_ENTRY_SET_UNDEFINED`.
- **Mixed allocation with residual (DEC-8)** — the operator can state a group total and/or explicit per-meter values. Explicit values are pinned; the remainder (total − Σ explicit) splits evenly among the meters without one (`RESIDUAL`). One unspecified meter absorbs the whole residual; N split evenly. Overflow (explicit > total on any hour) fails `400 GOAL_DEVICE_OVERFLOW`.
- **Implicit conversion** — the first write carrying a `deviceId` on a CUSTOMER year converts it: existing values become the group total per hour, the target meter gets its stated values (EXPLICIT), the remaining entry meters absorb the residual. Hour-exact totals preserved, one version bump, the switch recorded in history. The reverse (DEVICE → CUSTOMER) only happens via a deliberate deviceless `PUT` stating `granularity: 'CUSTOMER'`.
- **Group-total editing (DEC-9)** — a deviceless write on a DEVICE year edits the group total: explicit meters stay pinned, residuals rebalance.
- **No silent changes (DEC-12)** — registering or reclassifying a meter never alters goals by itself. The participating set is pinned at write time; converging to a changed ENTRY set is the explicit **rebalance** operation (preview + operator confirmation + optimistic lock + ONE version bump + ONE `REBALANCE` history entry).
- **Removal never shrinks silently (DEC-12)** — removing an EXPLICIT meter's goal redistributes its share to the RESIDUAL meters (total preserved). With no residual meter left, the caller must state `mode: 'shrink-total'` or the call answers `409 GOAL_REMOVAL_MODE_REQUIRED`.

### Backend (API surface — all additive)

- `?deviceId=` on `GET` (narrows the tree to one meter) and on `PUT`/`PATCH`/`POST /import`/`DELETE` (targets one entry meter).
- `PUT` body accepts `granularity: 'CUSTOMER' | 'DEVICE'` to disambiguate deviceless PUTs on DEVICE years.
- `DELETE` body accepts `mode: 'redistribute' | 'shrink-total'`.
- **New endpoint** `POST /customers/:id/goals/rebalance?domain=&year=&dryRun=` — dryRun previews the before/after per meter (entering/leaving); apply runs under `expectedVersion`.
- `GET` response gains `granularity`, `devices[]` (per meter: code, label, dominant `allocation`, `annual`, `annualAdjusted` with the RFC-0052 margin applied) — consolidated tree nodes of a DEVICE year omit `sourceLevel`/`derived` (ambiguous across meters).
- New error codes: `GOAL_DEVICE_OVERFLOW` (400), `GOAL_ENTRY_SET_UNDEFINED` (422), `GOAL_DEVICE_NOT_ENTRY` (422), `GOAL_REMOVAL_MODE_REQUIRED` (409); a `deviceId` of another customer answers `404`.
- Devices API: `meterRole`/`meterDomain` on create/update/read (nullable pair).
- **Schema (migration `0061`)** — `devices.meter_role`/`meter_domain` (+ CHECKs); `consumption_goal_hours.device_id` (FK `ON DELETE RESTRICT`), generated `device_key`, `device_allocation` (+ CHECK), uniqueness now *(goal_id, device_key, month, day, hour)*; `consumption_goals.granularity`; history `device_id` + `REBALANCE` source.
- 24 new unit tests (conversion arithmetic, DEC-11 gating, removal modes, rebalance, time × device residual composition, concurrency); full unit suite green; CUSTOMER-goal behaviour covered by a byte-identity test.

### UI

- **Meter selector** on the customer's Goals tab — "Customer total (group)" plus the resolved ENTRY meters (declassified meters that still hold materialised goals stay listed). Reads, saves, bucket deletes and CSV imports all follow the selected meter.
- **Conversion notice** — editing with a meter selected on a still-CUSTOMER year shows, before the operator confirms by saving, that the year will become per-meter, with the **resolved ENTRY list and its count** (DEC-11 requirement).
- **Per-meter cards** on the consolidated view with **Explicit / Residual** badges and the annual value (margin-adjusted when a margin is active); clicking a card scopes the tab to that meter. A "Per meter (N)" chip joins the header chips.
- **"Rebalance available" banner** — divergence between the current ENTRY set and the pinned participating set is detected client-side (entering meters / residual holders that left) and surfaced without touching data; the button opens a **dry-run preview modal** (before/after per meter, entering/leaving tags) and the confirm applies under the optimistic lock.
- **Device registry form** — new "Metering (goals)" section with the meter role/measured-domain pair (both-or-neither validation) and a hint that classifying never changes goals by itself.
- **History timeline** renders the new `REBALANCE` operation with its own icon/label.
- **Per-sensor CSV import** — the existing import modal, scoped by the meter selector (one CSV per sensor; a consolidated CSV with a `device` column is backlog).

---

## 3. Goal-series tab badge & coverage warnings

New in this release (post-approval addition, both sides):

- The Goals tab badge now counts **goal series** for the visible *(domain, year)*: `1` for a customer-wide goal, `N` for a DEVICE year (one per meter with metas), `0` when empty — it no longer shows "months filled". The badge is pinned to the consolidated view (selecting a meter doesn't rewrite it).
- **Coverage warning** — any series covering less than 100% of the year's hour slots (8 760/8 784) shows a warning icon next to the count with a myio-lib InfoTooltip that says **which series is short (general or meter X) and where the holes are**, e.g. *"The GENERAL goal for this domain/year does not cover 100% of days and hours. Missing: Feb, Mar, 15 Apr… (~8,016h)."*
- Backend support: `GET` responses now expose `hoursCovered` (consolidated + per meter) and `coverageGaps` — compact missing refs, coarsest form first (whole month `YYYY-MM` → whole day `YYYY-MM-DD` → hour `YYYY-MM-DDThh`), capped at 12 refs with `truncated` + total `missingHours`. Present on GET reads only; absent when coverage is complete.

---

## 4. Operations / rollout checklist

1. Apply migrations `0060` + `0061` (`npm run db:mig:up`). Note: `0061` drops the old uniqueness via `DROP CONSTRAINT` (it was created as a constraint by `0047`; a plain `DROP INDEX` fails with `2BP01`).
2. Run `scripts/db/ops/add-goals-management-policy.sql` **with** the deploy (JWT non-admin access to goals depends on it).
3. Curate the pilot's ENTRY meters via the device form (e.g. Moxuara: `TRAFO_GERAL` + `TRAFO_CAG` as ENTRY/ENERGY) **before** enabling DEVICE granularity for 2026 — production devices have no classification until this is done, so the meter selector stays hidden (by design).
4. Per-sensor spreadsheet loads: generate one `bucket,value` CSV per meter and import each with its meter selected (see `docs/goals/sa-cavalcante/2026-v2/goals-2026-SDI-*.csv` for the SDI split: CAG × Condomínio from the seasonalized apportionment workbook).

## 5. Explicitly out of scope (v1)

- DEVICE granularity for AVERAGE domains (TEMPERATURE).
- Per-device margin (RFC-0052 margin stays customer-level, applied after aggregation).
- Consolidated CSV with a `device` column (one file per sensor for now).
- Automatic redistribution on meter registration/reclassification (always the explicit rebalance).
