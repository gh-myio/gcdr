# RFC-0040: Device `label` Only — Retiring `displayName` from the Device Entity

- Feature Name: `device_label_only`
- Start Date: 2026-06-11
- RFC PR: (leave this empty)
- GCDR Issue: (leave this empty)
- Status: **DRAFT — impact study complete, not approved**

## Summary

Remove the `displayName` field from the **Device** entity, keeping `name`
(immutable technical identity) and `label` (human-facing, editable) as the
only naming fields. Today a device carries three name-ish fields — `name`,
`displayName` and `label` — and the UI already treats `label` as the primary
human-facing string (`label || name`), making `displayName` redundant noise
on this entity. The change is **breaking** for the public API, the device
sync-job CSV flow, the alarm-bundle consumers in `myio-js-library`, the
**alarms-backend enrichment pipeline** (`deviceName = displayName ?? name`,
snapshotted into its `sourceName` column), and the frontend, so it ships in
phases with a dual-read transition window.

## Motivation

A GCDR device currently has:

| Field | Column | Constraint | Origin |
|---|---|---|---|
| `name` | `name` | NOT NULL | migration 0000 — technical identity (matches TB `name`) |
| `displayName` | `display_name` varchar(255) | NOT NULL | migration 0000 — generic cross-entity convention |
| `label` | `label` varchar(100) | NULL | migration 0009 — ThingsBoard `label` parity |

Problems this redundancy causes today:

1. **Ambiguity at every call site.** The codebase shows three competing
   fallback chains: `displayName ?? name` (documented for the
   alarms-backend in `ONBOARDING.md:247`), `label || name` (WO wizard,
   WO detail `deviceMain()`), and the triple
   `label || displayName || name` (`RuleDevicesTab.tsx:537`). Two devices
   rendered by different screens can show different names.
2. **Sync writes them inconsistently.** The device sync job (RFC-0023)
   patches `displayName = row.deviceName` **and** `label = row.label` from
   the same CSV row (`DeviceSyncJobService.ts:335-336`), so the two fields
   drift with no owner.
3. **`label` is the field with external meaning.** ThingsBoard has a native
   `label`; RFC-0022 conformity and the Upsell widget reconcile TB↔GCDR
   through it. `displayName` exists only because the initial schema copied
   the convention used by customers/assets/users.
4. **UI already chose.** The OS module, device pickers and the WO scope
   card standardized on `label` as the main line with `name` subtle —
   `displayName` is mostly dead weight that forms still ask the user to
   fill in.

The goal: **one editable human-facing name per device (`label`), one
technical identity (`name`), zero ambiguity.**

## Guide-level explanation

After this RFC, a device has exactly two name fields:

- **`name`** — technical identity, used for machine matching (TB sync,
  reconciliation). Unchanged.
- **`label`** — the human-facing name shown everywhere in UIs. Becomes
  **NOT NULL** (backfilled from `display_name`, then `name`). Max length
  raised from 100 to **255** so no `display_name` value is truncated.

What users see:

- Device forms show a single "Label / Rótulo" field instead of
  "Display Name" + "Label".
- Lists, dropdowns and the WO module keep rendering `label` as the main
  line and `name` as the subtle secondary — visually nothing changes where
  the new pattern is already in place.

What integrators see:

- Device API payloads stop carrying `displayName` (after a deprecation
  window in which both are returned, `displayName` mirroring `label`).
- The sync CSV (`tbId|deviceName|label|…`) keeps its shape; `deviceName`
  continues to map to `name`, `label` to `label`, and the `displayName`
  patch column disappears.
- The enriched bundles (`/customers/external/:id?deep=1`, used by
  `myio-js-library`) expose `label` and, during the transition, a
  `displayName` alias with the same value.

## Reference-level explanation

### Impact inventory (survey of 2026-06-11, three repos)

#### Backend — `gcdr.git`

