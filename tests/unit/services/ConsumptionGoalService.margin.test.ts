// RFC-0052 — Goal Margin Adjustment: pure unit tests over a mocked repository.
// Covers the overlay derivation (adjustedValue on every node), the upsert /
// no-op / clear flows, the MARGIN history rows and the optimistic 409.

import {
  ConsumptionGoalService,
  VersionConflictError,
} from '../../../src/services/ConsumptionGoalService';
import { NotFoundError } from '../../../src/shared/errors/AppError';
import type {
  ConsumptionGoalRepository,
  ConsumptionGoalRow,
  ConsumptionGoalHourRow,
} from '../../../src/repositories/consumptionGoalRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '84e0370e-636a-4741-9874-504b5e0b3577';
const goalId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actor = '22222222-2222-2222-2222-222222222222';

const key = { tenantId, customerId, domain: 'ENERGY' as const, year: 2026 };

function goalRow(overrides: Partial<ConsumptionGoalRow> = {}): ConsumptionGoalRow {
  return {
    id: goalId,
    tenantId,
    customerId,
    domain: 'ENERGY',
    year: 2026,
    unit: 'kWh',
    version: 3,
    goalMarginPct: null,
    goalMarginUpdatedBy: null,
    goalMarginUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: actor,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: actor,
    ...overrides,
  } as ConsumptionGoalRow;
}

function hourRow(month: number, day: number, hour: number, value: number): ConsumptionGoalHourRow {
  return {
    goalId,
    month,
    day,
    hour,
    value: String(value),
    sourceLevel: 'HOUR',
    derived: false,
    updatedAt: new Date(),
    updatedBy: actor,
  } as ConsumptionGoalHourRow;
}

/** Minimal repo mock; withTransaction just runs the callback with a fake tx. */
function makeRepo(overrides: Partial<Record<keyof ConsumptionGoalRepository, jest.Mock>> = {}) {
  const repo = {
    withTransaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'SUM', unit: 'kWh' }),
    findGoal: jest.fn().mockResolvedValue(null),
    findGoalById: jest.fn().mockResolvedValue(null),
    createGoal: jest.fn(),
    setMargin: jest.fn(),
    appendHistory: jest.fn().mockResolvedValue({}),
    findHours: jest.fn().mockResolvedValue([]),
    findHistory: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return repo as unknown as ConsumptionGoalRepository & Record<string, jest.Mock>;
}

