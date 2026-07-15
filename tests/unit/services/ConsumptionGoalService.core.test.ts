// RFC-0046 — core domain tests over a mocked repository (feedback P1.6).
// Covers: DEC-3 distribution at every level (leap-year aware), DEC-2 roll-up
// (SUM + weighted AVERAGE), the P1.1 deep-tree semantics (parent fills around
// finer children), the P1.2 residual rule with operator-confirmed hours, the
// P1.4 creation guard, the P1.5 atomic whole-year delete with key-stamped
// history, and the CSV import parser.

import { ConsumptionGoalService } from '../../../src/services/ConsumptionGoalService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import type {
  ConsumptionGoalRepository,
  ConsumptionGoalRow,
  ConsumptionGoalHourRow,
  GoalHourUpsert,
} from '../../../src/repositories/consumptionGoalRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '33333333-3333-3333-3333-333333333333';
const goalId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actor = '22222222-2222-2222-2222-222222222222';

const key = { tenantId, customerId, domain: 'ENERGY' as const, year: 2026 };
const tempKey = { tenantId, customerId, domain: 'TEMPERATURE' as const, year: 2026 };

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

function hourRow(
  month: number,
  day: number,
  hour: number,
  value: number,
  opts: { derived?: boolean; sourceLevel?: string } = {},
): ConsumptionGoalHourRow {
  return {
    goalId,
    month,
    day,
    hour,
    value: String(value),
    sourceLevel: opts.sourceLevel ?? 'HOUR',
    derived: opts.derived ?? false,
    updatedAt: new Date(),
    updatedBy: actor,
  } as ConsumptionGoalHourRow;
}

type MockedRepo = ConsumptionGoalRepository & { [K in keyof ConsumptionGoalRepository]: jest.Mock };

function makeRepo(overrides: Partial<Record<keyof ConsumptionGoalRepository, jest.Mock>> = {}) {
  const repo = {
    withTransaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
    getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'SUM', unit: 'kWh' }),
    findGoal: jest.fn().mockResolvedValue(null),
    findGoalById: jest.fn().mockResolvedValue(null),
    createGoal: jest.fn().mockResolvedValue(goalRow({ version: 1 })),
    bumpVersion: jest.fn().mockImplementation(async (_id, expected) =>
      expected === undefined || expected === 3 ? goalRow({ version: (expected ?? 3) + 1 }) : null,
    ),
    upsertHours: jest.fn().mockImplementation(async (_id: string, hours: GoalHourUpsert[]) => hours.length),
    deleteHours: jest.fn().mockResolvedValue(0),
    deleteGoal: jest.fn().mockResolvedValue(1),
    findHours: jest.fn().mockResolvedValue([]),
    appendHistory: jest.fn().mockResolvedValue({}),
    findHistory: jest.fn().mockResolvedValue([]),
    findHistoryByKey: jest.fn().mockResolvedValue([]),
    setMargin: jest.fn(),
    ...overrides,
  };
  return repo as unknown as MockedRepo;
}

const sumOf = (hours: GoalHourUpsert[]) => hours.reduce((a, h) => a + Number(h.value), 0);

// =============================================================================
// DEC-3 — distribution
// =============================================================================

describe('distribution (DEC-3, leap-year aware)', () => {
  it('YEAR bucket splits evenly over 8760 hours (non-leap)', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await service.replace(key, { annual: { value: 87600 } }, actor);

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(8760);
    expect(Number(hours[0].value)).toBeCloseTo(10, 9);
    expect(sumOf(hours)).toBeCloseTo(87600, 6);
    expect(hours.every((h) => h.derived && h.sourceLevel === 'YEAR')).toBe(true);
  });

  it('YEAR bucket covers 8784 hours on a leap year', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await service.replace({ ...key, year: 2028 }, { annual: { value: 8784 } }, actor);

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(8784);
    expect(hours.filter((h) => h.month === 2)).toHaveLength(29 * 24);
    expect(Number(hours[0].value)).toBeCloseTo(1, 9);
  });

  it('MONTH bucket splits over the exact month hour count', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await service.replace(key, { monthly: { '02': { value: 672 } } }, actor);

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(28 * 24); // fev/2026 não bissexto
    expect(Number(hours[0].value)).toBeCloseTo(1, 9);
  });

  it('AVERAGE domain copies the bucket value to every hour in scope', async () => {
    const repo = makeRepo({
      getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'AVERAGE', unit: 'C' }),
    });
    const service = new ConsumptionGoalService(repo);

    await service.replace(tempKey, { monthly: { '01': { value: 22.5 } } }, actor);

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(31 * 24);
    expect(hours.every((h) => Number(h.value) === 22.5)).toBe(true);
  });
});

