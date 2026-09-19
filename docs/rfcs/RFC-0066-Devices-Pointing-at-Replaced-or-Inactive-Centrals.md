# RFC-0066 — Devices Pointing at Replaced or Inactive Centrals: Detection, Repair & Resolution

- **Status:** Draft — **future work**, deliberately not implemented by ED-1257 / RFC-0065
- **Date:** 2026-09-19
- **Domain:** Centrals / Devices / Data quality
- **Authors:** MYIO Engineering (draft: Claude Code, on behalf of rodrigo@myio.com.br)
- **Depends on:** RFC-0005 (Gateway hardware replacement), RFC-0062 (`hardwareId`), RFC-0065 (hybrid central identity in the bundle `deviceIndex`)
- **Origin:** RFC-0065 §Unresolved question 1, split out so the bundle work could ship without deciding it.
- **Migration:** none required to *detect*; the repair/resolution options below may need a small schema addition (see §Design options).

---

## Summary

A device row carries `central_id`. When a gateway is physically replaced through `POST /centrals/:oldUuid/replace` (RFC-0005), GCDR creates a **new** central row and repoints every device in one transaction, and archives the old row (`INACTIVE`, `metadata.replacedBy`/`replacedAt`). That path is consistent. But two situations leave devices pointing at a central that is **not the live one**:

1. **Out-of-band gateway migration** — e.g. Moxuara (`e982edf9…` → `6d7cd66a…`), done in the ingestion with slave renumbering (325/191 → 1/2), never through `/replace`. Devices in GCDR still reference the old central.
2. **Partial or historical repairs** — devices repointed manually, or replacements performed before the transactional path existed.

Today nothing in GCDR **detects** these devices, nothing **reports** them, and consumers that key on `centralId` silently get a dead handle. RFC-0065 gives consumers a second handle at the bundle (`centralHardwareId` next to `centralId`) but does not fix or even surface the underlying data. This RFC proposes how to do that.

## Motivation

Verified in the Moxuara production bundle (2026-09-19): 52 of 53 indexed devices reference `e982edf9…`, one references `6d7cd66a…`, and the ingestion's own view of "this central" does not match — the interpolation screen reports devices "in other centrals". The consumer cannot tell whether that is a legitimate multi-central customer or stale pointers, and neither can an operator looking at GCDR.

Concrete costs of leaving it undetected:

- Consumers match `(centralId, slaveId)` against a gateway that no longer exists, so governance/verification silently skips those devices.
- Field/ops staff have no list of "devices to repoint" after a gateway change; the work is discovered per incident.
- Publishing `centralHardwareId` (RFC-0065) is a mitigation, not a fix: the `centralId` a stale device points at is still wrong.

## Guide-level explanation

Three independent capabilities, shippable separately:

1. **Detect & report** — a read-only data-quality view: devices whose `central_id` points at a central that is `INACTIVE`/`DELETED`, replaced (`metadata.replacedBy` set), or missing; plus devices with a `central_id` but no `slave_id`.
2. **Repair** — an explicit, auditable operation to repoint a set of devices from an old central to its successor, never automatic.
3. **Resolve (optional, opt-in)** — let the bundle/read APIs *follow* `replacedBy` to the successor so consumers get the live central even before the data is repaired.

The unit of identity stays `(central, slave)`. **GCDR must not guess a slave renumbering** (Moxuara 325/191 → 1/2): repair moves the *central*, and a slave remap, when needed, is an explicit input.

## Reference-level explanation

### 1. Detection (read-only, low risk — do first)

A query (and endpoint, e.g. `GET /customers/:customerId/data-quality/stale-central-pointers`) returning, per device:

```jsonc
{
  "deviceId": "…", "deviceName": "…", "slaveId": 7,
  "centralId": "e982edf9-…",
  "reason": "CENTRAL_INACTIVE | CENTRAL_REPLACED | CENTRAL_MISSING | SLAVE_ID_MISSING",
  "centralStatus": "INACTIVE",
  "replacedBy": "6d7cd66a-…"        // from centrals.metadata.replacedBy, when known
}
```

Notes:
- `CENTRAL_REPLACED` is exact only for replacements done through RFC-0005 (they write `metadata.replacedBy`). An out-of-band migration leaves the old central `ACTIVE` with no successor link — it cannot be detected from GCDR data alone. This is the Moxuara case and the honest limit of detection; see §Unresolved questions.
- Read-only, tenant-scoped, paginated like other list endpoints; `centrals:read` scope.

