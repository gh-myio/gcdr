// =============================================================================
// orchestrator-devices worker — advisory lock (RFC-0062 §1)
//
// A session-level pg_try_advisory_lock on a DEDICATED (reserved) connection, so
// a scan never overlaps its own previous run and an accidental second instance
// (e.g. a rolling-deploy surge) never double-scans.
//
// This is INSURANCE, not HA. The MVP runs a single replica; HA is a non-goal
// (RFC-0062 §1). The lock is held per-scan (acquire → run → release), not for a
// leader's lifetime, which keeps a reserved socket from being pinned forever.
//
// Why it is safe here: there is no external transaction-pooler (PgBouncer) in
// front of Postgres, so a session-level lock stays valid as long as it runs on
// the same reserved socket — which reserveConnection() guarantees.
//
// Key namespace (registered in migration 0070): classid 0x4F44 ('OD'), objid
// 1=centrals, 2=devices, 3=os, 4=rules.
// =============================================================================

import { reserveConnection } from '../../infrastructure/database/drizzle/db';
import type { MonitorName } from './control';

const CLASS_ID = 0x4f44; // 'OD' — Orchestrator Devices
const OBJ_ID: Record<MonitorName, number> = { centrals: 1, devices: 2, os: 3, rules: 4 };

type Reserved = Awaited<ReturnType<typeof reserveConnection>>;

/**
 * Try to acquire the per-monitor lock. Returns a release() handle on success,
 * or null if another holder has it (skip this scan). Always release() in a
 * finally so the reserved socket returns to the pool.
 */
export async function acquireMonitorLock(
  monitor: MonitorName,
): Promise<{ release: () => Promise<void> } | null> {
  const objId = OBJ_ID[monitor];
  const reserved: Reserved = await reserveConnection();
  try {
    const rows = (await reserved`select pg_try_advisory_lock(${CLASS_ID}, ${objId}) as locked`) as Array<{ locked: boolean }>;
    const locked = rows[0]?.locked === true;
    if (!locked) {
      reserved.release();
      return null;
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          await reserved`select pg_advisory_unlock(${CLASS_ID}, ${objId})`;
        } finally {
          reserved.release();
        }
      },
    };
  } catch (err) {
    reserved.release();
    throw err;
  }
}

/** Run `fn` while holding the monitor lock; skip (return null) if not acquired. */
export async function withMonitorLock<T>(
  monitor: MonitorName,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lock = await acquireMonitorLock(monitor);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
