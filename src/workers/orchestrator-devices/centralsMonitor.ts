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

import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import {
  centrals,
  devices,
  orchestratorDevicesRuns,
  orchestratorDevicesChecks,
  orchestratorDevicesStatusHistory,
  orchestratorRetryPolicies,
} from '../../infrastructure/database/drizzle/schema';
import { workerConfig, gatewayUrl } from './config';
import { probeGateway, type RetryAttempt, type RetryPolicy } from './gatewayClient';
import { classifyDevice, isDeviceTransition, type Classification } from './ladder';
import { evaluateSanityGate } from './sanityGate';
import { canonicalWritesAllowed, type ControlState } from './control';
import { centralVerdict, nextTimelineStatus, type TimelineStatus } from './verdict';
import { mapWithConcurrency } from './concurrency';
import { applyCanonical, shouldApplyCanonical, type Transition } from './canonicalApply';
import { buildCandidatePayload, debounceForCandidate, emitCandidate, type DownCandidate } from './incidents';

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
type CheckInsert = typeof orchestratorDevicesChecks.$inferInsert;
type StatusHistoryInsert = typeof orchestratorDevicesStatusHistory.$inferInsert;

interface CentralRow {
  id: string;
  tenantId: string;
  customerId: string;
  connectionStatus: string;
  checkIntervalSeconds: number | null;
  retryPolicy: string | null;
  lastGatewayCheckAt: Date | null;
  lastGatewaySuccessCheckAt: Date | null;
}
interface DeviceRow {
  id: string;
  tenantId: string;
  customerId: string;
  centralId: string | null;
  slaveId: number | null;
  connectivityStatus: string;
  healthStatus: string;
  unknownReason: string | null;
}

