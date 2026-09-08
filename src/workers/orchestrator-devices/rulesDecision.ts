// =============================================================================
// orchestrator-devices — rules-monitor decision logic (pure, no DB/IO)
//
// RFC-0062 Monitor D (NO_CONSUMPTION). Given a rule's scope, each device's canonical
// bucket count for the local day (from ALARMS, RFC-0035), the resolved cap, and the
// rule's currently-active auto-mutes, decide the proposed MUTE / RESTORE actions.
//
//   MUTE    — device in scope, over cap TODAY, not already muted today, count KNOWN.
//   RESTORE — an active mute from a PREVIOUS local day (the count reset at rollover).
//
// Fail-safe: a device whose count is UNKNOWN (ALARMS didn't echo it) is skipped —
// never muted on missing data. Pure ⇒ unit-testable without a DB.
// =============================================================================

import type { DailyCap } from './rulesCap';
import { isOverDailyCap } from './rulesCap';

export type RuleActionKind = 'MUTE' | 'RESTORE';

export interface RuleAction {
  ruleId: string;
  deviceId: string;
  action: RuleActionKind;
  todayCount: number | null; // the triggering count for MUTE; null for RESTORE
  cap: number | null;        // cap in buckets at decision time (null = no cap)
  reason: 'DAILY_CAP' | 'DAY_ROLLOVER';
}

export interface ActiveMute {
  deviceId: string;
  localDay: string; // 'YYYY-MM-DD'
}

export interface DecideInput {
  ruleId: string;
  today: string;               // local day 'YYYY-MM-DD'
  scopeDeviceIds: string[];    // devices currently in the rule scope
  counts: Map<string, number>; // deviceId -> todayCount (canonical buckets); MISSING = unknown
  cap: DailyCap;
  activeMutes: ActiveMute[];   // this rule's mutes with restored_at IS NULL
}

export function decideRuleActions(input: DecideInput): RuleAction[] {
  const { ruleId, today, scopeDeviceIds, counts, cap, activeMutes } = input;
  const actions: RuleAction[] = [];
  const mutedToday = new Set(activeMutes.filter((m) => m.localDay === today).map((m) => m.deviceId));

  // MUTE — over cap today, not already muted today, count known (fail-safe on unknown).
  for (const deviceId of scopeDeviceIds) {
    if (mutedToday.has(deviceId)) continue;
    const c = counts.get(deviceId);
    if (c === undefined) continue; // unknown count ⇒ NO CHANGE
    if (isOverDailyCap(c, cap)) {
      actions.push({ ruleId, deviceId, action: 'MUTE', todayCount: c, cap: cap.buckets, reason: 'DAILY_CAP' });
    }
  }

  // RESTORE — any active mute from a previous local day (count reset at the rollover).
  for (const m of activeMutes) {
    if (m.localDay !== today) {
      actions.push({ ruleId, deviceId: m.deviceId, action: 'RESTORE', todayCount: null, cap: cap.buckets, reason: 'DAY_ROLLOVER' });
    }
  }

  return actions;
}