### 2. Repair (explicit, audited)

`POST /centrals/:oldUuid/repoint-devices` (name TBD) with `{ toCentralId, deviceIds?, slaveIdMap?, reason }`:

- Single transaction; validates both centrals are in the same tenant/customer; refuses when `toCentralId` is not ACTIVE.
- Without `slaveIdMap` the slave ids are preserved; a supplied map is validated for collisions on `(central_id, slave_id, channel)` (the unicity rule from migration 0029).
- Writes a ledger event (same pattern as `GATEWAY_REPLACED`) with the old/new pair and the exact device set; invalidates the customer's alarm-bundle cache (RFC-0065 C).
- Dry-run mode returning the diff, mirroring the `dryRun` convention already used by the goals rebalance.

Deliberately **not** automatic: a wrong automatic repoint would silently corrupt device identity.

### 3. Resolution (opt-in, later)

An option on bundle/read paths to substitute `replacedBy` for a replaced central, for consumers that cannot wait for data repair. Risky (hides data problems, and `slaveId` may not be valid on the successor), so it is only proposed for the case where the successor link is explicit **and** slave ids are preserved (the RFC-0005 `/replace` guarantee).

## Design options considered for the successor link

| Option | Pros | Cons |
|---|---|---|
| Keep using `centrals.metadata.replacedBy` (today) | No migration; already written by `/replace` | JSONB, not indexed/FK; absent for out-of-band migrations |
| New nullable column `centrals.replaced_by_central_id` (FK) | Queryable, integrity-checked | Migration (governance: custom runner + `docs/DB-MIGRATIONS.md`); backfill from metadata |
| Per-device `previous_identity` history table | Bridges any migration incl. slave renumbering | New domain; larger scope; write-path cost |

Recommendation: ship §1 with `metadata.replacedBy` as-is; decide the column/history table only if detection proves the volume justifies it.

## Rollout plan

1. §1 detection endpoint + a one-off report for Moxuara and the other SA Cavalcante customers (read-only; produces the repair worklist).
2. §2 repair operation with dry-run, used first on Moxuara with an explicit slave map agreed with the ingestion team.
3. §3 only if a real consumer still needs it after repair.

## Testing strategy

- Detection: fixtures for INACTIVE central, replaced-with-successor, missing central row, null `slave_id`; assert each `reason`; assert tenant isolation.
- Repair: transaction atomicity (all-or-nothing), collision on `(central, slave, channel)` rejected with zero writes, non-ACTIVE target rejected, ledger event written, bundle cache invalidated, dry-run performs no writes, idempotent on a repeated `reason`/request id.
- Regression: RFC-0005 `/replace` behavior unchanged.

## Drawbacks

- Detection cannot see out-of-band migrations (no successor link) — the Moxuara case still needs human input.
- A repair endpoint is a powerful write path; needs the admin-tier gate and audit from day one (compare RFC-0064 A.5 on `/entities`).

## Rationale and alternatives

- **Automatic repointing on detection** — rejected: identity corruption risk, and slave renumbering is not inferable.
- **Do nothing beyond RFC-0065** — leaves stale pointers invisible; consumers keep degrading silently.
- **Push all identity resolution to consumers** — they lack the successor link and the ledger; GCDR is the only place that knows `replacedBy`.

## Prior art

- RFC-0005 — replacement transaction, ledger event, `metadata.replacedBy`.
- RFC-0065 — bundle emits `centralHardwareId` alongside `centralId`.
- Migration 0029 — `(central, slave, channel)` unicity.
- `docs/api/API-Gateway.md` — central identity fields.

## Unresolved questions

1. Can out-of-band migrations be recorded going forward (e.g., a lightweight "gateway migrated" ledger event written by the ingestion tooling) so detection is exact?
2. Where should the worklist live — GCDR endpoint, an ops script, or the frontend's central detail page?
3. Should repair be limited to `role:super-admin`/`entities:admin`-style admin tier, or a dedicated operator permission?
4. Is a per-device `previous_identity` worth its own RFC once repair exists?

## Future possibilities

- Frontend "stale pointers" panel on the customer/central pages.
- Scheduled data-quality job with an alert when the count is non-zero.
- Feeding the same signal to the orchestrator-devices worker so its central probes flag orphaned devices.
