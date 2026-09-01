// =============================================================================
// orchestrator-devices — centrals sweep (RFC-0062 §3 + §6 Phase 1)
//
// One probe of /v2/slaves per due central reconciles the central AND all its
// slaves (no per-device fan-out). Two stages, matching the review boundary:
//   * Evidence (item 4) — ALWAYS written: last_gateway_check_at, latency,
//     probe_result. Evidence is not canonical status, so it is safe in shadow.
//   * Status classification (item 5) — the proposed central connection_status +
//     per-device connectivity/health/unknown_reason, recorded to the shadow
//     ledger (orchestrator_devices_checks.proposed_write). NO canonical write yet
//     (that is item 7, behind the canonical-writes flag).
//
// The sanity gate (§7) is computed over fleet-wide down-flips and recorded, so it
// already sits in front of the (still-disabled) canonical apply path.
// =============================================================================

import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import {
  centrals,
  devices,
  orchestratorDevicesRuns,
  orchestratorDevicesChecks,
  orchestratorRetryPolicies,
} from '../../infrastructure/database/drizzle/schema';
import { workerConfig, gatewayUrl } from './config';
import { probeGateway, type RetryAttempt, type RetryPolicy, type ProbeOutcome } from './gatewayClient';
import { classifyDevice, type Classification } from './ladder';
import { evaluateSanityGate } from './sanityGate';
import { canonicalWritesAllowed, type ControlState } from './control';

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
type CheckInsert = typeof orchestratorDevicesChecks.$inferInsert;

interface CentralRow {
  id: string;
  tenantId: string;
  connectionStatus: string;
  checkIntervalSeconds: number | null;
  retryPolicy: string | null;
  lastGatewayCheckAt: Date | null;
}
interface DeviceRow {
  id: string;
  centralId: string | null;
  slaveId: number | null;
  connectivityStatus: string;
  healthStatus: string;
  unknownReason: string | null;
}

interface CentralResult {
  checkRows: CheckInsert[];
  changed: number;
  skipped: number;
  failed: boolean;
  deviceTotal: number;
  deviceFlipsToDown: number;
}

/** Deterministic per-central jitter in [-jitterPct, +jitterPct]/100 so scans
 *  spread instead of bursting every interval (no Math.random → stable). */
function jitterFraction(centralId: string, jitterPct: number): number {
  let h = 0;
  for (let i = 0; i < centralId.length; i++) h = (h * 31 + centralId.charCodeAt(i)) & 0xffffffff;
  const unit = (Math.abs(h) % 1000) / 1000; // [0,1)
  return ((unit * 2 - 1) * jitterPct) / 100; // [-jitterPct, +jitterPct]/100
}

function isDue(c: CentralRow, defaultIntervalSec: number, jitterPct: number): boolean {
  if (!c.lastGatewayCheckAt) return true;
  const intervalSec = c.checkIntervalSeconds ?? defaultIntervalSec;
  const effectiveMs = intervalSec * 1000 * (1 + jitterFraction(c.id, jitterPct));
  return Date.now() - c.lastGatewayCheckAt.getTime() >= effectiveMs;
}

async function loadRetryPolicies(): Promise<Map<string, RetryPolicy>> {
  const rows = await db.select().from(orchestratorRetryPolicies);
  const map = new Map<string, RetryPolicy>();
  for (const r of rows) map.set(r.name, { name: r.name, attempts: r.attempts as RetryAttempt[] });
  return map;
}

/** Map a probe outcome to the central's proposed status + how its devices should
 *  be classified when there is no payload to classify from (auth/config/down). */