interface TimelineSignal {
  centralId: string;
  tenantId: string;
  customerId: string;
  reachable: boolean;
  genuineDown: boolean;
  pastGrace: boolean;
  probeResult: string;
}
interface CentralResult {
  checkRows: CheckInsert[];
  transitions: Transition[];
  downCandidates: DownCandidate[];
  changed: number;
  skipped: number;
  failed: boolean;
  deviceTotal: number;
  deviceFlipsToDown: number;
  timelineSignal: TimelineSignal;
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


function deviceCheckRow(runId: string, centralId: string, d: DeviceRow, cls: Classification, inputStatus: string | null, latencyMs: number, policy: string): { row: CheckInsert; transition: boolean; flipsToDown: boolean } {
  const transition = isDeviceTransition(d, cls);
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
  const now = new Date();
  const verdict = centralVerdict(outcome, c.connectionStatus, c.lastGatewaySuccessCheckAt, workerConfig.offlineGraceMin * 60_000, now.getTime());

  // ── Evidence (item 4) — ALWAYS written (not canonical status). last_gateway_check_at
  //    is the last ATTEMPT; last_gateway_success_check_at is stamped ONLY on success. ──
  await db.update(centrals).set({
    lastGatewayCheckAt: now,
    ...(outcome.ok ? { lastGatewaySuccessCheckAt: now } : {}),
    lastGatewayCheckLatencyMs: outcome.latencyMs,
    probeResult: verdict.probeResult,
  }).where(eq(centrals.id, c.id));

  const checkRows: CheckInsert[] = [];
  const transitions: Transition[] = [];
  const downCandidates: DownCandidate[] = [];
  let changed = 0, skipped = 0, deviceFlipsToDown = 0;

  // ── Incident candidate (item 8): only a GENUINE down opens CENTRAL_OFFLINE;
  //    AUTH_ERROR/CONFIG_ERROR never do. Debounce + emission decided by the caller. ──
  if (verdict.genuineDown && verdict.pastGrace) {
    downCandidates.push({ kind: 'CENTRAL_OFFLINE', entityType: 'central', entityId: c.id, tenantId: c.tenantId, customerId: c.customerId, centralId: c.id, causingSignal: `probe:${verdict.probeResult}` });
  }

  // ── Central status classification (item 5) → shadow ledger + transition. ──
  const centralTransition = verdict.proposedStatus !== c.connectionStatus;
  if (centralTransition) {
    changed += 1;
    transitions.push({
      entityType: 'central', entityId: c.id, tenantId: c.tenantId, centralId: c.id,
      oldValues: { connectionStatus: c.connectionStatus },
      newValues: { connectionStatus: verdict.proposedStatus },
      cascade: false, causingSignal: outcome.ok ? 'probe:OK' : `probe:${verdict.probeResult}`,
    });
  }
  checkRows.push({
    runId, monitor: 'centrals', entityType: 'central', entityId: c.id, centralId: c.id,
    input: { ok: outcome.ok, kind: outcome.ok ? null : outcome.kind, latencyMs: outcome.latencyMs, attempts: outcome.attempts, policy: policy.name },
    computedState: verdict.proposedStatus,
    proposedWrite: { connectionStatus: verdict.proposedStatus },
    causedTransition: centralTransition, latencyMs: outcome.latencyMs, policy: policy.name,
  });

  const payloadBySlave = new Map<number, string>();
  if (outcome.ok) for (const s of outcome.slaves) payloadBySlave.set(s.id, s.status);

  const dev = classifyDevices(c.id, centralDevices, verdict, payloadBySlave, outcome.latencyMs, policy.name, runId);
  checkRows.push(...dev.checkRows);
  transitions.push(...dev.transitions);
  downCandidates.push(...dev.downCandidates);
  changed += dev.changed;
  skipped += dev.skipped;
  deviceFlipsToDown += dev.deviceFlipsToDown;

  return { checkRows, transitions, downCandidates, changed, skipped, failed: !outcome.ok, deviceTotal: centralDevices.length, deviceFlipsToDown,
    timelineSignal: { centralId: c.id, tenantId: c.tenantId, customerId: c.customerId, reachable: verdict.reachable, genuineDown: verdict.genuineDown, pastGrace: verdict.pastGrace, probeResult: verdict.probeResult } };
}

interface DeviceLoopResult {
  checkRows: CheckInsert[];
  transitions: Transition[];
  downCandidates: DownCandidate[];
  changed: number;
  skipped: number;
  deviceFlipsToDown: number;
}

/** Classify every slave of one central from the probe payload (or the fallback
 *  when the central is unreachable). Pure of scheduling — just the per-device
 *  shadow classification + transition + DEVICE_OFFLINE candidate collection. */
function classifyDevices(
  centralId: string,
  centralDevices: DeviceRow[],
  verdict: ReturnType<typeof centralVerdict>,
  payloadBySlave: Map<number, string>,
  latencyMs: number,
  policyName: string,
  runId: string,
): DeviceLoopResult {
  const checkRows: CheckInsert[] = [];
  const transitions: Transition[] = [];
  const downCandidates: DownCandidate[] = [];
  let changed = 0, skipped = 0, deviceFlipsToDown = 0;

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

    const { row, transition, flipsToDown } = deviceCheckRow(runId, centralId, d, cls, inputStatus, latencyMs, policyName);
    if (transition) {
      changed += 1;
      transitions.push({
        entityType: 'device', entityId: d.id, tenantId: d.tenantId, centralId,
        oldValues: { connectivityStatus: d.connectivityStatus, healthStatus: d.healthStatus, unknownReason: d.unknownReason },
        newValues: { connectivityStatus: cls.connectivity, healthStatus: cls.health, unknownReason: cls.unknownReason },
        cascade: cls.unknownReason === 'CENTRAL_UNREACHABLE',
        causingSignal: inputStatus ?? 'unknown',
      });
    }
    // DEVICE_OFFLINE candidate: only a real OFFLINE (gateway said offline). A
    // cascade device is UNKNOWN (CENTRAL_UNREACHABLE), never OFFLINE, so it is
    // naturally excluded here — no device-offline storm behind a down central.
    if (cls.connectivity === 'OFFLINE') {
      downCandidates.push({ kind: 'DEVICE_OFFLINE', entityType: 'device', entityId: d.id, tenantId: d.tenantId, customerId: d.customerId, centralId, causingSignal: inputStatus ?? 'gateway:offline' });
    }
    if (flipsToDown) deviceFlipsToDown += 1;
    checkRows.push(row);
  }

  return { checkRows, transitions, downCandidates, changed, skipped, deviceFlipsToDown };
}

/** Decide + emit incident candidates (debounce → emit). A POST failure is
 *  swallowed by emitCandidate, so this never fails the sweep. */
async function emitIncidents(candidates: DownCandidate[], control: ControlState, log: Logger): Promise<{ posted: number; dryRun: number; disabled: number; debounced: number; failed: number }> {
  let posted = 0, dryRun = 0, disabled = 0, debounced = 0, failed = 0;
  const detectedAt = new Date().toISOString();
  const emitCfg = { emissionEnabled: control.flags.incidentEmissionEnabled, apiUrl: workerConfig.alarmsApiUrl, apiToken: workerConfig.alarmsApiToken };
  for (const cand of candidates) {
    const due = await debounceForCandidate(cand, control.flags.incidentOpenAfterTicks);
    if (!due) { debounced += 1; continue; }
    const r = await emitCandidate(buildCandidatePayload(cand, detectedAt), emitCfg, log);
    if (r === 'posted') posted += 1;
    else if (r === 'dry-run') dryRun += 1;
    else if (r === 'disabled') disabled += 1;
    else failed += 1;
  }
  return { posted, dryRun, disabled, debounced, failed };
}

