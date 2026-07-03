# RFC-0050 — Pre-Setup Migration to the GCDR Ecosystem (Backend / Platform)

- **Feature Name:** `presetup-migration-backend`
- **Start Date:** 2026-07-03
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** In implementation — phases B1–B2 implemented on branch `feat/rfc-0050-presetup-backend` (2026-07-03); see *Implementation notes* below
- **Implementation notes (2026-07-03):**
  - **B1:** migration `drizzle/migrations/0051_presetup_operator_role.sql` seeds `role:presetup-operator` (system role, idempotent, all tenants) via the custom `db:mig` runner; dev seed mirrored in `scripts/db/seeds/05-roles.sql`.
  - **B2:** proxy module at `/api/v1/integrations/{ingestion,thingsboard,central}` — `src/services/IntegrationsProxyService.ts` + `src/controllers/integrationsProxy.controller.ts`. Deny-by-default allowlist tables, traversal rejection, Ingestion OAuth token cache (80% lifetime, single-flight, 401→invalidate+retry-once), TB JWT via `X-Target-Authorization`, header hygiene (inbound credentials never forwarded), per-target timeouts (30s/30s/120s), structured access log without secrets, fail-fast env (no staging fallback). 50 unit tests in `tests/unit/{services,controllers}/`.
  - **Open questions resolved in code:** D1 → env flag `PRESETUP_PROXY_ENABLED` (default off; routes answer 404 when dark — swap for an RFC-0012 registry flag if rollout needs per-operator granularity). D2 → Central goes through the proxy from day one. D3 → proxy never retries and passes upstream status through; no circuit breaker in v1 (frontend sync engine owns retries).
  - **Pending:** B3 (G1 tree parity golden test, G2 throughput numbers, G3 policy decision + concurrency test), B4 joint E2E, B5 decommission gate + cutover runbook, confused-deputy scoping decision (Winston §1).
- **Authors:** Rodrigo Lago (rplago@gmail.com), MYIO Platform Team
- **Domain:** Platform / Integrations (cross-cutting)
- **Source project:** `data-ingestion-prod.git/packages/presetup-nextjs` (`@myio/presetup-nextjs@2.0.0`) — see its `docs/PRESETUP-OVERVIEW-AND-MIGRATION.md`
- **Companion RFC:** `gcdr-frontend.git/docs/RFC-0020-Presetup-Migration-Frontend.md` (UI port)
- **Related RFCs:**
  - [RFC-0033](./RFC-0033-Customer-Integration-Sync-State.md) — Customer Integration Sync State (the integrations ledger the presetup writes to)
  - [RFC-0035](./RFC-0035-Plural-MQTT-Integrations-On-Centrals.md) — Central intrinsic config + MQTT credentials
  - [RFC-0036](./RFC-0036-Device-Annotations-Migration.md) / API-Keys reveal (migration 0036) — recoverable customer API keys created during setup
  - [RFC-0037](./RFC-0037-Work-Orders-Event-Model.md) — Work Orders (the post-sync "Create OS" flow)
  - [RFC-0016](./RFC-0016-ThingsBoard-Entity-Mapping.md) — ThingsBoard entity mapping conventions
- **Stakeholders:** Platform Backend, Platform Frontend, Field Operations, IoT Integration, Security

---

## Summary

Migrate the internal **Pre-Setup** tool (customer topology builder + 4-backend cascade sync, today a standalone Next.js app in `data-ingestion-prod.git`) into the GCDR ecosystem. The UI port is specified in the companion frontend RFC-0020; **this RFC covers everything the GCDR backend must provide** so the ported UI can work without the Next.js server that exists today:

1. **Identity change** — replace the presetup's *master API key + tenant header* model with the **logged-in user's JWT**, and define the permission surface this requires.
2. **A proxy/BFF layer for the non-GCDR backends** (ThingsBoard, Ingestion, Central provisioning), because the Next.js API routes that inject secrets today disappear and Vite cannot hold server-side secrets.
3. **Contract confirmation** — the GCDR endpoints the presetup already consumes are kept as-is; a short gap list is included.