function centralVerdict(outcome: ProbeOutcome, current: string): {
  reachable: boolean;
  proposedStatus: string;
  probeResult: string;
  deviceFallback: Classification | null;
} {
  if (outcome.ok) return { reachable: true, proposedStatus: 'ONLINE', probeResult: 'OK', deviceFallback: null };
  if (outcome.kind === 'AUTH_ERROR') {
    return { reachable: false, proposedStatus: current, probeResult: 'AUTH_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'AUTH_ERROR' } };
  }
  if (outcome.kind === 'CONFIG_ERROR') {
    return { reachable: false, proposedStatus: current, probeResult: 'CONFIG_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CONFIG_ERROR' } };
  }
  // Genuine down (timeout / conn refused / 5xx / parse-fail after retries).
  return { reachable: false, proposedStatus: 'OFFLINE', probeResult: outcome.kind,
    deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' } };
}

function deviceCheckRow(runId: string, centralId: string, d: DeviceRow, cls: Classification, inputStatus: string | null, latencyMs: number, policy: string): { row: CheckInsert; transition: boolean; flipsToDown: boolean } {
  const transition =
    cls.connectivity !== d.connectivityStatus ||
    cls.health !== d.healthStatus ||
    (cls.unknownReason ?? null) !== (d.unknownReason ?? null);
  const flipsToDown = cls.connectivity === 'OFFLINE' && d.connectivityStatus !== 'OFFLINE';
  return {
    transition,
    flipsToDown,
    row: {
      runId, monitor: 'centrals', entityType: 'device', entityId: d.id, centralId,
      input: { slaveId: d.slaveId, gatewayStatus: inputStatus },
      computedState: `${cls.connectivity}/${cls.health}`,
      proposedWrite: { connectivityStatus: cls.connectivity, healthStatus: cls.health, unknownReason: cls.unknownReason },
      causedTransition: transition, latencyMs, policy,
    },
  };
}

/** Probe one central, write its evidence, and classify it + its devices (shadow). */
async function processCentral(c: CentralRow, centralDevices: DeviceRow[], policy: RetryPolicy, runId: string): Promise<CentralResult> {
  const outcome = await probeGateway(gatewayUrl(c.id), policy, {
    timeoutMs: workerConfig.probeTimeoutMs,
    maxTotalMs: workerConfig.probeMaxTotalMs,
    statusToken: workerConfig.statusToken,
  });
  const verdict = centralVerdict(outcome, c.connectionStatus);

  // ── Evidence (item 4) — ALWAYS written (not canonical status). ──
  await db.update(centrals).set({
    lastGatewayCheckAt: new Date(),
    lastGatewayCheckLatencyMs: outcome.latencyMs,
    probeResult: verdict.probeResult,
  }).where(eq(centrals.id, c.id));

  const checkRows: CheckInsert[] = [];
  let changed = 0, skipped = 0, deviceFlipsToDown = 0;

  // ── Central status classification (item 5) → shadow ledger. ──
  const centralTransition = verdict.proposedStatus !== c.connectionStatus;
  if (centralTransition) changed += 1;
  checkRows.push({
    runId, monitor: 'centrals', entityType: 'central', entityId: c.id, centralId: c.id,
    input: { ok: outcome.ok, kind: outcome.ok ? null : outcome.kind, latencyMs: outcome.latencyMs, attempts: outcome.attempts, policy: policy.name },
    computedState: verdict.proposedStatus,
    proposedWrite: { connectionStatus: verdict.proposedStatus },
    causedTransition: centralTransition, latencyMs: outcome.latencyMs, policy: policy.name,
  });

  const payloadBySlave = new Map<number, string>();
  if (outcome.ok) for (const s of outcome.slaves) payloadBySlave.set(s.id, s.status);

  for (const d of centralDevices) {
    let cls: Classification | null;
    let inputStatus: string | null;
    if (verdict.reachable) {
      const status = d.slaveId !== null ? payloadBySlave.get(d.slaveId) : undefined;
      if (status === undefined) { skipped += 1; continue; } // registered but not seen — leave last-known
      cls = classifyDevice({ centralReachable: true, gatewayStatus: status });
      inputStatus = status;
    } else {
      cls = verdict.deviceFallback;
      inputStatus = `probe:${verdict.probeResult}`;
    }
    if (!cls) { skipped += 1; continue; }

    const { row, transition, flipsToDown } = deviceCheckRow(runId, c.id, d, cls, inputStatus, outcome.latencyMs, policy.name);
    if (transition) changed += 1;
    if (flipsToDown) deviceFlipsToDown += 1;
    checkRows.push(row);
  }

  return { checkRows, changed, skipped, failed: !outcome.ok, deviceTotal: centralDevices.length, deviceFlipsToDown };
}

export async function runCentralsSweep(control: ControlState, log: Logger): Promise<void> {
  const policies = await loadRetryPolicies();
  const defaultPolicy = policies.get(workerConfig.defaultRetryPolicy) ?? policies.get('default') ?? { name: 'default', attempts: [{ delay_ms: 0 }] };

  const enabled = (await db.select({
    id: centrals.id, tenantId: centrals.tenantId, connectionStatus: centrals.connectionStatus,
    checkIntervalSeconds: centrals.checkIntervalSeconds, retryPolicy: centrals.retryPolicy,
    lastGatewayCheckAt: centrals.lastGatewayCheckAt,
  }).from(centrals).where(eq(centrals.monitoringEnabled, true))) as CentralRow[];

  const due = enabled
    .filter((c) => isDue(c, workerConfig.checkIntervalSeconds, workerConfig.checkJitterPct))
    .slice(0, workerConfig.scanBatchSize);

  if (due.length === 0) {
    log('info', 'centrals sweep: no centrals due', { enabled: enabled.length });
    return;
  }

  const dueIds = due.map((c) => c.id);
  const deviceRows = (await db.select({
    id: devices.id, centralId: devices.centralId, slaveId: devices.slaveId,
    connectivityStatus: devices.connectivityStatus, healthStatus: devices.healthStatus, unknownReason: devices.unknownReason,
  }).from(devices).where(and(inArray(devices.centralId, dueIds), isNotNull(devices.slaveId), isNull(devices.deletedAt)))) as DeviceRow[];

  const devicesByCentral = new Map<string, DeviceRow[]>();
  for (const d of deviceRows) {
    if (!d.centralId) continue;
    const arr = devicesByCentral.get(d.centralId) ?? [];
    arr.push(d);
    devicesByCentral.set(d.centralId, arr);
  }

  const [run] = await db.insert(orchestratorDevicesRuns).values({ monitor: 'centrals' }).returning({ id: orchestratorDevicesRuns.id });
  const runId = run.id;

  let scanned = 0, changed = 0, skipped = 0, failures = 0, deviceTotal = 0, deviceFlipsToDown = 0;
  const checkRows: CheckInsert[] = [];

  for (const c of due) {
    scanned += 1;
    const policy = (c.retryPolicy && policies.get(c.retryPolicy)) || defaultPolicy;
    const res = await processCentral(c, devicesByCentral.get(c.id) ?? [], policy, runId);
    checkRows.push(...res.checkRows);
    changed += res.changed;
    skipped += res.skipped;
    if (res.failed) failures += 1;
    deviceTotal += res.deviceTotal;
    deviceFlipsToDown += res.deviceFlipsToDown;
  }

  // Sanity gate (§7): fleet-wide down-flips. Recorded now; fronts the (still
  // disabled) canonical apply. In shadow nothing is applied, so this is advisory.
  const sanity = evaluateSanityGate({ totalInScope: deviceTotal, flippingToDown: deviceFlipsToDown, maxPct: control.flags.sanityMaxFleetFlipPct });

  if (checkRows.length > 0) await db.insert(orchestratorDevicesChecks).values(checkRows);

  await db.update(orchestratorDevicesRuns).set({
    finishedAt: new Date(), scanned, changed, skipped, failures,
    notes: {
      mode: canonicalWritesAllowed(control.flags) ? 'canonical' : 'shadow',
      deviceTotal, deviceFlipsToDown,
      sanity: { held: sanity.held, flippedPct: Number(sanity.flippedPct.toFixed(1)), reason: sanity.reason ?? null },
    },
  }).where(eq(orchestratorDevicesRuns.id, runId));

  log('info', 'centrals sweep done', {
    due: due.length, scanned, changed, skipped, failures, deviceTotal, deviceFlipsToDown,
    mode: canonicalWritesAllowed(control.flags) ? 'canonical' : 'shadow', sanityHeld: sanity.held,
  });
  if (sanity.held) log('warn', 'sanity gate would HOLD canonical writes', { reason: sanity.reason });
}
