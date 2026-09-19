# RFC-0065 — Alarm Bundle `deviceIndex`: NO_CONSUMPTION Scope Coverage & Hybrid Central Identity

- **Status:** Implemented on branch `feat/ED-1257-bundle-nc-scope-hybrid-central-identity` (A, B and C; unit-tested) — pending review/merge. Tracked in **ED-1257**. The stale-pointer question is split out into **RFC-0066** (future work).
- **Date:** 2026-09-19
- **Domain:** Alarms / Bundles / Centrals (cross-cutting)
- **Authors:** MYIO Engineering (draft: Claude Code, on behalf of rodrigo@myio.com.br)
- **Jira:** ED-1257 (Sprint 20). Follow-up of ED-1255 (per-device `centralId`, PR #76).
- **Depends on:** RFC-0005 (Gateway hardware replacement), RFC-0055 (NO_CONSUMPTION rule type), RFC-0062 (`hardwareId`, orchestrator-devices), RFC-0018 (per-device rule variants)
- **Origin:** request from the ingestion interpolation agent, 2026-09-19 (`PEDIDO-GCDR-deviceIndex-escopo-no-consumption`, in `data-ingestion-prod.git`), validated here against the real production bundle (`gcdr-bundle-to-verify-service-prod-2026-09-19.json`).
- **Migration:** none (no schema change). Additive response fields only.

---

## Summary

The `deviceIndex` of the simplified bundle (`/bundle/simple`, and `/bundle/to-verify-service` which is built on it) is the map a consumer uses to learn *which central and slave a device lives on*. Two independent problems make it unfit for the ingestion agent's governance of NO_CONSUMPTION rules:

1. **Coverage.** A device that is only in the scope of a NO_CONSUMPTION rule (and has no alarm rule) is **omitted** from the index. In the Moxuara production bundle that is **281 of the 322** devices in the rule's scope.
2. **Identity brittleness.** The index exposes a single central handle, `centralId`. That handle is **not stable across a gateway change**: RFC-0005 makes `centrals.id` the hardware UUID, so a physical replacement produces a *new* central row, and gateway migrations done outside `/replace` (Moxuara: `e982edf9…` → `6d7cd66a…`) leave devices pointing at the old central. A consumer keyed only on `centralId` breaks whenever the gateway changes.

This RFC (A) emits NO_CONSUMPTION-scoped devices in the index behind an **opt-in** flag, (B) adds an **optional** `centralHardwareId` next to `centralId` so consumers can be *hybrid* (match on the central UUID **or** the hardware id, whichever they hold and whichever survived the change), and (C) closes a cache-staleness hole: central replacement does not invalidate the bundle cache.

---

## Motivation

### Verified facts (production bundle, Moxuara, 2026-09-19)

| Measurement | Value |
|---|---|
| Entries in `deviceIndex` | 53 (all with `centralId` and `slaveId` — ED-1255 works in production) |
| Distinct centrals in the index | `e982edf9…` ×52, `6d7cd66a…` ×1 |
| NO_CONSUMPTION rule `55c05500-0055-4055-8055-000000000001`, scope `DEVICE` | 322 device ids |
| …of which already in the index (have an alarm rule) | 41 |
| …of which **absent** from the index | **281** |
| Expected index size after this RFC | 53 + 281 = **334** (12 indexed devices are outside the NC scope) |

### Cause (code, `origin/desenv`)

`AlarmBundleService.buildSimplifiedBundle`:

```ts
// Only include devices that have at least one applicable rule
if (applicableRuleIds.length === 0) continue;          // L461
```

`applicableRuleIds` counts **alarm** rules only. NO_CONSUMPTION rules are collected separately (`noConsumptionRules`, RFC-0055) and emitted in their own section; they never contribute to that count, so a device that is only in a NC scope never reaches the index.

### Why identity must be hybrid

- **RFC-0005**: `centrals.id` *is* the hardware UUID (`CentralReplacementRepository` header). `POST /centrals/:oldUuid/replace` creates a **new row** with a new `id` and repoints every device to the new row in one transaction. So after a replacement `centralId` changes. **`serialNumber` is not an identity handle**: it is an address-like value of the radio (e.g. `219.19.169.246`), so it is intentionally *not* published in the index. The two gateway handles are the central UUID (`id`) and the `hardwareId` (below).
- **RFC-0062**: `centrals.hardware_id` is the *physical* hardware UUID (builds `{hardwareId}.y.myio.com.br`), nullable; `null` ⇒ consumers fall back to `id`.
- **Gateway migrations outside `/replace`** (Moxuara): the ingestion moved to a new gateway and renumbered slaves (325/191 → 1/2). GCDR devices still point to the old central. No handle GCDR stores can be translated automatically here — but exposing all the handles it *does* know lets a consumer bridge the gap deterministically instead of guessing.

The consumer's true identity is *(gateway, slave)*. GCDR cannot know which gateway handle a given consumer uses, so it should publish every stable handle it holds and let the consumer match by preference.

---

## Guide-level explanation

### What a consumer sees

`GET …/alarm-rules/bundle/to-verify-service` (and any caller that opts in) returns, for a customer with a device B that is *only* in a NO_CONSUMPTION scope:

```jsonc
"deviceIndex": {
  "<device-A-uuid>": { "deviceName": "…", "slaveId": 7,  "centralId": "e982edf9-…", "centralHardwareId": "…", "offset": {}, "ruleIds": ["rule-1"] },
  "<device-B-uuid>": { "deviceName": "…", "slaveId": 12, "centralId": "e982edf9-…", "centralHardwareId": "…", "offset": {}, "ruleIds": [] }   // NC scope only
}
```

`ruleIds: []` means "known device, no alarm rule" — **not** "monitored".

### Recommended consumer matching (hybrid)

1. `(centralId, slaveId)` — exact.
2. else `(centralHardwareId, slaveId)` — the physical hardware id; survives a change of the central row when the consumer keys on hardware.

(`serialNumber` is not part of the matching: it is not a gateway identity.)

GCDR **does not** translate `slaveId` between gateways; if a gateway migration renumbered slaves, that mapping stays the consumer's responsibility.

---

## Reference-level explanation

### A. Emit NO_CONSUMPTION-scoped devices (opt-in)

- New optional field `includeNoConsumptionScope?: boolean` on `GenerateBundleParams` (default `false`).
- `getCacheKey` (L66-77) **must** include it (`String(params.includeNoConsumptionScope || false)`); otherwise the two variants would share one cache slot.
- `verifyBundle` (L260) calls `generateSimplifiedBundle({ ...params, includeNoConsumptionScope: true })`. `/bundle/simple` is unchanged and stays byte-identical.
- In `buildSimplifiedBundle`, build `ncScopedIds` from the NC rules that are already passed in (they already respect `includeDisabled`) whose `scope.type === 'DEVICE'`, using the same id extraction as `toNoConsumptionBundleRules` (`scope.entityIds ?? [scope.entityId]`, L542-544). Then:

```ts
if (applicableRuleIds.length === 0 && !(includeNcScope && ncScopedIds.has(device.id))) continue;
```

  An NC-only device gets a normal mapping (`deviceName`, `slaveId`, `centralId`, `offset`) with `ruleIds: []`; the RFC-0018 variant-resolution loop is a no-op for it.
- Scopes `GLOBAL`, `CUSTOMER`, `ASSET` are **not** expanded (the consumer needs per-device identity only for `DEVICE` scope).
- With `X-Central-Id`, devices are already filtered by central before this loop, so the flag never widens the central filter.

**Signature and version.** The request assumed changing `deviceIndex` would invalidate `meta.signature`. Verified otherwise: `computeBundleSignature` signs only `version`, `generatedAt`, `customerId`, `tenantId`, `rulesCount`, `devicesCount` — **not** `deviceIndex` content — and `devicesCount` is `devices.length` (the input list, unaffected). What *does* change is `versionId`: it is a content hash of `{ deviceIndex, rules, noConsumptionRules }` (`calculateVersionHash`), so adding entries moves the version automatically and 304-caching consumers re-fetch once. The change still belongs **inside** `buildSimplifiedBundle` because that is where the hash is computed and because `verifyBundle` reuses the cached object (mutating it afterwards would poison the cache).

### B. Hybrid central identity (additive)

Add optional fields to `SimpleDeviceMapping` (`src/domain/entities/AlarmBundle.ts`):

```ts
centralHardwareId?: string;   // centrals.hardware_id — physical UUID; omitted when null
```

- Sourced with **one `listByCustomer` query per target customer** (no N+1 per device), indexed by id in memory. `AlarmBundleService` had no central dependency, so an `ICentralRepository` is injected as a 4th optional constructor param, defaulting to the real one — same pattern as the existing three.
- **Failure mode:** the lookup never throws. If it fails, the hybrid fields are simply omitted (a warning is logged) and the bundle is still built — alarm bundle generation must not depend on a best-effort identity enrichment. Consequence to be aware of: a transient failure changes the content hash for that build (fields absent), so `versionId` can flap once until the 300 s cache turns over.
- **Rule:** `centralHardwareId` is emitted whenever the central has one — including a non-ACTIVE (replaced) central, since it is still the physical id. Devices whose central is unknown to the lookup, or whose `hardwareId` is null, get no field. `serialNumber` is **never** published (not an identity — see above).
- **Applies to both `/bundle/simple` and `/bundle/to-verify-service`** (unlike A, B is not behind the opt-in flag): the fields are additive and optional, like `centralId` was in ED-1255. `versionId` moves once on deploy for every customer.
- Fields are omitted when unknown (never fabricated). Absent fields ⇒ old behavior; existing consumers are unaffected.
- These fields affect the content hash, so `versionId` moves once on deploy, as in A.

### C. Cache invalidation on central replacement

`CentralService` invalidates the bundle cache on create/update/status changes (`invalidateCache`), but `CentralReplacementService`/`CentralReplacementRepository` (RFC-0005) **do not**. After `POST /centrals/:oldUuid/replace` the devices are repointed in the transaction, yet the bundle cache (TTL 300 s) keeps serving the old `centralId` until it expires. Fix: invalidate the customer's bundle cache after a successful (non-replayed) replacement, with an `InvalidationMeta` reason, mirroring `CentralService`.

### Non-goals

- No `slaveId` translation across gateways; no automatic repointing of devices after out-of-band gateway migrations.
- No change to alarm semantics; NO_CONSUMPTION governance stays in the orchestrator/ingestion.
- Data fixes (devices with null `slave_id`, devices still on the old central) are cadastro work, not code.

---

## Rollout plan

1. **A + C** first (coverage + cache staleness): small, high value, opt-in flag keeps `/bundle/simple` identical.
2. **B** next (additive fields + central lookup). Can ship in the same PR; kept separable in commits.
3. Verify in production with the Moxuara `to-verify-service`: index contains all 322 scope devices (334 total), signature valid, `versionId` stable across two consecutive calls.
4. Ingestion adopts the hybrid matching order on its side.
5. Rollback: the flag and fields are additive; reverting restores the previous shape.

## Testing strategy

- Unit (extend `tests/unit/controllers/rules.verify.test.ts` / service tests): customer with **A** (alarm rule), **B** (NC scope only), **C** (nothing) → index has A and B (`B.ruleIds === []`, `centralId`/`slaveId` set), not C.
- Flag off ⇒ result identical to today (golden); flag on/off use distinct cache keys.
- `includeDisabled=false` + disabled NC rule ⇒ its scope devices are not added.
- Non-`DEVICE` scopes do not expand the index.
- Hybrid fields: present when the central has `hardwareId`; omitted when null; one central query for N devices.
- Central replacement: after `replace`, next bundle read reflects the new `centralId` (cache invalidated); an idempotent replay does not double-invalidate.
- Signature: stays valid; `versionId` changes when the index grows and is stable across identical calls.

## Drawbacks

- Larger `to-verify-service` payload (≈ +281 entries for Moxuara, tens of KB uncompressed).
- `ruleIds: []` entries are a new shape for one endpoint; a consumer that reads "in index" as "monitored" would misbehave — hence opt-in, and the in-repo consumer (`SimulatorEngine`) was checked: it iterates `ruleIds` (no-op when empty) and only uses `deviceName`.
- One extra central query per uncached bundle build.

## Rationale and alternatives

- **Always include NC-scoped devices in `/bundle/simple`** — simpler, but changes an endpoint consumed by Node-RED and the alarm side outside this repo; rejected without confirmation from those owners.
- **Post-process `deviceIndex` in `verifyBundle`** — rejected: mutates a shared cached object and bypasses the content hash.
- **Publish only `hardwareId` (replace `centralId`)** — rejected: `hardwareId` is nullable (RFC-0062) and not every consumer keys on it; keeping both `centralId` and `centralHardwareId` lets each consumer use the handle it holds.
- **Also publish `serialNumber`** — rejected: it is an address-like radio value, not a gateway identity (an earlier draft of this RFC proposed it; removed).
- **Have GCDR resolve "the" current central** — rejected: GCDR cannot know which handle or slave numbering a consumer uses.

## Prior art

- ED-1255 / PR #76 — per-device `centralId` in `deviceIndex`.
- RFC-0005 — gateway hardware replacement (`centrals.id` = hardware UUID; a replacement creates a new row and repoints devices).
- RFC-0055 — NO_CONSUMPTION rule and the `noConsumptionRules` bundle section.
- RFC-0062 — `hardwareId` and the probe host.
- `docs/api/API-Gateway.md` — central identity fields.

## Unresolved questions

1. ~~**Devices still pointing at a replaced (archived/INACTIVE) central.**~~ **Decided:** the stale pointer is a data-repair item, not something the bundle papers over; `serialNumber` is not part of the identity. Detection, repair and optional successor-following are specified as future work in **RFC-0066**.
2. **Owners of `/bundle/simple` consumers (Node-RED, alarms-backend):** confirm none treats "present in index" as "monitored"; if none, the flag could later default to on.
3. **Should replacement also emit a bundle-cache reason distinct from `CentralService`'s?** (Cosmetic; affects the version-history audit trail.)
4. **Slave renumbering across gateways** (Moxuara 325/191 → 1/2): out of scope here; is a per-device "previous identity" hint worth a future RFC?

## Future possibilities

- Per-device `previousIdentity` (centralId/slaveId history) to bridge gateway migrations without consumer-side tables.
- A data-quality endpoint listing devices whose `central_id` points at an INACTIVE/replaced central or that lack `slave_id`.
- Defaulting `includeNoConsumptionScope` to on once consumers are confirmed safe.
