# RFC-0060: Dashboard Performance and Production Hardening

- Feature Name: `dashboard_performance_and_production_hardening`
- Start Date: 2026-08-24
- RFC PR: (leave this empty until a PR is opened)
- Tracking Issue: (leave this empty until an issue is opened)
- Status: **DRAFT**
- Authors: MYIO Engineering (diagnosed live via Chrome DevTools + production container logs)
- Related RFCs: RFC-0009 (Events & Audit Logs), RFC-0021 (HTML Templates Engine), RFC-0015 (Alarm Bundle Version History)

# Summary
[summary]: #summary

A production debugging session (2026-08-21 container logs + 2026-08-24 live browser inspection
of `https://gcdr-web.a.myio-bas.com`) surfaced one critical performance defect and a cluster of
error-handling / operational defects in the GCDR API. This RFC specifies the full remediation
demand:

1. **`GET /api/v1/dashboard` takes ~119 seconds** to respond in production. The frontend home
   page renders before the response arrives, showing **0 devices / 0 rules** to every user.
   Root cause: 12 unbounded aggregation queries over an `audit_logs` table receiving
   **~268k rows/day** (7.4M rows in the last 30 days).
2. **Audit log flooding**: the rules engine writes a `RULE_TRIGGERED` audit row per execution
   (`SYSTEM_EVENT`/`EXECUTE`), ~3 rows/second, with no retention policy. This is 99.9% of the
   table volume and grows unboundedly.
3. **Unhandled `ZodError` (HTTP 500) on the templates API**: a machine consumer calls
   `/api/v1/templates/*` with slug-style types (`email/alarm.opened`, `email/alarm.closed`)
   that the `TemplateType` enum rejects; the raw `ZodError` escapes as an uncaught exception
   and a stack trace in the container log instead of a clean 400.
4. **Recurring 401s from misconfigured M2M consumers**: an API key retrying
   `GET /customers/:id/goals` every few minutes without the `goals:read` scope, and a
   central/Node-RED instance polling `/alarm-rules/bundle/simple` with no credentials at all.
   These are operational issues, but the API can help surface them instead of silently
   filling logs.

This RFC proposes: splitting and caching the dashboard summary, pre-aggregating audit
statistics, redirecting high-frequency `RULE_TRIGGERED` events out of `audit_logs` with a
retention policy, normalizing template-type aliases (or failing them cleanly with 400),
guaranteeing that every Zod parse failure maps to a structured 400, and adding a lightweight
"noisy client" report so misconfigured M2M consumers become visible.

# Motivation
[motivation]: #motivation

## Evidence, captured live

**Dashboard latency (Chrome DevTools, 2026-08-24).** After a page reload,
`GET https://gcdr-api.a.myio-bas.com/api/v1/dashboard` stayed `pending` while all sibling
requests (`/auth/me`, `/customers`, `/assets`, `/partners`, `/users`, `/wiki/pages`) returned
200 in well under a second. A timed in-page `fetch` of the same endpoint completed with
**HTTP 200 in 119,458 ms**. The payload itself explains the cost:

```json
"audit": {
  "last24h":  { "total": 268273,  "byCategory": { "SYSTEM_EVENT": 268272, "AUTH": 1 } },
  "last72h":  { "total": 830115,  "byCategory": { "SYSTEM_EVENT": 830087 } },
  "lastWeek": { "total": 1984767, "byCategory": { "SYSTEM_EVENT": 1983632 } },
  "lastMonth":{ "total": 7394958, "byCategory": { "SYSTEM_EVENT": 7390539 },
                "byAction": { "EXECUTE": 7390682 } }
}
```

The user-facing consequence: the home dashboard renders long before the response and shows
**"Total de Dispositivos: 0"** and **"Total de Regras: 0"**, while the eventual response
carries the real numbers (3,871 devices, 172 enabled rules, 81 triggered in 24h). The
product's landing page is factually wrong for every user, every day.