export async function runCentralsSweep(control: ControlState, log: Logger): Promise<void> {
  const policies = await loadRetryPolicies();
  const defaultPolicy = policies.get(workerConfig.defaultRetryPolicy) ?? policies.get('default') ?? { name: 'default', attempts: [{ delay_ms: 0 }] };

  const enabled = (await db.select({
    id: centrals.id, tenantId: centrals.tenantId, customerId: centrals.customerId, connectionStatus: centrals.connectionStatus,
    checkIntervalSeconds: centrals.checkIntervalSeconds, retryPolicy: centrals.retryPolicy,
    lastGatewayCheckAt: centrals.lastGatewayCheckAt,
    lastGatewaySuccessCheckAt: centrals.lastGatewaySuccessCheckAt,
  }).from(centrals).where(and(
    eq(centrals.monitoringEnabled, true),
    eq(centrals.status, 'ACTIVE'), // never scan archived/inactive gateways, even if the flag is on
  ))) as CentralRow[];

  const due = enabled
    .filter((c) => isDue(c, workerConfig.checkIntervalSeconds, workerConfig.checkJitterPct))
    .slice(0, workerConfig.scanBatchSize);

  if (due.length === 0) {
    log('info', 'centrals sweep: no centrals due', { enabled: enabled.length });
    return;
  }

  const dueIds = due.map((c) => c.id);
  const deviceRows = (await db.select({
    id: devices.id, tenantId: devices.tenantId, customerId: devices.customerId, centralId: devices.centralId, slaveId: devices.slaveId,
    connectivityStatus: devices.connectivityStatus, healthStatus: devices.healthStatus, unknownReason: devices.unknownReason,
  }).from(devices).where(and(
    inArray(devices.centralId, dueIds),
    isNotNull(devices.slaveId),
    isNull(devices.deletedAt),
    eq(devices.status, 'ACTIVE'), // only monitor active devices — never write status on inactive ones
  ))) as DeviceRow[];

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
  const transitions: Transition[] = [];
  const downCandidates: DownCandidate[] = [];

  // Probe centrals with bounded concurrency (RFC-0062 hardening) — each keeps its
  // own per-central timeout and writes its own evidence; only HOW MANY run at once
  // changes. Results are merged in input order so counters/ledger are unchanged.
  const results = await mapWithConcurrency(due, workerConfig.probeConcurrency, (c) => {
    const policy = (c.retryPolicy && policies.get(c.retryPolicy)) || defaultPolicy;
    return processCentral(c, devicesByCentral.get(c.id) ?? [], policy, runId);
  });
  for (const res of results) {
    scanned += 1;
    checkRows.push(...res.checkRows);
    transitions.push(...res.transitions);
    downCandidates.push(...res.downCandidates);
    changed += res.changed;
    skipped += res.skipped;
    if (res.failed) failures += 1;
    deviceTotal += res.deviceTotal;
    deviceFlipsToDown += res.deviceFlipsToDown;
  }

  // Sanity gate (§7): fleet-wide down-flips — fronts BOTH canonical apply and
  // incident emission (a held gate blocks incidents too).
  const sanity = evaluateSanityGate({ totalInScope: deviceTotal, flippingToDown: deviceFlipsToDown, maxPct: control.flags.sanityMaxFleetFlipPct });

  // ── Canonical apply (item 7) — three guards: !shadow ∧ canonical_enabled ∧ !held. ──
  // Evidence (last_gateway_check_*/probe_result) was already written per central,
  // OUTSIDE this gate. Here we touch canonical status only-on-change + audit.
  let applied = 0, audited = 0;
  const wantCanonical = canonicalWritesAllowed(control.flags);
  let mode: 'shadow' | 'canonical' | 'held' = 'shadow';
  if (wantCanonical && sanity.held) {
    mode = 'held';
    log('warn', 'SANITY GATE HELD canonical writes — nothing applied, proposals kept in ledger', { reason: sanity.reason, wouldApply: transitions.length });
  } else if (shouldApplyCanonical(control.flags, sanity.held)) {
    mode = 'canonical';
    const r = await applyCanonical(transitions);
    applied = r.applied; audited = r.audited;
  }

  // Insert checks FIRST so the debounce query below sees this tick's state.
  if (checkRows.length > 0) await db.insert(orchestratorDevicesChecks).values(checkRows);

  // ── Durable connectivity timeline (append-ON-CHANGE) — one row per central whose
  //    ONLINE/DEGRADED/OFFLINE/UNKNOWN state differs from its last recorded state.
  //    Not pruned; records the PROPOSED state in shadow, canonical once live.
  //    Secondary observability: a failure here (e.g. migration 0072 not yet applied)
  //    must NEVER abort the canonical sweep — swallow + warn, like incident emission. ──
  // Surfaced in the run's notes so a timeline failure is VISIBLE in the DB (not only
  // in stdout) — otherwise a sweep looks 100% OK while the timeline is silently broken.
  let timelineInserted = 0;
  let timelineFailed = false;
  let timelineError: string | undefined;
  try {
    const lastStatus = await loadLastCentralStatus(dueIds);
    const historyRows: StatusHistoryInsert[] = [];
    for (const res of results) {
      const sig = res.timelineSignal;
      const last = lastStatus.get(sig.centralId) ?? null;
      const next: TimelineStatus = nextTimelineStatus(sig, last);
      if (next !== last) {
        historyRows.push({
          tenantId: sig.tenantId, customerId: sig.customerId, entityType: 'central',
          entityId: sig.centralId, centralId: sig.centralId,
          fromStatus: last, toStatus: next, probeResult: sig.probeResult, mode,
        });
      }
    }
    if (historyRows.length > 0) await db.insert(orchestratorDevicesStatusHistory).values(historyRows);
    timelineInserted = historyRows.length;
  } catch (err) {
    timelineFailed = true;
    timelineError = err instanceof Error ? err.message : String(err);
    log('warn', 'timeline history write failed (sweep continues)', { error: timelineError });
  }

  // ── Incidents (item 8) — sanity held blocks emission too. ──
  const inc = (!sanity.held && downCandidates.length > 0)
    ? await emitIncidents(downCandidates, control, log)
    : { posted: 0, dryRun: 0, disabled: 0, debounced: 0, failed: 0 };

  const incidents = { candidates: downCandidates.length, ...inc };

  await db.update(orchestratorDevicesRuns).set({
    finishedAt: new Date(), scanned, changed, skipped, failures,
    notes: {
      mode, applied, audited, transitions: transitions.length,
      deviceTotal, deviceFlipsToDown,
      sanity: { held: sanity.held, flippedPct: Number(sanity.flippedPct.toFixed(1)), reason: sanity.reason ?? null },
      incidents,
      timeline: { inserted: timelineInserted, failed: timelineFailed, ...(timelineError ? { error: timelineError } : {}) },
    },
  }).where(eq(orchestratorDevicesRuns.id, runId));

  log('info', 'centrals sweep done', {
    due: due.length, scanned, changed, skipped, failures, deviceTotal, deviceFlipsToDown,
    mode, applied, audited, sanityHeld: sanity.held, incidents,
    timeline: { inserted: timelineInserted, failed: timelineFailed },
  });

  // Keep the operational ledger bounded (§7/§8) — never audit_logs.
  await pruneLedger(workerConfig.ledgerRetentionDays);
}

