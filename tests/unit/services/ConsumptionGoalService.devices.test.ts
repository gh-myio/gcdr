// RFC-0046 Addendum A (APPROVED rev. 2) — device-granular goals over a mocked
// repository and injected entry-meter resolver. Covers the §6 acceptance
// criteria that are unit-testable: implicit conversion (2), the residual
// arithmetic worked example (3), entry-set gating (11), rebalance (12),
// explicit removal (13) and the composition invariants (14).

import { ConsumptionGoalService } from '../../../src/services/ConsumptionGoalService';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';
import type {
  ConsumptionGoalRepository,
  ConsumptionGoalRow,
  ConsumptionGoalHourRow,
  GoalHourUpsert,
} from '../../../src/repositories/consumptionGoalRepository';
import type { Device } from '../../../src/domain/entities/Device';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '33333333-3333-3333-3333-333333333333';
const goalId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actor = '22222222-2222-2222-2222-222222222222';

const key = { tenantId, customerId, domain: 'ENERGY' as const, year: 2026 };

const A = 'aaaa0001-0000-4000-8000-000000000001';
const B = 'aaaa0002-0000-4000-8000-000000000002';
const C = 'aaaa0003-0000-4000-8000-000000000003';
const D = 'aaaa0004-0000-4000-8000-000000000004';

function meter(id: string, code: string, overrides: Partial<Device> = {}): Device {
  return {
    id,
    tenantId,
    customerId,
    code,
    name: code,
    label: code,
    meterRole: 'ENTRY',
    meterDomain: 'ENERGY',
    status: 'ACTIVE',
    ...overrides,
  } as Device;
}

const METER_A = meter(A, 'TRAFO_A');
const METER_B = meter(B, 'TRAFO_B');
const METER_C = meter(C, 'TRAFO_C');
const METER_D = meter(D, 'TRAFO_D');