**Where the queries come from.** `DashboardService.getSummary()`
(`src/services/DashboardService.ts:47-56`) calls
`auditLogRepository.getAuditPeriodSummary()` once per window (24h, 72h, 1 week, 1 month).
Each call (`src/repositories/AuditLogRepository.ts:198-230`) issues **three** aggregate
queries — `COUNT(*)`, `GROUP BY event_category`, `GROUP BY action` — over the raw table.
That is 12 aggregations per dashboard hit, the widest of which scans a 30-day window of
~7.4M rows. The `audit_logs_tenant_created_idx (tenant_id, created_at)` index exists
(`src/infrastructure/database/drizzle/schema.ts:1231`), but an index range scan over
millions of rows followed by grouping is still O(rows-in-window); no index makes this shape
fast. Every page load by every user repeats the full work — there is no cache.

**Where the rows come from.** `EventType.RULE_TRIGGERED` (`src/shared/types/audit.types.ts:54`)
is categorized by inference in `src/shared/config/audit.config.ts`: the `_TRIGGERED` suffix maps
to `EventCategory.SYSTEM_EVENT` (line 95-97) and, matching no CRUD suffix, to
`ActionType.EXECUTE` (line 126). With 172 enabled rules evaluated continuously, this writes
~3 audit rows per second — matching exactly the `SYSTEM_EVENT`/`EXECUTE` signature that
dominates every window above. `audit_logs` has **no retention policy**; at the current rate it
grows by ~90M rows/year, degrading not just the dashboard but every audit query and the
storage bill.

**Unhandled ZodError (container log, 2026-08-21).** Repeating every ~3 minutes:

```
Error: ZodError: [{ "received": "email/alarm.closed", "code": "invalid_enum_value",
  "options": ["EMAIL_ALARM", ..., "TELEGRAM_DAILY_SUMMARY_MULTI"], "path": ["type"] }]
    at ZodObject.parse (/app/node_modules/zod/v3/types.cjs:120:22)
    at /app/dist/controllers/templates.controller.js:81:61
```

A machine consumer (almost certainly the alarm orchestrator / email sender) sends
event-style slugs — `email/alarm.opened`, `email/alarm.closed` — where GCDR expects
`TemplateType` enum values (`EMAIL_ALARM`, `TELEGRAM_ALARM_OPENED`, …). Two defects
compound here:

- **Contract drift**: the consumer and GCDR disagree on the type vocabulary, so alarm
  emails presumably fail to render at all.
- **Error hygiene**: the `ZodError` reaches the log as a raw stack trace. Zod parse
  failures inside controller `try` blocks are forwarded via `next(err)`, but the global
  error handler does not translate `ZodError` into a structured 400 — it surfaces as an
  unhandled 500 with a full stack dump, which pollutes logs and hides the real signal.

**Misconfigured M2M consumers (container log, 2026-08-21).** Two steady 401 streams:

- `GET /customers/:id/goals` from `200.18.164.201` — API key lacking scope `goals:read`,
  retrying several times per minute against two customer IDs.
- `GET /customers/:id/alarm-rules/bundle/simple` from `181.77.154.234` — no token or API
  key at all, retrying every ~5 minutes (a central or Node-RED flow with empty credentials).

Neither is a code bug per se, but today the only way to notice them is to read raw
container logs. Alarms for those customers are silently not being delivered/configured.

## Why act now

- The landing page of the product displays wrong data for all users — a trust problem.
- The 119s request holds a DB connection and compute for two minutes per page load; a
  handful of concurrent visitors can saturate the pool and degrade unrelated endpoints.
- `audit_logs` growth is unbounded; every month of delay adds ~7.5M rows to migrate later.
- The template contract drift means a production notification pathway (alarm emails) is
  broken and only visible as log noise.

# Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

After this RFC, the system behaves as follows:

## Dashboard

The home dashboard loads in under a second. The summary endpoint is split:

- `GET /api/v1/dashboard` returns rules + devices + alerts — the cheap, always-fresh
  blocks. Target p95 < 500 ms.
