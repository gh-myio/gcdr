# RFC-0046 — Customer Consumption Goals · Review Feedback v2

- **Reviews of:** `docs/RFC-0046-Customer-Consumption-Goals.md`
- **Supersedes:** `docs/RFC-0046-Customer-Consumption-Goals-feedback.md` (v1) — see "What changed since v1".
- **Date:** 2026-06-18
- **Format:** BMAD party-mode roundtable, **round 2** — agents reacting to the author's written answers on the v1 feedback.
- **Reviewers:** 🏗️ Winston (System Architect) · 📋 John (Product Manager) · 🎨 Sally (UX Designer) · 💻 Amelia (Senior Software Engineer)

---

## Headline: the design pivoted

The author's answers changed three load-bearing assumptions, and the panel **unanimously reversed the v1 storage recommendation**:

1. **HOUR is required NOW** (not deferred): the client wants goals analysed by hour, plus a change history; "model the DB for the worst case". Hour = up to 8,760 buckets/year/entity.
2. **Per-asset goals are OUT of scope.**
3. **The DOMAIN owns the schema**, not the `GoalsPanel` — so byte-for-byte mirroring of the panel JSON is no longer a constraint.

Consequence: **the v1 "JSONB envelope, defer hour" is withdrawn. v2 recommends a NORMALISED model.** The author's own intuition was correct — normalising resolves the same-envelope month-collision concurrency raised in v1.

---

## Endorsed direction (v2 consensus)

- **Normalised storage:** one row per **leaf** bucket (the finest level actually filled on each branch); coarser levels are **not stored** — they are computed on read.
- **Granularity is a MIXED TREE per year:** within one year, some months may be hourly, others daily, others monthly — they coexist as distinct rows, no conflict.
- **Aggregation method is per-DOMAIN, stored, not per-row:** `SUM` for `ENERGY`/`WATER`, `AVERAGE` for `TEMPERATURE`. `total = 25` on a temperature goal reads as "25 °C".
- **History → its own append-only table;** `?fetchHistory=true` returns ≤100 entries, newest first.
- **No per-asset:** the goal key is `(customer, domain, time-bucket)`. This **dissolves the v1 "asset key" question (B-2)**.

---

## Proposed data model (normalised)

