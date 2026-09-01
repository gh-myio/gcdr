// =============================================================================
// orchestrator-devices — incident emission (RFC-0062 §8, item 8)
//
// Scope of this round: CENTRAL_OFFLINE + DEVICE_OFFLINE only (DEVICE_DEGRADED is
// deferred — degraded is noisier and needs calibration).
//
// GCDR DECIDES, ALARMS DISPATCHES: the worker pushes an incident candidate to the
// ALARMS multi-source ingestion endpoint (RFC-0031 POST /incidents/candidates);
// ALARMS owns persistence, lifecycle and the panel (RFC-0055 split).
//
// Guardrails (all enforced here or by the caller):
//   * dedupe key OMITS day (continuous state, §8) — one incident open while down;
//   * debounce: only after N consecutive down ticks; insufficient history ⇒ never
//     open (a first bad tick can't become an incident);
//   * cascade: a CENTRAL_UNREACHABLE device is UNKNOWN (not OFFLINE) so it is never
//     a DEVICE_OFFLINE candidate; AUTH_ERROR/CONFIG_ERROR never a CENTRAL_OFFLINE;
//   * emission behind the incident_emission_enabled flag; absent URL ⇒ dry-run;
//   * a POST failure NEVER throws (the canonical sweep must not fail on ALARMS);
//   * mode = PARTIAL (conservative — we do not claim full central coverage);
//   * the ALARMS token is NEVER logged.
// =============================================================================

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { orchestratorDevicesChecks } from '../../infrastructure/database/drizzle/schema';

export type IncidentKind = 'CENTRAL_OFFLINE' | 'DEVICE_OFFLINE';

export interface DownCandidate {
  kind: IncidentKind;
  entityType: 'central' | 'device';
  entityId: string;
  tenantId: string;
  customerId: string;
  centralId: string;
  causingSignal: string;
}

export interface IncidentCandidatePayload {
  kind: IncidentKind;
  mode: 'PARTIAL' | 'AUTHORITATIVE';
  source: string;
  status: 'OPEN';
  severity: 'CRITICAL' | 'HIGH';
  tenantId: string;
  customerId: string;
  centralId: string;
  deviceId?: string;
  dedupeKey: string;
  detectedAt: string;
  evidence: { causingSignal: string };
}

export interface EmitConfig {
  emissionEnabled: boolean;
  apiUrl?: string;
  apiToken?: string;
}

export type EmitResult = 'posted' | 'dry-run' | 'failed' | 'disabled';
type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;

const SEVERITY: Record<IncidentKind, 'CRITICAL' | 'HIGH'> = { CENTRAL_OFFLINE: 'CRITICAL', DEVICE_OFFLINE: 'HIGH' };

/** Dedupe key OMITS day — offline is a continuous state (one incident while down),
 *  unlike RFC-0055 NO_CONSUMPTION which is a per-day rollup. */
export function dedupeKey(c: DownCandidate): string {
  return c.kind === 'CENTRAL_OFFLINE'
    ? `${c.tenantId}:${c.customerId}:central:${c.centralId}:${c.kind}`
    : `${c.tenantId}:${c.customerId}:device:${c.entityId}:${c.kind}`;
}

export function buildCandidatePayload(c: DownCandidate, detectedAtIso: string): IncidentCandidatePayload {
  return {
    kind: c.kind,
    mode: 'PARTIAL',
    source: 'gcdr-orchestrator-devices',
    status: 'OPEN',
    severity: SEVERITY[c.kind],
    tenantId: c.tenantId,
    customerId: c.customerId,
    centralId: c.centralId,
    ...(c.entityType === 'device' ? { deviceId: c.entityId } : {}),
    dedupeKey: dedupeKey(c),
    detectedAt: detectedAtIso,
    evidence: { causingSignal: c.causingSignal },
  };
}

/** Pure debounce: true iff the newest `requiredTicks` states are ALL down.
 *  Fewer than requiredTicks states ⇒ false (a first bad tick never opens). */
export function debounceSatisfied(recentStatesNewestFirst: string[], isDown: (s: string) => boolean, requiredTicks: number): boolean {
  if (requiredTicks < 1) return false;
  if (recentStatesNewestFirst.length < requiredTicks) return false;
  for (let i = 0; i < requiredTicks; i++) if (!isDown(recentStatesNewestFirst[i])) return false;
  return true;
}

export const isCentralDownState = (s: string): boolean => s === 'OFFLINE';
export const isDeviceDownState = (s: string): boolean => s.startsWith('OFFLINE');

/** Read the newest N check states for this entity (deterministic order) and apply
 *  the debounce. Uses only same entity_type/entity_id/monitor rows. */
export async function debounceForCandidate(c: DownCandidate, requiredTicks: number): Promise<boolean> {
  const rows = await db
    .select({ s: orchestratorDevicesChecks.computedState })
    .from(orchestratorDevicesChecks)
    .where(and(
      eq(orchestratorDevicesChecks.entityType, c.entityType),
      eq(orchestratorDevicesChecks.entityId, c.entityId),
      eq(orchestratorDevicesChecks.monitor, 'centrals'),
    ))
    .orderBy(desc(orchestratorDevicesChecks.createdAt), desc(orchestratorDevicesChecks.id))
    .limit(requiredTicks);
  const states = rows.map((r) => r.s ?? '');
  const isDown = c.kind === 'CENTRAL_OFFLINE' ? isCentralDownState : isDeviceDownState;
  return debounceSatisfied(states, isDown, requiredTicks);
}

/**
 * Emit a candidate: POST when enabled + URL present, else dry-run/log. NEVER
 * throws (a failing ALARMS must not fail the sweep) and NEVER logs the token.
 */
export async function emitCandidate(payload: IncidentCandidatePayload, config: EmitConfig, log: Logger): Promise<EmitResult> {
  if (!config.emissionEnabled) {
    log('info', 'incident candidate built — emission disabled, not posted', { kind: payload.kind, dedupeKey: payload.dedupeKey });
    return 'disabled';
  }
  if (!config.apiUrl) {
    log('info', 'incident candidate built — no ALARMS_API_URL, dry-run only', { kind: payload.kind, dedupeKey: payload.dedupeKey });
    return 'dry-run';
  }
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`; // never logged
    // apiUrl must already include /api/v1 → posts to .../api/v1/incidents/candidates (RFC-0031).
    const res = await fetch(`${config.apiUrl.replace(/\/$/, '')}/incidents/candidates`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log('warn', 'incident POST returned non-2xx (sweep continues)', { kind: payload.kind, status: res.status });
      return 'failed';
    }
    log('info', 'incident candidate posted to ALARMS', { kind: payload.kind, dedupeKey: payload.dedupeKey });
    return 'posted';
  } catch (err) {
    log('warn', 'incident POST failed (sweep continues)', { kind: payload.kind, error: err instanceof Error ? err.message : String(err) });
    return 'failed';
  }
}
