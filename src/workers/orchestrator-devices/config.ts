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

  // Scheduling (§3): project-default cadence + jitter to avoid a thundering herd.
  checkIntervalSeconds: intEnv('CENTRAL_CHECK_INTERVAL_SECONDS', 900),
  checkJitterPct: intEnv('CENTRAL_CHECK_JITTER_PCT', 20),

  // Policy-book fallbacks (§4/§6) when a central/device does not override.
  defaultRetryPolicy: process.env.CENTRAL_DEFAULT_RETRY_POLICY ?? 'default',

  // Bounded per-scan batch.
  scanBatchSize: intEnv('SCAN_BATCH_SIZE', 500),
} as const;

export type WorkerConfig = typeof workerConfig;

/** Build the probe URL for a central by its hardware UUID. */
export function gatewayUrl(centralId: string): string {
  const host = workerConfig.tunnelHostTemplate.replace('{id}', centralId);
  return `${host}${workerConfig.probePath}`;
}