function goalRow(overrides: Partial<ConsumptionGoalRow> = {}): ConsumptionGoalRow {
  return {
    id: goalId,
    tenantId,
    customerId,
    domain: 'ENERGY',
    year: 2026,
    unit: 'kWh',
    version: 3,
    granularity: 'CUSTOMER',
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
  opts: {
    deviceId?: string | null;
    allocation?: 'EXPLICIT' | 'RESIDUAL';
    derived?: boolean;
    sourceLevel?: string;
  } = {},
): ConsumptionGoalHourRow {
  return {
    goalId,
    month,
    day,
    hour,
    value: String(value),
    sourceLevel: opts.sourceLevel ?? 'MONTH',
    derived: opts.derived ?? true,
    deviceId: opts.deviceId ?? null,
    deviceKey: opts.deviceId ?? '00000000-0000-0000-0000-000000000000',
    deviceAllocation: opts.allocation ?? 'EXPLICIT',
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
    findGoalById: jest.fn().mockImplementation(async () => goalRow({ version: 4, granularity: 'DEVICE' })),
    createGoal: jest.fn().mockResolvedValue(goalRow({ version: 1 })),
    bumpVersion: jest.fn().mockImplementation(async (_id, expected) =>
      expected === undefined || expected === 3 ? goalRow({ version: (expected ?? 3) + 1 }) : null,
    ),
    upsertHours: jest.fn().mockImplementation(async (_id: string, hours: GoalHourUpsert[]) => hours.length),
    deleteHours: jest.fn().mockResolvedValue(0),
    deleteGoal: jest.fn().mockResolvedValue(1),
    updateGranularity: jest.fn().mockResolvedValue(undefined),
    findHours: jest.fn().mockResolvedValue([]),
    appendHistory: jest.fn().mockResolvedValue({}),
    findHistory: jest.fn().mockResolvedValue([]),
    findHistoryByKey: jest.fn().mockResolvedValue([]),
    setMargin: jest.fn(),
    ...overrides,
  };
  return repo as unknown as MockedRepo;
}

function makeService(
  repo: MockedRepo,
  entrySet: Device[] = [METER_A, METER_B, METER_C],
  lookup: Device[] = [METER_A, METER_B, METER_C, METER_D],
) {
  const entryMeters = jest.fn().mockResolvedValue(entrySet);
  const deviceLookup = jest.fn().mockImplementation(async (_t: string, ids: string[]) =>
    lookup.filter((d) => ids.includes(d.id)),
  );
  const service = new ConsumptionGoalService(repo, { entryMeters, deviceLookup });
  return { service, entryMeters, deviceLookup };
}

const upsertsOf = (repo: MockedRepo): GoalHourUpsert[] =>
  repo.upsertHours.mock.calls.flatMap((c) => c[1] as GoalHourUpsert[]);

const sumOf = (hours: GoalHourUpsert[]) => hours.reduce((a, h) => a + Number(h.value), 0);

// =============================================================================
// Criterion 2 — implicit CUSTOMER → DEVICE conversion
// =============================================================================

describe('implicit conversion (criterion 2)', () => {
  it('device write on a CUSTOMER goal converts: totals preserved, target EXPLICIT, others RESIDUAL', async () => {
    // Existing customer rows: day 2026-01-10, 24 hours of 120 (T = 2880).
    const existing = Array.from({ length: 24 }, (_, h) => hourRow(1, 10, h, 120));
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await service.merge(
      key,
      { buckets: [{ level: 'DAY', ref: '2026-01-10', value: 720 }], expectedVersion: 3 },
      actor,
      A,
    );

    // NULL-device rows replaced by the materialised decomposition.
    expect(repo.deleteHours).toHaveBeenCalledWith(goalId, { deviceId: null }, expect.anything());
    expect(repo.updateGranularity).toHaveBeenCalledWith(goalId, 'DEVICE', expect.anything());

    const upserts = upsertsOf(repo);
    const aRows = upserts.filter((u) => u.deviceId === A);
    const bRows = upserts.filter((u) => u.deviceId === B);
    const cRows = upserts.filter((u) => u.deviceId === C);
    expect(aRows).toHaveLength(24);
    expect(bRows).toHaveLength(24);
    expect(cRows).toHaveLength(24);
    // A: 720/24 = 30 per hour, EXPLICIT; B/C: (120 − 30)/2 = 45, RESIDUAL.
    expect(Number(aRows[0].value)).toBeCloseTo(30, 9);
    expect(aRows.every((u) => u.deviceAllocation === 'EXPLICIT')).toBe(true);
    expect(Number(bRows[0].value)).toBeCloseTo(45, 9);
    expect(bRows.every((u) => u.deviceAllocation === 'RESIDUAL')).toBe(true);
    // Hour-exact SUM before == after (2880).
    expect(sumOf(upserts)).toBeCloseTo(2880, 6);

    // ONE history entry recording the switch + the targeted device.
    expect(repo.appendHistory).toHaveBeenCalledTimes(1);
    const entry = repo.appendHistory.mock.calls[0][0];
    expect(entry.deviceId).toBe(A);
    expect(entry.details[0]).toMatchObject({ ref: 'granularity', note: 'CUSTOMER -> DEVICE' });
  });

  it('conversion overflow: device bucket above the stated total → GOAL_DEVICE_OVERFLOW', async () => {
    const existing = Array.from({ length: 24 }, (_, h) => hourRow(1, 10, h, 10)); // T = 240
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await expect(
      service.merge(key, { buckets: [{ level: 'DAY', ref: '2026-01-10', value: 480 }] }, actor, A),
    ).rejects.toMatchObject({ code: 'GOAL_DEVICE_OVERFLOW' });
  });
});

// =============================================================================
// Criterion 3 — residual arithmetic (the worked example)
// =============================================================================

describe('residual arithmetic (criterion 3)', () => {
  const H = { level: 'HOUR' as const, ref: '2026-01-01T00' };
  const deviceGoal = () => goalRow({ granularity: 'DEVICE' });

  it('group total on an empty DEVICE goal splits evenly (all RESIDUAL)', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(deviceGoal()) });
    const { service } = makeService(repo);

    await service.merge(key, { buckets: [{ ...H, value: 100 }], expectedVersion: 3 }, actor);

    const upserts = upsertsOf(repo);
    expect(upserts).toHaveLength(3);
    expect(upserts.every((u) => u.deviceAllocation === 'RESIDUAL')).toBe(true);
    expect(Number(upserts[0].value)).toBeCloseTo(100 / 3, 9);
  });

  it('pinning A=30 rebalances B and C to 35 each (total preserved)', async () => {
    const existing = [A, B, C].map((id) => hourRow(1, 1, 0, 100 / 3, { deviceId: id, allocation: 'RESIDUAL' }));
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(deviceGoal()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await service.merge(key, { buckets: [{ ...H, value: 30 }] }, actor, A);

    const upserts = upsertsOf(repo);
    const a = upserts.find((u) => u.deviceId === A)!;
    const b = upserts.find((u) => u.deviceId === B)!;
    const c = upserts.find((u) => u.deviceId === C)!;
    expect(Number(a.value)).toBe(30);
    expect(a.deviceAllocation).toBe('EXPLICIT');
    expect(Number(b.value)).toBeCloseTo(35, 6);
    expect(Number(c.value)).toBeCloseTo(35, 6);
    expect(sumOf(upserts)).toBeCloseTo(100, 6);
  });

  it('pinning B=40 next moves only C (→ 30)', async () => {
    const existing = [
      hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 35, { deviceId: B, allocation: 'RESIDUAL' }),
      hourRow(1, 1, 0, 35, { deviceId: C, allocation: 'RESIDUAL' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(deviceGoal()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await service.merge(key, { buckets: [{ ...H, value: 40 }] }, actor, B);

    const upserts = upsertsOf(repo);
    expect(upserts.find((u) => u.deviceId === A)).toBeUndefined(); // explicit untouched
    expect(Number(upserts.find((u) => u.deviceId === B)!.value)).toBe(40);
    expect(Number(upserts.find((u) => u.deviceId === C)!.value)).toBeCloseTo(30, 6);
  });

  it('raising the group total to 120 moves only the residual meter (C → 50)', async () => {
    const existing = [
      hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 40, { deviceId: B, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 30, { deviceId: C, allocation: 'RESIDUAL' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(deviceGoal()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await service.merge(key, { buckets: [{ ...H, value: 120 }] }, actor);

    const upserts = upsertsOf(repo);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].deviceId).toBe(C);
    expect(Number(upserts[0].value)).toBeCloseTo(50, 6);
  });

  it('explicit meters above the group total → GOAL_DEVICE_OVERFLOW', async () => {
    const existing = [
      hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 35, { deviceId: B, allocation: 'RESIDUAL' }),
      hourRow(1, 1, 0, 35, { deviceId: C, allocation: 'RESIDUAL' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(deviceGoal()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    // B explicit 80: share = 100 − 30 − 80 = −10.
    await expect(
      service.merge(key, { buckets: [{ ...H, value: 80 }] }, actor, B),
    ).rejects.toMatchObject({ code: 'GOAL_DEVICE_OVERFLOW' });
  });

  it('fully-explicit hour + inconsistent group total → 400', async () => {
    const existing = [
      hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 40, { deviceId: B, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 30, { deviceId: C, allocation: 'EXPLICIT' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(deviceGoal()),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo);

    await expect(
      service.merge(key, { buckets: [{ ...H, value: 120 }] }, actor),
    ).rejects.toThrow(ValidationError);
    // ...and a CONSISTENT total is accepted as a no-op.
    await expect(
      service.merge(key, { buckets: [{ ...H, value: 100 }] }, actor),
    ).resolves.toMatchObject({ distribution: { hoursWritten: 0 } });
  });
});

// =============================================================================
// Criterion 11 — entry-set gating (DEC-11)
// =============================================================================

describe('entry-set gating (criterion 11)', () => {
  it('422 GOAL_ENTRY_SET_UNDEFINED when no ENTRY meter is classified', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const { service } = makeService(repo, []); // empty entry set

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 100 }] }, actor, A),
    ).rejects.toMatchObject({ code: 'GOAL_ENTRY_SET_UNDEFINED' });
  });

  it('422 GOAL_DEVICE_NOT_ENTRY for a same-customer device that is not ENTRY-classified', async () => {
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const { service } = makeService(repo, [METER_B, METER_C]); // A not in set, but exists

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 100 }] }, actor, A),
    ).rejects.toMatchObject({ code: 'GOAL_DEVICE_NOT_ENTRY' });
  });

  it('404 for a device of another customer (no existence leak)', async () => {
    const foreign = meter(D, 'FOREIGN', { customerId: '99999999-9999-4999-8999-999999999999' });
    const repo = makeRepo({ findGoal: jest.fn().mockResolvedValue(goalRow()) });
    const { service } = makeService(repo, [METER_B], [foreign]);

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 100 }] }, actor, D),
    ).rejects.toThrow(NotFoundError);
  });

  it('AVERAGE domains reject DEVICE granularity (v1)', async () => {
    const repo = makeRepo({
      getOrSeedDomainConfig: jest.fn().mockResolvedValue({ aggregationMethod: 'AVERAGE', unit: 'C' }),
      findGoal: jest.fn().mockResolvedValue(goalRow({ domain: 'TEMPERATURE', unit: 'C' })),
    });
    const { service } = makeService(repo);

    await expect(
      service.merge(
        { ...key, domain: 'TEMPERATURE' },
        { buckets: [{ level: 'MONTH', ref: '2026-01', value: 20 }] },
        actor,
        A,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

// =============================================================================
// Criterion 13 — explicit removal (DEC-12)
// =============================================================================

describe('device removal (criterion 13)', () => {
  const rows = () => [
    hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
    hourRow(1, 1, 0, 35, { deviceId: B, allocation: 'RESIDUAL' }),
    hourRow(1, 1, 0, 35, { deviceId: C, allocation: 'RESIDUAL' }),
  ];

  it('removing an EXPLICIT device redistributes its share (total preserved)', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
      deleteHours: jest.fn().mockResolvedValue(1),
    });
    const { service } = makeService(repo);

    const result = await service.remove(key, { expectedVersion: 3 }, actor, A);

    expect(repo.deleteHours).toHaveBeenCalledWith(goalId, { deviceId: A }, expect.anything());
    const upserts = upsertsOf(repo);
    expect(Number(upserts.find((u) => u.deviceId === B)!.value)).toBeCloseTo(50, 6); // 35 + 15
    expect(Number(upserts.find((u) => u.deviceId === C)!.value)).toBeCloseTo(50, 6);
    expect(result?.version).toBe(4);
    expect(repo.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'DELETE', deviceId: A }),
      expect.anything(),
    );
  });

  it('409 GOAL_REMOVAL_MODE_REQUIRED when no residual meter can absorb', async () => {
    const allExplicit = [
      hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
      hourRow(1, 1, 0, 70, { deviceId: B, allocation: 'EXPLICIT' }),
    ];
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(allExplicit),
    });
    const { service } = makeService(repo);

    await expect(service.remove(key, undefined, actor, A)).rejects.toMatchObject({
      code: 'GOAL_REMOVAL_MODE_REQUIRED',
    });

    // ...and mode shrink-total proceeds without redistribution.
    const result = await service.remove(key, { mode: 'shrink-total' }, actor, A);
    expect(result).not.toBeNull();
    expect(upsertsOf(repo)).toHaveLength(0);
  });
});

