import {
  decideRestoreAction,
  resolveMuteTimezone,
  type RestoreDecisionInput,
} from '../../../src/workers/orchestrator-devices/rulesCanonicalApply';

const TODAY = '2026-09-09';
const YESTERDAY = '2026-09-08';
const DEV = 'dev-1';

function input(over: Partial<RestoreDecisionInput> = {}): RestoreDecisionInput {
  return {
    muteDay: YESTERDAY,
    today: TODAY,
    deviceId: DEV,
    rule: { type: 'NO_CONSUMPTION', scopeType: 'DEVICE', scopeDeviceIds: [] }, // device already removed by the mute
    ...over,
  };
}

describe('decideRestoreAction — the day-rollover restore branch (RFC-0062 item 5)', () => {
  it('mute day still current (== today) ⇒ NOT_DUE', () => {
    expect(decideRestoreAction(input({ muteDay: TODAY }))).toBe('NOT_DUE');
  });

  it('mute day in the FUTURE (clock skew) ⇒ NOT_DUE (never restore early)', () => {
    expect(decideRestoreAction(input({ muteDay: '2026-09-10' }))).toBe('NOT_DUE');
  });

  it('day passed + rule DEVICE/NO_CONSUMPTION missing the device ⇒ RESTORE', () => {
    expect(decideRestoreAction(input())).toBe('RESTORE');
  });

  it('day passed + empty scope stays valid (RESTORE re-adds to [])', () => {
    expect(decideRestoreAction(input({ rule: { type: 'NO_CONSUMPTION', scopeType: 'DEVICE', scopeDeviceIds: [] } }))).toBe('RESTORE');
  });

  it('rule deleted ⇒ RULE_GONE (close pendency, nothing to re-add)', () => {
    expect(decideRestoreAction(input({ rule: null }))).toBe('RULE_GONE');
  });

  it('human changed scope_type away from DEVICE ⇒ SUPERSEDED_MANUAL', () => {
    expect(decideRestoreAction(input({ rule: { type: 'NO_CONSUMPTION', scopeType: 'CUSTOMER', scopeDeviceIds: [] } }))).toBe('SUPERSEDED_MANUAL');
  });

  it('rule type no longer NO_CONSUMPTION ⇒ SUPERSEDED_MANUAL', () => {
    expect(decideRestoreAction(input({ rule: { type: 'ALARM_THRESHOLD', scopeType: 'DEVICE', scopeDeviceIds: [] } }))).toBe('SUPERSEDED_MANUAL');
  });

  it('human already re-added the device to scope ⇒ SUPERSEDED_MANUAL (never double-add)', () => {
    expect(decideRestoreAction(input({ rule: { type: 'NO_CONSUMPTION', scopeType: 'DEVICE', scopeDeviceIds: [DEV] } }))).toBe('SUPERSEDED_MANUAL');
  });

  it('idempotent: a device already restored back into scope does not RESTORE again', () => {
    // second sweep sees the device present ⇒ SUPERSEDED_MANUAL, so restore fires exactly once
    const first = decideRestoreAction(input({ rule: { type: 'NO_CONSUMPTION', scopeType: 'DEVICE', scopeDeviceIds: [] } }));
    expect(first).toBe('RESTORE');
    const second = decideRestoreAction(input({ rule: { type: 'NO_CONSUMPTION', scopeType: 'DEVICE', scopeDeviceIds: [DEV] } }));
    expect(second).toBe('SUPERSEDED_MANUAL');
  });
});

describe('resolveMuteTimezone — persisted tz is authoritative (point #6)', () => {
  it('persisted row timezone wins', () => {
    expect(resolveMuteTimezone('America/Sao_Paulo', 'UTC')).toBe('America/Sao_Paulo');
  });
  it('legacy null row falls back to the live rule tz', () => {
    expect(resolveMuteTimezone(null, 'America/Manaus')).toBe('America/Manaus');
  });
  it('both absent ⇒ UTC', () => {
    expect(resolveMuteTimezone(null, undefined)).toBe('UTC');
    expect(resolveMuteTimezone(undefined, undefined)).toBe('UTC');
  });
  it('empty string is treated as absent', () => {
    expect(resolveMuteTimezone('', '')).toBe('UTC');
  });
});
