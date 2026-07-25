// RFC-0054 Phase 2 — money overlay math (GoalMoneyService) + fixed-point util.
// The RFC golden vectors are the shared oracle: V1 sum bands → "644.00",
// V2 tie 2.005 → "2.01". Also: zero-is-not-a-price coverage, margin composition.

import { GoalMoneyService, type MoneyRow, type MoneyDevice, type PriceAt } from '../../../src/services/GoalMoneyService';
import { parseScaled, roundHalfUpDiv, centsToDecimalString } from '../../../src/shared/utils/money';

const svc = new GoalMoneyService();
const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function specific(id: string): MoneyDevice {
  return { id, code: id.slice(0, 4), label: 'M', tariffCategory: 'SPECIFIC' };
}
function row(deviceId: string, month: number, day: number, hour: number, value: string): MoneyRow {
  return { deviceId, month, day, hour, value };
}

describe('money util — fixed point', () => {
  it('parses decimals to scaled BigInt', () => {
    expect(parseScaled('10.5', 6)).toBe(10_500_000n);
    expect(parseScaled('2.005000', 6)).toBe(2_005_000n);
    expect(parseScaled('4', 6)).toBe(4_000_000n);
  });
  it('rounds half-up away from zero', () => {
    expect(roundHalfUpDiv(2005n, 10n)).toBe(201n); // 200.5 → 201
    expect(roundHalfUpDiv(2004n, 10n)).toBe(200n); // 200.4 → 200
  });
  it('renders centavos', () => {
    expect(centsToDecimalString(64_400n)).toBe('644.00');
    expect(centsToDecimalString(201n)).toBe('2.01');
    expect(centsToDecimalString(5n)).toBe('0.05');
  });
});

describe('GoalMoneyService — golden vectors', () => {
  it('V1: sum of intraday bands → "644.00"', () => {
    const rows: MoneyRow[] = [];
    for (let h = 0; h <= 10; h++) rows.push(row(DEV_A, 7, 1, h, '10')); // @2
    for (let h = 11; h <= 14; h++) rows.push(row(DEV_A, 7, 1, h, '10')); // @3
    for (let h = 15; h <= 19; h++) rows.push(row(DEV_A, 7, 1, h, '12')); // @4
    for (let h = 20; h <= 23; h++) rows.push(row(DEV_A, 7, 1, h, '8'));  // @2
    const priceAt: PriceAt = (_c, _m, _d, h) =>
      h <= 10 ? '2.000000' : h <= 14 ? '3.000000' : h <= 19 ? '4.000000' : '2.000000';

    const res = svc.compute({ year: 2026, marginPct: null, rows, devices: [specific(DEV_A)], priceAt });
    expect(res.annual?.monetaryValue).toBe('644.00');
    expect(res.daily['07-01'].monetaryValue).toBe('644.00');
    expect(res.money.coverageComplete).toBe(true);
    expect(res.money.pricedHours).toBe(24);
    expect(res.money.totalHours).toBe(24);
  });

  it('V2: a half-centavo raw rounds half-up ("2.005" → "2.01")', () => {
    const res = svc.compute({
      year: 2026, marginPct: null,
      rows: [row(DEV_A, 7, 1, 0, '1')],
      devices: [specific(DEV_A)],
      priceAt: () => '2.005000',
    });
    expect(res.annual?.monetaryValue).toBe('2.01');
  });
});

describe('GoalMoneyService — margin composition', () => {
  it('monetaryValue uses the margin-adjusted quantity; monetaryRawValue the raw', () => {
    const res = svc.compute({
      year: 2026, marginPct: 10, // +10%
      rows: [row(DEV_A, 7, 1, 0, '1')],
      devices: [specific(DEV_A)],
      priceAt: () => '2.000000',
    });
    expect(res.annual?.monetaryValue).toBe('2.20');    // 1 × 1.1 × 2
    expect(res.annual?.monetaryRawValue).toBe('2.00'); // 1 × 2
  });
});

describe('GoalMoneyService — zero-is-not-a-price coverage', () => {
  it('excludes an uncategorized device (never priced 0) and reports it', () => {
    const devices: MoneyDevice[] = [
      specific(DEV_A),
      { id: DEV_B, code: 'B', label: 'Bomba', tariffCategory: null },
    ];
    const res = svc.compute({
      year: 2026, marginPct: null,
      rows: [row(DEV_A, 7, 1, 0, '10'), row(DEV_B, 7, 1, 0, '99')],
      devices,
      priceAt: () => '2.000000',
    });
    // Only DEV_A priced (10×2=20); DEV_B excluded, not 0-priced.
    expect(res.annual?.monetaryValue).toBe('20.00');
    expect(res.money.coverageComplete).toBe(false);
    expect(res.money.pricedHours).toBe(1);
    expect(res.money.totalHours).toBe(2);
    expect(res.money.uncategorizedDevices).toEqual([{ deviceId: DEV_B, code: 'B', label: 'Bomba' }]);
  });

  it('excludes a device-hour with no category tariff and reports the gap', () => {
    const res = svc.compute({
      year: 2026, marginPct: null,
      rows: [row(DEV_A, 3, 1, 0, '10'), row(DEV_A, 7, 1, 0, '10')],
      devices: [specific(DEV_A)],
      priceAt: (_c, m) => (m === 3 ? null : '2.000000'), // March unpriced
    });
    expect(res.annual?.monetaryValue).toBe('20.00'); // only July priced
    expect(res.money.coverageComplete).toBe(false);
    expect(res.money.tariffCoverageGaps.missingHours).toBe(1);
    expect(res.money.tariffCoverageGaps.missing).toContain('2026-03-01T00');
  });

  it('always returns the stable empty coverage shape when complete', () => {
    const res = svc.compute({
      year: 2026, marginPct: null,
      rows: [row(DEV_A, 7, 1, 0, '10')],
      devices: [specific(DEV_A)],
      priceAt: () => '1.000000',
    });
    expect(res.money.tariffCoverageGaps).toEqual({ missing: [], truncated: false, missingHours: 0 });
    expect(res.money.uncategorizedDevices).toEqual([]);
    expect(res.money.coverageComplete).toBe(true);
  });
});