- `GET /api/v1/dashboard/audit` returns the audit activity block, served from a
  pre-aggregated store and cached. Target p95 < 300 ms.

The frontend renders each card as its data arrives (skeleton placeholders instead of
zeros). A stat card never displays `0` because a request is still in flight — `0` means
the server said zero.

Audit counts are allowed to be slightly stale (up to 5 minutes). The dashboard is an
overview, not a forensic tool; the audit log list view remains exact.

## Audit pipeline

`RULE_TRIGGERED` executions no longer land in `audit_logs`. They are recorded as
aggregate counters (per tenant, per rule, per hour) in a small rollup table that the
dashboard and rule statistics read. `audit_logs` returns to its RFC-0009 purpose —
*who changed what* — and gets a retention policy (default 180 days, configurable per
deployment) enforced by a scheduled job.

## Templates API

A consumer sending `type=email/alarm.opened` gets one of two behaviors, chosen at
implementation time (see [Unresolved questions]):

- **Alias mapping (preferred)**: a published alias table normalizes slug-style types to
  canonical `TemplateType` values (`email/alarm.opened` → `EMAIL_ALARM`, or the specific
  telegram types where unambiguous) before validation. Existing consumers keep working.
- **Clean rejection**: the request fails with a structured `400 VALIDATION_ERROR` naming
  the received value and the accepted values.

In both cases, **no Zod stack trace ever reaches the container log**. Any `ZodError`
that escapes a controller is translated by the global error handler into the standard
error envelope with `code: VALIDATION_ERROR`, HTTP 400, and a one-line log entry.

## Noisy-client visibility

Repeated authentication/authorization failures from the same key or IP are aggregated
and surfaced on the (admin) dashboard alerts block — e.g. *"API key `gcdr_pk_…abc` was
denied `goals:read` 214× in the last 24h"* — so a misconfigured integration is a visible
alert instead of buried log lines.

# Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

## 1. Dashboard endpoint split + cache

### 1.1 Endpoint changes

- `GET /api/v1/dashboard` (`src/controllers/dashboard.controller.ts`) keeps its response
  shape **minus** the `audit` block. Existing consumers of `rules`/`devices` fields are
  unaffected; the `audit` key is removed (breaking only for the GCDR frontend, updated in
  the same release — see frontend work below).
- New `GET /api/v1/dashboard/audit` returns exactly the previous `audit` block:

```json
{
  "last24h":  { "total": 0, "byCategory": {}, "byAction": {} },
  "last72h":  { "..." : "..." },
  "lastWeek": { "..." : "..." },
  "lastMonth":{ "..." : "..." },
  "staleAsOf": "2026-08-24T18:55:00.000Z"
}
```

`staleAsOf` is new and mandatory: the timestamp of the underlying aggregate snapshot.

### 1.2 Caching

`DashboardService` gains an in-process TTL cache keyed by `tenantId`:

- audit block: TTL 300 s
- rules/devices block: TTL 30 s (cheap but hit on every page load)

Single-process deployment (current Dokploy setup) makes in-memory caching sufficient; the
cache interface must be a small injectable so a Redis-backed implementation can be swapped
in if the API is ever scaled horizontally. A `?fresh=true` query flag (super-admin only)
bypasses the cache for debugging.

### 1.3 Query shape

Even served from rollups (below), `getAuditPeriodSummary` collapses from 12 queries to a
single `SELECT ... GROUP BY` over the rollup table per request, computing all four windows
with conditional aggregation (`COUNT(*) FILTER (WHERE bucket >= now() - interval '24 hours')`, …).

## 2. Audit rollups and event redirection

### 2.1 New table `audit_stats_hourly`

```sql
CREATE TABLE audit_stats_hourly (
  tenant_id      uuid        NOT NULL,
  bucket         timestamptz NOT NULL,          -- truncated to the hour
  event_category varchar(50) NOT NULL,
  action         varchar(20) NOT NULL,
  count          bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, bucket, event_category, action)
);
```