// =============================================================================
// Criterion 12 — rebalance (DEC-12)
// =============================================================================

describe('rebalance (criterion 12)', () => {
  const rows = () => [
    hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
    hourRow(1, 1, 0, 70, { deviceId: B, allocation: 'RESIDUAL' }),
  ];

  it('dryRun previews entering meter without writing', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo, [METER_A, METER_B, METER_D]);

    const preview = await service.rebalance(key, true, 3, actor);

    expect(preview.dryRun).toBe(true);
    expect(preview.entering).toEqual([D]);
    expect(preview.leaving).toEqual([]);
    const b = preview.devices.find((d) => d.deviceId === B)!;
    const d = preview.devices.find((x) => x.deviceId === D)!;
    expect(b.annualBefore).toBeCloseTo(70, 6);
    expect(b.annualAfter).toBeCloseTo(35, 6);
    expect(d.annualAfter).toBeCloseTo(35, 6);
    expect(repo.upsertHours).not.toHaveBeenCalled();
    expect(repo.bumpVersion).not.toHaveBeenCalled();
  });

  it('apply bumps ONE version, writes the new pool and appends ONE REBALANCE entry', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo, [METER_A, METER_B, METER_D]);

    const result = await service.rebalance(key, false, 3, actor);

    expect(result.version).toBe(4);
    expect(repo.bumpVersion).toHaveBeenCalledTimes(1);
    const upserts = upsertsOf(repo);
    expect(Number(upserts.find((u) => u.deviceId === B)!.value)).toBeCloseTo(35, 6);
    expect(Number(upserts.find((u) => u.deviceId === D)!.value)).toBeCloseTo(35, 6);
    expect(repo.appendHistory).toHaveBeenCalledTimes(1);
    expect(repo.appendHistory.mock.calls[0][0]).toMatchObject({ source: 'REBALANCE' });
  });

  it('a declassified meter loses its RESIDUAL rows (leaving), EXPLICIT rows stay', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    // B declassified: entry set = A, D.
    const { service } = makeService(repo, [METER_A, METER_D]);

    const result = await service.rebalance(key, false, 3, actor);

    expect(result.leaving).toEqual([B]);
    expect(repo.deleteHours).toHaveBeenCalledWith(
      goalId,
      { deviceId: B, allocation: 'RESIDUAL' },
      expect.anything(),
    );
    const upserts = upsertsOf(repo);
    // D absorbs the whole residual share (70).
    expect(Number(upserts.find((u) => u.deviceId === D)!.value)).toBeCloseTo(70, 6);
  });

  it('registering a meter changes NO goal by itself (rebalance is explicit)', async () => {
    // Direct read with a larger entry set: get() must not mutate anything.
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo, [METER_A, METER_B, METER_D]);

    await service.get(key, 'month', false);

    expect(repo.upsertHours).not.toHaveBeenCalled();
    expect(repo.deleteHours).not.toHaveBeenCalled();
    expect(repo.updateGranularity).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Reads — consolidated tree, device filter, devices[] summary
// =============================================================================

describe('DEVICE-granular reads', () => {
  const rows = () => [
    hourRow(1, 1, 0, 30, { deviceId: A, allocation: 'EXPLICIT' }),
    hourRow(1, 1, 0, 35, { deviceId: B, allocation: 'RESIDUAL' }),
    hourRow(1, 1, 0, 35, { deviceId: C, allocation: 'RESIDUAL' }),
  ];

  it('consolidated tree SUMs across meters (hourly node aggregates all rows)', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo);

    const result = await service.get(key, 'hour', false);

    expect(result.granularity).toBe('DEVICE');
    expect(result.tree.annual?.value).toBeCloseTo(100, 6);
    expect(result.tree.hourly?.['01-01T00']?.value).toBeCloseTo(100, 6);
    // Consolidated nodes omit the per-device time meta (DEC-9).
    expect(result.tree.monthly?.['01']?.sourceLevel).toBeUndefined();
    expect(result.tree.monthly?.['01']?.derived).toBeUndefined();
  });

  it('?deviceId= filters the tree to one meter', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo);

    const result = await service.get(key, 'hour', false, A);

    expect(result.tree.annual?.value).toBeCloseTo(30, 6);
  });

  it('devices[] summary reports allocation and annual per meter', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(rows()),
    });
    const { service } = makeService(repo);

    const result = await service.get(key, 'month', false);

    expect(result.devices).toHaveLength(3);
    const a = result.devices!.find((d) => d.deviceId === A)!;
    const b = result.devices!.find((d) => d.deviceId === B)!;
    expect(a).toMatchObject({ code: 'TRAFO_A', allocation: 'EXPLICIT' });
    expect(a.annual).toBeCloseTo(30, 6);
    expect(b).toMatchObject({ allocation: 'RESIDUAL' });
    expect(b.annual).toBeCloseTo(35, 6);
  });

  it('CUSTOMER goals read exactly as before (granularity CUSTOMER, no devices block)', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow()),
      findHours: jest.fn().mockResolvedValue([hourRow(1, 1, 0, 100)]),
    });
    const { service } = makeService(repo);

    const result = await service.get(key, 'hour', false);

    expect(result.granularity).toBe('CUSTOMER');
    expect(result.devices).toBeUndefined();
    expect(result.tree.hourly?.['01-01T00']).toMatchObject({ value: 100, sourceLevel: 'MONTH' });
  });
});