// =============================================================================
// P1.1 — deep tree: parent fills around finer children
// =============================================================================

describe('deep tree replace (P1.1)', () => {
  it('keeps the month as default and overrides only the stated day — total preserved', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await service.replace(
      key,
      { monthly: { '01': { value: 3100, daily: { '15': { value: 200 } } } } },
      actor,
    );

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(31 * 24);

    const day15 = hours.filter((h) => h.day === 15);
    expect(day15).toHaveLength(24);
    expect(Number(day15[0].value)).toBeCloseTo(200 / 24, 9);
    expect(day15.every((h) => h.sourceLevel === 'DAY')).toBe(true);

    const rest = hours.filter((h) => h.day !== 15);
    expect(Number(rest[0].value)).toBeCloseTo(2900 / (30 * 24), 9);
    expect(rest.every((h) => h.sourceLevel === 'MONTH')).toBe(true);

    expect(sumOf(hours)).toBeCloseTo(3100, 6);
  });

  it('day + hour exception: the hour is confirmed, the day residual fills the other 23', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await service.replace(
      key,
      {
        monthly: {
          '03': { value: 3100, daily: { '10': { value: 500, hourly: { '08': { value: 100 } } } } },
        },
      },
      actor,
    );

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    const h08 = hours.find((h) => h.day === 10 && h.hour === 8)!;
    expect(Number(h08.value)).toBe(100);
    expect(h08.derived).toBe(false);

    const day10rest = hours.filter((h) => h.day === 10 && h.hour !== 8);
    expect(Number(day10rest[0].value)).toBeCloseTo(400 / 23, 9);

    expect(sumOf(hours)).toBeCloseTo(3100, 6);
  });

  it('rejects a fully-covered parent whose value conflicts with its children', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    const daily: Record<string, { value: number }> = {};
    for (let d = 1; d <= 28; d++) daily[String(d).padStart(2, '0')] = { value: 10 };

    await expect(
      service.replace(key, { monthly: { '02': { value: 999, daily } } }, actor),
    ).rejects.toThrow(ValidationError);
  });

  it('accepts a fully-covered parent whose value matches its children', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    const daily: Record<string, { value: number }> = {};
    for (let d = 1; d <= 28; d++) daily[String(d).padStart(2, '0')] = { value: 10 };

    const result = await service.replace(key, { monthly: { '02': { value: 280, daily } } }, actor);
    expect(result.distribution.hoursWritten).toBe(28 * 24);
  });
});

// =============================================================================
// P1.2 — merge residual with operator-confirmed hours
// =============================================================================

