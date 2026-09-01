// =============================================================================
// orchestrator-devices — canonical apply (RFC-0062 item 7)
//
// Turns the shadow proposals into real writes on connection_status /
// connectivity_status / health_status — but ONLY behind three guards:
//   1. shadow_mode = false        (control.ts canonicalWritesAllowed)
//   2. canonical_writes_enabled = true
//   3. sanity gate held = false   (§7 — mass transition guard)
// If any guard fails, nothing canonical is written; the proposal stays in the
// shadow ledger and (on a sanity hold) a loud warning is logged.
//
// Writes are only-on-change (the caller passes only caused-transition rows),
// batched by target value, and audited (RFC-0009) ONLY for real transitions.
//
// Audit granularity mirrors incident cascade-suppression (§8): a central going
// unreachable is ONE meaningful event, so the 307 derived device→UNKNOWN
// (CENTRAL_UNREACHABLE) transitions are NOT each audited — the central's audit
// row carries the affected-device count instead. Non-cascade device transitions
// (a device's own ONLINE/OFFLINE/health change) ARE audited individually.
// =============================================================================

import { inArray } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { auditLogs, centrals, devices } from '../../infrastructure/database/drizzle/schema';
import { canonicalWritesAllowed, type OrchestratorFlags } from './control';

type AuditInsert = typeof auditLogs.$inferInsert;

export interface Transition {
  entityType: 'central' | 'device';
  entityId: string;
  tenantId: string;
  centralId: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  /** device transition driven purely by a central-down cascade (unknown_reason
   *  = CENTRAL_UNREACHABLE) — suppressed from individual audit. */
  cascade: boolean;
  causingSignal: string;
}

export interface CanonicalPlan {
  centralUpdates: { connectionStatus: string; ids: string[] }[];
  deviceUpdates: { connectivityStatus: string; healthStatus: string; unknownReason: string | null; ids: string[] }[];
  // Connectivity edges (old != new) so we bump last(Dis)connectedAt like the
  // DeviceRepository does — a health-only change within ONLINE must NOT re-stamp
  // lastConnectedAt, so these are edges, not "target == ONLINE/OFFLINE".
  deviceConnectedIds: string[]; // transitioned INTO ONLINE
  deviceDisconnectedIds: string[]; // transitioned INTO OFFLINE
  auditRows: AuditInsert[];
}

/** The three-guard gate. Pure — the unit tests target this directly. */
export function shouldApplyCanonical(flags: OrchestratorFlags, sanityHeld: boolean): boolean {
  return canonicalWritesAllowed(flags) && !sanityHeld;
}

function auditRow(t: Transition, eventType: string, extraMeta: Record<string, unknown> = {}): AuditInsert {
  return {
    tenantId: t.tenantId,
    eventType,
    eventCategory: 'SYSTEM_EVENT',
    auditLevel: 'STANDARD',
    action: 'UPDATE',
    description: `${t.entityType} ${eventType}`.slice(0, 500),
    entityType: t.entityType,
    entityId: t.entityId,
    actorType: 'SYSTEM',
    oldValues: t.oldValues,
    newValues: t.newValues,
    metadata: { monitor: 'orchestrator-devices', causingSignal: t.causingSignal, ...extraMeta },
  };
}

/**
 * Build the batched update + audit plan from a set of (already only-on-change)
 * transitions. Pure — no DB. This is what the tests exercise for grouping,
 * only-on-change, and audit-only-on-real-transition (with cascade suppression).
 */
