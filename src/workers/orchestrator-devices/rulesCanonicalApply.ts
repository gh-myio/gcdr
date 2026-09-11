// =============================================================================
// orchestrator-devices — Monitor D canonical apply (RFC-0062 item 5, DEVICE scope)
//
// Turns the shadow MUTE/RESTORE proposals into REAL writes on rules.scope_entity_ids
// for NO_CONSUMPTION + scope_type=DEVICE rules, behind the same gate as the other
// monitors: canonicalWritesAllowed(flags) === (!shadowMode && canonicalWritesEnabled).
// MASTER + monitor.rules are already gated in the worker tick before this runs.
//
// Correctness contract (product review):
//   MUTE  — re-validated UNDER a row lock (never trust the shadow snapshot):
//           tenant + type=NO_CONSUMPTION + status=ACTIVE + enabled + scope_type=DEVICE
//           + deviceId still in scope + no mute row yet for (rule,device,today). Only
//           then remove the device (version-bumped, so a concurrent human edit 409s)
//           and insert the canonical mute ledger row. Scope change + ledger insert are
//           ONE transaction — never one without the other.
//   RESTORE — driven by an INDEPENDENT query over the mute ledger (pending canonical
//           mutes whose local_day < today), NOT by whether the rule is still enabled /
//           capped. Re-validated under lock: a human scope edit / rule deletion CLOSES
//           the pendency with a reason WITHOUT re-adding the device; a still-DEVICE rule
//           missing the device gets it back (day rollover). At most one restore per mute.
//
// A restore's day comparison uses the timezone PERSISTED on the mute row (falls back to
// the rule's tz, then UTC for legacy rows) so it is unambiguous even if the rule changed.
// Nothing here throws to the caller: each unit runs in its own try/tx and logs on failure.
// =============================================================================

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { rules, orchestratorRuleMutes } from '../../infrastructure/database/drizzle/schema';
import type { NoConsumptionConfig } from '../../domain/entities/Rule';
import type { RuleProposalGroup } from './rulesMonitor';
import type { FlushTarget } from './bundleFlush';

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;

// rules.updated_by is a uuid column (no FK), so the actor must be a valid UUID —
// a plain label like 'orchestrator-devices' throws invalid-uuid. This fixed system
// id marks the row as written by the orchestrator-devices Monitor D (RFC-0062).
const ACTOR = '00000000-0000-0000-0000-0000000000d4';