No new domain tables are introduced. The GCDR remains the **source of truth** in the cascade `GCDR → ThingsBoard → Ingestion → Central`.

---

## Motivation

The presetup is the tool that builds and provisions a customer's topology (Customer → Asset → Gateway/Central → Device) before go-live. It already treats GCDR as the source of truth, generates canonical IDs through GCDR, writes the RFC-0033 integrations ledger, and creates Work Orders (RFC-0037) after sync — yet it lives in a different repo, with a different auth model, its own deploy, and a pinned pre-release of `myio-js-library`.

Problems with the status quo:

- **Master API key in a separate app.** The presetup operates with `GCDR_MASTER_API_KEY` (full tenant access) injected by Next.js server routes. Every operator shares the same identity; audit logs and the WO/ledger `actor` cannot attribute actions to a real user.
- **Duplicated platform surface.** Login, HTTP clients, dialogs/toasts, and the WO creation flow all exist twice (presetup vs `gcdr-frontend`).
- **Operational drift.** Separate Docker image, separate env management (`NEXT_PUBLIC_*` build-time vs runtime `--env-file` pitfalls), separate release cadence.

Migrating the UI into `gcdr-frontend` removes the duplication, but the frontend alone cannot absorb the **secret-holding proxies**. That is the backend work this RFC defines.

---

## Current architecture (what disappears)

The presetup's Next.js server exists only as a secret-injecting proxy:

| Next.js route (today) | Purpose | Secrets injected |
|---|---|---|
| `/api/gcdr/[...path]` | Generic proxy to GCDR | `GCDR_MASTER_API_KEY`, `GCDR_TENANT_ID` |
| `/api/ingestion/auth` | OAuth2 client-credentials token for Ingestion | `INGESTION_CLIENT_ID/SECRET` |
| `/api/thingsboard/[...path]` | Generic proxy to ThingsBoard (forwards operator JWT) | — (base URL only) |
| Central provisioning | Called directly from the browser | — |

After migration:

- The **GCDR proxy disappears entirely** — the ported UI calls `/api/v1/...` directly with the user's JWT, like every other `gcdr-frontend` screen.
- The **Ingestion and ThingsBoard proxies must be re-homed** (Section "Proxy/BFF layer").
- Central provisioning follows the same decision.

---

## Design

### 1. Identity: master key → user JWT

All GCDR calls made by the ported presetup use the standard `gcdr-frontend` authenticated client (JWT Bearer, `req.context` populated with the real `userId`).

Consequences and required work:

- **Permission surface.** The presetup performs, in one session: customer create/update, asset CRUD, central CRUD (+ MQTT password set/delete per RFC-0035), device CRUD + move, customer API key create/list/reveal, WO enable + create + event append, and central serial check/next. Operators need a role that grants this. **Proposal:** a dedicated RBAC role key `role:presetup-operator` (assignable per tenant) documented alongside this RFC, instead of requiring `role:super-admin`. No new backend mechanism — this is configuration of the existing RBAC (RFC-0002).
- **Actor attribution improves.** The integrations ledger (RFC-0033), audit logs (RFC-0009), API-key reveal audit (migration 0036), and WO events (RFC-0037) will record the real user instead of the master-key service identity. The `actorOf` fallback for master-key/service-account callers remains for other M2M consumers but is no longer exercised by the presetup.
- **Scope narrowing.** With a user JWT, the operator may legitimately see only a subtree of customers. The presetup flows (import customer, orphan reconcile, serial uniqueness check) must behave correctly under partial visibility. `nextCentralSerial`/`checkCentralSerial` are tenant-global checks — confirm they are allowed for the presetup role (gap G3 below).

### 2. Proxy/BFF layer for ThingsBoard, Ingestion and Central

Vite env vars are build-time and public; the Ingestion OAuth client secret cannot ship to the browser. Three options were considered:

