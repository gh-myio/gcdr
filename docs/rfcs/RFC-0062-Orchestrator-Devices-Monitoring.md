# RFC-0062 — Orchestrator-Devices: Centrals, Devices & Work-Order Monitoring Service

- **Feature Name:** `orchestrator_devices`
- **Start Date:** 2026-08-31
- **RFC PR:** _(this PR)_
- **Tracking Issue:** _TBD_
- **Authors:** GCDR Core Team
- **Status:** Draft
- **Domain:** Centrals / Devices / Work Orders / Operational monitoring
- **Deployment target:** a dedicated **Dokploy container** (a headless worker, not the API), sharing the GCDR image and database
- **Related:** RFC-0009 (Events & Audit Logs), RFC-0055 (No-Consumption Incidents), RFC-0023 (Device Identity — connectivity ownership), gcdr PR #19 (Central topology / connectivity reconcile), the **Alarm Orchestrator** service (`gh-myio/alarms-backend` — the orchestrator/dispatcher/verify worker pattern this RFC mirrors).

---

## Summary

Introduce **`orchestrator-devices`**, a headless GCDR **worker service** — deployed as its own Dokploy container from the GCDR image — that continuously **listens to and monitors the operational state of centrals, devices, and work orders (OS)**, and reconciles that state into GCDR **off the request path**. It is the operational counterpart to the master-data API: the API records *who exists*; this service tracks *what is currently happening to it* (online/offline, healthy/degraded, on-time/overdue) and writes it back as first-class state, emitting incidents/events and audit as it goes.

It follows the proven shape of the **Alarm Orchestrator** (`orchestrator` / `dispatcher` / `verify` workers, one image, per-role container, Redis/BullMQ queues): here the roles are **centrals-monitor**, **devices-monitor**, and **os-monitor**.

It also ships a **low-level admin cockpit served by the GCDR backend itself** — a `/admin/orchestrator-devices` HTML console in the same family as `/admin/simulator`, `/admin/monitor` and `/admin/db` — so an operator can watch the checks run, tail the monitor's logs, see per-scan/per-entity outcomes, and pause/kick a monitor, without shelling into the container.

## Motivation

Three concrete, live gaps show GCDR has no operational-monitoring plane today:

- **M1 — Device connectivity is almost entirely `UNKNOWN`.** The dashboard reports **1771 of 1788 devices as "Desconhecido"** because `devices.connectivity_status` is never populated for most devices — only ~17 are marked `ONLINE`. There is no service that derives connectivity from the central cloud-server link and telemetry freshness and writes it back.
- **M2 — Device health status is a mock.** `DashboardService` returns `health: { healthy:0, degraded:0, critical:0, unknown: total }` with an inline note: *"mock data — device health not yet tracked; add a `healthStatus` column written by a periodic health-check service."* No such service exists.
- **M3 — Reconcile is smuggled onto a read.** PR #19's `CentralTopologyService.getTopology` reconciles `central.connection_status` and each device's `connectivity_status` **as a side effect of a `GET`** — which breaks GET idempotency and makes the global counts depend on someone opening a central's topology page. The reviewer explicitly asked for that reconcile to move to a scheduled reconciler off the read path. **This service is that home.**
- **M4 — Work orders have no SLA watchdog.** OS lifecycle carries SLA/escalation semantics (RFC rules), but nothing periodically scans open OSs for **overdue / SLA-breached / stale** states to flag or escalate them; today it only reacts to user actions.

GCDR already owns the master data (`centrals`, `devices`, `wo_*`) and the DB; what it lacks is a **continuously-running, off-request-path** process that observes reality and reconciles it. Standing that up as a separate deployable — exactly as the Alarm Orchestrator did — keeps the hot API path clean and lets the monitor scale and restart independently.

## Guide-level explanation

`orchestrator-devices` is **one process with three monitors**, each a scheduled (and, where a signal exists, event-driven) loop. It holds no user session; it authenticates to external sources with a service credential and writes to the GCDR DB directly.