// =============================================================================
// Criterion 14 — composition invariants (time residual × device residual)
// =============================================================================

describe('residual composition (criterion 14)', () => {
  it('a device MONTH bucket composes time distribution with device rebalance, drift ≤ 1e-6', async () => {
    // DEVICE goal: 24h of day 2026-02-01 with A residual 5/h, B residual 5/h (T=10/h).
    const existing = [A, B].flatMap((id) =>
      Array.from({ length: 24 }, (_, h) => hourRow(2, 1, h, 5, { deviceId: id, allocation: 'RESIDUAL' })),
    );
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE' })),
      findHours: jest.fn().mockResolvedValue(existing),
    });
    const { service } = makeService(repo, [METER_A, METER_B]);

    // Pin A with a DAY bucket of 72 → 3/h EXPLICIT; B absorbs → 7/h.
    await service.merge(key, { buckets: [{ level: 'DAY', ref: '2026-02-01', value: 72 }] }, actor, A);

    const upserts = upsertsOf(repo);
    const aRows = upserts.filter((u) => u.deviceId === A);
    const bRows = upserts.filter((u) => u.deviceId === B);
    expect(aRows).toHaveLength(24);
    expect(bRows).toHaveLength(24);
    expect(Number(aRows[0].value)).toBeCloseTo(3, 9);
    expect(Number(bRows[0].value)).toBeCloseTo(7, 9);
    // Day total preserved: 24 × 10 = 240.
    expect(Math.abs(sumOf(upserts) - 240)).toBeLessThanOrEqual(1e-6);
  });

  it('concurrent device writes: the loser gets VERSION_CONFLICT', async () => {
    const repo = makeRepo({
      findGoal: jest.fn().mockResolvedValue(goalRow({ granularity: 'DEVICE', version: 5 })),
      findHours: jest.fn().mockResolvedValue([]),
    });
    const { service } = makeService(repo);

    await expect(
      service.merge(key, { buckets: [{ level: 'MONTH', ref: '2026-01', value: 10 }], expectedVersion: 3 }, actor, A),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 5 });
    expect(repo.upsertHours).not.toHaveBeenCalled();
  });
});
