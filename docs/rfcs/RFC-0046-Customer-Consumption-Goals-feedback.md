# RFC-0046 — Customer Consumption Goals · Review Feedback

- **Reviews of:** `docs/rfcs/RFC-0046-Customer-Consumption-Goals.md`
- **Date:** 2026-06-18
- **Format:** BMAD party-mode roundtable (independent reviewers)
- **Reviewers:** 🏗️ Winston (System Architect) · 📋 John (Product Manager) · 🎨 Sally (UX Designer) · 💻 Amelia (Senior Software Engineer)
- **Status of RFC after review:** Draft — **not yet implementation-ready.** Three decisions are blocking; the storage shape itself is endorsed.

---

## Executive summary

The **JSONB-envelope-per-`(customer, domain)`** storage choice is **endorsed by all reviewers** — precisely because the `goalsData` shape is a contract owned by an external component (`GoalsPanel`), so storing it byte-for-byte and round-tripping it without translation is the low-risk move. Month/day volumes are tiny; deferring **hour** to a separate time-series store is correct.

However, the RFC treats as "open questions" several items that the panel agreed are actually **blocking** — they sit at the intersection of data model, UX, and implementation. The review converges on **three must-resolve-before-coding** decisions and a set of clarifications.

---

## Consensus — blocking decisions (resolve before implementation)

1. **B-1 — Temperature semantics.** `TEMPERATURE` is a setpoint/band, not additive; `annual.total` has no meaning for it. Flagged by *all four* reviewers as blocking model **and** UX **and** code. Decide one of:
   - (a) a domain-specific sub-shape (e.g. `{ setpoint, min, max }`) — breaks the "single shape" premise; or
   - (b) keep `total` carrying the setpoint, **disable** the day→month→year roll-up, document it — *only if `GoalsPanel` already tolerates this* (depends on the panel contract).
   - Engineering corollary: define **exactly what `GET` returns at month/year for temperature** (`null`? average? setpoint? — "disabled" is not a response value).

2. **B-2 — Asset key (`gcdrAssetId` vs ThingsBoard id).** A one-way door and the **only open question that blocks integration** (the dashboard's goals↔actuals join needs a stable key). Architecture + Product agree: key by **`gcdrAssetId`** (GCDR is the master-data source of truth); translate to TB id at the edge. Changing later = data migration across every envelope.

3. **B-3 — `PUT` semantics: replace vs merge.** Not stated in the RFC and the most expensive ambiguity. If replace → simple, idempotent. If merge → the verb should be `PATCH`. Also define: roll-up runs **on write (materialised)** or **on read (computed)**, and which of `daily`/`monthly` is the source of truth when both exist.

---

## Architecture (🏗️ Winston)

- **Endorses the envelope, rejects premature normalisation** — the contract is external; translation layers risk silent drift. Bucket tables are justified **only** for hourly and heavy cross-customer analytics (out of scope).
- **Move `history` out of the envelope** into its own append-only table (`customer_goals_history`, FK to the goal). Inlining couples the hot path (read/write current goal) to the cold path (audit), and the "~20" bound becomes manual pruning someone forgets. (Engineering accepts inline *only if* append+trim+version-bump is a single atomic statement — see Q-9.)
- **Promote routing columns** — surface `domain` (and likely `year`/`granularity`) as top-level columns alongside the JSONB payload, for indexable `WHERE` without denormalising content ("routing columns + JSONB payload" pattern). Cheap now; expensive later.
- **Document concurrency semantics** — the lock granularity is the whole `(customer, domain)` envelope; two operators editing different months collide. Acceptable (low-contention data) but the RFC must say so, and the front-end must handle `409` as **reload-and-reapply**, not reload-and-discard.
- **One paragraph on hour↔envelope reconciliation** — when hourly arrives it lives in a second store with its own version/audit; describe how they coexist now, even if implemented later.

## Product (📋 John)

- **Name the JTBD explicitly** in the RFC: GCDR's job is "a single, versioned, audited source of *targets* so each dashboard stops inventing its own" — not "is the mall on track" (that's the consumer's job). Half the open questions dissolve once this is written.
- **Keep the goals-vs-actuals split** (master data vs time series). The friction risk is *not* the split — it's **failing to document the join contract** (which key matches goal↔actual). Resolve B-2 now.
- **Cut from MVP / defer:** holding/ROOT-RESELLER roll-up (derivable = a sum; and re-imports the temperature non-additivity problem; nobody asked for it), **TEMPERATURE**, **DAILY granularity**, and history-retention policy (append-only is enough; retention is ops).
- **Do not economise on:** optimistic concurrency, `goals:read`/`goals:write` scopes, and audit — the spine of a "source of truth".
- **Proposed MVP:** ENERGY + WATER · annual + monthly · asset key decided & documented · optimistic concurrency + scopes + audit · split kept with the join contract written down.
- **Two questions that gate approval:** (1) Who is the *named* consumer calling `GET /customers/:id/goals` in week 1? No name → no MVP. (2) Does mirroring the `GoalsPanel` JSON mean "smart round-trip" or "GCDR inherits a UI's format as its domain contract"? **Who owns the schema — the domain or the screen?**

## UX (🎨 Sally)

- **Mirror contract is the best decision and the most dangerous** — business rules that live in the panel's head become invisible backend contract. The RFC must state, **in the document**, which field is source-of-truth and which is derived (so a direct API write to `monthly` doesn't silently crack the mirror).
- **Temperature is "interface lying"** — putting a setpoint in the additive 12-month grid makes the operator read the annual column as a total. Needs its own semantics/component, not "one more domain in the same sum grid". Open question: **comfort band or single target?** — changes the whole component.
- **Granularity switch is a data-loss trap** — when daily import makes monthly derived, what happens to manually-typed months? The RFC must specify the **transition state machine** and the warning text ("importing daily makes monthly calculated — your manual values will be replaced. Continue?"). Silent transition = the #1 support ticket.
- **Disabled hour** — needs an explicit "coming soon" tooltip (not bare `disabled`), and **no phantom `hourly: null`** leaking into the contract.
- **Per-asset goals** — define whether the assets must sum to the mall total (error / warning / allowed, with the exact message) and require a **stable, resolvable asset key** so renamed/disabled assets don't show as "unknown asset".
- **Treat CSV import as an experience, not a parse** — 365 rows with 3 errors: reject all? import partial? preview before save? cite the offending line. The RFC names "imported via CSV" as if it were a button.
- **Open question that re-weights everything:** is the operator's flow mostly manual grid entry or mostly CSV? If ~90% CSV, the editable grid is theatre and the design rigor belongs in import/preview/error.

