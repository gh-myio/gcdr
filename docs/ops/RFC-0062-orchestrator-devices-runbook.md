# RFC-0062 — `orchestrator-devices` Worker — Operations Runbook (Phase 1)

**Audience:** operators / on-call. **Scope:** GCDR `orchestrator-devices` worker, Phase 1.
**Branch:** `feat/rfc-0062-orchestrator-devices`. **Status of Phase 1:** ships **SAFE** (idle, shadow-only).

---

## 0. What this service is

`orchestrator-devices` is a **headless GCDR worker** — a plain Node process, **not an HTTP server**.
It monitors centrals (gateways) and devices **off the request path** and reconciles their
connectivity/health, optionally raising incidents in ALARMS.

- Deployed as its **own Dokploy container** from the **same GCDR image**.
- Command: `node dist/workers/orchestrator-devices.worker.js`
- **Single replica.** HA is a non-goal for Phase 1.
- Source: `src/workers/orchestrator-devices/`
- The real per-entity health **cockpit / UI is Phase 2**. In Phase 1 you observe the worker
  **only through the DB tables** documented below.

Everything the worker does is gated by a **live control plane in the database** — you change
behaviour with `UPDATE` statements, **no redeploy required**.

---

## 1. Reference — flags, scopes, columns

### Control-plane rows (`orchestrator_devices_control`, one row per `scope`)

| scope | field | meaning |
|---|---|---|
| `MASTER` | `enabled` | Global kill switch. `false` ⇒ worker idles (no probes, no writes). Still heartbeats `last_run_at` every tick. |
| `CENTRALS` | `enabled` | Per-monitor gate for the centrals monitor. |
| `DEVICES` | `enabled` | Per-monitor gate for the devices monitor. |
| `OS` | `enabled` | Per-monitor gate for the OS monitor (seeded **off**). |
| `FLAGS` | `config` (jsonb) | Rollback / safety switches (see below). |

**`FLAGS.config` keys (seeded values):**

```json
{
  "shadow_mode": true,
  "canonical_writes_enabled": false,
  "incident_emission_enabled": false,
  "incident_open_after_ticks": 2,
  "sanity_max_fleet_flip_pct": 30
}
```

| flag | meaning |
|---|---|
| `shadow_mode` | When `true`, the worker computes what it *would* write and records it in the **shadow ledger** (`orchestrator_devices_checks.proposed_write`) but does **not** touch canonical columns. |
| `canonical_writes_enabled` | Master allow for writing canonical status columns. |
| `incident_emission_enabled` | Allow posting incidents to ALARMS. |
| `incident_open_after_ticks` | Debounce N: an incident opens only after N consecutive "down" checks. |
| `sanity_max_fleet_flip_pct` | If a single scan would flip more than this % of the fleet, the **sanity gate holds** (suppresses canonical writes + incidents that tick). |

### Effective rules (memorize these)

- A monitor **runs** only when: `MASTER.enabled ∧ <MONITOR>.enabled ∧ central.monitoring_enabled` are **all true**.
- Canonical status is **written** only when: `!shadow_mode ∧ canonical_writes_enabled ∧ !sanity.held`.
- An incident **emits** only when: `incident_emission_enabled ∧ !sanity.held ∧ debounce satisfied` (N consecutive down checks).

### Per-gateway gate

`centrals.monitoring_enabled` (boolean, default **false**) — opt-in per gateway. Only enabled centrals are probed.

### Key tables

| table | one row per | notable columns |
|---|---|---|
| `orchestrator_devices_runs` | monitor scan | `scanned`, `changed`, `skipped`, `failures`, `notes` (jsonb: `mode`, `applied`, `audited`, `sanity`, `incidents`) |
| `orchestrator_devices_checks` | entity per scan | `proposed_write` (jsonb — **shadow ledger**), `computed_state`, `caused_transition`, `input`, `latency_ms`, `policy` |
| `orchestrator_retry_policies` | policy | seeded `strict` / `default` / `lenient` |
| `orchestrator_freshness_policies` | policy | Phase 2 |

### Canonical columns the worker owns (only after cutover)

- `centrals.connection_status`
- `devices.connectivity_status`
- `devices.health_status` (+ `devices.unknown_reason`)

### Evidence columns (always written, even in shadow)

