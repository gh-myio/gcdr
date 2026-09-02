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

  // Grace window (§5): after a probe starts failing, a central is held in DEGRADED
  // (warning) and only proposed OFFLINE once it has had NO successful sync for this
  // many minutes. Default 5. The cockpit reads the same value to derive its display.
  offlineGraceMin: intEnv('ORCH_DEVICES_OFFLINE_GRACE_MIN', 5),

  // Scheduling (§3): project-default cadence + jitter to avoid a thundering herd.
  checkIntervalSeconds: intEnv('CENTRAL_CHECK_INTERVAL_SECONDS', 900),
  checkJitterPct: intEnv('CENTRAL_CHECK_JITTER_PCT', 20),

  // Policy-book fallbacks (§4/§6) when a central/device does not override.
  defaultRetryPolicy: process.env.CENTRAL_DEFAULT_RETRY_POLICY ?? 'default',

  // Bounded per-scan batch.
  scanBatchSize: intEnv('SCAN_BATCH_SIZE', 500),

  // Ledger retention (§7/§8): the high-frequency _checks/_runs rows are pruned
  // beyond this age so the operational ledger stays bounded (never audit_logs).
  ledgerRetentionDays: intEnv('ORCH_DEVICES_LEDGER_RETENTION_DAYS', 7),

  // Incidents (§8) — ALARMS multi-source ingestion (RFC-0031). Emission is also
  // gated by the incident_emission_enabled FLAG; absent URL ⇒ dry-run/log only.
  alarmsApiUrl: process.env.ALARMS_API_URL, // e.g. https://<alarms-host>/api/v1 (must include /api/v1)
  alarmsApiToken: process.env.ALARMS_API_TOKEN, // never logged
} as const;

export type WorkerConfig = typeof workerConfig;

// A central id becomes a SUBDOMAIN of the tunnel host, so it must be a strict UUID
// and nothing else — this both sanitizes the value and blocks request-forgery/SSRF
// (an id carrying `/`, `.`, `@`, `\` etc. could otherwise redirect the probe to an
// arbitrary host). The recheck endpoint takes the id from the request path.
const CENTRAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the probe URL for a central by its hardware UUID. Throws on a non-UUID id. */
export function gatewayUrl(centralId: string): string {
  if (!CENTRAL_ID_RE.test(centralId)) {
    throw new Error('gatewayUrl: centralId must be a UUID');
  }
  const host = workerConfig.tunnelHostTemplate.replace('{id}', centralId);
  return `${host}${workerConfig.probePath}`;
}