Population strategy: **write-through**. `AuditLogRepository.create()` (and the bulk insert
path, if any) performs an `INSERT ... ON CONFLICT (tenant_id, bucket, event_category, action)
DO UPDATE SET count = audit_stats_hourly.count + 1` alongside each audit write. A one-off
backfill script populates history from the existing `audit_logs` rows. This keeps rollups
exact and avoids a scheduler dependency for correctness; the retention job (2.3) is the
only cron.

The dashboard audit block reads **only** this table: a month of data is at most
`24×31 × categories × actions` rows per tenant — thousands, not millions.

### 2.2 `RULE_TRIGGERED` leaves `audit_logs`

- The audit writer (`logEvent` middleware / `AuditService`) short-circuits
  `EventType.RULE_TRIGGERED`: it increments a new `rule_execution_stats_hourly` rollup
  (`tenant_id, rule_id, bucket, count, last_triggered_at`) and **does not** insert into
  `audit_logs`.
- `ruleService.getStatistics().recentlyTriggered` switches to this table.
- If per-execution detail is ever needed (it is today only implied, never queried), it
  belongs to the alarm-orchestrator's own storage, not GCDR's audit trail. The rollup
  keeps `last_triggered_at` per rule so the UI can still show "last fired at …".
- The `SYSTEM_EVENT` category remains valid for other inferred events; this RFC removes
  only the one flooding writer.

### 2.3 Retention

- New scheduled job (same in-process scheduler used by the simulator subsystem) deleting
  `audit_logs` rows older than `AUDIT_RETENTION_DAYS` (env, default `180`), batched
  (`DELETE ... WHERE id IN (SELECT ... LIMIT 10000)`) to avoid long locks, run nightly.
- `audit_stats_hourly` is kept 24 months (it is tiny) so year-over-year charts remain
  possible.
- Migration note: the initial cleanup of the existing ~90M-row backlog must run as a
  supervised script (`scripts/db/ops/`), not inside a Drizzle migration — per the
  project's custom migration-runner governance, long-running data deletes do not belong
  in the schema migration chain.

## 3. Templates: alias normalization + ZodError hygiene

### 3.1 Alias table

`src/domain/entities/Template.ts` (or a sibling module) exports:

```ts
export const TEMPLATE_TYPE_ALIASES: Record<string, TemplateType> = {
  'email/alarm.opened':  'EMAIL_ALARM',
  'email/alarm.closed':  'EMAIL_ALARM',
  // extend as consumer vocabularies are confirmed
};

export function normalizeTemplateType(input: string): TemplateType | undefined {
  return (TemplateType includes input) ? input : TEMPLATE_TYPE_ALIASES[input];
}
```

DTO schemas that accept `type` (`RenderTemplateQuerySchema`, `RenderTemplateBodySchema`,
`ListTemplatesQuerySchema`, …) apply `z.preprocess(normalize, TemplateTypeEnum)` so aliases
are resolved *before* enum validation. Response payloads and stored rows always carry the
canonical enum value. The alias list ships in `docs/` (templates engine doc) as part of the
public M2M contract.

Open question 1 below covers whether `alarm.opened`/`alarm.closed` should map to distinct
template types instead of both collapsing to `EMAIL_ALARM`; the answer requires confirming
what the email sender expects to render for each event.

### 3.2 Global ZodError mapping

`src/middleware/errorHandler.ts` gains, before the generic 500 fallback:

```ts
if (err instanceof ZodError) {
  return sendError(res, 400, 'VALIDATION_ERROR', formatZodIssues(err), requestId);
}
```

with `formatZodIssues` producing `path`, `message`, and (for enum failures) the accepted
values — the same envelope `ValidationError` already produces. Log output for this class
is a single structured line (no stack). This is defense in depth: controllers keep their
`try/catch → next(err)` idiom, and any future `.parse()` added without a wrapper is still
safe.