| Area | Where | What changes |
|---|---|---|
| DB schema | `schema.ts:316-318` — `display_name` NOT NULL, `label` varchar(100) NULL | drop `display_name`; `label` → varchar(255) NOT NULL |
| Entity | `src/domain/entities/Device.ts:105-107` | remove `displayName: string`; `label` becomes required |
| DTOs | `src/dto/request/DeviceDTO.ts:82,118`; `src/dto/response/DeviceResponseDTO.ts:9-10,52-53` | drop `displayName` from create/update; response keeps deprecated alias during transition |
| Repository | `DeviceRepository.ts:22-23` (ILIKE search), `:86` (`displayName: data.displayName \|\| data.name` default), `:202-204` (update), `:469-471` (mapper) | search on `label` only; default `label = data.label \|\| data.name` on create |
| Sync job | `DeviceSyncJobService.ts:30,57,335-336,389-390,459,505-514` — CSV `tbId\|deviceName\|label\|…`; patches both fields | patch/create `label` only; drop the displayName diff and the `name`-dedup special case (`:513-514`) |
| Controllers | `devices.controller.ts:61,93` (label filter — keeps working) | no change beyond response shape |
| Simulator | `simulator-admin.controller.ts:401` (`displayName: device.displayName`) | switch to `label` |
| Seeds | `scripts/db/seeds/08-devices.sql` and `v1.0.0/08-devices.sql` (18 INSERT blocks each, many empty labels) | populate `label` on every row; drop `display_name` column from INSERTs |
| OpenAPI | `docs/openapi.yaml:1399-1402,1487,3275-3297,10769` (device `displayName`, "displayName defaults to name", sync CSV sample) | regenerate device schema; document deprecation alias |
| Docs | `ONBOARDING.md:237,247` (alarms-backend uses `displayName ?? name`); `ARCHITECTURE-Device-Sync-Jobs.md:80,124-125,171`; `RFC-0022:41-149`; `RFC-0023:68,152,234,290` | rewrite fallback as `label ?? name`; update sync matrices |
| Tests | device repository/sync tests asserting `displayName` | update assertions |

**Not affected:** `display_name` on customers, assets, users, centrals,
groups, roles and policies — the cross-entity convention stays; this RFC is
**device-only** (see Drawbacks). `BundleGeneratorService.ts:194` uses
*customer* `displayName` — untouched.

#### Frontend — `gcdr-frontend.git`

| Area | Where | What changes |
|---|---|---|
| Types | `src/types/device.ts:15-16,39,54-55` | remove `displayName`; `label: string` required |
| Device form | `DeviceForm.tsx:22-30,54-55,77-78,100-101,163,167,204,208` — two fields today | single "Label" field; title/breadcrumb `label \|\| name` |
| Device grid | `DevicesGrid.tsx:216,260-262,396,399,522-539,618-647,786` — sort/filter/export/column on `displayName` **and** `label` | one `label` column; sort/filter/export on `label` |
| Device detail | `DeviceDetail.tsx:231-236,278-282,654` — header `displayName`, subtle `name` | header `label \|\| name` |
| Deep search | `DeviceDeepSearch.tsx:20-24,76-77,246-259` + `deviceService.ts:25-26,66-67` — separate `displayName`/`label` params | single `label` param (backend keeps `label` filter) |
| WO module | `WorkOrderDetail.tsx:1078-1095,1162` (ScopeDevice + `deviceMain`), `WorkOrderCreateWizard.tsx:821-822,1054` | already label-first; just drop `displayName` from types/filter arrays |
| Rules | `DeviceSelectionModal.tsx:86-88,283,307`; `RuleDevicesTab.tsx:57-59,537` (`label \|\| displayName \|\| name`); `RuleList.tsx:127`; `RuleDetail.tsx`; `AssetDetail.tsx` | collapse chains to `label \|\| name` |
| Wiki autocomplete | `EntityAutocomplete.tsx:90-91` (`d.displayName ?? d.name ?? d.label ?? d.id`) | reorder to `d.label ?? d.name ?? d.id` |
| i18n | `devices.json` pt-BR/en `deepSearch.fields.displayName` ("Nome de Exibição"/"Display Name") | remove key; keep `label` ("Rótulo"/"Label") |

