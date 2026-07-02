import { centralRestoreJobRepository } from '../repositories/CentralRestoreJobRepository';
import { centralCommandRepository } from '../repositories/CentralCommandRepository';

// =============================================================================
// CR-S5: stalled restore-job + command sweep.
//
// A restore job / operational command is driven by the central reporting back
// (PATCH). If the central dies mid-flight it stops reporting, leaving the row
// RUNNING forever (the claim only looks at QUEUED, so it's never re-picked and
// never surfaced). This periodically fails such rows so the stall is visible for
// alerting / operator action.
//
// We reap to FAILED (not auto-requeue) because a pg_restore that died partway
// through RESTORE_DB may have left the central's embedded Postgres in a partial
// state that re-running could worsen — recovery is an operator decision. A
// command that stalled is likewise failed, not silently retried.
// =============================================================================

const RESTORE_STALL_TIMEOUT_MS = Number(
  process.env.RESTORE_STALL_TIMEOUT_MS ?? String(20 * 60 * 1000),
); // 20 min — RESTORE_DB legitimately runs long and reports infrequently.
// A reboot/restart reports (or the box comes back) within a couple of minutes;
// a command still RUNNING after this window means the central never came back.
const COMMAND_STALL_TIMEOUT_MS = Number(
  process.env.COMMAND_STALL_TIMEOUT_MS ?? String(5 * 60 * 1000),
); // 5 min
const SWEEP_INTERVAL_MS = Number(process.env.RESTORE_SWEEP_INTERVAL_MS ?? String(60 * 1000)); // 1 min

/**
 * Run a single sweep: fail RUNNING restore jobs that stopped reporting. Exported
 * so a cron/serverless invocation can drive it too. Returns the reaped count.
 */
export async function sweepStalledRestoreJobsOnce(): Promise<number> {
  const reaped = await centralRestoreJobRepository.reapStalledJobs(RESTORE_STALL_TIMEOUT_MS);
  if (reaped.length > 0) {
    console.warn(
      `[restore-sweep] failed ${reaped.length} stalled restore job(s): ` +
        reaped.map((r) => r.id).join(', '),
    );
  }
  return reaped.length;
}

/**
 * Run a single sweep: fail RUNNING operational commands that stopped reporting
 * (the central died mid-REBOOT / restart and never PATCHed a result). Returns
 * the reaped count.
 */
export async function sweepStalledCommandsOnce(): Promise<number> {
  const reaped = await centralCommandRepository.reapStalledJobs(COMMAND_STALL_TIMEOUT_MS);
  if (reaped.length > 0) {
    console.warn(
      `[command-sweep] failed ${reaped.length} stalled command(s): ` +
        reaped.map((r) => r.id).join(', '),
    );
  }
  return reaped.length;
}

/** Drive both sweeps for one tick; each is isolated so one failing can't skip the other. */
async function sweepOnce(): Promise<void> {
  await Promise.allSettled([sweepStalledRestoreJobsOnce(), sweepStalledCommandsOnce()]);
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic sweep on the long-running server. Idempotent. */
export function startRestoreSweep(): void {
  if (timer) return;
  // One immediate sweep catches rows orphaned by a server crash/restart.
  void sweepOnce().catch((err) => console.error('[restore-sweep] initial sweep failed', err));
  timer = setInterval(() => {
    void sweepOnce().catch((err) => console.error('[restore-sweep] sweep failed', err));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive for the sweep alone
}

export function stopRestoreSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
