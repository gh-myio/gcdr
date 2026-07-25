// RFC-0054 Phase 3 — financial (CURRENCY) goals via `measure`.
// Covers the measure identity + guard on ConsumptionGoalService.get / .replace:
//   - CURRENCY is only valid on a SUM domain (else 422 GOAL_MEASURE_INVALID);
//   - a CURRENCY read reports unit BRL and measure CURRENCY;
//   - omitting measure defaults to QUANTITY + the domain unit;
//   - findGoal / findHistoryByKey are queried measure-aware.
//
// The money/budget overlay (DEC-6, withMoney) is exercised in
// GoalMoneyService.test.ts and the money-path integration; here we isolate the
// measure semantics over a mocked repository.

import { ConsumptionGoalService } from '../../../src/services/ConsumptionGoalService';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '33333333-3333-3333-3333-333333333333';
const actor = '22222222-2222-2222-2222-222222222222';

const energyKey = { tenantId, customerId, domain: 'ENERGY' as const, year: 2026 };
const tempKey = { tenantId, customerId, domain: 'TEMPERATURE' as const, year: 2026 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSvc(cfg: { aggregationMethod: string; unit: string }, goal: any = null) {
  const repo = {
    getOrSeedDomainConfig: jest.fn().mockResolvedValue(cfg),
    findGoal: jest.fn().mockResolvedValue(goal),
    findHistoryByKey: jest.fn().mockResolvedValue([]),
    findHours: jest.fn().mockResolvedValue([]),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ConsumptionGoalService(repo as any);
  return { svc, repo };
}

describe('ConsumptionGoalService — RFC-0054 Phase 3 (measure)', () => {
  it('rejects a CURRENCY goal on a non-SUM domain with 422 GOAL_MEASURE_INVALID', async () => {
    const { svc } = makeSvc({ aggregationMethod: 'AVERAGE', unit: 'C' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc.get({ ...tempKey, measure: 'CURRENCY' } as any, 'month', false),
    ).rejects.toMatchObject({ code: 'GOAL_MEASURE_INVALID', statusCode: 422 });
  });

  it('allows a CURRENCY goal on a SUM domain and reports unit BRL', async () => {
    const { svc } = makeSvc({ aggregationMethod: 'SUM', unit: 'kWh' }, null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await svc.get({ ...energyKey, measure: 'CURRENCY' } as any, 'month', false);
    expect(res.measure).toBe('CURRENCY');
    expect(res.unit).toBe('BRL');
    expect(res.version).toBe(0);
  });

  it('defaults to QUANTITY and the domain unit when measure is omitted', async () => {
    const { svc, repo } = makeSvc({ aggregationMethod: 'SUM', unit: 'kWh' }, null);
    const res = await svc.get(energyKey, 'month', false);
    expect(res.measure).toBe('QUANTITY');
    expect(res.unit).toBe('kWh');
    expect(repo.findGoal).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'ENERGY', year: 2026 }),
    );
  });

  it('looks up history by the same measure key on a CURRENCY read', async () => {
    const { svc, repo } = makeSvc({ aggregationMethod: 'SUM', unit: 'kWh' }, null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.get({ ...energyKey, measure: 'CURRENCY' } as any, 'month', true);
    expect(repo.findHistoryByKey).toHaveBeenCalledWith(
      expect.objectContaining({ measure: 'CURRENCY' }),
      expect.any(Number),
    );
  });

  it('rejects a CURRENCY replace on a non-SUM domain with 422', async () => {
    const { svc } = makeSvc({ aggregationMethod: 'AVERAGE', unit: 'C' });
    await expect(
      svc.replace(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...tempKey, measure: 'CURRENCY' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { entries: [] } as any,
        actor,
      ),
    ).rejects.toMatchObject({ code: 'GOAL_MEASURE_INVALID', statusCode: 422 });
  });
});