- `centrals.last_gateway_check_at`
- `centrals.last_gateway_check_latency_ms`
- `centrals.probe_result`

### The probe

Per enabled central: `GET https://{central.id}.y.myio.com.br/v2/slaves`
(**our** endpoint; `central.id` is the hardware UUID).

| observation | verdict |
|---|---|
| 2xx | reachable; per-slave `status` field drives device connectivity |
| timeout / conn refused / 5xx / parse-fail (after retry policy) | central **OFFLINE** + its devices **UNKNOWN / CENTRAL_UNREACHABLE** (cascade — **not** device-offline) |
| 401 / 403 | `AUTH_ERROR` (**not** a down verdict) |
| NXDOMAIN | `CONFIG_ERROR` |

---

## 2. Environment prerequisites

> **Shell convention:** all command examples assume a **bash shell** (Linux — the
> Dokploy/ops target), using `export`, the `psqlc` helper below, and `timeout`. On a
> Windows/PowerShell dev box, translate accordingly (e.g. `$env:VAR=...` instead of
> `export`, and run the `docker exec … psql` calls directly).

### Production (Dokploy)

- Service defined in `docker-compose.dokploy.yml` (single replica, no public port, DB
  healthcheck via `last_run_at` freshness, `restart: on-failure`).
- Env example: `.env.dokploy.orchestrator-devices` — safety flags boot-default to SAFE;
  intervals/timeouts/retry; optional `ALARMS_API_URL` / `ALARMS_API_TOKEN`; sanity/debounce;
  `CENTRAL_TUNNEL_HOST_TEMPLATE`. **`DATABASE_URL` comes from a Dokploy secret — never committed.**
- Healthcheck script: `dist/workers/orchestrator-devices.healthcheck.js` — exits `0` iff
  `MASTER.last_run_at` is fresh (`< HEALTHCHECK_MAX_STALE_MS`, default `180000`ms).

### Local dev DB

- Container `gcdr-db-local`, host port `5544`.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5544/db_gcdr`
- Inspect: `docker exec gcdr-db-local psql -U postgres -d db_gcdr -c "..."`
- Known test gateway: **Moxuara** central `e982edf9-edb1-4aa6-8a14-4782465ae5a3` (307 devices).

A convenience env for the rest of this doc (local):

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5544/db_gcdr'
# helper for inline psql (local container):
psqlc() { docker exec gcdr-db-local psql -U postgres -d db_gcdr -c "$1"; }
```

---

## 3. Step 1 — Apply migration 0070

Migration `drizzle/migrations/0070_orchestrator_devices.sql` is **additive**. It is applied
with the custom runner, which **wraps the migration in a transaction** — a failure rolls back
cleanly, leaving the schema untouched.

> The runner needs `DATABASE_URL` set in the environment and does **NOT** auto-load `.env`.

```bash
# make sure DATABASE_URL points at the target DB, then:
DATABASE_URL="$DATABASE_URL" npm run db:mig:up
```

Verify the objects exist:

```bash
psqlc "\dt orchestrator_devices_control orchestrator_devices_runs orchestrator_devices_checks orchestrator_retry_policies orchestrator_freshness_policies"
```

Verify the retry policies seeded:

```bash
psqlc "SELECT name FROM orchestrator_retry_policies ORDER BY name;"
-- expect: default, lenient, strict
```

---

## 4. Step 2 — Start the worker in SAFE mode

### 4a. Confirm the control table is seeded SAFE

```bash
psqlc "SELECT scope, enabled, config FROM orchestrator_devices_control ORDER BY scope;"
```

Expected (SAFE) state:

| scope | enabled | config |
|---|---|---|
| `MASTER` | `false` | — |
| `CENTRALS` | `true` | — |
| `DEVICES` | `true` | — |
| `OS` | `false` | — |
| `FLAGS` | — | `shadow_mode=true`, `canonical_writes_enabled=false`, `incident_emission_enabled=false`, `incident_open_after_ticks=2`, `sanity_max_fleet_flip_pct=30` |

Explicit proof of the safety flags:

```bash
psqlc "SELECT config->>'shadow_mode'                AS shadow,
              config->>'canonical_writes_enabled'   AS canonical,
              config->>'incident_emission_enabled'  AS incidents
       FROM orchestrator_devices_control WHERE scope='FLAGS';"
-- expect: shadow=true | canonical=false | incidents=false
```