⚠️ **Find-replace hazard:** users, customers, assets, groups and centrals
also have `displayName` in the frontend (e.g. `u.displayName || u.email`
all over the WO module). The change must be surgical per device type, never
a bulk rename.

#### Library — `myio-js-library-PROD.git`

The library **reads** device `displayName` from GCDR responses; it never
writes it (TB→GCDR sync maps `device.label || device.name` to GCDR `name`,
`entityMappers.ts:72-106`).

| Area | Where | What changes |
|---|---|---|
| Public types | `gcdr-sync/types.ts:184-207` — `GCDRBundleDevice.displayName` and `GCDRBundleAsset.displayName` mandatory; re-exported in `src/index.ts:1710-1732` | add `label`, deprecate `displayName?` alias → **major version bump** |
| Alarm-bundle-map modal | `openAlarmBundleMapModal.ts:945,1035,1096` — `entityLabel \|\| displayName \|\| name` | `entityLabel \|\| label \|\| name` |
| GCDR API client | `GCDRApiClient.ts:140-155` — `GET /customers/external/:id?deep=1` bundle | type update only |
| Upsell widget | `thingsboard/WIDGET/GCDR-Upsell-Setup/v.1.0.0/controller.js:268,1701-1733,2361,2420,2590,2924-2950` — **matches TB devices to GCDR devices by normalized `displayName`** | match by `label` (and keep `name`); priority matrix doc update |
| Docs | lib RFC-0176/0186/0187 reference displayName in GCDR payloads | update |

Asset `displayName` in the bundle (`GCDRBundleAsset`) is **out of scope** —
assets keep `displayName` in GCDR; only the device type narrows.

**Widget sweep (controller.js / template.html / settingsSchema.json):** a
full grep across every TB widget in the library found `displayName` in
exactly **one** widget file — the Upsell controller above. The 15 other
GCDR-aware widget files (MYIO-SIM `v5.2.0_UNIQUE`, main-dashboard `v-5.2.0`
TELEMETRY/MAIN_VIEW/MENU/ALARM/HEADER, `v-5.4.0`, MAIN_BAS,
Pre-Setup-Constructor) consume the **alarm bundle**, whose `deviceName` is
built server-side from `device.name` (`AlarmBundleService.ts:470,665`) —
not from `displayName` — so they are unaffected. No `template.html` or
`settingsSchema.json` references device `displayName` anywhere.

#### Alarms backend — `alarms-backend.git`

The heaviest external consumer (survey of 2026-06-11). Its alarm enrichment
pipeline derives `deviceName = device.displayName ?? device.name` from GCDR
device lookups and **persists the result as a snapshot** in the alarms
table (`sourceName` varchar(100)) — historical rows are never re-fetched.

| Area | Where | What changes |
|---|---|---|
| GCDR client types | `src/infrastructure/http/gcdr.client.ts:104-116` — `GCDRApiDevice` requires `displayName`; **no `label` field exists** | add `label`, make `displayName` optional during transition |
| GCDR client calls | `gcdr.client.ts:531-545` (`getDevice`), `:550-566` (`getDeviceByCentralAndSlaveId`, preferred lookup), `:875-893` (`listDevicesByCentral`) | response shape change only |
| Verify service | `verify.service.ts:696,726,733` — `EnrichedDevice.deviceName = device.displayName ?? device.name ?? bundleEntry.deviceName`; emitted in `AlarmCandidateRaised` (`:520`) | chain becomes `label ?? displayName ?? name ?? bundleEntry.deviceName` (drop `displayName` at Phase 3) |
| Orchestrator worker | `orchestrator.worker.ts:576-592` (candidate → alarm, `deviceName = displayName ?? name`), `:259` (dispatch templates render `alarm.sourceName ?? alarm.deviceId`) | same chain update |
| Persistence | `schema.ts:50` (`sourceName` varchar(100) snapshot), `alarm.repository.pg.ts:85` | no schema change; **note: GCDR `label` widens to 255 — values >100 chars will truncate into `sourceName`** |
| Customer API | `alarms.routes.ts:77` — `deviceName: alarm.sourceName ?? null` | unchanged (reads the snapshot) |
| Swagger | `swagger.plugin.ts:298` — documents deviceName as "GCDR device.displayName" | reword to `label` |
| Backfill / admin | `backfill-alarm-enrichment.ts:9,117,146`; `admin.routes.ts:416,573`; `db-admin.routes.ts:368,556,2000` — all re-enrich via `displayName ?? name` | update chains; run the backfill **before** GCDR Phase 4 so historical `sourceName` is re-snapshotted from `label` |

