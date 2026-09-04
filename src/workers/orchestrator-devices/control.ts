// =============================================================================
// orchestrator-devices worker — live control plane (RFC-0062 §1/§9/§10)
//
// The worker reads the control rows at the TOP OF EVERY TICK. Three levels:
//   MASTER  — one switch stops/starts the entire tick.
//   CENTRALS / DEVICES / OS — per-monitor enable.
//   FLAGS   — rollback switches: shadow_mode, canonical_writes_enabled,
//             incident_emission_enabled (+ sanity + debounce knobs).
//
// Ships SAFE (migration 0070 seed): MASTER off, shadow on, canonical writes off,
// incident emission off — so a fresh deploy observes and shadows without ever
// touching canonical columns or paging anyone until ops deliberately promotes it.
// =============================================================================

import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { orchestratorDevicesControl } from '../../infrastructure/database/drizzle/schema';

export type MonitorName = 'centrals' | 'devices' | 'os' | 'rules';

export interface OrchestratorFlags {
  /** When true, the worker COMPUTES status/incidents and writes them to the
   *  shadow ledger (proposed_write) but never touches canonical columns. */
  shadowMode: boolean;
  /** Master gate for writing connection_status/connectivity_status/health_status. */
  canonicalWritesEnabled: boolean;
  /** Master gate for pushing incident candidates to ALARMS. */
  incidentEmissionEnabled: boolean;
  /** Sanity gate (§7): hold canonical writes if > this % of a scope flips. */
  sanityMaxFleetFlipPct: number;
  /** Incident debounce (§8): open only after N consecutive down ticks. */
  incidentOpenAfterTicks: number;
}

export const FLAG_DEFAULTS: OrchestratorFlags = {
  shadowMode: true,
  canonicalWritesEnabled: false,
  incidentEmissionEnabled: false,
  sanityMaxFleetFlipPct: 30,
  incidentOpenAfterTicks: 2,
};

export interface ControlState {
  masterEnabled: boolean;
  monitors: Record<MonitorName, boolean>;
  flags: OrchestratorFlags;
}

type FlagsConfig = {
  shadow_mode?: boolean;
  canonical_writes_enabled?: boolean;
  incident_emission_enabled?: boolean;
  sanity_max_fleet_flip_pct?: number;
  incident_open_after_ticks?: number;
};

/** Read all control rows once and resolve the effective control state. */
export async function loadControl(masterBootDefault: boolean): Promise<ControlState> {
  const rows = await db.select().from(orchestratorDevicesControl);
  const byScope = new Map(rows.map((r) => [r.scope, r]));

  const cfg = (byScope.get('FLAGS')?.config ?? {}) as FlagsConfig;

  return {
    masterEnabled: byScope.get('MASTER')?.enabled ?? masterBootDefault,
    monitors: {
      centrals: byScope.get('CENTRALS')?.enabled ?? true,
      devices: byScope.get('DEVICES')?.enabled ?? true,
      os: byScope.get('OS')?.enabled ?? false,
      rules: byScope.get('RULES')?.enabled ?? true, // Monitor D (RFC-0062 §11b); shadow-safe by default
    },
    flags: {
      shadowMode: cfg.shadow_mode ?? FLAG_DEFAULTS.shadowMode,
      canonicalWritesEnabled: cfg.canonical_writes_enabled ?? FLAG_DEFAULTS.canonicalWritesEnabled,
      incidentEmissionEnabled: cfg.incident_emission_enabled ?? FLAG_DEFAULTS.incidentEmissionEnabled,
      sanityMaxFleetFlipPct: cfg.sanity_max_fleet_flip_pct ?? FLAG_DEFAULTS.sanityMaxFleetFlipPct,
      incidentOpenAfterTicks: cfg.incident_open_after_ticks ?? FLAG_DEFAULTS.incidentOpenAfterTicks,
    },
  };
}

/** Heartbeat: stamp MASTER.last_run_at so a stalled worker is detectable
 *  (who-watches-the-watchman, §1). Does NOT touch updated_at (that is for
 *  config changes, not liveness). */
export async function heartbeat(): Promise<void> {
  await db
    .update(orchestratorDevicesControl)
    .set({ lastRunAt: new Date() })
    .where(eq(orchestratorDevicesControl.scope, 'MASTER'));
}

/** True when this write path is allowed to touch canonical columns:
 *  NOT in shadow mode AND canonical writes explicitly enabled. */
export function canonicalWritesAllowed(flags: OrchestratorFlags): boolean {
  return !flags.shadowMode && flags.canonicalWritesEnabled;
}