| Option | Description | Assessment |
|---|---|---|
| **A. GCDR integrations proxy module** (recommended) | New backend module `src/controllers/integrationsProxy*` exposing `/api/v1/integrations/{ingestion,thingsboard,central}/...` behind the user JWT + presetup role. Injects the Ingestion client credentials server-side; forwards the operator's TB JWT; relays Central provisioning calls. | One deploy, one auth model, per-user audit of outbound sync calls. Adds outbound coupling to GCDR, mitigated by keeping the module a *pure relay* (no domain logic, timeouts, no retries beyond the client's). |
| B. Keep the presetup Next server as a micro-BFF | The UI moves, the old `/api/*` routes stay running as a slim service. | Fastest, but keeps a second deploy and the master key alive; contradicts the goal. |
| C. New standalone BFF service | Dedicated proxy service. | Clean, but a third deployable for a thin relay is overkill at current scale. |

**Recommendation: Option A**, with these rules:

- Routes are **gated by the presetup RBAC role**; they are not general-purpose open proxies. Path allowlists per target (e.g., only the TB endpoints the sync planners use).
- The proxy adds `X-Request-Id` passthrough and logs `{userId, target, method, path, status}` for audit; bodies are not persisted.
- Ingestion token acquisition (client-credentials) happens server-side with a short in-memory cache honoring `expires_in`.
- Env vars move to the GCDR backend deployment: `INGESTION_AUTH_URL`, `INGESTION_CLIENT_ID`, `INGESTION_CLIENT_SECRET`, `THINGSBOARD_BASE_URL`, `PROVISIONING_BASE_URL`.
- Central provisioning today is called browser-direct without auth; routing it through the proxy is included for uniformity and future credential enforcement (decision point D2).

### 3. GCDR API contract — kept as-is, plus gaps

The presetup's `services/gcdr-api.ts` maps 1:1 onto existing GCDR endpoints (customers, assets, centrals incl. serial + MQTT password, devices incl. move, customer API keys incl. reveal, WO enable/create/event/users). **No breaking changes** to these endpoints are part of this RFC.

Known gaps to verify/close during implementation:

- **G1 — Enriched customer tree.** `getEnrichedCustomerTree(rootId)` must return everything the import tree-builder needs (centrals with config/frequency, devices with channel identity, API key metadata). Verify parity with `tree?deep=1`.
- **G2 — Bulk-friendliness.** The initial setup creates N assets/devices sequentially through the master key today. Under JWT + RBAC the same sequence must not trip rate limits; if it does, either raise limits for the presetup role or add a batch endpoint (out of scope unless proven necessary).
- **G3 — Serial endpoints under RBAC.** `nextCentralSerial`/`checkCentralSerial` are tenant-wide reads; confirm the presetup role can call them without full customer visibility.

### 4. Non-goals

- No changes to the sync semantics (planner → apply, idempotency, RFC-0003 channel fan-out) — that logic ports inside the frontend.
- No new GCDR domain tables or migrations.
- No changes to the alarm bundle, rules engine, or other GCDR modules.
- Decommissioning the old presetup deployment is a follow-up, not part of this RFC's deliverable.

---

## Migration plan (backend workstream)

Phases align with the frontend RFC-0020 plan; each is independently shippable.

| Phase | Deliverable | Depends on |
|---|---|---|
| B0 | **Prerequisite (shared):** stable `myio-js-library` release exposing the C-/A-/D- code generators (today pinned `0.1.521-homolog.0`). | — |
| B1 | RBAC: define + seed `role:presetup-operator`; document required policies. Verify G3. | — |
| B2 | Integrations proxy module (Option A): Ingestion auth + relay, TB relay, Central relay; env plumbing in Dokploy. | B1 |
| B3 | Contract verification: G1 tree parity, G2 throughput under JWT; fix whatever surfaces. | B1 |
| B4 | Joint E2E with the ported UI (frontend phases F4–F5): full cascade sync against staging. | B2, B3, frontend |
| B5 | Decommission plan for `myio-presetup-ed812` (freeze, redirect, remove master key). | B4 |

## Risks

- **Over-permissive proxy.** A generic relay to TB/Ingestion could become an unaudited tunnel — mitigated by role gating + path allowlists + structured logging (Section 2).
- **Permission regressions.** Flows that silently worked under the master key may 403 under JWT; B3 exists to flush these out before the UI ships.
- **Ingestion defaults.** The presetup's `lib/config.ts` defaults point to Ingestion **staging**; the proxy module must fail fast when its env vars are missing rather than fall back.