### `consumption_goals` — leaf values only
```
id           uuid PK
tenant_id    uuid
customer_id  uuid
domain       text         -- ENERGY | WATER | TEMPERATURE
year         smallint
month        smallint NULL -- NULL ⇒ leaf is the year
day          smallint NULL -- NULL ⇒ leaf is the month
hour         smallint NULL -- NULL ⇒ leaf is the day
value        numeric
updated_by   uuid
updated_at   timestamptz
UNIQUE (tenant_id, customer_id, domain, year, month, day, hour)
```
Leaf granularity is **implicit by the deepest non-null level**: `(2026,–,–,–)`=year; `(2026,3,–,–)`=March; `(2026,3,15,9)`=09:00 on Mar-15. (Amelia's variant uses an explicit `granularity` enum + a `bucket_key` text — same idea, more explicit; pick one at implementation.)

**Coexistence invariant:** a branch may not hold both a coarse leaf and a finer leaf. Detailing March into days **deletes** the March month-leaf (it becomes computed); collapsing March back deletes its day/hour children. This is **transactional service logic**, not a SQL constraint.

### `consumption_goal_domains` — aggregation config (per domain)
```
tenant_id          uuid
domain             text
aggregation_method text   -- SUM | AVERAGE
unit               text   -- kWh | m³ | °C
PK (tenant_id, domain)
```
Keep the method on the **domain**, not on each value row, to prevent "one hour SUM, another AVERAGE" inconsistency. (Amelia would also persist a denormalised `value_type` on the value row for read stability — acceptable as a derived copy.)

### `consumption_goal_history` — append-only audit
```
id, tenant_id, customer_id, domain,
year/month/day/hour (or granularity + bucket_key)  -- which bucket changed
old_value numeric NULL, new_value numeric NULL,
action text (CREATE|UPDATE|DELETE),
changed_by uuid, changed_at timestamptz
INDEX (tenant_id, customer_id, changed_at DESC)
```
`?fetchHistory=true` → `ORDER BY changed_at DESC LIMIT 100`.

---

## Granularity precedence — the UX state machine (🎨 Sally)

**Golden rule for the screen:** *"the finest level you filled wins; everything above it becomes a reflection."*

Each node has exactly **two states** — a node is CALCULATED **iff** at least one descendant is detailed; there is no third state:

| Level | Finest descendant filled? | State | Written by |
|---|---|---|---|
| Year | none (year is the leaf) | EDITABLE | operator |
| Year | any month detailed | CALCULATED | system (Σ/x̄ of months) |
| Month | month is the leaf | EDITABLE | operator |
| Month | days/hours detailed | CALCULATED | system |
| Day | day is the leaf | EDITABLE | operator |
| Day | hours detailed | CALCULATED | system |
| Hour | always leaf | EDITABLE | operator |

- **Drill (override-down):** the parent becomes CALCULATED; children are born EDITABLE, **pre-seeded** with an even split (e.g. `10000/31`) flagged "suggested" so the calculated parent still equals the prior total (zero surprise). Warning shown **at the moment of drilling**.
- **Clear (revert-up):** a destructive, honest confirmation ("the 31 daily values will be discarded…"); the parent returns to an EDITABLE field that is **empty with the last computed total as placeholder** (Tab accepts) — it does not pretend the operator already decided.
- **Editable = pencil icon; calculated = Σ (sum) or x̄ (average) icon + greyed/italic.** One grammar across manual and CSV.

### Mixed-tree visualisation
- Per-month **granularity badge**: `MONTHLY` (grey) / `DAILY` (blue) / `HOURLY` (purple); `DAILY · 3 hourly days` when mixed inside a month.
- A 4px coloured left rail per month and a **12-cell year mini-map** (the "establishing shot") so the operator instantly sees which months are hourly vs daily.
- **Disabled hours** (outside operating window): rendered with hatching and a locked `0` ("not counted"), **not hidden** — hiding triggers "where are the 24 hours?".

### Temperature without lying
Same state machine; the calculated node uses **x̄ (weighted average)** with an explicit glyph + °C unit and tooltip "weighted average by days (°C does not sum)". A fixed header chip ("Temperature · average" / "Energy · sum") keeps the operator on the right ruler. The glyph makes a sum visibly impossible — the cure for v1's "interface lying".

---

## CSV import — experience, not parse (🎨 Sally, from the author's flow)
1. **Drop** → "Preview. Nothing is saved until you confirm."
2. **Dry-run** (split): left = a *ghost* tree of how the year would look (changed badges blink); right = line-by-line diagnostics ("8,380 OK · 32 problems", each citing the exact line; granularity conflicts → "kept HOURLY, finest wins"). **Partial import is explicit** + "download error report (CSV)". Never silent, never all-or-nothing.
3. **Confirm** in numbers ("3 months become HOURLY, 5 DAILY, 4 stay MONTHLY; 32 lines ignored").
4. **Full log** — downloadable, auditable; closing it opens straight into the imported tree for tweaking specific hours. CSV is the fast way to seed the same tree the operator edits by hand.

---

## Product — revised scope (📋 John)

- **No longer deferred:** HOUR and DAILY (the client's core need; operator imports a mixed year). TEMPERATURE stays — the per-domain aggregation method removed the blocker.
- **Still cut:** per-asset (confirmed out). **Still deferred (decision pending):** the *derived* roll-up (the rule that auto-sums hours up to close a month). Not the granularity — the auto-derivation. In the MVP each bucket is stored as entered.
- **Revised MVP:** goals by **customer × domain (ENERGY/WATER/TEMPERATURE) × time-bucket (HOUR/DAY/MONTH/YEAR)**, with per-domain aggregation method, manual **and** CSV entry, and change history. No per-asset, no derived roll-up (pending decision below).
- **Schema owner = domain** ✅ — a goal is a business entity (customer+domain+period), not a screen artefact. Caveat: `aggregation_method` is domain metadata, never an operator per-row choice.

### The goals-vs-actuals JOIN contract (plain language — author said "não entendi")
Two separate things must meet on the dashboard: the **GOAL** (the operator's target number) and the **ACTUAL** (measured device readings). The join contract is simply *which key matches one to the other*. With per-asset gone it has **3 parts**:
```
(customer_id, domain, time_bucket)        e.g. 2026-06-01T14:00 / HOUR
```
The dashboard aggregates the actual readings (SUM or AVG per the domain) for that customer+domain within the bucket, and looks up the goal with the same `(customer, domain, bucket)`. Two rules or it breaks: **goal granularity = actual bucket granularity**, and **`aggregation_method` belongs to the domain**, not the individual goal.

---

## Engineering — re-issued ACs for the normalised model (💻 Amelia)

What "hour-now" breaks in v1: JSONB write-amplification (rewriting the whole year to edit one hour), per-bucket audit impossible inline, single-row lock contention.

1. **AC-1 (leaf-only):** persist only the finest filled level per branch; coarser never stored as a row.
2. **AC-2 (rollup on read):** GET returns the tree; YEAR=f(MONTH), MONTH=f(DAY), DAY=f(HOUR) via the domain's method (SUM / AVG). **Computed-on-read** (do not materialise in MVP; add a materialised view only if profiling demands).
3. **AC-3 (mixed-tree integrity):** detailing a finer child DELETES the ancestor's coarse leaf + logs a DELETE; collapse inverse likewise. Coarse-leaf and fine-leaf never coexist on a branch.
4. **AC-4 (idempotency):** upsert by the UNIQUE bucket key; identical resend = no-op, no new history row.
5. **AC-5 (concurrency):** lock per bucket (row), not whole-tree; two users editing different hours of the same day don't block.
6. **AC-6 (PUT = replace):** `PUT` of (year+domain) deletes buckets absent from that scope; each delete logged.
7. **AC-7 (PATCH/import = merge):** touches only the buckets sent; absent ones preserved.
8. **AC-8 (history schema):** every mutation logs (bucket, old→new, changed_by, changed_at, action).
9. **AC-9 (fetchHistory):** `?fetchHistory=true` → ≤100 entries, `ORDER BY changed_at DESC`; default false.
10. **AC-10 (temperature AVERAGE):** AVG ignores empty buckets — `DAY = AVG(filled hours)`, not divide-by-24; `total=25` = 25 °C.
11. **AC-11 (CSV dry-run):** import always dry-run preview (no persist) → confirm → persist; response carries ok/error counts.
12. **AC-12 (CSV partial+log):** valid lines import; invalid cite line number + reason; full log returned; partial never aborts the batch.

### B-3 explained (PUT replace vs merge — author said "não entendi")
You `PUT` a payload with 3 months. What happens to the other 9 that already existed and you did **not** send?
- **REPLACE (full):** the PUT is the absolute truth of the resource — the 9 absent are **deleted**.
- **MERGE (upsert):** only the 3 sent are written — the 9 absent **stay**.
- **Recommendation:** `PUT` = replace per (year+domain); `PATCH`/import = merge per bucket. Without this, "I didn't send hour X" is ambiguous between "zero it" and "keep it".

---

## Two decisions the author still owes (both affect the number the client sees)

| # | Decision | Where it surfaced | Note |
|---|---|---|---|
| **DEC-1** | **Does the derived roll-up enter the MVP?** When a year has June hourly and July daily, should June *also* appear as a monthly goal (sum of 720 hours)? | John (product) — Amelia already models it as computed-on-read, so it's cheap to include; it's a product/UX call. | "Yes" → roll-up back in MVP. "No, each bucket is independent" → John's cut holds. |
| **DEC-2** | **Temperature average: average-of-averages or weighted?** Rolling DAY→MONTH→YEAR for temperature — each day weighs equally, or weighted by the filled hours/days? | Amelia + Sally | Both recommend **weighted** (statistically correct), with a tooltip "weighted by days". Changes the displayed number. |

---

## What changed since v1

| Topic | v1 position | v2 position (after author answers) |
|---|---|---|
| Storage | JSONB envelope per (customer, domain), mirroring GoalsPanel | **Normalised, leaf-per-bucket rows** (envelope withdrawn) |
| Hour | Deferred to a separate time-series store | **In scope now**; drives the whole model |
| Granularity | One per year (month default, optional day) | **Mixed tree** per year; finest-wins, coarser computed |
| Temperature (B-1) | Sub-shape vs disabled roll-up; likely defer | **Per-domain `aggregation_method` = AVERAGE**; kept in MVP |
| Asset key (B-2) | Decide `gcdrAssetId` vs TB id (blocking) | **Moot** — per-asset out of scope |
| Schema owner (D-6) | Open ("domain or screen?") | **Domain** owns the schema |
| History (D-4) | Inline vs own table (divergent) | **Own append-only table** + `fetchHistory=true` (≤100) |
| Routing columns (D-5) | Promote `domain`/`year` out of JSONB | **Moot** — normalised model is all columns |
| Concurrency | Whole-envelope lock; 409→reapply on front | **Per-bucket lock**; collisions largely gone |
| PUT semantics (B-3) | Undecided (blocking) | **PUT = replace (year+domain); PATCH/import = merge (bucket)** |
| MVP scope (D-7) | ENERGY+WATER, annual+monthly | **ENERGY+WATER+TEMPERATURE, all granularities incl. HOUR**; no per-asset; derived roll-up pending (DEC-1) |

---

## Still endorsed (carried from v1)
- Goals-vs-actuals split (GCDR stores targets only); document the join contract (now done above).
- Optimistic concurrency, `goals:read`/`goals:write` scopes, and a `CUSTOMER_GOALS_UPDATED` audit event.

_Generated from round 2 of a BMAD party-mode review of RFC-0046. Design-only; no implementation implied. Resolve DEC-1 and DEC-2, then the RFC can be rewritten around the normalised model._
