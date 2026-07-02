import { centralRestoreJobRepository } from '../repositories/CentralRestoreJobRepository';

// =============================================================================
// CR-S5: stalled restore-job sweep.
//
// A restore job is driven by the central reporting progress (PATCH). If the
// central dies mid-restore it stops reporting, leaving the job RUNNING forever
// (claimNextQueued only looks at QUEUED, so it's never re-picked and never
// surfaced). This periodically fails such jobs so the stall is visible for
// alerting / operator action.
//
// We reap to FAILED (not auto-requeue) because a pg_restore that died partway
// through RESTORE_DB may have left the central's embedded Postgres in a partial
// state that re-running could worsen — recovery is an operator decision.
// =============================================================================

const RESTORE_STALL_TIMEOUT_MS = Number(
  process.env.RESTORE_STALL_TIMEOUT_MS ?? String(20 * 60 * 1000),
); // 20 min — RESTORE_DB legitimately runs long and reports infrequently.
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

let timer: NodeJS.Timeout | null = null;

/** Start the periodic sweep on the long-running server. Idempotent. */
export function startRestoreSweep(): void {
  if (timer) return;
  // One immediate sweep catches jobs orphaned by a server crash/restart.
  void sweepStalledRestoreJobsOnce().catch((err) =>
    console.error('[restore-sweep] initial sweep failed', err),
  );
  timer = setInterval(() => {
    void sweepStalledRestoreJobsOnce().catch((err) =>
      console.error('[restore-sweep] sweep failed', err),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive for the sweep alone
}

export function stopRestoreSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