describe('merge with confirmed hours (P1.2)', () => {
  it('SUM: spreads only the residual over derived hours — total equals the bucket', async () => {
    const existing = [hourRow(3, 10, 8, 500, { derived: false })];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const service = new ConsumptionGoalService(repo);

    await service.merge(
      key,
      { buckets: [{ level: 'DAY', ref: '2026-03-10', value: 3500 }], expectedVersion: 3 },
      actor,
    );

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    // A hora confirmada NÃO é reescrita; as 23 derivadas dividem o residual.
    expect(hours).toHaveLength(23);
    expect(hours.some((h) => h.hour === 8)).toBe(false);
    expect(Number(hours[0].value)).toBeCloseTo(3000 / 23, 9);
    expect(sumOf(hours) + 500).toBeCloseTo(3500, 6);
  });

  it('SUM: rejects a bucket below its confirmed hours (negative residual)', async () => {
    const existing = [hourRow(3, 10, 8, 500, { derived: false })];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const service = new ConsumptionGoalService(repo);

    await expect(
      service.merge(key, { buckets: [{ level: 'DAY', ref: '2026-03-10', value: 400 }] }, actor),
    ).rejects.toThrow(ValidationError);
  });

  it('HOUR bucket overwrites a confirmed hour (explicit beats pinned)', async () => {
    const existing = [hourRow(3, 10, 8, 500, { derived: false })];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const service = new ConsumptionGoalService(repo);

    await service.merge(
      key,
      { buckets: [{ level: 'HOUR', ref: '2026-03-10T08', value: 750 }] },
      actor,
    );

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(1);
    expect(Number(hours[0].value)).toBe(750);
    expect(hours[0].derived).toBe(false);
  });

  it('AVERAGE: remaining hours keep the scope mean equal to the bucket value', async () => {
    const existing = [hourRow(1, 5, 12, 30, { derived: false })];
    const repo = makeRepo({
      getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'AVERAGE', unit: 'C' }),
      findGoal: jest.fn().mockResolvedValue(goalRow({ domain: 'TEMPERATURE', unit: 'C' })),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const service = new ConsumptionGoalService(repo);

    await service.merge(
      tempKey,
      { buckets: [{ level: 'DAY', ref: '2026-01-05', value: 20 }] },
      actor,
    );

    const hours = repo.upsertHours.mock.calls[0][1] as GoalHourUpsert[];
    expect(hours).toHaveLength(23);
    const fill = Number(hours[0].value);
    expect(fill).toBeCloseTo((20 * 24 - 30) / 23, 9);
    // média do escopo = (30 + 23 × fill) / 24 = 20
    expect((30 + 23 * fill) / 24).toBeCloseTo(20, 9);
  });
});

// =============================================================================
// DEC-2 — roll-up on read
// =============================================================================

describe('roll-up on read (DEC-2)', () => {
  it('SUM sums hours; nodes report finest sourceLevel and derived only when all derived', async () => {
    const rows = [
      hourRow(5, 13, 17, 1000, { derived: false, sourceLevel: 'HOUR' }),
      hourRow(5, 13, 18, 500, { derived: true, sourceLevel: 'MONTH' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(rows),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.get(key, 'hour', false);

    expect(result.tree.annual?.value).toBe(1500);
    expect(result.tree.monthly?.['05']).toMatchObject({
      value: 1500,
      sourceLevel: 'HOUR',
      derived: false,
    });
    expect(result.tree.daily?.['05-13']?.value).toBe(1500);
    expect(result.tree.hourly?.['05-13T17']?.value).toBe(1000);
  });

  it('AVERAGE weights by hour count (hour-weighted, not month-weighted)', async () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, h) => hourRow(1, 1, h, 10)),
      hourRow(2, 1, 0, 50),
    ];
    const repo = makeRepo({
      getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'AVERAGE', unit: 'C' }),
      findGoal: jest.fn().mockResolvedValue(goalRow({ domain: 'TEMPERATURE', unit: 'C' })),
      findHours: jest.fn().mockResolvedValue(rows),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.get(tempKey, 'month', false);

    // (10+10+10+50)/4 = 20 — e não a média das médias mensais (10+50)/2 = 30.
    expect(result.tree.annual?.value).toBe(20);
    expect(result.tree.monthly?.['01']?.value).toBe(10);
    expect(result.tree.monthly?.['02']?.value).toBe(50);
  });
});

// =============================================================================
// DEC-4 — optimistic version (incl. P1.4 creation guard)
// =============================================================================

describe('optimistic version (DEC-4, P1.4)', () => {
  it('PATCH with a stale expectedVersion raises VERSION_CONFLICT with the current version', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ version: 5 })),
    });
    const service = new ConsumptionGoalService(repo);

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 10 }], expectedVersion: 3 }, actor),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 5 });
  });

  it('P1.4: a positive expectedVersion against a NON-existent goal conflicts (currentVersion 0) instead of creating', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 10 }], expectedVersion: 7 }, actor),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 0 });
    expect(repo.createGoal).not.toHaveBeenCalled();
    expect(repo.upsertHours).not.toHaveBeenCalled();
  });

  it('first write without a guard creates the goal and lands on version 1 (no extra bump)', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    const result = await service.replace(key, { annual: { value: 100 } }, actor);

    expect(repo.createGoal).toHaveBeenCalled();
    expect(repo.bumpVersion).not.toHaveBeenCalled();
    expect(result.version).toBe(1);
  });
});