```
        ┌──────────────────────── orchestrator-devices (Dokploy container) ─────────────────────────┐
        │                                                                                           │
 cloud-server ──link/status──▶  centrals-monitor  ──▶ centrals.connection_status (ONLINE/OFFLINE)   │
 heartbeats  ──────────────▶                                                                        │
                                                                                                    │
 cloud-server device-status ─▶  devices-monitor   ──▶ devices.connectivity_status (fix M1)          │
 telemetry freshness ───────▶                     ──▶ devices.healthStatus       (fix M2)           │
                                                                                                    │
 wo_* SLA timers ───────────▶  os-monitor         ──▶ overdue / breach flags, escalation events     │
        │                                                                                           │
        └───────────── emits: incidents/events · RFC-0009 audit · (optional) alarm-orchestrator feed┘
```

- **Deploys like the Alarm Orchestrator.** Same GCDR image; the container's `command` selects the worker entrypoint (`node dist/workers/orchestrator-devices.js`); a `.env.dokploy.orchestrator-devices` sets its role, intervals, thresholds and the shared `DATABASE_URL`. It does **not** serve HTTP (beyond a `/healthz` liveness probe).
- **Off the request path.** Nothing in the API mutates connectivity/health anymore; the API only reads. PR #19's `GET` reconcile is removed and its logic moves here (M3).
- **Single writer.** This service becomes the **one** writer of `connection_status` / `connectivity_status` / `healthStatus`, resolving the "two writers" ambiguity flagged in RFC-0023 (energy-ingestion vs GCDR) and PR #19.

For an operator: the dashboard's "Saúde dos Dispositivos" stops reading "1% online / 1771 desconhecido" and starts reflecting reality, updated every scan interval — without anyone opening a page.

## Reference-level explanation

### 1. Deployment & runtime shape (mirrors the alarm-orchestrator)

- **New worker entrypoint** `src/workers/orchestrator-devices.worker.ts`, built into `dist/workers/`. `package.json` gains `worker:orchestrator-devices`.
- **Dokploy container**: same image as the GCDR API, `command: ["node","dist/workers/orchestrator-devices.js"]`, own `.env.dokploy.orchestrator-devices`, shares the GCDR Postgres. Added to `docker-compose.dokploy.yml` as a sibling of the API (like `orchestrator-worker`/`dispatcher-worker` there).
- **Leader lock (HA-safe):** each monitor scan acquires a **Postgres advisory lock** (`pg_try_advisory_lock`) keyed per monitor, so running >1 replica never double-scans. No new infra required.
- **Queue (optional, phase 2):** for event-driven work and retries, reuse the alarm stack's **Redis/BullMQ** with a DLQ; the MVP is a timer loop + advisory lock and needs no Redis.
- **Liveness:** a minimal `/healthz` endpoint (or a heartbeat row) so Dokploy can health-check the worker.
- **Graceful shutdown & backpressure:** bounded per-scan batch size; a scan never overlaps its own previous run.

### 2. Monitor A — `centrals-monitor` (per-gateway liveness probe)

- **Probe:** each gateway is reachable at its **own per-gateway tunnel host** — the central's hardware UUID is the subdomain — so the monitor issues a bounded-timeout `GET` to:

  ```
  GET https://{central.id}.y.myio.com.br/v2/slaves
  e.g. https://295628b1-75c6-4854-8031-107cd9a2ab91.y.myio.com.br/v2/slaves
  ```

  A **2xx response ⇒ the central is `ONLINE`** (its API is up and can enumerate its slaves). A timeout, DNS/connection error, or non-2xx ⇒ `OFFLINE`. (A recent heartbeat, `centrals.last_heartbeat_at` within `CENTRAL_OFFLINE_AFTER`, is an optional secondary signal.)
