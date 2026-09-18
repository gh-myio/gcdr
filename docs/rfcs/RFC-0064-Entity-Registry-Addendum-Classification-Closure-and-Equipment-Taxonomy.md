# RFC-0064 — Generic Entity Registry Addendum: Classification-Consumer Closure & Equipment Taxonomy Extension

- **Status:** Draft — audit complete, ready for implementation planning. **This document is docs-only**: it specifies and audits, it does not implement.
- **Date:** 2026-09-18
- **Domain:** Platform / Master Data (cross-cutting) — addendum to RFC-0047
- **Authors:** MYIO Engineering (audit + draft: Claude Code agent, on behalf of rodrigo@myio.com.br)
- **Depends on:** RFC-0047 — Generic Entity Registry (this repo: `docs/rfcs/RFC-0047-Generic-Entity-Registry.md`, `RFC-0047-Entity-API.md`, `RFC-0047-Entity-schema.md`)
- **Cross-repo references** (live in `myio-js-library-PROD.git`, a different repository — cited by title only, not as relative links, since they will not resolve from here):
  - **RFC-0207 — Customer-Scoped Device Classification Profile**, specifically its addendum **"RFC-0207 v3.2: contrato GCDR via RFC-0047 (RESOLVIDO, 2026-06-23)"** — the source of Part A's six-item checklist (§v3.2-G).
  - **RFC-0234 — Energy Transformadores Group**, specifically its **"Future possibilities"** section — the source of Part B's `TRANSFORMADOR` labeling-profile bullet. RFC-0234 explicitly states its *main* design requires **no** GCDR change; only this one optional bullet is GCDR-relevant.
- **Migration:** **none required by this RFC.** Part A closes gaps in service/middleware/test code and RBAC seed data (implementation follow-up, separate PRs). Part B is a documentation + example data-seed addition using the *existing* `PROFILE` entity type — no new `entity_type`, no schema change.

---

## Summary

This addendum closes two loose ends left after RFC-0047 shipped, both surfaced by consumers in `myio-js-library-PROD.git` rather than by GCDR itself:

- **Part A** audits and closes the remaining implementation gaps in the **RFC-0207 device-classification consumer contract** — the six-item "trabalho restante" checklist from RFC-0207's §v3.2-G, which names GCDR/RFC-0047 as the owner of each item. This document re-verifies each item against the actual code (not against what any prior document assumed) and specifies precisely what remains.
- **Part B** defines how an operator registers **`TRANSFORMADOR`** as a **`PROFILE`-type `entity_key`** in the existing registry, per RFC-0234's optional "Future possibilities" bullet — a purely cosmetic labeling addition, decoupled from RFC-0234's exclusion mechanism (which lives entirely in the consumer, not in GCDR).

Both parts extend RFC-0047's existing model (`entity_types` + `entities`) with **no new type** and **no schema migration** for Part B, and with **service/middleware code changes** (not schema changes) for Part A.

---

## Motivation

RFC-0047 shipped as a generic registry with the explicit promise that a new taxonomy concept is "a data insert, not a redesign." Two consumers have since tested that promise:

1. **RFC-0207's classification tree** (`myio-js-library-PROD.git`) adopted RFC-0047 as its backing store in a BMAD roundtable (2026-06-23) and left behind a six-item checklist of exactly what GCDR still owed it, with each item attributed to a specific write-path guarantee (atomicity, cast safety, concurrency, catalog validation, authorization, and one closing test). Three months on, nobody had re-verified which of the six were actually done versus assumed done. This RFC performs that verification against the real code and specifies what remains.
2. **RFC-0234's "Transformadores" group** feature identified, in its own Future Possibilities section, an optional cosmetic labeling need (`TRANSFORMADOR` as a `deviceProfile`) that would touch RFC-0047's registry if picked up — but RFC-0234 explicitly declined to specify how, deferring the "how" to whoever implements it. This RFC answers that "how" using RFC-0047's own vocabulary, so nobody re-derives it later or reaches for a bespoke table.

Precision matters more than narrative completeness here: this document is written for whoever implements the remaining Part A work, and a claim that something is "done" when it isn't (or vice versa) costs them real debugging time.

---

## Guide-level explanation

### Part A, in one paragraph