### 4b. Start the worker

**Production (Dokploy):** deploy the `orchestrator-devices` service from
`docker-compose.dokploy.yml`. With `MASTER.enabled=false` it will boot, heartbeat, and idle.

**Local:**

```bash
# one-off tsx run
DATABASE_URL="$DATABASE_URL" npx tsx src/workers/orchestrator-devices.worker.ts
# or
npm run worker:orchestrator-devices:dev
```

### 4c. Confirm it is alive

The worker heartbeats `MASTER.last_run_at` **every tick regardless of MASTER state**:

```bash
psqlc "SELECT scope, last_run_at, now() - last_run_at AS age
       FROM orchestrator_devices_control WHERE scope='MASTER';"
```

`age` should stay below the tick interval (and well below `HEALTHCHECK_MAX_STALE_MS`, 180s).
In Dokploy the container healthcheck runs the same freshness check via
`dist/workers/orchestrator-devices.healthcheck.js`.

---

## 5. Step 3 — Enable ONE gateway + turn MASTER on

Pick a single known gateway (local: Moxuara). Enable per-gateway monitoring, then flip MASTER.

```bash
# 1) opt this one gateway in
psqlc "UPDATE centrals SET monitoring_enabled=true
       WHERE id='e982edf9-edb1-4aa6-8a14-4782465ae5a3';"

# 2) turn the global switch on
psqlc "UPDATE orchestrator_devices_control SET enabled=true WHERE scope='MASTER';"

# confirm exactly one gateway is enabled
psqlc "SELECT count(*) AS enabled_centrals FROM centrals WHERE monitoring_enabled=true;"
```

Because `shadow_mode=true` and `canonical_writes_enabled=false`, the worker now **probes** but
still **only writes the shadow ledger + evidence columns**.

---

## 6. Step 4 — Run in shadow and inspect the ledger

### Fast manual tick (local)

```bash
DATABASE_URL="$DATABASE_URL" \
CENTRAL_DEFAULT_RETRY_POLICY=strict \
CENTRAL_PROBE_TIMEOUT_MS=4000 \
ORCH_DEVICES_TICK_INTERVAL_MS=600000 \
timeout --signal=TERM 45 npx tsx src/workers/orchestrator-devices.worker.ts
```

(Large tick interval + a 45s `timeout` gives you exactly one clean scan.)

### Inspect `orchestrator_devices_runs`

```bash
psqlc "SELECT id, created_at, scanned, changed, skipped, failures,
              notes->>'mode'     AS mode,
              notes->>'applied'  AS applied,
              notes->>'audited'  AS audited,
              notes->'sanity'    AS sanity,
              notes->'incidents' AS incidents
       FROM orchestrator_devices_runs
       ORDER BY created_at DESC LIMIT 5;"
```

In shadow you expect `mode=shadow` and `applied=0`.

### Inspect `orchestrator_devices_checks` (the shadow ledger)

```bash
psqlc "SELECT entity_type, entity_id, computed_state, caused_transition,
              latency_ms, policy,
              proposed_write,
              proposed_write->>'unknownReason' AS unknown_reason
       FROM orchestrator_devices_checks
       WHERE run_id = (SELECT id FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 1)
       ORDER BY entity_type, entity_id
       LIMIT 20;"
```

`proposed_write` is exactly what the worker **would** write once shadow is off.

---

## 7. Step 5 — Smoke ONLINE and OFFLINE (proving shadow writes nothing canonical)

### 7a. BEFORE snapshot of canonical columns

```bash
psqlc "SELECT connection_status FROM centrals
       WHERE id='e982edf9-edb1-4aa6-8a14-4782465ae5a3';"

psqlc "SELECT connectivity_status, count(*)
       FROM devices WHERE central_id='e982edf9-edb1-4aa6-8a14-4782465ae5a3'
       GROUP BY connectivity_status ORDER BY 1;"
```

Record these values.

### 7b. Smoke ONLINE (reachable gateway)

Run a scan (Section 6). Expect proposals of **ONLINE / HEALTHY**:

```bash
psqlc "SELECT entity_type, computed_state,
              proposed_write->>'connectionStatus'    AS c_status,
              proposed_write->>'connectivityStatus'  AS d_conn,
              proposed_write->>'healthStatus'        AS d_health
       FROM orchestrator_devices_checks
       WHERE run_id=(SELECT id FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 1)
       ORDER BY entity_type LIMIT 10;"
```

