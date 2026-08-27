// =============================================================================
// RFC-0061 M8 — background workers bootstrap (pull sync + outbox drain).
//
// NOT wired yet: app.ts is frozen for this module PR. The wave-3 integration
// adds, next to the other subsystem starts in app.ts (`startRestoreSweep()`):
//
//   import { startInventoryExternalWorkers } from './services/inventory/InventoryExternalWorkers';
//   ...
//   try {
//     startInventoryExternalWorkers();
//   } catch (error) {
//     console.error('Failed to start the inventory external-sync workers:', error);
//   }
//
// Scheduling follows the codebase's standing pattern (setInterval + unref —
// CentralRestoreSweep): node-cron is NOT a dependency of this repo, so the RFC's
// "node-cron every 5 min" lands as an equivalent 5-min interval; swapping to
// node-cron later is a one-liner once the dependency is approved.
//
// v1 tenant scope (DEC-7 follow-up = per-tenant config via secretEnvelope):
// the workers only start when the env-based client is configured
// (MYIO_PRODUCTS_API_KEY) and pull for the single default tenant
// (INV_SYNC_TENANT_ID || DEFAULT_TENANT_ID || the seed default). The outbox
// drain is tenant-agnostic — it claims rows for every tenant, all dispatched
// through the same env-based client in v1.
//
// Shadow mode (J4): the pull runs with the env-resolved mode — writes only
// when INV_SYNC_LIVE=true; otherwise corrections are computed and logged.
// =============================================================================

import { inventoryExternalSyncService } from './InventoryExternalSyncService';
import { inventoryOutboxWorker } from './InventoryOutboxWorker';
import { isExternalPlatformConfigured } from './ExternalPlatformClient';
import { ConflictError } from '../../shared/errors/AppError';

const PULL_INTERVAL_MS = Number(process.env.INV_SYNC_PULL_INTERVAL_MS ?? String(5 * 60_000)); // 5 min (§M8)
const DRAIN_INTERVAL_MS = Number(process.env.INV_OUTBOX_DRAIN_INTERVAL_MS ?? String(30_000)); // 30 s

function syncTenantId(): string {
  return (
    process.env.INV_SYNC_TENANT_ID ||
    process.env.DEFAULT_TENANT_ID ||
    '11111111-1111-1111-1111-111111111111'
  );
}

let pullTimer: NodeJS.Timeout | null = null;
let drainTimer: NodeJS.Timeout | null = null;

async function pullTick(): Promise<void> {
  try {
    const report = await inventoryExternalSyncService.runPull(syncTenantId());
    // eslint-disable-next-line no-console -- worker heartbeat
    console.info(
      `[inv-external-sync] pull ${report.live ? 'LIVE' : 'SHADOW'}: total=${report.total} ignored=${report.ignored} changed=${report.changed} corrections=${report.corrections.length} problems=${report.problems.length}`,
    );
  } catch (err) {
    if (err instanceof ConflictError) return; // lease held elsewhere — single-flight working as designed
    // eslint-disable-next-line no-console -- worker diagnostics
    console.error('[inv-external-sync] pull tick failed:', err);
  }
}

async function drainTick(): Promise<void> {
  try {
    const result = await inventoryOutboxWorker.drainOnce();
    if (result.claimed > 0) {
      // eslint-disable-next-line no-console -- worker heartbeat
      console.info(
        `[inv-outbox] drain: claimed=${result.claimed} dispatched=${result.dispatched} failed=${result.failed} dead=${result.dead}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- worker diagnostics
    console.error('[inv-outbox] drain tick failed:', err);
  }
}

/**
 * Start both M8 workers on the long-running server. Idempotent; no-op when the
 * external platform client is not configured (MYIO_PRODUCTS_API_KEY unset).
 */
export function startInventoryExternalWorkers(): void {
  if (!isExternalPlatformConfigured()) {
    // eslint-disable-next-line no-console -- startup diagnostics
    console.info('[inv-external-sync] MYIO_PRODUCTS_API_KEY não configurada — workers M8 desativados');
    return;
  }
  if (!pullTimer) {
    pullTimer = setInterval(() => void pullTick(), PULL_INTERVAL_MS);
    pullTimer.unref?.(); // never keep the process alive for the worker alone
  }
  if (!drainTimer) {
    drainTimer = setInterval(() => void drainTick(), DRAIN_INTERVAL_MS);
    drainTimer.unref?.();
  }
}

export function stopInventoryExternalWorkers(): void {
  if (pullTimer) {
    clearInterval(pullTimer);
    pullTimer = null;
  }
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}
