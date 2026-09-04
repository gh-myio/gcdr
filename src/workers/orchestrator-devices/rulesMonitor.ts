// =============================================================================
// orchestrator-devices — Monitor D: rules-monitor (NO_CONSUMPTION auto-mute/restore)
//
// SHADOW-ONLY on this branch: it COMPUTES proposed MUTE/RESTORE actions and records
// them to the shadow ledger (orchestrator_devices_checks, monitor='rules') + logs a
// summary. It does NOT mutate rules.scope_entity_ids and does NOT write the
// orchestrator_rule_mutes ledger — canonical apply is a later batch (RFC-0062 item 5).
//
// The daily bucket count comes from ALARMS via a pluggable reader (mock on localhost,
// http once ALARMS RFC-0035 ships). Fail-safe: a device whose count can't be read is
// left UNKNOWN ⇒ NO CHANGE (never muted on missing data).
// =============================================================================

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import {
  rules,
  orchestratorRuleMutes,
  orchestratorDevicesRuns,
  orchestratorDevicesChecks,
} from '../../infrastructure/database/drizzle/schema';
import type { NoConsumptionConfig } from '../../domain/entities/Rule';
import type { ControlState } from './control';
import { workerConfig } from './config';
import { resolveDailyBucketCap, type DailyCap } from './rulesCap';
import { decideRuleActions, type RuleAction } from './rulesDecision';
import {
  MockAlarmsReader,
  HttpAlarmsReader,
  parseMockCounts,
  type AlarmsReader,
} from './alarmsReader';

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
type CheckInsert = typeof orchestratorDevicesChecks.$inferInsert;

export interface RuleProposalGroup {
  ruleId: string;
  tenantId: string;
  customerId: string;
  timezone: string;
  today: string;
  cap: DailyCap;
  scopeCount: number;
  countsChecked: number;
  actions: RuleAction[];
}

/** Local calendar day ('YYYY-MM-DD') for a timezone. Falls back to UTC on a bad tz. */
function localDay(tz: string, nowMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/** Build the configured ALARMS reader (mock unless explicitly http + a base URL). */
export function makeAlarmsReader(): AlarmsReader {
  if (workerConfig.rulesAlarmsReader === 'http' && workerConfig.alarmsReadUrl) {
    return new HttpAlarmsReader(workerConfig.alarmsReadUrl, workerConfig.alarmsReadToken);
  }
  return new MockAlarmsReader(parseMockCounts(workerConfig.rulesMockCounts));
}

/** Shared compute path (used by the sweep AND the cockpit preview): read eligible
 *  NO_CONSUMPTION rules, resolve counts + active mutes, decide proposed actions.
 *  Read-only — writes nothing. */
export async function computeRuleProposals(reader: AlarmsReader, nowMs: number): Promise<RuleProposalGroup[]> {
  const ruleRows = await db
    .select({
      id: rules.id,
      tenantId: rules.tenantId,
      customerId: rules.customerId,
      scopeEntityIds: rules.scopeEntityIds,
      noConsumptionConfig: rules.noConsumptionConfig,
    })
    .from(rules)
    .where(and(eq(rules.type, 'NO_CONSUMPTION'), eq(rules.enabled, true), eq(rules.status, 'ACTIVE')));

  const out: RuleProposalGroup[] = [];
  for (const r of ruleRows) {
    const cfg = (r.noConsumptionConfig ?? {}) as Partial<NoConsumptionConfig>;
    const cap = resolveDailyBucketCap(cfg);
    if (cap.buckets === null) continue; // fail-open: no cap ⇒ skip (no ALARMS call, no proposals)

    const tz = cfg.timezone || 'UTC';
    const today = localDay(tz, nowMs);
    const scope = (r.scopeEntityIds ?? []) as string[];

    // Counts — chunk at 500 (contract), fail-safe per chunk (a failed chunk leaves its
    // devices UNKNOWN ⇒ decideRuleActions makes NO CHANGE for them).
    const counts = new Map<string, number>();
    for (let i = 0; i < scope.length; i += 500) {
      const chunk = scope.slice(i, i + 500);
      if (chunk.length === 0) continue;
      try {
        const resp = await reader.dailyCounts({ customerId: r.customerId, kind: 'NO_CONSUMPTION', timezone: tz, deviceIds: chunk });
        for (const row of resp.counts) counts.set(row.deviceId, row.todayCount);
      } catch { /* fail-safe: unknown for this chunk */ }
    }

    const muteRows = await db
      .select({ deviceId: orchestratorRuleMutes.deviceId, localDay: orchestratorRuleMutes.localDay })
      .from(orchestratorRuleMutes)
      .where(and(eq(orchestratorRuleMutes.ruleId, r.id), isNull(orchestratorRuleMutes.restoredAt)));
    const activeMutes = muteRows.map((m) => ({ deviceId: m.deviceId, localDay: String(m.localDay) }));

    const actions = decideRuleActions({ ruleId: r.id, today, scopeDeviceIds: scope, counts, cap, activeMutes });
    out.push({ ruleId: r.id, tenantId: r.tenantId, customerId: r.customerId, timezone: tz, today, cap, scopeCount: scope.length, countsChecked: counts.size, actions });
  }
  return out;
}

/** The per-tick sweep (registered as the `rules` monitor). Shadow-only. */
export async function runRulesSweep(_control: ControlState, log: Logger): Promise<void> {
  const reader = makeAlarmsReader();
  const groups = await computeRuleProposals(reader, Date.now());

  let wouldMute = 0, wouldRestore = 0, scanned = 0;
  const checkRows: CheckInsert[] = [];
  for (const g of groups) {
    scanned += g.scopeCount;
    for (const a of g.actions) {
      if (a.action === 'MUTE') wouldMute += 1; else wouldRestore += 1;
      checkRows.push({
        runId: null,
        monitor: 'rules',
        entityType: 'device',
        entityId: a.deviceId,
        centralId: null,
        input: { todayCount: a.todayCount, cap: a.cap },
        computedState: a.action,
        proposedWrite: { ruleId: a.ruleId, action: a.action, todayCount: a.todayCount, cap: a.cap, reason: a.reason, mode: 'shadow' },
        causedTransition: false,
      });
    }
  }

  const [run] = await db.insert(orchestratorDevicesRuns).values({ monitor: 'rules' }).returning({ id: orchestratorDevicesRuns.id });
  for (const row of checkRows) row.runId = run.id;
  if (checkRows.length > 0) await db.insert(orchestratorDevicesChecks).values(checkRows);

  await db.update(orchestratorDevicesRuns).set({
    finishedAt: new Date(),
    scanned,
    changed: wouldMute + wouldRestore,
    notes: { reader: reader.kind, rules: groups.length, wouldMute, wouldRestore, mode: 'shadow (no rule writes on this branch)' },
  }).where(eq(orchestratorDevicesRuns.id, run.id));

  log('info', 'rules sweep done', { reader: reader.kind, rules: groups.length, scanned, wouldMute, wouldRestore, mode: 'shadow' });
}