/** Prune the high-frequency operational ledger beyond the retention window.
 *  Cheap: both tables are indexed on their timestamp. */
async function pruneLedger(retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  await db.delete(orchestratorDevicesChecks).where(lt(orchestratorDevicesChecks.createdAt, cutoff));
  await db.delete(orchestratorDevicesRuns).where(lt(orchestratorDevicesRuns.startedAt, cutoff));
  // NB: orchestrator_devices_status_history is intentionally NOT pruned — it is the
  // durable timeline (tiny: one row per state change), meant to outlive the ledger.
}

/** Last recorded timeline state per central (DISTINCT ON), to decide if this tick is a
 *  transition worth appending. Empty map for an empty id list. */
async function loadLastCentralStatus(centralIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (centralIds.length === 0) return m;
  // Build "IN ($1::uuid, $2::uuid, ...)" via sql.join — NOT `= ANY(${centralIds}::uuid[])`:
  // interpolating a JS array renders as a row `($1, $2, ...)`, and `(row)::uuid[]` is
  // invalid Postgres ("cannot cast type record to uuid[]"), which threw every tick.
  const ids = sql.join(centralIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (central_id) central_id, to_status
    FROM orchestrator_devices_status_history
    WHERE entity_type = 'central' AND central_id IN (${ids})
    ORDER BY central_id, created_at DESC
  `)) as unknown as Array<{ central_id: string; to_status: string }>;
  for (const r of rows) m.set(r.central_id, r.to_status);
  return m;
}