## Open questions

- **D1:** Is `role:presetup-operator` per-tenant configuration enough, or do we want a feature flag (RFC-0012) to gate the whole presetup UI as well?
- **D2:** Should Central provisioning go through the proxy from day one (recommended) or stay browser-direct until it gains credentials?
- **D3:** Who owns the TB/Ingestion outage behavior — proxy-level circuit breaker vs. leaving retries to the frontend sync engine (current behavior)?

---

*Draft for approval. No code is moved or written until this RFC and the companion frontend RFC-0020 are approved.*

---

## Agent Feedback (BMAD Party Mode roundtable — 2026-07-03)

> Independent review by BMAD agents, each spawned as a separate subagent with the full text of both RFCs. Recorded verbatim (only heading levels adjusted). Positions on open questions D1–D3 are advisory until the RFC owner resolves them. The same panel's frontend feedback lives in the companion RFC-0020.

### 🏗️ Winston — System Architect

Overall verdict up front: the shape is right — Option A is the boring, correct choice, and the phasing is disciplined. My concerns are concentrated in three places: the proxy's blast radius, the two RFCs quietly deferring the same hard problems to each other (G3 and partial-tree visibility), and a cutover plan that currently has no rollback story.

**What's sound**

- **Option A over B and C** is the right call, and for the right reasons. Option B keeps a second deployment and a master key alive — that's two standing liabilities to save one migration. Option C adds a third deployable to an ecosystem that already runs GCDR, ThingsBoard, Ingestion, and Central; a standalone BFF is a service you'd staff, monitor, and version forever to serve one internal tool. Folding the relay into GCDR is boring technology: one deploy, one auth stack, one log pipeline. Good.
- **The identity change is the real win of this RFC**, and the Summary undersells it slightly. Moving from a shared master key to per-user JWT means the integrations ledger (RFC-0033), audit logs (RFC-0009), and WO events (RFC-0037) get real actor attribution for free. That's not a nice-to-have — it's the difference between "someone provisioned 40 devices" and "Rodrigo provisioned 40 devices at 14:02." That alone justifies the migration cost.
- **Path allowlists per target + no body persistence + structured logging** in the proxy design is the correct minimal posture. A pure relay with an allowlist is auditable in a way that a "smart" proxy never is.
- **B0 as a hard gate** — pinning to `0.1.521-homolog.0` with no local fallback is a supply-chain landmine, and making a stable myio-js-library release phase zero rather than a parallel track is the right sequencing.

**What's risky or missing**