Out of scope but adjacent: `daily-summary.worker.ts:95` uses *customer*
`displayName ?? name` — customers keep `displayName`, no change.

#### Alarms frontend — `alarms-frontend.git`

**No direct impact.** The frontend never fetches device `displayName` from
GCDR: alarms arrive with a flattened `deviceName` string produced by
alarms-backend (`src/types/alarm.ts:28`), and the enrichment hook
explicitly avoids per-device GCDR calls
(`use-gcdr-enrichment.ts:21-22` — it only enriches *customer* and *rule*
names; the customer chain `data.displayName || data.name` at `:58` is out
of scope). `GcdrDevice.displayName` in `src/lib/api/gcdr.ts:11-15` is
declared but the device call is never made.

Transitive risk only: if alarms-backend ever returns a null `deviceName`,
the UI degrades to truncated device ids (`a.deviceName || deviceId.slice(0, 8)`
in `alarms/page.tsx:445`, `alarm-device-group-card.tsx:109`). No code
change required as long as alarms-backend keeps `deviceName` populated.

### Migration plan

Four phases; each is independently shippable and reversible until Phase 4.

**Phase 1 — Backend, additive (migration 0037):**

```sql
-- 0037_devices_label_required.sql (no BEGIN/COMMIT — custom runner)
ALTER TABLE devices ALTER COLUMN label TYPE varchar(255);
UPDATE devices SET label = COALESCE(NULLIF(btrim(label), ''), display_name, name)
WHERE label IS NULL OR btrim(label) = '';
ALTER TABLE devices ALTER COLUMN label SET NOT NULL;
```

Backend starts dual-writing: create/update keep accepting `displayName`
but map it into `label` when `label` is absent; responses return both,
`displayName` mirroring `label`. Sync job patches `label` only. Seeds
updated. `ONBOARDING.md` fallback doc flips to `label ?? name`.

**Phase 2 — Consumers:** frontend drops the Display Name field and all
`displayName` reads for devices; `myio-js-library` ships a major version
with `label` in `GCDRBundleDevice` and the Upsell matcher updated. The
**alarms-backend** adds `label` to `GCDRApiDevice` and switches every
enrichment chain to `label ?? displayName ?? name` (verify service,
orchestrator worker, admin re-enrichment, backfill script), then runs its
`backfill-alarm-enrichment` against GCDR so historical `sourceName`
snapshots are re-derived from `label` **before** Phase 4 removes the
source field. alarms-frontend needs no change (it consumes the flattened
`deviceName`).

**Phase 3 — API deprecation end:** after ≥2 release cycles with both
fields served, the deprecated `displayName` alias is removed from device
responses and rejected (400) in request DTOs.

**Phase 4 — Schema cleanup (migration 0038+):**

```sql
ALTER TABLE devices DROP COLUMN display_name;
```

Rollback before Phase 4 is trivial (alias still served). After Phase 4,
rollback = re-add `display_name` nullable backfilled from `label`.

### Invariants after completion

- `devices.label` — varchar(255) NOT NULL; the only editable human name.
- `devices.name` — unchanged; technical identity.
- Canonical render chain everywhere: **`label || name`** (with `name`
  shown as the subtle secondary when it differs).
- Smart search covers `name, label, code, serialNumber, externalId,
  identifier, metadata`.

## Drawbacks