// =============================================================================
// P1.5 — atomic whole-year delete with auditable history
// =============================================================================

describe('whole-year delete (P1.5)', () => {
  it('runs guard + wipe + history + parent delete inside ONE transaction, history stamped with the goal key', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      deleteHours: jest.fn().mockResolvedValue(8760),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.remove(key, { expectedVersion: 3 }, actor);

    expect(repo.withTransaction).toHaveBeenCalledTimes(1);
    // history antes do deleteGoal
    const histOrder = repo.appendHistory.mock.invocationCallOrder[0];
    const delOrder = repo.deleteGoal.mock.invocationCallOrder[0];
    expect(histOrder).toBeLessThan(delOrder);

    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        customerId,
        domain: 'ENERGY',
        year: 2026,
        source: 'DELETE',
        actionLevel: 'YEAR',
        bucketRef: '2026',
        hoursAffected: 8760,
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({ deleted: { bucket: null, hoursRemoved: 8760 }, version: 0 });
  });

  it('a stale guard 409s and nothing is deleted', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ version: 9 })),
    });
    const service = new ConsumptionGoalService(repo);

    await expect(service.remove(key, { expectedVersion: 3 }, actor)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      currentVersion: 9,
    });
    expect(repo.deleteHours).not.toHaveBeenCalled();
    expect(repo.deleteGoal).not.toHaveBeenCalled();
  });

  it('404 when the year has no goal', async () => {
    const repo = makeRepo();
    const service = new ConsumptionGoalService(repo);

    await expect(service.remove(key, undefined, actor)).rejects.toThrow(NotFoundError);
  });

  it('get() of a deleted year still returns its history (key-based read)', async () => {
    const repo = makeRepo({
      findHistoryByKey: jest.fn().mockResolvedValue([
        {
          goalId,
          source: 'DELETE',
          actionLevel: 'YEAR',
          bucketRef: '2026',
          oldValue: null,
          newValue: null,
          bucketCount: 1,
          details: [],
          distributed: true,
          hoursAffected: 8760,
          version: 4,
          actor,
          changedAt: new Date('2026-07-14T12:00:00Z'),
        },
      ]),
    });
    const service = new ConsumptionGoalService(repo);

    const result = await service.get(key, 'month', true);

    expect(result.version).toBe(0);
    expect(result.history).toHaveLength(1);
    expect(result.history?.[0]).toMatchObject({ source: 'DELETE', bucketRef: '2026' });
  });
});

// =============================================================================
// CSV import
// =============================================================================

describe('CSV import', () => {
  it('dry-run parses, previews and persists NOTHING', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const service = new ConsumptionGoalService(repo);

    const csv = ['bucket,value', '2026-01,3100', '2026-02-15,120', 'not-a-ref,5', '2026-03,abc'].join('\n');
    const result = await service.importData(key, csv, true, undefined, actor);

    expect(result.okCount).toBe(2);
    expect(result.errorCount).toBe(2);
    expect(result.diagnostics.map((d) => d.line)).toEqual([4, 5]);
    expect(repo.withTransaction).not.toHaveBeenCalled();
    expect(repo.upsertHours).not.toHaveBeenCalled();
  });

  it('persist applies via merge semantics and appends ONE IMPORT history row with the goal key', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const service = new ConsumptionGoalService(repo);

    const csv = '2026-01,3100\n2026-02,2800';
    const result = await service.importData(key, csv, false, 3, actor);

    expect(repo.appendHistory).toHaveBeenCalledTimes(1);
    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'IMPORT', bucketCount: 2, tenantId, customerId, year: 2026 }),
      expect.anything(),
    );
    expect(result.version).toBe(4);
  });

  it('rejects a leap-day ref on a non-leap year', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const service = new ConsumptionGoalService(repo);

    const result = await service.importData(key, '2026-02-29,10', true, undefined, actor);
    expect(result.okCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });
});