### 7c. Smoke OFFLINE (unreachable gateway)

Force a genuine down (e.g. point the gateway at an unreachable host, or use a central id whose
tunnel is down). After the retry policy exhausts, expect:

- central proposal: `connection_status = OFFLINE`
- devices proposal (cascade): `connectivity_status = UNKNOWN`, `unknown_reason = CENTRAL_UNREACHABLE`
  (**not** device-offline).

```bash
psqlc "SELECT entity_type, computed_state,
              proposed_write->>'connectionStatus'    AS c_status,
              proposed_write->>'connectivityStatus'  AS d_conn,
              proposed_write->>'unknownReason'       AS unknown_reason
       FROM orchestrator_devices_checks
       WHERE run_id=(SELECT id FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 1)
       ORDER BY entity_type LIMIT 10;"
```

> `401/403` would surface as `AUTH_ERROR` (no down verdict); `NXDOMAIN` as `CONFIG_ERROR`.

### 7d. AFTER snapshot — prove canonical DID NOT change

Re-run the exact BEFORE queries:

```bash
psqlc "SELECT connection_status FROM centrals
       WHERE id='e982edf9-edb1-4aa6-8a14-4782465ae5a3';"

psqlc "SELECT connectivity_status, count(*)
       FROM devices WHERE central_id='e982edf9-edb1-4aa6-8a14-4782465ae5a3'
       GROUP BY connectivity_status ORDER BY 1;"
```

**They must be identical to BEFORE.** Only evidence columns move in shadow:

```bash
psqlc "SELECT last_gateway_check_at, last_gateway_check_latency_ms, probe_result
       FROM centrals WHERE id='e982edf9-edb1-4aa6-8a14-4782465ae5a3';"
```

---

## 8. Step 6 — Criteria to leave shadow and cut over to canonical writes

Do **not** flip until all of the following hold:

- [ ] Shadow has run for **N days** (recommend ≥ 3–7) across the enabled fleet.
- [ ] The divergence between `proposed_write` and the current canonical values has been
      **reviewed and judged acceptable** (no unexpected mass flips, no bad cascades).
- [ ] The **sanity gate never spuriously held** (`notes->'sanity'` shows no false holds during
      normal operation).
- [ ] Evidence columns look sane (fresh `last_gateway_check_at`, plausible latencies).

Quick divergence review (centrals):

```bash
psqlc "SELECT c.id,
              c.connection_status                      AS current_status,
              k.proposed_write->>'connectionStatus'   AS proposed_status
       FROM orchestrator_devices_checks k
       JOIN centrals c ON c.id = k.entity_id
       WHERE k.entity_type='central'
         AND k.run_id=(SELECT id FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 1)
         AND c.connection_status IS DISTINCT FROM k.proposed_write->>'connectionStatus';"
```

### Flip: shadow OFF + canonical ON (single statement, no redeploy)

```bash
psqlc "UPDATE orchestrator_devices_control
       SET config = jsonb_set(jsonb_set(config,'{shadow_mode}','false'),
                              '{canonical_writes_enabled}','true')
       WHERE scope='FLAGS';"
```

Then watch the next runs turn canonical:

```bash
psqlc "SELECT created_at,
              notes->>'mode'    AS mode,
              notes->>'applied' AS applied,
              notes->>'audited' AS audited,
              notes->'sanity'   AS sanity
       FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 5;"
-- expect: mode=canonical, applied > 0 (when there are transitions), audited > 0
```

Confirm canonical columns now move with reality:

```bash
psqlc "SELECT connection_status FROM centrals
       WHERE id='e982edf9-edb1-4aa6-8a14-4782465ae5a3';"
```

---

## 9. Step 7 — IMMEDIATE ROLLBACK (no redeploy)

If canonical writes look wrong, put shadow back on **immediately**:

```bash
psqlc "UPDATE orchestrator_devices_control
       SET config = jsonb_set(config,'{shadow_mode}','true')
       WHERE scope='FLAGS';"
```

Equivalent alternative — revoke the write allow:

```bash
psqlc "UPDATE orchestrator_devices_control
       SET config = jsonb_set(config,'{canonical_writes_enabled}','false')
       WHERE scope='FLAGS';"
```