1. **The proxy is a confused-deputy machine unless scoping goes beyond path allowlists.** A path allowlist doesn't stop a legitimate presetup operator from POSTing to an *allowed* Ingestion path with a customer ID outside their subtree. The proxy holds OAuth2 client-credentials for Ingestion — that token is tenant-global. So the effective authority of any `role:presetup-operator` holder at the Ingestion boundary is the union of the allowlist, not their GCDR scope. The RFC needs a stated position: either (a) the proxy inspects and validates target-customer identifiers in proxied requests against the caller's GCDR scope, or (b) we explicitly accept that presetup-operator is a high-trust role and document that acceptance in the Risks section. Silence here is the worst option — someone will grant the role casually in two years.
2. **G3 is listed as a gap but it's actually a design decision in disguise.** `nextCentralSerial`/`checkCentralSerial` being tenant-global while the operator sees a subtree isn't a "verify it works" item — it's a policy question: *should* a subtree-scoped operator be able to enumerate serial existence tenant-wide? That's an information-disclosure trade-off (serial enumeration reveals fleet size and provisioning cadence). My recommendation: keep the check tenant-global (a serial collision across subtrees is a real integrity failure), but make the endpoint return only boolean existence, never the owning customer. Write that down in the RFC, don't leave it as G3.
3. **G2 (bulk-friendliness) has no numbers.** "Sequential asset/device creation" — how many calls in a worst-case topology import? 50? 500? If it's hundreds, JWT-per-call is fine but rate limiting and the absence of any batch endpoint will make a topology sync take minutes and fail partway with no resume semantics. The planner→apply pattern on the frontend implies idempotent re-apply is the recovery story — the RFC should *state* that GCDR create endpoints are safe to re-apply (or which ones aren't) rather than leaving it implicit. A single paragraph "Recovery model: re-run the applier; these endpoints are idempotent by natural key, these are not" would remove the biggest E2E risk in B4.
4. **The OAuth token cache is shared mutable state in a multi-instance deployment.** Fine in one process. If GCDR ever runs more than one instance, each caches independently, which is harmless (worst case: extra token grants) — but say so, so nobody "fixes" it with Redis later. Also specify behavior on 401 mid-cache: invalidate and retry once, then surface. Cheap to write now, expensive to debug in staging.
5. **B5 (decommission) has no rollback gate.** The phases run B0→B5 linearly, but nothing says what condition must hold before `myio-presetup-ed812` dies. Concrete recommendation: B5 requires N successful real provisioning runs through the new path (pick N, even N=3) plus one full cutover week with the old deployment in read-only standby. Decommissioning is the only irreversible step in this RFC — it deserves a gate, not a bullet.
6. **Timeout/error semantics for the relay are unspecified.** A pure relay to three backends with different latency profiles (Central provisioning can be slow) needs per-target timeouts and a defined error envelope (pass through target status vs. wrap in GCDR's error shape). The frontend RFC will build retry UX against whatever this is — decide it here, once.

**On the open questions**

- **D1 (feature flag in addition to role): Yes, and it's cheap.** The role answers "who may," the flag answers "is the route live in this environment." During F2–F7 you'll want the proxy module deployed to prod but dark. RFC-0012 flags already exist — use the boring mechanism you have. Remove the flag after B5; don't let it live forever.
- **D2 (Central through proxy day one): Yes, through the proxy from day one.** Browser-direct to Central means CORS configuration on Central, a second auth story, and a second thing to decommission later. The whole value of Option A is one egress point with one logging pipeline; punching a browser-direct hole in it day one undermines the design you just chose. If Central-direct has a latency argument, measure it in B4 before believing it.
- **D3 (outage behavior): frontend retries, proxy fails fast — no circuit breaker in v1.** This is a low-concurrency internal operator tool, not a high-QPS service mesh. A circuit breaker protects a fleet from cascading load; here it would mostly add a state machine that misfires during Central's normal slow provisioning. Give the proxy honest per-target timeouts and pass the target's status through with a clear error envelope; let the planner→apply UX handle retry, because the human at the keyboard has context the proxy doesn't. Revisit only if real traffic proves otherwise.

**Cross-cutting note (applies to both RFCs):** the two RFCs each reference the other's gaps (G3 ↔ subtree visibility, G1 ↔ import pickers) but neither owns the joint acceptance test. B4/F7 should be a single shared E2E checklist — same document, both teams sign it — covering: partial-visibility operator runs a full topology import, sync to all four backends, orphan reconcile, and serial check, with attribution verified in the ledger. If that checklist passes, both RFCs' hardest risks are retired at once. Cheap to write, and it turns two Drafts into one deliverable.

### 💻 Amelia — Senior Software Engineer

**Sound**

- Option A (pure relay in-process) is correct. B/C both keep a second secret perimeter alive; A collapses it to one deployment, one env surface, one audit log.
- Fail-fast on missing `INGESTION_AUTH_URL`/`THINGSBOARD_BASE_URL`/`PROVISIONING_BASE_URL` with no fallback. The lib/config.ts STAGING-default risk is real; fail-fast is the only acceptable behavior.
- B5 as an explicit decommission phase with master-key removal. Migrations that never kill the old path never finish.

**Risky / missing**

1. **No test strategy section. Blocking for a Draft→Accepted transition.** Minimum bar I will hold implementation to:
   - Allowlist unit tests, deny-by-default: positive cases per route, plus negative cases for `..` traversal, URL-encoded slashes (`%2F`, `%2E%2E`), method mismatch (allowlisted GET path called as DELETE), and query-string smuggling. Allowlist must be a data table (method + path pattern), enumerated by a test — not `if` chains scattered in a controller.
   - Token cache tests: expiry honored with safety margin (refresh at ~80% of `expires_in`), single-flight on concurrent refresh (no stampede), upstream 401 → invalidate + retry once, then surface. Fake timers, no live OAuth.
   - Role-gate tests covering all three auth forms. Known gotcha in this codebase: JWT bypasses the API-key scope gate, and `req.user.roles` carries role KEYS (`role:presetup-operator`), not scopes. A gate that only checks scopes will silently pass JWTs. Test JWT-with-role, JWT-without-role, API-key, customer-key explicitly.
2. **Proxy must never retry.** D3 aside, POST to Ingestion/Central provisioning is non-idempotent. A proxy retry = duplicate provisioning. Assert single-attempt semantics in tests.
3. **Authorization header hygiene unstated.** The relay must strip the inbound user JWT and cookies before forwarding, and inject only the cached client-credentials token. Say it in the RFC; test it.
4. **G1 has a hidden prod dependency.** Parity requires devices channel identity — migration 0029 is not applied in prod. Also `frequency` on centrals (0027) and API-key metadata semantics (reveal restrictions, pre-0036 keys non-revealable). B3 must list migration prerequisites explicitly, and G1 verification must be a golden test: seeded customer, `getEnrichedCustomerTree` output vs `tree?deep=1`, field-by-field diff in CI — not eyeballing.
5. **G2 is unquantified.** "Must not trip rate limits" is not testable. Fix N (e.g., 1 customer / 20 assets / 200 devices), write a throughput test in B3 with a pass budget. If it fails, the answer is bulk endpoints, not raising global limits.
6. **G3 needs a concurrency test, not just a permission test.** `nextCentralSerial` read → client-side use → create is a race between two operators. Uniqueness must be DB-enforced (unique constraint or sequence), with a test for concurrent allocation. The RFC only asks "can the role call it" — wrong question half-answered.
7. **B1 seeding mechanism.** Role seed must go through the custom `schema_migrations` runner (`db:mig:*`) as an idempotent migration. `npm run db:seed` is dev-only tooling here; the drizzle journal is frozen and won't carry it.
8. **403-regression risk needs teeth.** "Flows that silently worked under master key may 403" — mitigation should be a shadow/audit mode: log every would-be-403 with `{userId, path, missingPermission}` during B4 before enforcement flips on. Cheap to build inside the same middleware; turns unknown-unknowns into a grep.
9. **B0 red flag:** `0.1.521-homolog.0` pinned with no local fallback is a prod dependency on a homolog artifact. B0 must gate on a stable tag plus a failing-first test that imports all three generators.
10. Logging spec: add `requestId` and latency to `{userId, target, method, path, status}`, and a test asserting no secret (client_secret, tokens) ever hits the logger.

**Open questions**

- **D1: Yes, flag + role.** They fail differently — flag off = feature invisible (404/hidden), role missing = 403. Flag is also the B5/F7 rollback lever. One flag name, shared with frontend Q1.
- **D2: Proxy day one.** Browser-direct Central means CORS config, credentials in the browser, and a second E2E surface. No.
- **D3: Frontend retries, proxy passes through.** Keep current sync-engine retry behavior (frontend already owns partial-failure UX via StatusSync). Proxy: per-target timeout, upstream status passthrough, zero retries. Circuit breaker is premature optimization for a low-QPS internal tool.

### 📋 John — Product Manager

**Who is the customer of this RFC?** Not the operator. The operator's job — "get a customer live in the field without rework" — appears nowhere in the motivation. The motivation is identity attribution, deduplicated surface, deployment hygiene. All real, all engineering-facing. Fine. But then say so honestly: this RFC's success criteria should be *"nothing gets worse for the operator, and attribution gets better for us."* Right now the RFC has no operator-facing success criteria at all. Add them: same end-to-end setup time per customer, same or fewer sync failures, zero data loss during cutover. If you can't measure "nothing got worse," you can't detect regression until an operator screams during a go-live — the worst possible moment.

**Where does an operator go when a sync fails mid-cascade?** Today: standalone tool, presumably someone owns it. Tomorrow: a proxy relaying to three backends, role-gated, audited. Who reads those audit logs during a live incident? The RFC defines the pipe but not the support story. A pure relay that logs is not the same as a system someone can debug at 7am on go-live day. I want the RFC to name the runbook, or at minimum name that it owes one before B5.

**G2 (rate limits on bulk sequential creates) is under-specified in the direction that hurts.** The question isn't "does GCDR rate-limit the proxy" — it's "what does the *operator* see when create #47 of 200 gets throttled or fails?" Partial-tree states are the product risk here. Does the planner resume? Skip? Duplicate? The old master-key path presumably never hit this. New auth path, new failure mode, no defined UX. That's a gap in *this* RFC because the proxy is where the behavior gets decided.

**G3 is the sleeper.** "Tenant-global serial endpoints under partial customer visibility" — this is where a permission model change silently breaks a workflow. If an operator today can resolve any serial and tomorrow can only resolve serials in their subtree, that's not a contract gap, that's a *capability removal*. Decide explicitly: does `role:presetup-operator` grant tenant-wide read for these lookups? I say yes, grant it — presetup is a back-office job, not a customer-scoped one, and pretending otherwise creates ghost failures.

**B0 blocking on a stable library release with "no fallback" — why is that acceptable?** A migration whose phase 0 is "wait for someone else's release train" has an unbounded start date. Either commit to a date for the library release inside this RFC's plan, or define the fallback (vendor the pinned pre-release). "No fallback" is a decision to let the schedule slip silently. Pick.

**B5 decommission listed as both a phase and a follow-up non-goal.** Which is it? If the old deployment lives on "temporarily," the master key lives on with it — and the RFC's core motivation (kill the shared identity) isn't achieved until it's dead. Decommission with a date and a key-revocation step is the *proof* the RFC succeeded. Don't let it drift into backlog.

**Rollback: absent.** If the proxy misbehaves in week one, what happens? The old app still exists until B5 — good, that *is* your rollback, but nobody wrote it down. State it: "until B5, the old deployment is the rollback path; after B5, rollback means X." One paragraph. Write it.

**On the open questions:**

- **D1 (feature flag + role):** Yes, but keep it cheap. The role gate is the security boundary; the flag is the operational kill-switch. Those are different jobs and you want both during cutover. Rip the flag out after B5 — a permanent flag on a permanent feature is debt.
- **D2 (Central through proxy from day one):** Yes, day one. Browser-direct means the browser holds or reaches a credential the whole RFC exists to centralize. Shipping the migration with one backend still going around the proxy re-creates the exact problem in miniature, and "we'll route it later" never happens. If Central-direct has a latency or LAN-reachability reason, that reason belongs *in the RFC*, not in a hallway.
- **D3 (outage behavior):** Circuit breaker in the proxy, honest errors to the frontend, and the *planner* owns retry — because the planner knows sync semantics (what's idempotent, what's already applied) and the proxy, by its own non-goals, does not. A proxy that retries blindly against a sequential-create cascade is how you get duplicate devices. Proxy: fail fast, say why. Frontend: resume where it stopped.

**Cross-cutting verdict (applies to both RFCs):** both RFCs are strongest on mechanism and weakest on the cutover *week itself* — comms, checklist, rollback, who's on point when the first real go-live runs through the new path. The code plan is credible. The operational plan is a to-do. Write the cutover runbook as a named deliverable in one of the two RFCs (I'd put it in RFC-0050, B4/B5), or it won't exist when you need it.