## Engineering (💻 Amelia) — required clarifications & ACs

Underspecified areas: Zod validation of the sparse envelope, optimistic concurrency, PUT idempotency, daily→monthly aggregation (+ temperature), atomic bounded `history`, tenant isolation.

**Acceptance criteria to add before the story is estimable:**

- **AC1** — `PUT` = full replace of the year envelope (or rename to `PATCH`); define `200/201/404/422`.
- **AC2** — `PUT` without `version` on an existing resource → `428 Precondition Required` (recommended).
- **AC3** — atomic conditional update `SET version = version + 1 WHERE id = ? AND version = ?`; `rowCount = 0` → `409` with body carrying `currentVersion`.
- **AC4** — month key regex `^(0[1-9]|1[0-2])$`; daily `^\d{4}-\d{2}-\d{2}$` **+ real-date validation** (leap-year `02-29`) **+** key year must equal the route `:year`.
- **AC5** — `granularity:"hour"` → `422`; `daily` present with `granularity:"month"` → `422`.
- **AC6** — values `.finite()`, `>= 0` for ENERGY/WATER (define a ceiling and decimal precision); TEMPERATURE may be negative.
- **AC7** — roll-up spec: timing (read vs write), source of truth, partial-month behaviour (e.g. 10 of 30 days → partial sum or `null`), and the temperature month/year read result.
- **AC8** — `unit` is a closed enum per domain; roll-up rejects mixed units (no summing `kWh` + `MWh`).
- **AC9** — `history` item schema `{ version, ts, userId, snapshot|diff }`, an exact cap (e.g. 20), append + trim + version-bump in **one transaction**; `DELETE` must also be versioned/audited (append-only + physical delete = lost history).
- **AC10** — exact shape of `assets{}` / `metaTag` (or a declared `z.passthrough()` **and** a byte ceiling on the envelope, given `history` × dense `daily`).
- **AC11** — idempotency: identical repeated `PUT` is a no-op (version unchanged) — recommended.
- **AC12** — tenant isolation in every `WHERE` (`tenant_id` + `customer_id` + `domain`); cross-tenant test returns `404`.

**Blocking before estimation:** B-1 (temperature read result), B-3 (PUT replace vs merge), and roll-up timing (write vs read).

---

## Open decisions to settle (owner → RFC author)

| # | Decision | Recommendation from review |
| --- | --- | --- |
| B-1 | Temperature shape + month/year read value | Decide sub-shape vs disabled-roll-up; pin the read value. Likely defer TEMPERATURE out of MVP. |
| B-2 | Asset key | `gcdrAssetId`; translate to TB id at the edge. |
| B-3 | `PUT` replace vs merge + roll-up timing | Full replace per year; roll-up materialised on write; `daily` is source when present. |
| D-4 | History storage | Prefer a separate `customer_goals_history` table; if inline, make it atomic + capped + byte-bounded. |
| D-5 | Routing columns | Promote `domain` (+ `year`/`granularity`) to top-level columns. |
| D-6 | Schema ownership | State who owns the schema (domain vs `GoalsPanel`) and the versioning/compat policy if the panel's JSON changes. |
| D-7 | MVP scope | ENERGY + WATER, annual + monthly; defer TEMPERATURE, DAILY, holding roll-up, retention policy. |
| D-8 | Named MVP consumer | Identify the dashboard that calls the endpoint in week 1, or the MVP is speculative. |
| D-9 | Operator flow | Confirm manual-grid vs CSV-dominant; weight UX rigor accordingly (import/preview/error). |

---

## Points of agreement (carry forward unchanged)

- JSONB envelope per `(tenant, customer, domain)`; **do not** normalise buckets for month/day.
- Keep hour **out** of the JSON → separate time-series store.
- Keep the goals-vs-actuals split (GCDR stores targets only).
- Keep optimistic concurrency, `goals:read`/`goals:write` scopes, and the `CUSTOMER_GOALS_UPDATED` audit event.
- ENERGY + WATER with daily→monthly **sum** is the clean, endorsed path; the hard cases are temperature, granularity transition, and orphaned assets.

---

## Divergence to resolve

- **`history` location** — Winston: move to its own table (decouple hot/cold). Amelia: inline acceptable *iff* atomic + capped + byte-bounded. → Pick one; both are safe if the constraints are met.
- **Schema ownership (John's challenge)** — unaddressed in the RFC: is mirroring the `GoalsPanel` JSON a smart round-trip or inheriting a UI format as the domain contract? Add a compatibility/versioning policy for when the panel's JSON evolves.

_Generated from a BMAD party-mode review of RFC-0046. Design-only; no implementation implied._