export function planCanonicalWrites(transitions: Transition[]): CanonicalPlan {
  const centralTs = transitions.filter((t) => t.entityType === 'central');
  const deviceTs = transitions.filter((t) => t.entityType === 'device');

  // Central updates grouped by target status.
  const centralByStatus = new Map<string, string[]>();
  for (const t of centralTs) {
    const status = String(t.newValues.connectionStatus);
    const ids = centralByStatus.get(status) ?? [];
    ids.push(t.entityId);
    centralByStatus.set(status, ids);
  }

  // Device updates grouped by the (connectivity, health, unknownReason) triple.
  const deviceByTriple = new Map<string, { values: { connectivityStatus: string; healthStatus: string; unknownReason: string | null }; ids: string[] }>();
  for (const t of deviceTs) {
    const connectivityStatus = String(t.newValues.connectivityStatus);
    const healthStatus = String(t.newValues.healthStatus);
    const unknownReason = (t.newValues.unknownReason as string | null) ?? null;
    const key = `${connectivityStatus}|${healthStatus}|${unknownReason ?? ''}`;
    const bucket = deviceByTriple.get(key) ?? { values: { connectivityStatus, healthStatus, unknownReason }, ids: [] };
    bucket.ids.push(t.entityId);
    deviceByTriple.set(key, bucket);
  }

  // Cascade device counts per central — folded into the central's audit metadata
  // so the storm of derived transitions is represented by one number, not N rows.
  const cascadeByCentral = new Map<string, number>();
  for (const t of deviceTs) if (t.cascade) cascadeByCentral.set(t.centralId, (cascadeByCentral.get(t.centralId) ?? 0) + 1);

  const auditRows: AuditInsert[] = [
    ...centralTs.map((t) => {
      const cascadeDevices = cascadeByCentral.get(t.entityId) ?? 0;
      return auditRow(t, 'CENTRAL_CONNECTION_STATUS_CHANGED', cascadeDevices > 0 ? { cascadeDevices } : {});
    }),
    // Non-cascade device transitions only (cascade ones are covered by the central).
    ...deviceTs.filter((t) => !t.cascade).map((t) => auditRow(t, 'DEVICE_CONNECTIVITY_STATUS_CHANGED')),
  ];

  const deviceConnectedIds = deviceTs
    .filter((t) => t.oldValues.connectivityStatus !== 'ONLINE' && t.newValues.connectivityStatus === 'ONLINE')
    .map((t) => t.entityId);
  const deviceDisconnectedIds = deviceTs
    .filter((t) => t.oldValues.connectivityStatus !== 'OFFLINE' && t.newValues.connectivityStatus === 'OFFLINE')
    .map((t) => t.entityId);

  return {
    centralUpdates: [...centralByStatus].map(([connectionStatus, ids]) => ({ connectionStatus, ids })),
    deviceUpdates: [...deviceByTriple.values()].map((b) => ({ ...b.values, ids: b.ids })),
    deviceConnectedIds,
    deviceDisconnectedIds,
    auditRows,
  };
}

/** Execute a plan against the DB. Only-on-change + audit-only-on-transition are
 *  already baked into the plan (the caller passed only real transitions). */
export async function executeCanonicalPlan(plan: CanonicalPlan): Promise<{ applied: number; audited: number }> {
  const now = new Date();
  let applied = 0;
  for (const u of plan.centralUpdates) {
    // bump updatedAt so consumers see a fresh change stamp (not just the status).
    await db.update(centrals).set({ connectionStatus: u.connectionStatus as never, updatedAt: now }).where(inArray(centrals.id, u.ids));
    applied += u.ids.length;
  }
  for (const u of plan.deviceUpdates) {
    await db.update(devices).set({
      connectivityStatus: u.connectivityStatus as never,
      healthStatus: u.healthStatus as never,
      unknownReason: (u.unknownReason as never) ?? null,
      updatedAt: now,
    }).where(inArray(devices.id, u.ids));
    applied += u.ids.length;
  }
  // Mirror DeviceRepository: stamp last(Dis)connectedAt on the connectivity edge.
  if (plan.deviceConnectedIds.length > 0) {
    await db.update(devices).set({ lastConnectedAt: now }).where(inArray(devices.id, plan.deviceConnectedIds));
  }
  if (plan.deviceDisconnectedIds.length > 0) {
    await db.update(devices).set({ lastDisconnectedAt: now }).where(inArray(devices.id, plan.deviceDisconnectedIds));
  }
  if (plan.auditRows.length > 0) await db.insert(auditLogs).values(plan.auditRows);
  return { applied, audited: plan.auditRows.length };
}

export async function applyCanonical(transitions: Transition[]): Promise<{ applied: number; audited: number }> {
  return executeCanonicalPlan(planCanonicalWrites(transitions));
}
