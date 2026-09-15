// =============================================================================
// orchestrator-devices worker — configuration (RFC-0062 §14)
//
// Env with safe defaults. NOTE: the live control plane (MASTER switch, per-
// monitor gates, rollback FLAGS) lives in the `orchestrator_devices_control`
// table (see control.ts), NOT here — these are only boot-time defaults and
// probe/scheduling parameters.
// =============================================================================

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return raw === 'true' || raw === '1';
}

export const workerConfig = {
  // Tick cadence of the worker's own loop (the scheduler; per-central due-time
  // is computed inside centrals-monitor from check_interval_seconds).
  tickIntervalMs: intEnv('ORCH_DEVICES_TICK_INTERVAL_MS', 60_000),

  // Boot default for the MASTER switch — the live value is the MASTER control
  // row; this only seeds intent when the row is absent.
  masterEnabledBoot: boolEnv('ORCH_DEVICES_MASTER_ENABLED', false),

  // Gateway probe (§3/§5). {id} is the central UUID. These are OUR endpoints.
  tunnelHostTemplate: process.env.CENTRAL_TUNNEL_HOST_TEMPLATE ?? 'https://{id}.y.myio.com.br',
  probePath: process.env.CENTRAL_PROBE_PATH ?? '/v2/slaves',
  probeTimeoutMs: intEnv('CENTRAL_PROBE_TIMEOUT_MS', 5_000),
  probeMaxTotalMs: intEnv('CENTRAL_PROBE_MAX_TOTAL_MS', 120_000),
  statusToken: process.env.CLOUD_STATUS_TOKEN, // optional X-Status-Token (reused from PR #19 wiring)

  // WARNING window (§5): once a probe starts failing, a central stays ONLINE (blip
  // tolerance) until it has had NO successful sync for this many minutes, then it is
  // proposed DEGRADED (WARNING / ATENÇÃO). Default 5. Renamed from
  // ORCH_DEVICES_OFFLINE_GRACE_MIN — the old name is still read as a fallback.
  warningMin: intEnv('ORCH_DEVICES_CENTRAL_WARNING_MIN', intEnv('ORCH_DEVICES_OFFLINE_GRACE_MIN', 5)),

  // OFFLINE threshold (§5 stage 2): a central is only proposed OFFLINE — and a
  // CENTRAL_OFFLINE incident opened — once it has had NO successful sync for this many
  // minutes (default 150 = 2h30min); between the warning and offline windows it is
  // DEGRADED. A central that NEVER succeeded is already past both. Renamed from
  // ORCH_DEVICES_OFFLINE_HARD_MIN — the old name is still read as a fallback.
  offlineMin: intEnv('ORCH_DEVICES_CENTRAL_OFFLINE_MIN', intEnv('ORCH_DEVICES_OFFLINE_HARD_MIN', 150)),

  // Scheduling (§3): project-default cadence + jitter to avoid a thundering herd.
  checkIntervalSeconds: intEnv('CENTRAL_CHECK_INTERVAL_SECONDS', 900),
  checkJitterPct: intEnv('CENTRAL_CHECK_JITTER_PCT', 20),

  // Policy-book fallbacks (§4/§6) when a central/device does not override.
  defaultRetryPolicy: process.env.CENTRAL_DEFAULT_RETRY_POLICY ?? 'default',

  // Bounded per-scan batch.
  scanBatchSize: intEnv('SCAN_BATCH_SIZE', 500),

  // How many central probes run concurrently within a sweep (RFC-0062 hardening).
  // Serial sweeps of an unreachable fleet took many minutes and froze the heartbeat;
  // bounded concurrency keeps a full sweep short without a thundering herd. Keep it
  // below the DB pool size so per-central evidence writes never starve.
  probeConcurrency: intEnv('ORCH_DEVICES_PROBE_CONCURRENCY', 8),

  // The scheduler heartbeats at the top of every tick, but a long sweep would let
  // the stamp go stale mid-tick (false "worker hung"). This interval re-stamps the
  // heartbeat DURING a running tick. Must stay well under HEALTHCHECK_MAX_STALE_MS.
  // Floored at 5s so a bad env (0/negative) can't turn setInterval into a DB-hammer.
  heartbeatIntervalMs: Math.max(5_000, intEnv('ORCH_DEVICES_HEARTBEAT_INTERVAL_MS', 30_000)),

  // Ledger retention (§7/§8): the high-frequency _checks/_runs rows are pruned
  // beyond this age so the operational ledger stays bounded (never audit_logs).
  ledgerRetentionDays: intEnv('ORCH_DEVICES_LEDGER_RETENTION_DAYS', 7),

  // Incidents (§8) — ALARMS multi-source ingestion (RFC-0031). Emission is also
  // gated by the incident_emission_enabled FLAG; absent URL ⇒ dry-run/log only.
  alarmsApiUrl: process.env.ALARMS_API_URL, // e.g. https://<alarms-host>/api/v1 (must include /api/v1)
  alarmsApiToken: process.env.ALARMS_API_TOKEN, // never logged

  // ── rules-monitor (Monitor D, RFC-0062 §11b/§11c) ──────────────────────────
  // Daily-count reader source: 'mock' (deterministic, localhost/shadow — no ALARMS
  // needed) or 'http' (POST {alarmsReadUrl}/incidents/counts/daily). Defaults to mock
  // until the ALARMS endpoint (RFC-0035) is live.
  rulesAlarmsReader: (process.env.ORCH_DEVICES_RULES_ALARMS_READER === 'http' ? 'http' : 'mock') as 'mock' | 'http',
  // Read endpoint base (must include /api/v1); falls back to ALARMS_API_URL.
  alarmsReadUrl: process.env.ALARMS_READ_API_URL ?? process.env.ALARMS_API_URL,
  // DEDICATED read-scoped key (least privilege; separate from the producer write token).
  // Falls back to ALARMS_API_TOKEN when a dedicated read key isn't set (dev convenience;
  // prod should set ALARMS_READ_API_KEY explicitly). Never logged.
  alarmsReadToken: process.env.ALARMS_READ_API_KEY ?? process.env.ALARMS_API_TOKEN,
  // Localhost demo: JSON map deviceId->count to force auto-mute in mock mode, e.g. '{"<uuid>":3}'.
  rulesMockCounts: process.env.RULES_MOCK_COUNTS,

  // ── canonical apply → bundle cache flush (Monitor D, RFC-0062 §11c) ─────────
  // When the rules-monitor mutates rules.scope_entity_ids (auto-mute / restore) it
  // must force the API to regenerate the NO_CONSUMPTION bundle, because the bundle
  // cache is a PER-PROCESS in-memory Map (worker can't reach the API process's map).
  // Best-effort: worker calls DELETE {bundleFlushApiUrl}/customers/{id}/alarm-rules/
  // bundle/cache after commit (bundles:read key). A flush failure is LOGGED and NEVER
  // undoes the committed mute/restore — the 300s cache TTL is the guaranteed backstop.
  // Single-replica deployment (docker-compose.dokploy.yml: replicas=1) makes the
  // targeted flush sufficient; a multi-replica API would need shared/versioned
  // invalidation instead (documented limitation). Absent URL ⇒ TTL-only (no flush).
  bundleFlushApiUrl: process.env.GCDR_API_URL, // API base incl /api/v1, e.g. https://<gcdr-host>/api/v1
  bundleFlushApiKey: process.env.GCDR_BUNDLE_FLUSH_API_KEY, // bundles:read scope; never logged
  bundleFlushTimeoutMs: intEnv('ORCH_DEVICES_BUNDLE_FLUSH_TIMEOUT_MS', 4_000),
  bundleFlushRetries: intEnv('ORCH_DEVICES_BUNDLE_FLUSH_RETRIES', 2),
} as const;

export type WorkerConfig = typeof workerConfig;

// A central id becomes a SUBDOMAIN of the tunnel host, so it must be a strict UUID
// and nothing else — this both sanitizes the value and blocks request-forgery/SSRF
// (an id carrying `/`, `.`, `@`, `\` etc. could otherwise redirect the probe to an
// arbitrary host). The recheck endpoint takes the id from the request path.
const CENTRAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the probe URL for a central by its hardware UUID — callers pass
 * `central.hardwareId ?? central.id` (hardware_id overrides the tunnel
 * subdomain; NULL falls back to the row id). Throws on a non-UUID id.
 */
export function gatewayUrl(centralId: string): string {
  if (!CENTRAL_ID_RE.test(centralId)) {
    throw new Error('gatewayUrl: centralId must be a UUID');
  }
  const host = workerConfig.tunnelHostTemplate.replace('{id}', centralId);
  return `${host}${workerConfig.probePath}`;
}