### 🎨 Sally — UX Designer

Let me set the scene before I critique it. It's 7:40 AM, a go-live day. An operator — call her Ana — has spent three days building a 400-node tree for a shopping mall: floors, meters, gateways, serials generated, labels printed. Today she syncs to four backends and hands OSs to two field techs who are already driving to the site. Every design decision in these RFCs either protects that morning or breaks it. That's my lens.

**The identity change is the right call, but the RFC treats partial visibility as a data-contract problem when it's actually a trust problem.** Under the master key, Ana's mental model was "what I see is everything that exists." Under JWT, that contract silently breaks. The most dangerous moment isn't a 403 — it's a *false negative*: the import picker doesn't show a customer, so Ana concludes it doesn't exist and creates a duplicate. G3 (serial uniqueness) has the same shape inverted: the uniqueness check is tenant-global, so Ana can get "serial already in use" for a central she *cannot see*. If the API returns a bare conflict, she'll think the tool is broken. **Design requirement I want stated in the RFC:** conflict and existence-check endpoints must return a machine-readable "exists but outside your visibility" discriminator (not the entity itself — just the fact), so the frontend can say *"This serial belongs to a customer you don't have access to. Contact an admin."* instead of a dead-end error. Same for orphan reconciliation: an orphan whose true parent is invisible to the operator must be labeled "parent exists, not visible to you," never silently offered for re-parenting — that's how you get devices stolen across subtrees by a well-meaning operator.