**Effect:** the worker stops touching canonical columns. Canonical values are **frozen at their
last-known state** (whatever was last written) — nothing is reverted or nulled; the worker
simply resumes recording proposals in the shadow ledger. Verify:

```bash
psqlc "SELECT config->>'shadow_mode' AS shadow,
              config->>'canonical_writes_enabled' AS canonical
       FROM orchestrator_devices_control WHERE scope='FLAGS';"
```

---

## 10. Step 8 — Enable incident emission (ALARMS)

Do this **only after** canonical writes are validated **and** ALARMS integration is verified.

### 10a. Configure ALARMS + dry-run first

Set (via Dokploy env / secret; do not commit tokens):

```
ALARMS_API_URL=https://<alarms-endpoint>
ALARMS_API_TOKEN=<secret>
```

**With `ALARMS_API_URL` absent, the worker is in dry-run:** incident candidates are **logged as
"dry-run only" and never POSTed.** Confirm you see candidates being computed (still gated by the
debounce N = `incident_open_after_ticks`) before wiring the URL.

Inspect candidates recorded per run:

```bash
psqlc "SELECT created_at, notes->'incidents' AS incidents
       FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 5;"
```

### 10b. Turn emission on

```bash
psqlc "UPDATE orchestrator_devices_control
       SET config = jsonb_set(config,'{incident_emission_enabled}','true')
       WHERE scope='FLAGS';"
```

**Behaviour to know:**

- Emission still requires `!sanity.held` **and** N consecutive down checks (debounce).
- **POST failures never fail the sweep** — the scan completes regardless.
- Payload is **RFC-0031, `mode=PARTIAL`**.
- The **dedupe key omits the day** (so a persistent condition is not re-opened daily).

---

## 11. Step 9 — Revert EVERYTHING to SAFE

Full return to the seeded-safe posture (one statement per row plus flags):

```bash
# global off
psqlc "UPDATE orchestrator_devices_control SET enabled=false WHERE scope='MASTER';"

# flags: shadow on, canonical off, incidents off (keep debounce/sanity as seeded)
psqlc "UPDATE orchestrator_devices_control
       SET config = jsonb_set(jsonb_set(jsonb_set(config,
                    '{shadow_mode}','true'),
                    '{canonical_writes_enabled}','false'),
                    '{incident_emission_enabled}','false')
       WHERE scope='FLAGS';"
```

Verify:

```bash
psqlc "SELECT scope, enabled, config FROM orchestrator_devices_control ORDER BY scope;"
```

### Disable a single gateway

```bash
psqlc "UPDATE centrals SET monitoring_enabled=false
       WHERE id='<central-uuid>';"
```

(The worker simply stops probing that gateway on the next tick — no other state changes.)

---

## 12. How to tell the worker is alive

- **Heartbeat query** (works even when MASTER is off):

```bash
psqlc "SELECT scope, last_run_at, now() - last_run_at AS age
       FROM orchestrator_devices_control WHERE scope='MASTER';"
```

  `age` should stay under the tick interval; anything approaching
  `HEALTHCHECK_MAX_STALE_MS` (default `180000`ms / 3 min) means the worker is stuck or down.

- **Container healthcheck** runs `dist/workers/orchestrator-devices.healthcheck.js`, which exits
  `0` iff `MASTER.last_run_at` is fresh (`< HEALTHCHECK_MAX_STALE_MS`). Dokploy restarts the
  container `on-failure`.

- **Recent scan activity:**

```bash
psqlc "SELECT created_at, scanned, changed, failures, notes->>'mode' AS mode
       FROM orchestrator_devices_runs ORDER BY created_at DESC LIMIT 3;"
```

---

## 13. Notes / limits (Phase 1)

- **Single replica; HA is out of scope.** If the container is down, monitoring simply pauses —
  nothing is lost beyond the missed ticks.
- **The per-entity health cockpit / UI is Phase 2.** In Phase 1 the DB tables above are the only
  observability surface. `orchestrator_freshness_policies` also lands in Phase 2.
- Every flip in this runbook is a **DB `UPDATE`** — none require a redeploy.
- The probe endpoint and canonical/evidence columns are the **only** ones the worker touches; do
  not assume any endpoint or column not listed here.