A regression test posts `type=email/alarm.closed` to `/templates/render` and asserts
HTTP 400 (or 200 under alias mapping) and *zero* uncaught-exception log output.

## 4. Auth-failure visibility

Minimal, log-derived approach (no new hot-path writes):

- The 401/403 handler already logs one structured line per denial. Add a per-process
  in-memory counter keyed by `(apiKeyPrefix | ip, endpoint, reason)`, flushed to
  `audit_stats_hourly` under `event_category = 'AUTH'`, `action = 'DENY'` hourly.
- The dashboard alerts block surfaces any key/IP exceeding a threshold (default: 50
  denials/24h) as an actionable alert with the denial reason (`missing scope goals:read`,
  `no credentials`), so cases like the two observed streams become visible in the UI.
- Resolution of the two live incidents themselves is operational, tracked alongside this
  RFC: grant `goals:read` to the consumer key if legitimate, and identify/fix the
  credential-less central hitting `/alarm-rules/bundle/simple`.

## 5. Frontend (gcdr-frontend)

- Dashboard page calls the split endpoints independently; each card owns its loading
  state and renders a skeleton until its data arrives. **No card ever renders a literal
  `0` from an unresolved request.**
- The audit card displays the `staleAsOf` timestamp ("updated 3 min ago").
- Error state per card (retry affordance) instead of silent zeros on failure.

## 6. Rollout order

1. ZodError handler + alias mapping (no schema changes; immediately stops the 500s and
   likely repairs alarm-email rendering).
2. `audit_stats_hourly` + write-through + backfill; dashboard reads switch to it.
3. Endpoint split + cache + frontend skeletons (one coordinated release, back + front).
4. `RULE_TRIGGERED` redirection to `rule_execution_stats_hourly`.
5. Retention job + supervised backlog cleanup.
6. Auth-denial counters + dashboard alert.

Steps 1–3 remove the user-visible defect; 4–5 remove the cause; 6 is hardening.

# Drawbacks
[drawbacks]: #drawbacks

- **Staleness**: dashboard audit numbers can lag up to 5 minutes. Mitigated by
  `staleAsOf` and the exact list view.
- **Write amplification**: write-through rollups add one upsert per audit write. At
  post-redirection volumes (tens of writes/minute rather than 3/second) this is noise;
  at current volumes it would be significant — hence redirection (step 4) should land
  close behind step 2.
- **History loss**: redirecting `RULE_TRIGGERED` drops per-execution audit rows. Nothing
  in GCDR queries them individually today, and the orchestrator owns execution history,
  but this is a real reduction in raw data retained.
- **Contract change**: removing `audit` from `GET /dashboard` breaks any unknown consumer
  of that block. A release-note grace period with both (block present but served from
  rollups) is possible if needed.
- **Alias table maintenance**: a second vocabulary to keep in sync with consumers.
  The alternative (forcing consumers to migrate) pushes the cost onto systems we may not
  control the deploy cadence of.

# Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Why not "just add an index"?** The right index already exists
  (`audit_logs_tenant_created_idx`). The cost is grouping millions of matched rows, which
  no index eliminates. Pre-aggregation changes the asymptotic shape; indexing does not.
- **Why not only cache the slow endpoint?** A 5-minute TTL cache alone would fix p95 for
  warm hits but leave a 2-minute cold-start hit per TTL window per tenant, still hold
  connections, and do nothing about unbounded table growth. Caching is included, but as
  the second line, not the fix.
- **Why write-through rollups instead of a cron aggregator?** A cron that scans the raw
  table every N minutes re-pays the expensive scan forever and adds a failure mode
  (staleness on missed runs). Write-through is exact, O(1) per event, and has no
  scheduler dependency; the only cron in this design (retention) is correctness-neutral.
- **Why not PostgreSQL materialized views?** `REFRESH MATERIALIZED VIEW` re-runs the full
  aggregation (the 119s problem, on a timer) and takes locks; incremental refresh isn't
  available in stock PG16.