- **Breaks the cross-entity `displayName` convention.** Customers, assets,
  users, centrals, groups, roles and policies keep `displayName`; devices
  become the exception. New code touching multiple entity types must
  remember the asymmetry.
- **Wide blast radius for a cosmetic win:** ~20 backend files, ~15 frontend
  files, a library major bump, OpenAPI, four RFC docs and two seed sets.
- **External consumers we don't control** (ThingsBoard widget deployments
  pinned to old lib versions, Node-RED flows) need a coordinated window;
  the Upsell widget's TB↔GCDR matcher silently loses a matching dimension
  if deployed against a label-only API before updating.
- **Historical alarm names depend on a backfill.** alarms-backend snapshots
  `displayName ?? name` into `sourceName` at alarm creation; if its
  backfill doesn't run inside the transition window, old alarms keep
  pre-rename names and new ones use `label` — a silent inconsistency in
  dashboards and Telegram/work-order dispatch templates.
- varchar(100)→255 widening is safe, but any consumer that persisted
  `label` with a 100-char limit may truncate.

## Rationale and alternatives

- **Keep both, document precedence (do nothing):** zero migration cost, but
  the three competing fallback chains and sync drift remain — the bug
  factory this RFC exists to close.
- **Drop `label`, keep `displayName`:** rejected. `label` is the field with
  ThingsBoard parity (TB has native `label`; RFC-0022 and the Upsell widget
  reconcile through it) and the field the newest UI (OS module) already
  standardized on. It is also the user's stated direction.
- **Rename `display_name` → `label` in place (single migration):** fewer
  steps, but no deprecation window — every consumer breaks on deploy day.
  The phased alias approach costs one extra migration and buys safe,
  independent rollout per repo.
- **Make `label` a generated alias of `displayName` at the API layer only:**
  leaves two columns drifting in the DB; solves nothing for sync.

## Prior art

- **Migration 0026 (`qrc` → `wo`)** — precedent for a coordinated breaking
  rename across backend + frontend in this codebase.
- **Migration 0035** — precedent for backfill + NOT NULL tightening on an
  existing column (`work_orders.code`).
- **ThingsBoard** — devices expose `name` + `label` (no displayName);
  this RFC converges GCDR devices to the same shape, which is exactly what
  the TB-facing tooling (RFC-0022, Upsell widget) already assumes.
- **Rust RFC 0430 / 0356** — style precedent for consolidating redundant
  naming conventions via deprecation windows.

## Unresolved questions

1. ~~Does the **alarms-backend** read `displayName` directly?~~ **Resolved
   (survey 2026-06-11):** yes — directly via `GET /devices/:id`,
   `getDeviceByCentralAndSlaveId` and `listDevicesByCentral`, with the
   chain `displayName ?? name` snapshotted into `sourceName`. Remaining
   sub-question: scheduling its backfill run inside the Phase 2→4 window.
2. Are there **Node-RED flows** or dashboards consuming
   `GET /devices` / `tree?deep=1` that reference `displayName` outside the
   surveyed repos? (Audit `lastUsedAt` on customer API keys + ask MYIO ops.)
3. Should the deprecation alias in Phase 1–3 be advertised via a
   `Deprecation`/`Sunset` response header, or is doc + release notes enough?
4. Exact length policy: keep `label` at 255, or align with TB's label
   limit? Note the downstream constraint: alarms-backend snapshots into
   `sourceName` varchar(100) — labels longer than 100 chars truncate there.
5. Does any **report/export** (CSV exports in `DevicesGrid.tsx:396-399`)
   feed downstream spreadsheets that expect a `displayName` column header?

## Future possibilities

- Apply the same consolidation to **assets** (`displayName` vs `name`),
  whose UI also renders `displayName || name` everywhere — devices first,
  assets as RFC-0041 if the pattern proves out.
- A lint rule / typecheck helper banning new `displayName` references on
  device-typed objects during the transition.
- Once `label` is NOT NULL, expose it in the WO device-scope payloads and
  alarm bundles as the single guaranteed display string, simplifying
  `myio-js-library` fallback chains to `entityLabel || label`.
