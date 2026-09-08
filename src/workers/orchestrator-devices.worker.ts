// =============================================================================
// orchestrator-devices — headless GCDR worker (RFC-0062)
//
// One process, three monitors (centrals / devices / os), scheduled off the
// request path. This entrypoint is the SCHEDULER + control/gate/lock plumbing:
//   * reads the live control plane every tick (MASTER ∧ per-monitor ∧ FLAGS);
//   * heartbeats so a stalled worker is detectable;
//   * runs each enabled monitor under a per-monitor advisory lock (no overlap,
//     no double-scan across an accidental second instance);
//   * never overlaps its own tick; shuts down gracefully.
//
// Deploy: `node dist/workers/orchestrator-devices.worker.js` (a Dokploy sibling
// of the API, same image). Single replica; HA is a non-goal (§1).
//
// NOTE: the monitor bodies (centrals-monitor, devices-monitor) are wired in the
// next batch. This skeleton gates + locks + heartbeats end-to-end and writes
// nothing canonical — it is safe to run as-is (idle observer).
// =============================================================================

import { waitForDatabaseReady } from '../infrastructure/database/drizzle/db';
import { workerConfig } from './orchestrator-devices/config';
import { loadControl, heartbeat, type ControlState, type MonitorName } from './orchestrator-devices/control';
import { withMonitorLock } from './orchestrator-devices/advisoryLock';
import { runCentralsSweep } from './orchestrator-devices/centralsMonitor';
import { runRulesSweep } from './orchestrator-devices/rulesMonitor';

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  const line = { t: new Date().toISOString(), svc: 'orchestrator-devices', level, msg, ...extra };
  // eslint-disable-next-line no-console -- worker structured logging
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

// A monitor's per-tick body. Filled in by the next batch (centrals/devices).
type MonitorFn = (control: ControlState) => Promise<void>;

const monitors: Record<MonitorName, MonitorFn> = {
  // Phase 1: one /v2/slaves probe per central reconciles the central AND all its
  // slaves (evidence always; status/health → shadow ledger). No fan-out.
  centrals: (control) => runCentralsSweep(control, log),
  // Phase 2: the per-slave telemetry pull fan-out (freshness gate, full health).
  devices: async () => {
    log('info', 'devices-monitor: Phase 2 telemetry fan-out — not yet implemented');
  },
  os: async () => {
    log('info', 'os-monitor: Phase 3 (contract-blocked) — skipped');
  },
  // Monitor D (RFC-0062 §11b): NO_CONSUMPTION daily-cap auto-mute/restore. SHADOW-only
  // on this branch — computes proposals to the ledger, never mutates rule scope.
  rules: (control) => runRulesSweep(control, log),
};

let stopping = false;
let ticking = false;
let timer: NodeJS.Timeout | null = null;

/** One scheduler tick: gate top-down, run each enabled monitor under its lock. */
async function runTick(): Promise<void> {
  if (ticking) {
    log('warn', 'previous tick still running — skipping this one (no-overlap)');
    return;
  }
  ticking = true;
  // Keep the heartbeat fresh DURING the tick: a long sweep (fleet of unreachable
  // gateways) must not let last_run_at go stale and look like a hung worker
  // (RFC-0062 hardening). Cleared in finally. Errors are swallowed — a missed
  // heartbeat must never crash the tick.
  const hb = setInterval(() => { void heartbeat().catch(() => {}); }, workerConfig.heartbeatIntervalMs);
  try {
    const control = await loadControl(workerConfig.masterEnabledBoot);
    await heartbeat(); // liveness stamp regardless of gates

    if (!control.masterEnabled) {
      log('info', 'MASTER off — idle (no probes, no writes)');
      return;
    }

    const order: MonitorName[] = ['centrals', 'devices', 'rules']; // os is Phase 3
    for (const name of order) {
      if (stopping) break;
      if (!control.monitors[name]) continue;

      const ran = await withMonitorLock(name, async () => {
        const started = Date.now();
        try {
          await monitors[name](control);
        } catch (err) {
          log('error', `${name}-monitor threw`, { error: err instanceof Error ? err.message : String(err) });
        }
        log('info', `${name}-monitor tick done`, { ms: Date.now() - started });
      });

      if (ran === null) {
        log('info', `${name}-monitor lock held elsewhere — skipped this tick`);
      }
    }
  } catch (err) {
    log('error', 'tick failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(hb);
    ticking = false;
  }
}

/** Sequential scheduler: schedule the next tick only after the current finishes
 *  (prevents overlap even if a tick runs long). */
function scheduleNext(): void {
  if (stopping) return;
  timer = setTimeout(async () => {
    await runTick();
    scheduleNext();
  }, workerConfig.tickIntervalMs);
}

async function main(): Promise<void> {
  log('info', 'starting', {
    tickIntervalMs: workerConfig.tickIntervalMs,
    masterEnabledBoot: workerConfig.masterEnabledBoot,
  });

  const dbReady = await waitForDatabaseReady();
  if (!dbReady) log('warn', 'database not ready at boot — continuing, ticks will retry');

  // First tick immediately, then on the interval.
  await runTick();
  scheduleNext();

  const shutdown = (signal: string) => {
    log('info', `received ${signal} — shutting down`);
    stopping = true;
    if (timer) clearTimeout(timer);
    // Give a running tick a moment to release its lock, then exit.
    const deadline = Date.now() + 10_000;
    const wait = setInterval(() => {
      if (!ticking || Date.now() > deadline) {
        clearInterval(wait);
        log('info', 'stopped');
        process.exit(0);
      }
    }, 200);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log('error', 'fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