/** Local calendar day ('YYYY-MM-DD') for a timezone. Falls back to UTC on a bad tz. */
function localDay(tz: string, nowMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

// ── pure restore-branch decision (unit-tested; the tx just executes the verdict) ──

export type RestoreDecision =
  | 'NOT_DUE'            // same local day — the mute is still current
  | 'RULE_GONE'          // rule deleted — close pendency, nothing to re-add
  | 'SUPERSEDED_MANUAL'  // human reshaped scope / re-added the device — close, don't re-add
  | 'RESTORE';           // genuine day rollover — re-add the device

export interface RestoreDecisionInput {
  muteDay: string; // 'YYYY-MM-DD' the mute belongs to
  today: string;   // 'YYYY-MM-DD' in the resolved timezone
  deviceId: string;
  /** the LIVE rule under lock, or null if it no longer exists */
  rule: { type: string; scopeType: string; scopeDeviceIds: string[] } | null;
}

/** The mute is restorable only when its day has fully passed AND the rule is still a
 *  DEVICE-scoped NO_CONSUMPTION rule that is currently MISSING the device. Any manual
 *  reshape (scope type change, device already re-added) or deletion ends the pendency
 *  without re-adding — the operator's edit is authoritative (points #3/#4). Pure. */
export function decideRestoreAction(input: RestoreDecisionInput): RestoreDecision {
  const { muteDay, today, deviceId, rule } = input;
  if (muteDay >= today) return 'NOT_DUE';
  if (!rule) return 'RULE_GONE';
  if (rule.type !== 'NO_CONSUMPTION' || rule.scopeType !== 'DEVICE') return 'SUPERSEDED_MANUAL';
  if (rule.scopeDeviceIds.includes(deviceId)) return 'SUPERSEDED_MANUAL';
  return 'RESTORE';
}

/** Timezone a pending mute's day comparison must use: the tz PERSISTED on the row, else
 *  the live rule's tz (legacy rows written before the column existed), else UTC. */
export function resolveMuteTimezone(rowTz: string | null | undefined, ruleTz: string | undefined): string {
  return rowTz || ruleTz || 'UTC';
}

export interface CanonicalApplyResult {
  muted: number;
  restored: number;
  skipped: number;      // proposals/pendencies that revalidation declined (not an error)
  errors: number;       // per-unit failures (rolled back)
  targets: FlushTarget[]; // customers whose bundle cache must be flushed
}

// ── MUTE ─────────────────────────────────────────────────────────────────────

/** Apply the MUTE actions from the shadow proposal groups, each re-validated under a
 *  row lock inside its own transaction. Returns per-unit tallies + flush targets. */
export async function applyRuleMutes(
  groups: RuleProposalGroup[],
  nowMs: number,
  log: Logger,
): Promise<CanonicalApplyResult> {
  const targets: FlushTarget[] = [];
  let muted = 0, skipped = 0, errors = 0;

  for (const g of groups) {
    if (g.cap.buckets === null) continue; // no cap ⇒ never a MUTE candidate
    for (const a of g.actions) {
      if (a.action !== 'MUTE') continue;
      try {
        const applied = await db.transaction(async (tx) => {
          // Lock the rule row; everything below re-validates the LIVE row, not the snapshot.
          const [rule] = await tx
            .select({
              id: rules.id,
              tenantId: rules.tenantId,
              customerId: rules.customerId,
              type: rules.type,
              status: rules.status,
              enabled: rules.enabled,
              scopeType: rules.scopeType,
              scopeEntityIds: rules.scopeEntityIds,
              scopeEntityOverrides: rules.scopeEntityOverrides,
              version: rules.version,
            })
            .from(rules)
            .where(and(eq(rules.tenantId, g.tenantId), eq(rules.id, g.ruleId)))
            .for('update');

          if (!rule) return 'skip'; // rule vanished since the snapshot
          if (rule.type !== 'NO_CONSUMPTION' || rule.status !== 'ACTIVE' || !rule.enabled) return 'skip';
          if (rule.scopeType !== 'DEVICE') return 'skip'; // this apply governs DEVICE scope only
          const scope = (rule.scopeEntityIds ?? []) as string[];
          if (!scope.includes(a.deviceId)) return 'skip'; // human already removed it (or never in scope)

          // Idempotent: one mute per (rule, device, local day). If ANY row exists for today
          // (active OR already restored), do not re-mutate — keeps scope + ledger consistent.
          const existing = await tx
            .select({ id: orchestratorRuleMutes.id })
            .from(orchestratorRuleMutes)
            .where(and(
              eq(orchestratorRuleMutes.ruleId, g.ruleId),
              eq(orchestratorRuleMutes.deviceId, a.deviceId),
              eq(orchestratorRuleMutes.localDay, g.today),
            ))
            .limit(1);
          if (existing.length > 0) return 'skip';

          // Remove the device from scope (version-bumped) + prune any orphan value-override.
          const nextScope = scope.filter((d) => d !== a.deviceId);
          const overrides = (rule.scopeEntityOverrides ?? null) as Record<string, unknown> | null;
          let nextOverrides = overrides;
          if (overrides && Object.prototype.hasOwnProperty.call(overrides, a.deviceId)) {
            const clone = { ...overrides };
            delete clone[a.deviceId];
            nextOverrides = Object.keys(clone).length > 0 ? clone : null;
          }

          const upd = await tx
            .update(rules)
            .set({
              scopeEntityIds: nextScope,
              scopeEntityOverrides: nextOverrides,
              version: rule.version + 1,
              updatedBy: ACTOR,
              updatedAt: new Date(nowMs),
            })
            .where(and(eq(rules.id, g.ruleId), eq(rules.version, rule.version))) // optimistic guard (belt & suspenders under the lock)
            .returning({ id: rules.id });
          if (upd.length === 0) return 'skip'; // concurrent write slipped in — retry next sweep

          await tx.insert(orchestratorRuleMutes).values({
            tenantId: g.tenantId,
            customerId: g.customerId,
            ruleId: g.ruleId,
            deviceId: a.deviceId,
            localDay: g.today,
            todayCount: a.todayCount ?? 0,
            maxDaily: g.cap.buckets as number,
            reason: 'DAILY_CAP',
            mode: 'canonical',
            timezone: g.timezone,
          });

          return { customerId: rule.customerId };
        });

        if (applied === 'skip') skipped += 1;
        else {
          muted += 1;
          targets.push({ tenantId: g.tenantId, customerId: applied.customerId ?? g.customerId });
        }
      } catch (e) {
        errors += 1;
        log('warn', 'rules canonical MUTE failed (rolled back; will retry next sweep)', {
          ruleId: g.ruleId, deviceId: a.deviceId, err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return { muted, restored: 0, skipped, errors, targets };
}

// ── RESTORE ──────────────────────────────────────────────────────────────────

/**
 * Restore devices whose auto-mute has rolled over. INDEPENDENT of current rule
 * eligibility (a disabled or now-uncapped rule must still have its stale mutes
 * restored) — driven purely by the ledger: canonical, still-pending, local_day < today.
 * Each pendency is re-validated under a lock; a manual scope edit / deleted rule closes
 * the pendency (reason recorded) WITHOUT re-adding the device.
 */
export async function applyRuleRestores(nowMs: number, log: Logger): Promise<CanonicalApplyResult> {
  const targets: FlushTarget[] = [];
  let restored = 0, skipped = 0, errors = 0;

  // Pending canonical mutes only. We compare local_day < today PER-ROW using the row's
  // persisted timezone, so we cannot pre-filter the day in SQL for mixed timezones — but
  // we DO cap the candidate set to "some row could be due" via the active index.
  const pending = await db
    .select({
      id: orchestratorRuleMutes.id,
      tenantId: orchestratorRuleMutes.tenantId,
      customerId: orchestratorRuleMutes.customerId,
      ruleId: orchestratorRuleMutes.ruleId,
      deviceId: orchestratorRuleMutes.deviceId,
      localDay: orchestratorRuleMutes.localDay,
      timezone: orchestratorRuleMutes.timezone,
    })
    .from(orchestratorRuleMutes)
    .where(and(isNull(orchestratorRuleMutes.restoredAt), eq(orchestratorRuleMutes.mode, 'canonical')));

  for (const m of pending) {
    try {
      const muteDay = String(m.localDay); // 'YYYY-MM-DD'
      const applied = await db.transaction(async (tx) => {
        // Lock the rule (may be gone). Read its tz to resolve legacy mutes with null timezone.
        const [rule] = await tx
          .select({
            id: rules.id,
            type: rules.type,
            scopeType: rules.scopeType,
            scopeEntityIds: rules.scopeEntityIds,
            version: rules.version,
            noConsumptionConfig: rules.noConsumptionConfig,
          })
          .from(rules)
          .where(and(eq(rules.tenantId, m.tenantId), eq(rules.id, m.ruleId)))
          .for('update');

        const scope = (rule?.scopeEntityIds ?? []) as string[];
        const cfgTz = rule ? ((rule.noConsumptionConfig ?? {}) as Partial<NoConsumptionConfig>).timezone : undefined;
        const tz = resolveMuteTimezone(m.timezone, cfgTz);
        const today = localDay(tz, nowMs);

        const decision = decideRestoreAction({
          muteDay,
          today,
          deviceId: m.deviceId,
          rule: rule ? { type: rule.type, scopeType: rule.scopeType, scopeDeviceIds: scope } : null,
        });
        if (decision === 'NOT_DUE') return 'not-due'; // same local day — mute is still current

        // Re-lock the mute row to avoid a double-restore race across ticks/processes.
        const [muteRow] = await tx
          .select({ id: orchestratorRuleMutes.id })
          .from(orchestratorRuleMutes)
          .where(and(eq(orchestratorRuleMutes.id, m.id), isNull(orchestratorRuleMutes.restoredAt)))
          .for('update');
        if (!muteRow) return 'skip'; // another worker restored it first

        // Non-RESTORE verdicts just close the pendency with the reason — no scope re-add.
        if (decision !== 'RESTORE') {
          await tx.update(orchestratorRuleMutes).set({ restoredAt: new Date(nowMs), reason: decision }).where(eq(orchestratorRuleMutes.id, m.id));
          return { closed: true, customerId: m.customerId };
        }

        // Genuine day-rollover restore: re-add the device (version-bumped) + close the mute.
        const upd = await tx
          .update(rules)
          .set({ scopeEntityIds: [...scope, m.deviceId], version: rule!.version + 1, updatedBy: ACTOR, updatedAt: new Date(nowMs) })
          .where(and(eq(rules.id, m.ruleId), eq(rules.version, rule!.version)))
          .returning({ id: rules.id });
        if (upd.length === 0) throw new Error('rule changed during restore'); // roll back, retry next sweep

        await tx.update(orchestratorRuleMutes).set({ restoredAt: new Date(nowMs), reason: 'DAY_ROLLOVER' }).where(eq(orchestratorRuleMutes.id, m.id));
        return { restored: true, customerId: m.customerId };
      });

      if (applied === 'not-due' || applied === 'skip') skipped += 1;
      else {
        // Both a genuine restore and a "closed/superseded" pendency change what the bundle
        // should serve for that customer — flush either way.
        if ('restored' in applied) restored += 1; else skipped += 1;
        if (applied.customerId) targets.push({ tenantId: m.tenantId, customerId: applied.customerId });
      }
    } catch (e) {
      errors += 1;
      log('warn', 'rules canonical RESTORE failed (rolled back; will retry next sweep)', {
        muteId: m.id, ruleId: m.ruleId, deviceId: m.deviceId, err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { muted: 0, restored, skipped, errors, targets };
}