- **Why not TimescaleDB / continuous aggregates?** Correct long-term shape for
  time-series counters, but an infrastructure dependency (extension install on the prod
  Dokploy Postgres) disproportionate to two small rollup tables.
- **Why redirect `RULE_TRIGGERED` instead of `AUDIT_LEVEL` filtering?** The event-level
  machinery (`shouldLogEvent`) could drop these writes today by setting a `DEBUG` level —
  a one-line mitigation — but it destroys the signal entirely (no counters, no
  `last_triggered_at`) and leaves the category semantics muddled. The rollup keeps the
  operationally useful part at ~1/1000th of the storage.
- **Why alias mapping over rejecting slugs?** The sender appears to be a production
  notification pathway that has been failing silently; making it work is strictly better
  than making it fail more politely. Rejection remains the fallback if mapping proves
  ambiguous (see unresolved question 1).

# Prior art
[prior-art]: #prior-art

- **RFC-0009 (Events & Audit Logs)** defined the audit schema, levels, and inference
  rules this RFC adjusts; the payload-limit and level machinery
  (`src/shared/config/audit.config.ts`) is reused as-is.
- **RFC-0015 (Alarm Bundle Version History)** established the project's pattern of
  serving hot read paths from precomputed snapshots (`X-Version-Id` → 304) rather than
  recomputing per request — the same principle applied here to dashboard aggregates.
- Industry practice: high-cardinality event streams are near-universally served to
  dashboards from pre-aggregated rollups (StatsD/Prometheus counters, OLAP cubes);
  raw-scanning an OLTP audit table for dashboard tiles is a recognized anti-pattern.
- Express + Zod ecosystems conventionally map `ZodError` → 400 in the terminal error
  middleware; the codebase already has the `ValidationError` envelope to express this.

# Unresolved questions
[unresolved-questions]: #unresolved-questions

1. **Alias targets**: should `email/alarm.opened` / `email/alarm.closed` both map to
   `EMAIL_ALARM`, or does the email sender expect distinct opened/closed templates
   (mirroring the `TELEGRAM_ALARM_OPENED`/`TELEGRAM_ALARM_CLOSED` split)? Requires
   confirming the sender's rendering contract before step 1 ships. If distinct types are
   needed, `EMAIL_ALARM_OPENED`/`EMAIL_ALARM_CLOSED` must be added to `TemplateType`,
   the enum, and the tag catalog.
2. **Who is the slug sender?** Presumed alarm-orchestrator/EMAIL_SENDER; must be
   confirmed (source IP correlation) so its vocabulary can be frozen into the alias doc.
3. **Retention default**: 180 days is proposed; compliance requirements per customer
   (LGPD data-retention commitments, enterprise contracts) may dictate another value or
   per-tenant configuration.
4. **`GET /dashboard` compatibility window**: drop the `audit` block immediately (only
   known consumer is the GCDR frontend, released in lockstep) or keep it one release
   served from rollups?
5. **Prod schema drift**: given the project's migration-governance history (journal
   frozen at 0012, custom runner), verify the audit indexes assumed present in the
   Drizzle schema actually exist in the production database before assuming rollup
   backfill performance.

# Future possibilities
[future-possibilities]: #future-possibilities

- **Device health tracking**: `DashboardService` currently returns mock health data with
  an inline `_note` recommending a `healthStatus` column written by the
  alarm-orchestrator — the natural next dashboard workstream once this RFC lands.
- **Partitioning `audit_logs` by month** would make retention a `DROP PARTITION` instead
  of batched deletes, worthwhile if per-tenant retention windows diverge.
- **Redis-backed dashboard cache** if the API scales beyond one process.
- **Generalizing the rollup pattern** to other hot aggregates (device connectivity
  history, WO/incident counts) as more dashboard tiles appear.
- **Rate-limiting or temporary lockout of persistently failing API keys**, building on
  the denial counters, to stop misconfigured integrations from consuming request budget.