**G2 (rate limits) has a UX face the RFC ignores.** Bulk create of 400 nodes hitting a rate limit mid-cascade means a *partially created tree*. The backend must either support idempotent retries (client-supplied idempotency keys per node) or batch semantics with a resumable cursor. If the answer is "the frontend retries," say so explicitly and guarantee 429s carry `Retry-After` — the sync engine's per-item status display depends on it.

**On the open questions:**

- **D1 (feature flag + role):** Yes, both. The role answers "who may ever use this"; the flag answers "is it this operator's turn during rollout." During cutover you'll want to enable per-pilot-operator without minting/revoking roles, and to kill-switch instantly if the proxy misbehaves on go-live morning. Cheap insurance.
- **D2 (Central proxy day one):** Yes — but only if D3 is answered honestly first. Don't proxy Central provisioning day one if the proxy can't yet surface per-item progress; a worse experience behind better architecture is a regression Ana will feel immediately.
- **D3 — this is my strongest opinion on the backend RFC: keep retry ownership in the frontend.** Today the sync engine shows per-item status and Ana narrates progress to the field tech on the phone: "gateway 3 failed, retrying... ok, it's in." A proxy circuit breaker that opens mid-cascade turns that narrated, per-item story into a monolithic "sync failed" wall. The proxy should be a *transparent pipe with honest errors*: pass through upstream status per request, add timeout metadata, and let the frontend keep orchestrating retries and rendering per-item state. If you add a circuit breaker for backend protection (fine), it must fail with a distinct, per-item error the UI can render as "Central backend unavailable — 12 items pending, retry when green," ideally with a proxy health endpoint the UI can poll to show *when* it's worth retrying. Never let infrastructure resilience patterns erase the operator's situational awareness.