RFC-0207's classification editor saves a customer's whole domain tree in one call — `PUT /entities/bulk-replace`. Six things have to be true for that endpoint to be safe to build a UI on top of: the whole payload is validated as a unit before any row changes (atomicity), `metadata` never gets double-serialized (the historical "Moxuara" bug class), a concurrent edit is caught deterministically (`If-Match`/`409`), the `icon` field can't smuggle in a value the design system doesn't recognize, only a MYIO operator's JWT can write at all, and one integration test proves all of the above together. This document checks each of the six against the code as it exists today, not against the checklist's original expectations.

### Part B, in one paragraph

RFC-0234 wants an optional way for an operator to mark a device as "specifically a transformer" — for display only, never for the totals math (that stays in the consumer's `excludeGroupsTotals` device attribute, untouched by this RFC). RFC-0047's own design already has the right shape for this: a `PROFILE`-type `entity_key` hanging under a `GROUP`, exactly like the existing `CHILLER`/`FANCOIL`/`HVAC` example under `energy-commonarea`. `TRANSFORMADOR` is one more row of that same shape — not a new `entity_type`, which RFC-0047 explicitly designed *against* inventing per taxonomy concept.

---

## Reference-level explanation

### Part A — RFC-0207 §v3.2-G checklist closure

Each item below states: **what the code actually does today** (file/line cited), **verdict**, and **what closes the gap**, where one exists.

#### A.1 — Cross-tree TX validation (Q2/Q8)

> *Original ask:* `bulk-replace` validates cross-tree (parentage/depth/unique-allocation/1-fallback/formula refs) in the same transaction as the write, rejecting the whole payload atomically with zero rows changed.

**Verdict: partially implemented.**

- **Done:** per-node `metadata` shape validation runs for every node in the incoming forest *before* the repository is called at all — `EntityService.bulkReplace`'s `validateNodes` walk (`src/services/EntityService.ts` lines 447–453) calls `validateMetadataForType` recursively over `body.roots`; a `ZodError` anywhere in the tree throws before `this.repository.bulkReplace(...)` is ever invoked (line 474), so a metadata-shape violation is a true zero-write rejection.
- **Done (by construction, not by an explicit check):** cycles are impossible in a `bulk-replace` payload — the input is a literal nested tree (`children[]`), not a graph of parent-id references into the existing table, so there is nothing to walk for a cycle. This satisfies the "cycle-free" requirement without needing code for it.
- **Done (indirectly):** the DB's two partial unique indexes (`entities_system_uq` / `entities_customer_uq`, `docs/rfcs/RFC-0047-Entity-schema.md` lines 60–66) still enforce "no duplicate `(scope, type, key, parent)`" inside the same transaction as the insert — a duplicate key anywhere in the payload rolls the whole `bulkReplace` transaction back (`src/repositories/EntityRepository.ts` lines 437–522 is one `db.transaction(...)`), so zero-write atomicity holds for this case. It surfaces as `409 DUPLICATE_KEY` via `EntityService.mapRepoError` (lines 90–112), **not** as a pre-write validation error.
- **Gap:** there is **no explicit pre-write check** of `allowedParentTypes` for bulk-replace nodes. `EntityRepository.bulkReplace`'s `insertNode` (lines 470–502) inserts each node under its computed parent using `node.entityType ?? entityType` with **no call** to anything resembling `assertAllowedParentType` — the same rule that `EntityService.create`/`update` *do* enforce (`src/services/EntityService.ts` lines 232–248, 314–320, `assertAllowedParentType` at lines 525–534). A payload nesting, say, a `PROFILE` node under another `PROFILE`, or an arbitrary type under a type that forbids it, is accepted and written today via `bulk-replace` even though the identical structure would be rejected via `POST /entities` or `PATCH /entities/:id`.
- **Gap:** there is **no depth-limit enforcement at write time**. `ENTITY_MAX_DEPTH` (`src/dto/request/EntityDTO.ts` line 11, value `5`) is only applied *after* the insert, to bound the shape of the **response** (`EntityRepository.bulkReplace` line 514, `buildForest(sorted, ENTITY_MAX_DEPTH)`) — an over-deep payload is written to the DB in full; only what comes back in the response is truncated.
- **What closes it:** add a pre-write structural validator to `EntityService.bulkReplace`, run alongside (or immediately after) `validateNodes`, that walks `body.roots` and rejects, before calling the repository: (a) any node whose `entityType` is not in its parent's `allowedParentTypes` (reusing the existing `assertAllowedParentType` logic, now driven by the registry lookups already available to the service); (b) any node deeper than `ENTITY_MAX_DEPTH` from its root. Optionally also pre-check duplicate `(entityType, entityKey)` siblings within the payload itself, so the zero-write guarantee is enforced at the validation layer rather than relying solely on the DB unique index + transaction rollback.
- **Open call (see Unresolved Questions):** RFC-0207's addendum specifies this rejection as **`422`**, but every other `/entities` validation error in this codebase (`ValidationError` → `400`, see `src/shared/errors/AppError.ts` line 32; `INVALID_PARENT_TYPE`/`ENTITY_CYCLE` → `400` per `RFC-0047-Entity-API.md` §4) is `400`. This RFC does not resolve which status code the implementation should use — see Unresolved Questions.

#### A.2 — `metadata` jsonb cast + anti-Moxuara test (Q3)

> *Original ask:* bind `metadata` as an object with an explicit `::jsonb` cast, never `JSON.stringify` over an already-JSON string; a mandatory anti-Moxuara regression test.

**Verdict: implemented for the write path; the test exists but not exactly as specified (see A.6).**

- **Done:** every write path in `EntityRepository.ts` binds `metadata` as a plain JS object into the Drizzle `jsonb` column — `create` (lines 118–138, `metadata: data.metadata ?? {}`), `update`'s merge-patch (lines 196–210, builds a plain object then assigns it), and `bulkReplace`'s `insertNode` (lines 470–495, `metadata: node.metadata ?? {}`). None of these call `JSON.stringify` on a value that is already a JSON string, and none use `sql.raw` for the metadata column — the exact failure mode behind the historical Moxuara double-serialization bug is not present in any of these three paths.
- **Done:** an anti-Moxuara assertion exists — `tests/integration/entities.roundtrip.test.ts` Case 6 ("round-trips metadata with quotes/backslashes as real jsonb (no double-serialization)", lines 508–550) inserts a `metadata` object containing embedded quotes and backslashes and asserts `pg_typeof(metadata) = 'jsonb'`, a deep-equal read-back, and that `metadata->>'formula'` has no trailing quote (i.e., is not a JSON-string-wrapped string).
- **Caveat, carried into A.6:** this test inserts via a **raw `db.execute(sql\`INSERT …\`)`** with an explicit `${JSON.stringify(metadata)}::jsonb` cast in the SQL literal (line 522) — it proves the **column/cast mechanics** are safe, but it does **not** exercise `EntityRepository.create` or `EntityService`/the controller. The actual Drizzle write path (object-bind, no `JSON.stringify`) is a *different* code path from what this test exercises, and is currently unverified by an equivalent assertion. Both are individually sound (confirmed by direct code read for the repository path, and by this test for the raw-SQL path), but no single test proves the *real* `POST /entities` → `EntityRepository.create` → read-back round-trip end-to-end.

#### A.3 — `If-Match` domain-root scope + `409` with `currentVersion` (Q4)

> *Original ask:* `If-Match` concurrency is scoped per domain-root (not per-node); a stale match returns `409` carrying `currentVersion` in the body.

**Verdict: implemented.**

- `EntityService.bulkReplace` (`src/services/EntityService.ts` lines 435–484) recomputes the current subtree version — filtered to the query's `entityType` (the domain root, line 459: `current.roots.filter((r) => r.entityType === entityType)`) — and compares it to the normalized `If-Match` header (lines 456–470). A mismatch throws `AppError('VERSION_CONFLICT', …, 409)` with `.details = { currentVersion }` attached (lines 462–468), **before** `repository.bulkReplace` is called — confirmed zero-write by the unit test `tests/unit/services/EntityService.bulkReplace.test.ts` ("rejects VERSION_CONFLICT on a stale If-Match and carries currentVersion", lines 59–72), which asserts `repo.bulkReplace` is never invoked and that `err.details.currentVersion` matches the expected value.
- The controller (`src/controllers/entities.controller.ts` lines 260–288) reads the `If-Match` header, normalizes a quoted ETag, and forwards it; on success it sets `X-Version-Id` to the new version (line 283).
- No further work is needed for this item.

#### A.4 — `icon` validated against the RFC-0200 (`deviceIcons`) catalog (Q6)

> *Original ask:* `icon` is checked, at write time, against the same curated token catalog as RFC-0200's `deviceIcons`, via a checked-in mirror (not a hard-coded enum), so a picker can never offer a token the write path rejects.

**Verdict: gap, confirmed.**

- `ClassificationMetadataSchema` (`src/dto/request/EntityDTO.ts` lines 231–240) declares `icon: z.string().max(128).optional()` — a bounded string with **no catalog check at all**. Any string up to 128 characters passes.
- No checked-in mirror file of an RFC-0200 `deviceIcons` catalog exists anywhere in this repository. The only icon-adjacent artifact found is `scripts/seed-myio-device-icons.sh`, which uploads icon **image files** to the FileAssets API under public slugs (an unrelated feature — MYIO's device-icon *asset* store, not a curated *token* enum for `metadata.icon` validation).
- **What closes it:** add a checked-in file (e.g. `src/dto/request/deviceIconCatalog.ts`) exporting a frozen set/array of valid icon tokens, sourced from and kept in sync with RFC-0200's `deviceIcons` catalog (owned by MYIO-Design) — the same "checked-in mirror, not a hard enum" pattern RFC-0047-Entity-API.md §5 already prescribes for the baked-tree/key-parity mechanism. Change `ClassificationMetadataSchema`'s `icon` field to validate against that set (`z.enum(...)` or a `.refine()`), so an off-catalog `icon` is rejected with `400 VALIDATION_ERROR` at write time. Add a regenerate step (a build/PR step, mirroring the baked-copy regeneration convention already documented for consumers) and a unit test asserting a bogus token is rejected.

#### A.5 — `entities:write` RBAC seed for the "MYIO operator" role (Q7 / PO-1)

> *Original ask:* the operator's JWT carries `entities:write` via RBAC (a seeded role/policy for a "MYIO operator" profile, with the assignment done) — never a master key in the browser.

**Verdict: gap, and more structural than "not seeded."**

- `entities:write` / `entities:read` / `entities:admin` exist only as `ApiKeyScope` string-literal constants (`src/domain/entities/CustomerApiKey.ts` lines 34–36), a type used exclusively by the **Customer API Key** (`gcdr_cust_*`) scope-check path.
- The RBAC seed files (`scripts/db/seeds/04-policies.sql`, `05-roles.sql`) use a **different permission shape entirely** — `domain.function.action` strings (e.g. `devices.list.read`, `customers.secret.reveal`) — and contain **no `entities.*` policy and no role named anything like "MYIO operator."** `grep`-ing the full `scripts/` tree for `entities:` found no matches outside a comment.
- More importantly: `hybridAuthMiddleware` (`src/middleware/auth.ts`) only checks the `requiredScope` parameter on the **API-key branch** (lines 211–258, passed into `validateApiKey`/`validateApiKeyWithTenant`). The **JWT Bearer branch** (lines 196–208) decodes the token, sets `req.user`/`req.context`, and calls `next()` **unconditionally** — it never inspects `requiredScope` at all. So today, **any authenticated JWT user, regardless of role, can call the `/entities` write endpoints**; the `entities:write` gate is real only for customer API keys (which correctly get `403`, since no customer key is ever granted `entities:write` — RFC-0047's design intent for *that* half is honored). This matches a pre-existing, already-documented gotcha in this project (`reference_gcdr_auth_admin_detection.md`: "JWT bypassa gate de scope — scope só vale p/ API key"), which is not specific to `/entities` — it affects every route mounted with `hybridAuthByMethod`.
- The only real authorization narrowing on `/entities` writes today is the **admin tier** (`entities.controller.ts`'s `isAdminContext()`, lines 51–86), which additionally gates `is_system` row mutation and `entity_type` creation — but a *non-admin*, non-`is_system` write (e.g. editing a customer's cloned tree, or `bulk-replace`) has no JWT-side scope check whatsoever.
- **What closes it** is bigger than a seed-data change: (a) decide where JWT-side scope enforcement for `entities:write` actually belongs — either extend `hybridAuthMiddleware`'s JWT branch to check `requiredScope` against the user's RBAC roles/policies (which requires bridging the two different permission-string shapes: `ApiKeyScope`'s `entities:write` vs. RBAC's `domain.function.action`), or fold `/entities` write authorization into the same `isAdminContext()`-style role check the controller already performs for the admin tier, applied to *all* writes rather than just `is_system` ones, until general JWT scope enforcement exists; (b) whichever mechanism is chosen, seed a role (e.g. `role:myio-operator`, or reuse an existing one) and its assignment so a real operator's JWT satisfies it. This is flagged as an **architectural decision**, not a data-seed task — see Unresolved Questions.

#### A.6 — The §v3.2-D integration test

> *Original ask:* one integration test against a real Postgres, in a single run, proving three invariants together: (a) an invalid cross-tree payload → `422`, subtree row count unchanged; (b) a stale `If-Match` → `409` with `currentVersion` in the body; (c) a successful replace, re-read via `/resolve`, with `pg_typeof(metadata) = jsonb` and a deep-equal with no trailing-quote corruption.

**Verdict: partially done — the invariants are covered, but not as "a single test through the real code path," and not with the literal HTTP status the addendum named.**

`tests/integration/entities.roundtrip.test.ts` is explicit in its own header comment (lines 19–26) that it exercises "the §6 contract mostly at the DB level via raw Drizzle / db.execute … a raw-Drizzle equivalent" rather than the actual `EntityService`/`EntityRepository`/controller singletons, because those may not be wired at integration-test time. Concretely:

- **(a) cross-tree validation → zero-write:** covered by **Case 3** ("aborts a bulk-replace with one invalid node and writes zero rows", lines 350–394) — but it hand-rolls a `validateNode` function that mirrors the service's per-type `.strict()` metadata check, and raw `INSERT`s inside a manually-opened `db.transaction`, rather than calling the real `EntityService.bulkReplace` or hitting `PUT /entities/bulk-replace`. It also only exercises a **metadata-shape** violation, never a **cross-tree/topological** one (no parent-type-rule or depth-limit payload is tested — consistent with A.1's gap, since that validation doesn't exist yet to test). The thrown error is a custom `{ code: 'VALIDATION_ERROR' }`, asserted as such — not literally HTTP `422` (this codebase has no `422` anywhere in the `/entities` path; see A.1).
- **(b) stale `If-Match` → `409` + `currentVersion`:** covered by **Case 2** ("rejects a stale If-Match bulk-replace and writes zero rows", lines 308–343) — again a hand-rolled raw-SQL equivalent inside its own `db.transaction`, not the real `bulkReplace` call. The **real** `EntityService.bulkReplace` version-conflict path (real code, mocked repository) is separately unit-tested in `tests/unit/services/EntityService.bulkReplace.test.ts` (A.3 above) — so the logic is tested, but not together with (a) and (c), and not against a real DB.
- **(c) success → `pg_typeof(metadata)=jsonb` + deep-equal, no trailing-quote:** covered by **Case 6** (A.2 above) — a direct raw-SQL insert + read, not via the real `GET /entities/resolve` call.

So: **the three invariants are each demonstrably true today**, but as **three separate integration-test cases**, each a hand-rolled raw-SQL stand-in for the DB-level guarantee rather than a single test driving the real `PUT /entities/bulk-replace` HTTP/controller/service/repository stack. This is a materially different (and weaker) claim than "the single test that destrava a LIB" the 2026-06-23 addendum described. Do not treat the existing three cases as satisfying that closing test — they satisfy the underlying DB-truth invariants, which is valuable and should be kept, but the addendum's actual ask (one test, real code path) remains open.

- **What closes it:** once A.1 (cross-tree validation) exists to have something meaningful to assert, add one integration test that drives `EntityService.bulkReplace` (or, better, a `supertest` call against `PUT /api/v1/entities/bulk-replace` through the real Express app) and asserts, in one run: an intentionally invalid cross-tree payload is rejected with the status code settled in A.1's open question, with the subtree count provably unchanged; a stale `If-Match` on that same live endpoint returns `409` with `currentVersion`; and a valid replace, re-read through the real `GET /entities/resolve` service call (not a raw `SELECT`), round-trips `metadata` correctly. The existing Cases 2/3/6 should remain as DB-truth regression coverage — they are not redundant, just not a substitute for this.

---

### Part B — Equipment/profile taxonomy extension: `TRANSFORMADOR`

RFC-0234's Future Possibilities section describes an **optional `TRANSFORMADOR` labeling `deviceProfile`**, explicitly "decoupled from classification entirely: purely so operators can visually distinguish an Entrada-classified device that is specifically a transformer from a plain main meter in device lists, the `ExclusionGroupsTab` editor, and reports." The exclusion/totals math this labeling might eventually accompany lives entirely in the consumer's `excludeGroupsTotals` device attribute (per RFC-0234's main design) — **GCDR is not involved in that math at all**, and this RFC does not change that.

#### B.1 — Why `PROFILE`, not a new `entity_type`, and not `CLASSIFICATION_NODE`

RFC-0047's Shape A is explicit: "few types (`GROUP`, `PROFILE`, `EQUIPMENT`); the rich telemetry taxonomy lives in `entity_key`," and the RFC's own *promotion criterion* (§"When not to use it") says a concept graduates to its own type only when the service starts branching on it, needs referential integrity, becomes hot, or needs its own indexed field — none of which apply to a purely cosmetic label. Inventing an `entity_type` (e.g. `EQUIPMENT_LABEL`) for this would be exactly what RFC-0047 was built to avoid.

`CLASSIFICATION_NODE` is the wrong home too: that type carries `metadata.{role,rules,formula}`, evaluated by RFC-0207's classification/breakdown engine to compute totals — fields that are meaningless (and per RFC-0234, explicitly *not wanted*) for a purely cosmetic label. Using `CLASSIFICATION_NODE` would imply `TRANSFORMADOR` participates in the classification tree's totals math, which it must not.

`PROFILE` is the correct fit: it already exists for exactly this shape — "a profile under a group (e.g. CHILLER, FANCOIL)," per the seeded example (`scripts/db/seeds/31-entity-registry.sql` lines 60–72: `GROUP energy-commonarea` → `PROFILE CHILLER/FANCOIL/HVAC`) — and `entity_types` already declares `PROFILE`'s `allowed_parent_types = '{GROUP}'` (line 40).

#### B.2 — What parent `GROUP`

The current seed's only example `GROUP` roots are `energy-commonarea`, `oxygen`, and `pressure` (`31-entity-registry.sql` lines 60–87) — there is **no existing `GROUP` representing an "Entrada" telemetry domain** in today's seed data. Registering `TRANSFORMADOR` requires an operator to first decide (or seed) the parent `GROUP` — e.g. a new root such as `energy-entrada`, or nesting under an existing group if one better fits the operator's taxonomy at the time this is implemented. This RFC does not mandate a specific parent group name; see Unresolved Questions. The pattern below is illustrative, using a placeholder parent id.

#### B.3 — Example insert

Following the exact shape of the existing seed (`31-entity-registry.sql` lines 60–72), a `PROFILE`-type row for `TRANSFORMADOR`:

```sql
-- Illustrative — <parent_group_id> is whatever GROUP root the operator chooses
-- (see B.2); this is a data-only insert, no entity_types row, no migration.
INSERT INTO entities
  (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
   parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
VALUES
  (gen_random_uuid(), '<tenant>', NULL, 'PROFILE', 'TRANSFORMADOR', 'Transformador',
   '<parent_group_id>', <next_sort_order>, true, true, '<system actor>', '<system actor>')
ON CONFLICT DO NOTHING;
```

- **No `entity_types` change** — `PROFILE` is already registered with `allowed_parent_types = '{GROUP}'`.
- **No `ENTITY_METADATA_SCHEMAS` entry needed** — only the `CLASSIFICATION_*` types have a registered Zod schema today (`src/dto/request/EntityDTO.ts` lines 249–254); `PROFILE` falls through to free-form metadata (back-compat path, `validateMetadataForType`, lines 264–271), so a bare `entity_value` label (as used above, matching the existing CHILLER/FANCOIL/HVAC convention) needs no schema change. If a richer, validated shape (`metadata.label`/`metadata.icon`) is wanted later, that is a natural, optional follow-on (see Future Possibilities), not a requirement for this insert.
- **No new backend logic, no new endpoint, no code path change** — this is a data-seed / operator-runbook addition, exactly as RFC-0234 scoped it ("purely cosmetic," "does not require revisiting anything else").

#### B.4 — Explicitly out of scope for this row

- The device-attribute value `TRANSFORMADOR` that a device's `deviceProfile` attribute would carry (read by `handleDeviceType()`'s name-inference logic in `myio-js-library-PROD.git`, per RFC-0234's Future Possibilities bullet) is a **separate concern** — that attribute lives on the device record itself (a different GCDR domain entirely, out of RFC-0047's scope), not on this `entities` taxonomy row. This row's only job is to make `"TRANSFORMADOR"` a governed, listable taxonomy value (e.g., for an admin picker or report label), matching devices whose `deviceProfile` attribute happens to carry the same string — the two are related by convention (shared string value), not by a foreign key or any GCDR-enforced relationship.
- Wiring `TRANSFORMADOR` into RFC-0207's classification/breakdown engine (i.e., referencing it from a `CLASSIFICATION_NODE`'s `metadata.rules.deviceProfiles` list) is a distinct, later decision — this RFC neither requires nor precludes it, and RFC-0234 does not ask for it (the exclusion math is separate, per B's opening paragraph).

---

## Rollout plan

**Part A** — implementation follow-up, separate PRs, suggested order:

1. **A.4 (icon catalog)** — additive, low risk, no auth/validation-path change; ship first.
2. **A.1 (cross-tree structural validation in `bulkReplace`)** — medium risk: changes what payloads `bulk-replace` accepts. Coordinate the release with `myio-js-library-PROD.git`'s consumer (its own `validateProfile` "mirror" checklist, per RFC-0207 §v3.2-F/H, should already reject the same payloads client-side — this closes the server-side barrier the addendum's decision explicitly wanted: "o backend é a barreira de integridade, não a LIB").
3. **A.5 (JWT scope enforcement / MYIO-operator role)** — highest risk: touches `hybridAuthMiddleware`, shared by every route mounted with `hybridAuthByMethod`, not just `/entities`. Requires its own design decision (see Unresolved Questions) and a wider regression pass before merge.
4. **A.6 (the consolidated integration test)** — do last, once A.1 exists to have a real cross-tree violation to assert against; keep the existing three raw-SQL cases as-is (they remain valid DB-truth regression coverage).
5. **A.2** requires no further code change; consider adding the missing real-code-path anti-Moxuara assertion (the caveat noted in A.2) as a small addition to A.6's consolidated test rather than a separate PR.
6. **A.3** requires no further work.

**Part B** — ships independently of Part A, whenever an operator needs it and the parent-`GROUP` question (B.2) is settled; it is a one-time seed/runbook change, not a migration, and has no dependency on Part A.

---

## Testing strategy

**Part A:**
- Unit tests for the new structural validator (A.1): a `PROFILE`-under-`PROFILE` payload rejected, a payload exceeding `ENTITY_MAX_DEPTH` rejected, both asserted zero-write (repository never called) — mirroring the existing pattern in `tests/unit/services/EntityService.bulkReplace.test.ts`.
- Unit test for icon catalog rejection (A.4): an off-catalog `icon` value on a `CLASSIFICATION_*` node → `400 VALIDATION_ERROR`.
- Tests for JWT scope enforcement (A.5), once the mechanism is chosen: positive (an operator-role JWT can write), negative (an authenticated JWT without the operator role/scope gets `403` on a write it previously would have been allowed to perform) — this is a behavior change from today's actual code, so the negative case is the one that currently would fail and must start passing.
- The consolidated integration test (A.6), gated the same way the existing suite is (`RUN_DB_TESTS=1`, real Postgres).

**Part B:** no new code path, so no new test is required beyond the seed script's own idempotency (`ON CONFLICT DO NOTHING`, already the pattern used throughout `31-entity-registry.sql`).

---

## Drawbacks

- **Part A's A.5 fix is repo-wide, not entities-scoped.** Fixing JWT scope enforcement inside `hybridAuthMiddleware` changes behavior for every router mounted with `hybridAuthByMethod`, not only `/entities` — a narrow, entities-only patch (e.g., inline scope-checking logic duplicated into the entities controller) would avoid that blast radius but would leave the general gap this RFC surfaced unfixed for every other route that has it. This RFC does not resolve that trade-off (see Unresolved Questions) and flags it explicitly so implementers don't default to the narrow, siloed fix without considering the wider one.
- **Part A's A.1 fix changes the write contract.** Tightening `bulk-replace` to reject payloads it silently accepted today is a breaking change for any existing customer-cloned tree that happens to already violate `allowedParentTypes` or the depth bound (unlikely, since the only writer today is MYIO staff via the same rules `create`/`update` already enforce, but not provably impossible without an audit pass).
- **Part B risks an implicit false-equivalence.** `GROUP`/`PROFILE` (telemetry-grouping taxonomy) and `CLASSIFICATION_ENERGY|WATER|TEMPERATURE`/`CLASSIFICATION_NODE` (RFC-0207's classification/breakdown taxonomy) are two independent taxonomies that happen to share the same generic `entities` table. An operator who later wires `TRANSFORMADOR` (a `PROFILE`) into the classification engine without realizing these are separate systems could produce confusing results. This document calls that out explicitly (§B.4) as a guardrail, not a technical control.

---

## Rationale and alternatives

- **Reusing `entity_key` extension instead of a new type (Part B):** consistent with RFC-0047's stated purpose — "adding a subcategory = a data insert, no new code." A new `entity_type` (e.g. `EQUIPMENT_LABEL`) was considered and rejected: `PROFILE` already models exactly this shape, and creating a parallel type for a purely cosmetic distinction directly contradicts RFC-0047's own promotion criterion.
- **Fixing JWT scope enforcement generally vs. an entities-only shim (Part A.5):** considered a narrow fix scoped only to the entities controller (extend `isAdminContext()`-style logic to gate all writes, not just `is_system` ones) as a **stopgap** that ships faster and has a smaller blast radius; the general `hybridAuthMiddleware` fix is the structurally correct answer but affects every gated route. This RFC recommends the stopgap only as an interim step if the general fix can't land first — see Rollout plan step 3 and Unresolved Questions.
- **422 vs. 400 for cross-tree validation errors (Part A.1):** RFC-0207's addendum specified `422`; this codebase's actual convention (checked directly, not assumed) is `400` for every existing `/entities` validation error. This RFC does not pick a winner — see Unresolved Questions — because the choice affects the published wire contract (`RFC-0047-Entity-API.md` §4) and should be made deliberately, not as a side effect of closing this checklist item.

---

## Prior art

- **RFC-0047 — Generic Entity Registry** (this repo) — the base design this addendum extends; Shape A, the `entity_types`/`entities` model, and the promotion criterion are all inherited unchanged.
- **RFC-0207 — Customer-Scoped Device Classification Profile** (`myio-js-library-PROD.git`), specifically its addendum "RFC-0207 v3.2: contrato GCDR via RFC-0047 (RESOLVIDO, 2026-06-23)" — the origin of every item in Part A's checklist, decided in a BMAD roundtable (Winston/Amelia/John).
- **RFC-0234 — Energy Transformadores Group** (`myio-js-library-PROD.git`), specifically its "Future possibilities" section — the origin of Part B's `TRANSFORMADOR` labeling-profile bullet.

---

## Unresolved questions

- **HTTP status for cross-tree `bulk-replace` validation errors (A.1):** `422` (per RFC-0207 §v3.2-C, Q2/Q8) vs. this repo's existing `400`-only convention for every other `/entities` validation error. Needs a decision before A.1 ships, since it changes the published wire contract in `RFC-0047-Entity-API.md` §4, not just internal code.
- **Where JWT-side `entities:write` enforcement belongs (A.5):** a general fix to `hybridAuthMiddleware`'s JWT branch (bridging `ApiKeyScope` strings and RBAC's `domain.function.action` policy strings) versus an entities-scoped stopgap reusing `isAdminContext()`-style role checks. This is a real design decision with implications for every other route sharing the same latent gap — a wider audit of `hybridAuthByMethod`-mounted routers may be warranted rather than an entities-only fix, but that audit is out of scope for this document.
- **Part B's parent `GROUP` for `TRANSFORMADOR` (B.2):** a new `energy-entrada` root, or nesting under a different existing/future group — left to whoever picks up RFC-0234's Future Possibilities bullet, since RFC-0234's main design does not depend on this and is not blocked by it.
- **Should `PROFILE` gain a registered `ENTITY_METADATA_SCHEMAS` entry?** Today it is free-form (back-compat). If `TRANSFORMADOR` and other display-only profiles proliferate, a `.strict()` schema (e.g. `{ label, icon? }`) mirroring the `CLASSIFICATION_*` pattern may become worth adding — not required for Part B's v1.

---

## Future possibilities

- Once RFC-0234's own Future Possibilities "audit tool" (to find transformer-like devices across customers) exists, a bulk migration/backfill of `TRANSFORMADOR` `PROFILE` rows (or of device `deviceProfile` attributes referencing it) could be scripted from its output.
- If the general JWT scope-enforcement gap (A.5) is fixed for `hybridAuthMiddleware` as a whole, revisit whether `/entities` still needs any entities-specific authorization code at all, or whether the general fix fully subsumes `isAdminContext()`.
- A small `entities.controller.ts` endpoint (or an admin-UI affordance) exposing the icon catalog (A.4) for client-side pre-validation, formalizing the GCDR-side half of the "mirror" pairing `RFC-0047-Entity-API.md` §5.1 already describes on the consumer side.
- Extending `PROFILE` with a registered metadata schema (see Unresolved Questions) if display-only profiles like `TRANSFORMADOR` become common enough to warrant enforced shape.