describe('ConsumptionGoalService — RFC-0052 margin overlay', () => {
  // ---------------------------------------------------------------------------
  // Read-time derivation
  // ---------------------------------------------------------------------------

  it('get() derives adjustedValue on every node and returns the goalMargin block', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(
        goalRow({
          goalMarginPct: '-5.00',
          goalMarginUpdatedBy: actor,
          goalMarginUpdatedAt: new Date('2026-07-10T14:00:00Z'),
        }),
      ),
      findHours: jest.fn().mockResolvedValue([hourRow(5, 13, 17, 1000), hourRow(5, 13, 18, 500)]),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.get(key, 'hour', false);

    expect(result.goalMargin).toEqual({
      goalMarginPct: -5,
      updatedBy: actor,
      updatedAt: '2026-07-10T14:00:00.000Z',
    });
    expect(result.tree.annual).toMatchObject({ value: 1500, adjustedValue: 1425 });
    expect(result.tree.monthly?.['05']).toMatchObject({ value: 1500, adjustedValue: 1425 });
    expect(result.tree.daily?.['05-13']).toMatchObject({ value: 1500, adjustedValue: 1425 });
    expect(result.tree.hourly?.['05-13T17']).toMatchObject({ value: 1000, adjustedValue: 950 });
    expect(result.tree.hourly?.['05-13T18']).toMatchObject({ value: 500, adjustedValue: 475 });
  });

  it('get() without a margin keeps adjustedValue == value and goalMargin null', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue([hourRow(1, 1, 0, 123.456)]),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.get(key, 'hour', false);

    expect(result.goalMargin).toBeNull();
    expect(result.tree.hourly?.['01-01T00']).toMatchObject({ value: 123.456, adjustedValue: 123.456 });
  });

  // ---------------------------------------------------------------------------
  // setMargin
  // ---------------------------------------------------------------------------

  it('setMargin() on an existing goal bumps the version and appends a MARGIN history row', async () => {
    const existing = goalRow({ version: 3 });
    const bumped = goalRow({ version: 4, goalMarginPct: '-5.00', goalMarginUpdatedBy: actor, goalMarginUpdatedAt: new Date() });
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(existing),
      setMargin: jest.fn().mockResolvedValue(bumped),
      findHours: jest.fn().mockResolvedValue([]),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.setMargin(key, { goalMarginPct: -5, expectedVersion: 3 }, actor);

    expect(repo.setMargin).toHaveBeenCalledWith(goalId, '-5.00', 3, actor, true, expect.anything());
    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MARGIN',
        actionLevel: 'YEAR',
        bucketRef: '2026',
        oldValue: null,
        newValue: '-5.00',
        bucketCount: 0,
        hoursAffected: 0,
        version: 4,
      }),
      expect.anything(),
    );
    expect(result.version).toBe(4);
    expect(result.goalMargin?.goalMarginPct).toBe(-5);
  });

  it('setMargin() with the same pct is a no-op (no bump, no history)', async () => {
    const existing = goalRow({ version: 5, goalMarginPct: '-5.00' });
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(existing) });
    const service = new ConsumptionGoalService(repo);

    const result = await service.setMargin(key, { goalMarginPct: -5 }, actor);

    expect(repo.setMargin).not.toHaveBeenCalled();
    expect(repo.appendHistory).not.toHaveBeenCalled();
    expect(result.version).toBe(5);
  });

  it('setMargin() upserts the parent goal when the (domain, year) has none — version stays 1', async () => {
    const created = goalRow({ version: 1 });
    const withMargin = goalRow({ version: 1, goalMarginPct: '10.00' });
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(null),
      createGoal: jest.fn().mockResolvedValue(created),
      setMargin: jest.fn().mockResolvedValue(withMargin),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.setMargin(key, { goalMarginPct: 10 }, actor);

    expect(repo.createGoal).toHaveBeenCalled();
    // bump=false: the create IS the first change.
    expect(repo.setMargin).toHaveBeenCalledWith(goalId, '10.00', undefined, actor, false, expect.anything());
    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MARGIN', oldValue: null, newValue: '10.00', version: 1 }),
      expect.anything(),
    );
    expect(result.version).toBe(1);
    expect(result.goalMargin?.goalMarginPct).toBe(10);
  });

  it('setMargin() raises VERSION_CONFLICT (409) on a stale expectedVersion', async () => {
    const existing = goalRow({ version: 7 });
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(existing) });
    const service = new ConsumptionGoalService(repo);

    await expect(service.setMargin(key, { goalMarginPct: -5, expectedVersion: 6 }, actor)).rejects.toThrow(
      VersionConflictError,
    );
    expect(repo.setMargin).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // clearMargin
  // ---------------------------------------------------------------------------

  it('clearMargin() records old pct → null and bumps the version', async () => {
    const existing = goalRow({ version: 4, goalMarginPct: '-5.00' });
    const cleared = goalRow({ version: 5, goalMarginPct: null });
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(existing),
      setMargin: jest.fn().mockResolvedValue(cleared),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.clearMargin(key, 4, actor);

    expect(repo.setMargin).toHaveBeenCalledWith(goalId, null, 4, actor, true, expect.anything());
    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MARGIN', oldValue: '-5.00', newValue: null, version: 5 }),
      expect.anything(),
    );
    expect(result.goalMargin).toBeNull();
    expect(result.version).toBe(5);
  });

  it('clearMargin() is a no-op when no margin is set', async () => {
    const existing = goalRow({ version: 2, goalMarginPct: null });
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(existing) });
    const service = new ConsumptionGoalService(repo);

    const result = await service.clearMargin(key, undefined, actor);

    expect(repo.setMargin).not.toHaveBeenCalled();
    expect(repo.appendHistory).not.toHaveBeenCalled();
    expect(result.version).toBe(2);
  });

  it('clearMargin() 404s when the (domain, year) has no goal', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(null) });
    const service = new ConsumptionGoalService(repo);

    await expect(service.clearMargin(key, undefined, actor)).rejects.toThrow(NotFoundError);
  });
});
