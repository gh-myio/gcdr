import { decideRuleActions, type ActiveMute } from '../../../src/workers/orchestrator-devices/rulesDecision';
import { resolveDailyBucketCap } from '../../../src/workers/orchestrator-devices/rulesCap';

const cap3 = resolveDailyBucketCap({ maxDailyBucketsPerDay: 3 });
const noCap = resolveDailyBucketCap({ maxDailyBucketsPerDay: undefined });
const TODAY = '2026-09-04';
const YESTERDAY = '2026-09-03';
const RULE = 'rule-1';

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe('decideRuleActions — MUTE (over cap today)', () => {
  it('device at/above cap ⇒ MUTE; below ⇒ nothing', () => {
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: ['d1', 'd2'], counts: counts({ d1: 3, d2: 2 }), cap: cap3, activeMutes: [] });
    expect(a).toEqual([{ ruleId: RULE, deviceId: 'd1', action: 'MUTE', todayCount: 3, cap: 3, reason: 'DAILY_CAP' }]);
  });

  it('no cap ⇒ never mutes (fail-open) even at high counts', () => {
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: ['d1'], counts: counts({ d1: 99 }), cap: noCap, activeMutes: [] });
    expect(a).toEqual([]);
  });

  it('unknown count (device missing from ALARMS echo) ⇒ NO CHANGE (fail-safe)', () => {
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: ['d1'], counts: counts({}), cap: cap3, activeMutes: [] });
    expect(a).toEqual([]);
  });

  it('already muted today ⇒ not muted again (idempotent within the day)', () => {
    const muted: ActiveMute[] = [{ deviceId: 'd1', localDay: TODAY }];
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: ['d1'], counts: counts({ d1: 5 }), cap: cap3, activeMutes: muted });
    expect(a).toEqual([]);
  });
});

describe('decideRuleActions — RESTORE (day rollover)', () => {
  it('active mute from a previous day ⇒ RESTORE', () => {
    const muted: ActiveMute[] = [{ deviceId: 'd1', localDay: YESTERDAY }];
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: [], counts: counts({}), cap: cap3, activeMutes: muted });
    expect(a).toEqual([{ ruleId: RULE, deviceId: 'd1', action: 'RESTORE', todayCount: null, cap: 3, reason: 'DAY_ROLLOVER' }]);
  });

  it('active mute from TODAY ⇒ no restore (still within the day)', () => {
    const muted: ActiveMute[] = [{ deviceId: 'd1', localDay: TODAY }];
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: [], counts: counts({}), cap: cap3, activeMutes: muted });
    expect(a).toEqual([]);
  });

  it('rollover restore + a fresh over-cap mute can co-occur in one tick', () => {
    const muted: ActiveMute[] = [{ deviceId: 'old', localDay: YESTERDAY }];
    const a = decideRuleActions({ ruleId: RULE, today: TODAY, scopeDeviceIds: ['new'], counts: counts({ new: 4 }), cap: cap3, activeMutes: muted });
    expect(a).toContainEqual({ ruleId: RULE, deviceId: 'new', action: 'MUTE', todayCount: 4, cap: 3, reason: 'DAILY_CAP' });
    expect(a).toContainEqual({ ruleId: RULE, deviceId: 'old', action: 'RESTORE', todayCount: null, cap: 3, reason: 'DAY_ROLLOVER' });
  });
});