### Orchestrator note — scoreboard on the open questions

| Question | Winston | Amelia | John | Sally | Reading |
|---|---|---|---|---|---|
| **D1** flag + role | Yes, temporary | Yes, shared name with Q1 | Yes, kill-switch, remove after B5 | Yes, per-pilot rollout | **Unanimous yes** — one flag across both repos, deleted after B5/F7 |
| **D2** Central via proxy day one | Yes | Yes | Yes | Yes, conditional on D3 per-item errors | **Unanimous yes** |
| **D3** outage behavior | Frontend retries; no breaker in v1 | Frontend retries; proxy **zero retries** | Breaker in proxy + planner owns retry | Frontend owns retry; breaker only with per-item errors + health endpoint | **Consensus:** frontend/planner owns retry, proxy never retries and passes upstream status through with per-target timeouts. **Divergence:** John wants a circuit breaker v1; Winston/Amelia say premature; Sally accepts one only if it fails per-item. |

Recurring demands across agents worth folding into the next revision: (1) confused-deputy scoping of the proxy vs. declared high-trust role (Winston §1); (2) a test-strategy section incl. allowlist/token-cache/role-gate tests and shadow-403 mode (Amelia §1, §8); (3) quantified G2 + declared idempotency/recovery model (Winston §3, Amelia §5, John, Sally); (4) G3 resolved as a policy decision — tenant-global boolean check with "exists outside your visibility" discriminator (Winston §2, John, Sally); (5) rollback statement + gated B5 with cutover runbook (Winston §5, John); (6) migration prerequisites for G1 (0027/0029) made explicit (Amelia §4).
