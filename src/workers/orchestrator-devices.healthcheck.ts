// =============================================================================
// orchestrator-devices — container healthcheck (RFC-0062 §1)
//
// The worker serves no HTTP, so liveness is proven from the DB heartbeat: the
// worker stamps `orchestrator_devices_control.last_run_at` on EVERY tick, even
// when MASTER is off (it heartbeats before the master gate). A fresh timestamp
// therefore means the tick loop is alive; a stale one catches a crashed OR hung
// ("zombie") worker that a plain process check would miss.
//
// Exit 0 = healthy, exit 1 = unhealthy (Docker/Dokploy restarts on repeated 1).
// Invoked by docker-compose.dokploy.yml:
//   test: ["CMD", "node", "dist/workers/orchestrator-devices.healthcheck.js"]
// =============================================================================

import { eq } from 'drizzle-orm';
import { db } from '../infrastructure/database/drizzle/db';
import { orchestratorDevicesControl } from '../infrastructure/database/drizzle/schema';

const MAX_STALE_MS = Number.parseInt(process.env.HEALTHCHECK_MAX_STALE_MS ?? '180000', 10); // 3× the default 60s tick

async function main(): Promise<void> {
  const rows = await db
    .select({ lastRunAt: orchestratorDevicesControl.lastRunAt })
    .from(orchestratorDevicesControl)
    .where(eq(orchestratorDevicesControl.scope, 'MASTER'));

  const lastRunAt = rows[0]?.lastRunAt;
  if (!lastRunAt) {
    // No heartbeat yet — acceptable only during the container start_period, which
    // Dokploy/Docker enforces separately; outside it, this is unhealthy.
    console.error('healthcheck: no MASTER heartbeat yet');
    process.exit(1);
  }

  const ageMs = Date.now() - new Date(lastRunAt).getTime();
  if (ageMs > MAX_STALE_MS) {
    console.error(`healthcheck: heartbeat stale (${ageMs}ms > ${MAX_STALE_MS}ms) — worker crashed or hung`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console -- healthcheck output is operational signal
  console.log(`healthcheck: ok (heartbeat ${ageMs}ms ago)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('healthcheck: error', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