- **Per-central interval — project default, per-gateway override.** The probe runs every `CENTRAL_CHECK_INTERVAL_SECONDS` (a **project env default**, proposed **900 s / 15 min**); each central **MAY override** it with its own `check_interval_seconds` column, so a critical gateway can be probed more often and a flaky one less. The monitor schedules each central on **its own next-due time**, not one global sweep. (Distinct from the existing `centrals.frequency`, which is the central's *own* data-collection cadence — do not overload it.)
- **Persisted on the central (new columns):**
  - `last_gateway_check_at` (timestamptz) — when the probe last ran;
  - `last_gateway_check_latency_ms` (int) — round-trip time, kept both for the cockpit and to **trend degradation** (a gateway answering slower over time);
  - `connection_status` — written **only on change** (idempotent), with an RFC-0009 audit row.

  Full per-probe detail (URL, HTTP status, latency, whether it caused a transition) goes to `orchestrator_devices_checks` for the cockpit's low-level view.
- **Absorbs PR #19's reconcile** so the topology `GET` becomes a pure read; the `/v2/slaves` payload can additionally **seed the `devices-monitor`** (a bonus cross-check of which slaves the gateway currently reports).

### 2a. Retry policy — the probe "policy book"

A single timeout is **not** proof a gateway is down (a satellite/LTE hop blips). A probe therefore runs under a **retry policy** before any `OFFLINE` verdict: the central is marked `OFFLINE` only after the **whole retry sequence** fails; a 2xx on **any** attempt ⇒ `ONLINE`.

- **A curated catalog ("book") of named policies** — a table `orchestrator_retry_policies (name, attempts jsonb, description)` so ops tune it without a deploy. `attempts` is an ordered backoff list of `{ delay_ms, timeout_ms? }`:

  | policy | backoff before each attempt | total attempts |
  |---|---|---|
  | `strict` | `[0]` | 1 (no retry) |
  | `default` | `[0, +5s, +15s]` | 3 |
  | `lenient` (flaky LTE / satellite) | `[0, +10s, +30s, +60s]` | 4 |

  (i.e. exactly your "try 1× at X s, then again at X+Y s, …" — expressed as an ordered, per-attempt backoff.)
- **Per-gateway override + project default.** Each central references a policy by name via a nullable `centrals.retry_policy` column → falls back to the env default `CENTRAL_DEFAULT_RETRY_POLICY` (proposed `default`). A satellite gateway carries `lenient`; a wired one `strict`.
- **Bounded.** The monitor caps a policy's **total wall-time** (Σ delays + timeouts) at `CENTRAL_PROBE_MAX_TOTAL_MS` so retries never stall a scan; a policy that would exceed it is clamped and flagged in the cockpit. All retries run inside the same tick.
- **Recorded.** `orchestrator_devices_checks` logs, per probe: attempts made, which attempt succeeded (or all failed), per-attempt latency, and the policy used — so the cockpit shows *"central X: OFFLINE after 3/3 attempts under `default`"*.
- This is the connectivity analogue of the alarm system's **hysteresis / cooldown** guards — a transient blip can't flap `connection_status` or spam OFFLINE incidents.

### 2b. The `/v2/slaves` payload (one probe, two monitors)

A live probe against a real gateway returns **`200` in ~2 s with a JSON array of ~199 slaves** — so the same call that proves the central is up **also carries the per-device state**, and one request feeds both the centrals- and devices-monitors. Shape (trimmed to the fields the monitors use):

```jsonc
// GET https://{central.id}.y.myio.com.br/v2/slaves  →  200, array of slaves
[
  {
    "id": 106,                       // == GCDR devices.slave_id
    "type": "outlet",                // slave hardware type
    "name": "HIDR. SCMAL2ACACHICEBAL3",
    "version": "6.0.0",              // central/slave firmware
    "last_consumption": 0,           // last reading value (freshness hint)
    "status": "online",              // ← per-device connectivity, reported by the gateway
    "channels": [
      { "id": 401, "type": "flow_sensor",     "channel": 1, "value": 0,   "input": 0,   "output": 0 },
      { "id": 400, "type": "presence_sensor", "channel": 0, "value": 100, "input": 100, "output": 100 }
    ],
    "config": { "channelConfig": { /* channel0/1: channel_type, pulses, output */ } }
  },
  {
    "id": 120,
    "type": "three_phase_sensor",
    "name": "3F SCMAL2ACCAGC x200 x200A",
    "version": "6.0.0",
    "last_consumption": 9,
    "status": "online",
    "channels": [],
    "config": { "tolerance": 30, "min_variance": 20, "channelConfig": { /* … */ } }
  }
]
```

**How the monitors consume it:**
- **`centrals-monitor`** — only needs the HTTP outcome: a `2xx` (under the retry policy, §2a) ⇒ `ONLINE`. The body is not required for the liveness verdict.
- **`devices-monitor`** — reads the array and, per slave, uses:
  - **`id`** — the `slave_id`; joined to GCDR devices by **`(central_id, slave_id)`** (channel-centric identity, RFC-0008 / migration 0029) to find the device row.
  - **`status`** (`online` \| `offline` \| `bad`) — the **gateway-reported connectivity**, the **primary** source for `devices.connectivity_status` (far better than inferring from telemetry-freshness alone — it fixes **M1** directly). Telemetry-freshness stays a fallback for slaves the payload doesn't list.
  - **`version`** — firmware inventory / drift detection per slave.
  - **`last_consumption`** and **`channels[].value`** — freshness / health hints feeding `health_status` (`bad` status or a stuck value → `DEGRADED`/`CRITICAL`).
- **Efficiency:** one `/v2/slaves` call per central per tick reconciles the central **and** all its devices — no per-device fan-out. A slave present in GCDR but **absent** from the payload is a signal too (removed / not seen); a slave in the payload but **absent** in GCDR flags an unregistered device.

> Field notes from the live sample: `status` observed as `"online"`; `type` values seen include `outlet`, `three_phase_sensor`, `flow_sensor`, `presence_sensor`; `addr_low`/`addr_high` are the RF addressing; `code` was `null`. The monitor should treat unknown `type`/`status` values as pass-through (log, don't crash) since the central firmware owns this vocabulary.

### 3. Monitor B — `devices-monitor` (fixes M1 + M2)
- **Connectivity (M1):** the **primary** source is the per-slave **`status`** from the gateway's `/v2/slaves` payload (§2b), joined to devices by `(central_id, slave_id)` — `online`/`offline`/`bad` maps straight to `connectivity_status`. **Telemetry freshness** is the fallback for slaves the payload doesn't list: a reading within `DEVICE_OFFLINE_AFTER` (per-device cadence, fallback 60 min) is `ONLINE`, stale is `OFFLINE`, never-seen stays `UNKNOWN`. Grouped, batched, change-only writes.
- **Health (M2):** introduce `devices.health_status` (`HEALTHY | DEGRADED | CRITICAL | UNKNOWN`) — a small additive migration — and compute it from signals available to GCDR (connectivity, alarm state from the orchestrator, no-consumption incidents per RFC-0055, retry/error rates where exposed). `DashboardService.devices.health` stops being a mock and reads this column.
- **Semantics:** `UNKNOWN` means *not yet observed*, never *silently healthy* — so a device the monitor cannot classify is visibly unknown, not falsely green.

### 4. Monitor C — `os-monitor` (Work Orders)
- **Inputs:** `wo_*` open orders and their SLA/lifecycle timestamps.
- **Rules:** flag **overdue** (past due date), **SLA-breached** (elapsed > SLA window for its type/priority), and **stale** (no progress in `OS_STALE_AFTER`). On breach, emit an **escalation event** (and/or create/annotate an OS, or notify via the existing dispatch channels) — deny-by-default, one escalation per breach per window (idempotent, keyed by order + rule).
- Reuses the existing RFC-0009 audit and the alarm-orchestrator's dispatch where notification is wanted, rather than re-implementing channels.

### 5. Outputs & contracts
- **State reconcile:** `centrals.connection_status`, `devices.connectivity_status`, `devices.health_status` — change-only, audited.
- **Incidents/events:** device-offline / central-offline / os-breach as RFC-0009 events; optionally pushed to the **alarm-orchestrator** queue so existing dispatch (Telegram / Work Order / Webhook) handles delivery — this service **decides**, the orchestrator **dispatches** (same split the alarms system already uses).
- **No new customer-facing API** beyond what the dashboard already reads; the value is that those reads now return real data.

### 6. Configuration (`.env.dokploy.orchestrator-devices`)
| Var | Default | Meaning |
|---|---|---|
| `ORCH_DEVICES_ENABLE_CENTRALS` / `_DEVICES` / `_OS` | `true` | per-monitor enable flags (like the alarms `ENABLE_*_DISPATCH`) |
| `CENTRAL_CHECK_INTERVAL_SECONDS` | **900** (15 min) | project default probe cadence; **overridable per central** via the `check_interval_seconds` column |
| `CENTRAL_TUNNEL_HOST_TEMPLATE` | `https://{id}.y.myio.com.br` | per-gateway probe host; `{id}` = the central's UUID |
| `CENTRAL_PROBE_PATH`, `CENTRAL_PROBE_TIMEOUT_MS` | `/v2/slaves`, `5000` | endpoint hit + per-attempt bounded timeout (a hung gateway must not stall the scan) |
| `CENTRAL_DEFAULT_RETRY_POLICY` | `default` | policy from the `orchestrator_retry_policies` book; **overridable per central** via `centrals.retry_policy` |
| `CENTRAL_PROBE_MAX_TOTAL_MS` | `120000` | hard cap on a policy's total wall-time (Σ delays + timeouts) so retries can't stall a scan |
| `DEVICES_SCAN_INTERVAL_MS` / `OS_SCAN_INTERVAL_MS` | 60s / 300s | scan cadence for the other two monitors |
| `DEVICE_OFFLINE_AFTER` | 60m | device telemetry-freshness threshold |
| `OS_SLA_*` / `OS_STALE_AFTER` | per type | work-order SLA windows |
| `SCAN_BATCH_SIZE`, `SCAN_LEADER_LOCK` | 500, on | batching + advisory-lock HA guard |

### 7. Admin cockpit — `/admin/orchestrator-devices` (served by the backend)

A self-contained HTML console **served by the GCDR API process**, in the exact family as the existing admin UIs (`/admin/simulator` — Simulator Cockpit, `/admin/monitor` — API Monitor, `/admin/db` — DB Admin): a new `src/controllers/admin/devices-monitor-admin.controller.ts`, mounted **before Helmet** (relaxed CSP, like its siblings) at `app.use('/admin/orchestrator-devices', devicesMonitorAdminController)`. It is a **mix** of the three: the *control* affordances of the Simulator cockpit, the *live-tail/metrics* of the API Monitor, and the *raw-data browsing* of the DB Admin.

**The API serves it; the worker never serves HTTP.** The worker writes its run/check state to shared DB tables (below); the cockpit is a **read/observe view** over those tables plus a live log tail, so it works even though the monitor runs in a separate Dokploy container. Writing controls (pause/resume/kick) flip a small `orchestrator_devices_control` row (or enqueue a command) that the worker reads on its next tick.

**What it shows (low-level observability):**
- **Per-monitor status** — `centrals-monitor` / `devices-monitor` / `os-monitor`: enabled?, running?, leader-lock holder, last scan start/duration, next scan ETA, error rate.
- **Per-scan runs** — a table of recent scans (id, monitor, started/finished, scanned/changed/skipped counts, failures) from a `orchestrator_devices_runs` table the worker writes.
- **Per-entity check detail** — the last check per central/device/OS: input signal (heartbeat age, telemetry freshness, cloud status), computed state, whether it caused a transition, latency — from a `orchestrator_devices_checks` table (bounded/rolled-up, not unbounded like `audit_logs`; see RFC-0060's lesson).
- **Live log tail** — a streaming view (SSE) of the monitor's structured logs, filterable by monitor / level / entity, so "why is device X still UNKNOWN?" is answerable on screen.
- **Reconcile deltas** — how many devices flipped ONLINE/OFFLINE/UNKNOWN and health HEALTHY/DEGRADED/CRITICAL this scan, and OS SLA breaches raised.

**Controls (admin-gated):**
- Pause / resume a monitor; **run a scan now** (kick); adjust an interval/threshold at runtime (persisted to the control row, bounded to sane ranges); optionally re-check a single central/device on demand.

**Auth:** gated exactly like the other `/admin/*` cockpits — master key / `DISABLE_AUTH` operator path only (never a customer key); the cockpit is an internal operator tool, not a customer surface.

**Data model for observability:** two small tables owned by this service — `orchestrator_devices_runs` (one row per scan) and `orchestrator_devices_checks` (one row per entity per scan, retained N days / rolled up), plus a `orchestrator_devices_control` row per monitor. These are the cockpit's source of truth and keep the low-level detail **out of `audit_logs`** (audit keeps only state-change events, per RFC-0009 / RFC-0060).

## Drawbacks

- **A new deployable to operate** — another container, env file, and health check. Mitigated by reusing the GCDR image and DB (no new build, no new datastore for the MVP).
- **Write amplification on hot tables** — change-only writes keep this small, but connectivity flapping could churn `devices`; debounce via the staleness thresholds.
- **A `health_status` column is an additive migration** on `devices`; low risk but it must be written *only* by this service to keep a single owner.
- **Source coupling** — depends on the central cloud-server contract (the same dependency PR #19 already took on); a hung cloud-server must not stall scans (per-call timeout, like the topology service).

## Rationale and alternatives

- **Separate worker vs. an in-API cron.** A cron inside the API process couples monitoring latency and load to request traffic, can't scale independently, and dies with an API restart. The alarm-orchestrator already proved the separate-worker shape; reusing it keeps the API hot path clean (and finally removes PR #19's GET-that-mutates).
- **This service vs. energy-ingestion writing connectivity (RFC-0023 Q4).** Both could write connectivity; having **two writers** is the ambiguity RFC-0023 leaves open. This RFC proposes GCDR's monitor as the **single writer**, with ingestion feeding it telemetry freshness rather than writing status directly.
- **Reuse the alarm-orchestrator vs. a GCDR-native worker.** The alarm orchestrator is event/notification-centric and lives in another repo/DB; device/central/OS state is GCDR master data. Keeping the monitor **in the GCDR codebase** (its entities, repos, migrations) avoids cross-repo drift; it can still *hand off* to the orchestrator for dispatch.
- **Timer loop + advisory lock vs. Redis/BullMQ from day one.** The MVP is a timer + Postgres advisory lock — no new infra. BullMQ is a phase-2 upgrade only if event-driven fan-out or durable retries are needed.

## Prior art

- **Alarm Orchestrator** (`gh-myio/alarms-backend`): the `orchestrator` / `dispatcher` / `verify` worker entrypoints, one image, per-role Dokploy container with `.env.dokploy.{role}`, Redis/BullMQ + DLQ, `WORKER_CONCURRENCY` — the exact operational shape this RFC copies.
- **gcdr PR #19** (`CentralTopologyService`): the cloud-server link + connectivity reconcile logic to be **moved here** off the read path.
- **RFC-0055** (No-Consumption Incidents): a peer "observe telemetry → emit incident" flow; a device that goes silent is a signal this monitor can also raise.
- **RFC-0023** (Device Identity): the connectivity-writer ownership question this RFC answers.
- **SCIM / control-plane reconcilers**: the general "observe desired vs. actual, reconcile in the master's favour, off the request path" pattern.

## Unresolved questions

1. **Codebase home** — a worker inside the GCDR repo (proposed) vs. a small standalone service. The GCDR-in-repo option reuses entities/migrations but adds a worker build target.
2. **Telemetry-freshness source** — does GCDR read the ingestion `last_telemetry_ts` / readings directly (cross-DB), or does ingestion push freshness to GCDR? (ties to RFC-0023).
3. **`health_status` inputs** — the exact signal set and thresholds for `DEGRADED`/`CRITICAL` (connectivity + alarms + no-consumption + retries?), and who is authoritative.
4. **Redis now or later** — is durable retry / event fan-out needed in v1, or is the advisory-lock timer loop enough?
5. **Escalation delivery** — does `os-monitor` dispatch directly (reusing channels) or only emit events for the alarm-orchestrator to dispatch?
6. **Dokploy build path** — the GCDR backend still builds on-host (GHCR cutover pending); a new worker container should ship via the same GHCR image to avoid the OOM build path.

## Future possibilities

- **Push, not poll** — subscribe to the central WS / a telemetry event stream so connectivity flips in near-real-time instead of on a scan interval.
- **`heartbeat_agg` (TimescaleDB toolkit)** — compute liveness/`dead_ranges` from telemetry directly (pairs with the RFC-0055 / RFC-0008 line of work).
- **Feed the incidents plane** — device/central-offline incidents surfaced in the same panel as no-consumption incidents (`alarms-web`).
- **Predictive health** — beyond up/down, trend-based `DEGRADED` (rising retries, dropping cadence) — the ED-1131 predictive-3F line of work.
- **Fold in a `dispatcher-devices` role** — if device/OS notifications grow, split dispatch into its own container exactly as the alarms system split orchestrator from dispatcher.
