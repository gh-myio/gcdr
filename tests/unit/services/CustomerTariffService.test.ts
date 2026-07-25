// RFC-0054 Phase 1 — CustomerTariffService + TariffsDTO unit tests over a
// mocked repository. Covers: hourly distribution (8760/8784, leap-aware),
// finest-level-wins with an HOUR override, authored-structure roll-up, the
// optimistic version bump + conflict + first-write guard, sub-bucket delete
// scope, and the price/year validation contract.

import {
  CustomerTariffService,
  TariffVersionConflictError,
} from '../../../src/services/CustomerTariffService';
import {
  PriceSchema,
  GetTariffQuerySchema,
  validateTariffBucketsYear,
} from '../../../src/dto/request/TariffsDTO';
import type {
  CustomerTariffRepository,
  CustomerTariffRow,
  CustomerTariffHourRow,
  TariffHourUpsert,
} from '../../../src/repositories/customerTariffRepository';

const tenantId = '11111111-1111-1111-1111-111111111111';
const customerId = '84e0370e-636a-4741-9874-504b5e0b3577';
const tariffId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const key = { tenantId, customerId, domain: 'ENERGY' as const, category: 'SPECIFIC' as const, year: 2026 };

function headerRow(overrides: Partial<CustomerTariffRow> = {}): CustomerTariffRow {
  return {
    id: tariffId, tenantId, customerId, domain: 'ENERGY', category: 'SPECIFIC', year: 2026,
    unit: 'kWh', currency: 'BRL', tariffModel: 'FLAT', timezone: 'America/Sao_Paulo', version: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'), createdBy: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...overrides,
  } as CustomerTariffRow;
}

function hourRow(month: number, day: number, hour: number, price: string, sourceLevel: string, derived: boolean): CustomerTariffHourRow {
  return { tariffId, month, day, hour, price, sourceLevel, derived, updatedAt: new Date(), updatedBy: null } as CustomerTariffHourRow;
}

type MockedRepo = CustomerTariffRepository & { [K in keyof CustomerTariffRepository]: jest.Mock };

function makeRepo(overrides: Partial<Record<keyof CustomerTariffRepository, jest.Mock>> = {}) {
  const repo = {
    withTransaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
    findHeader: jest.fn().mockResolvedValue(null),
    findHeaderById: jest.fn().mockResolvedValue(null),
    createHeader: jest.fn().mockResolvedValue(headerRow({ version: 1 })),
    bumpVersion: jest.fn().mockImplementation((id: string, expected: number | undefined) =>
      Promise.resolve(headerRow({ version: (expected ?? 3) + 1 }))),
    findHours: jest.fn().mockResolvedValue([]),
    upsertHours: jest.fn().mockImplementation((_id: string, hours: TariffHourUpsert[]) => Promise.resolve(hours.length)),
    deleteHours: jest.fn().mockResolvedValue(0),
    deleteHeader: jest.fn().mockResolvedValue(undefined),
    appendHistory: jest.fn().mockResolvedValue(undefined),
    findHistoryByKey: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MockedRepo;
  return repo;
}

function upsertedHours(repo: MockedRepo): TariffHourUpsert[] {
  return repo.upsertHours.mock.calls[0][1] as TariffHourUpsert[];
}

describe('CustomerTariffService — distribution', () => {
  it('distributes an annual price to 8760 hours (non-leap 2026)', async () => {
    const repo = makeRepo();
    const svc = new CustomerTariffService(repo);
    // The controller passes DTO-canonicalized prices (6 decimals); the service
    // copies them verbatim (canonicalization is the DTO's job).
    const res = await svc.replace(key, { annual: { price: '1.500000' } }, null);
    expect(res.distribution.hoursWritten).toBe(8760);
    expect(upsertedHours(repo)).toHaveLength(8760);
    // every hour copies the same rate (not divided) at YEAR level, derived.
    const rows = upsertedHours(repo);
    expect(rows.every((r) => r.price === '1.500000' && r.sourceLevel === 'YEAR' && r.derived)).toBe(true);
  });

  it('distributes to 8784 hours in a leap year (2028, incl. 02-29)', async () => {
    const repo = makeRepo();
    const svc = new CustomerTariffService(repo);
    const res = await svc.replace({ ...key, year: 2028 }, { annual: { price: '2.000000' } }, null);
    expect(res.distribution.hoursWritten).toBe(8784);
    const has0229 = upsertedHours(repo).some((r) => r.month === 2 && r.day === 29 && r.hour === 0);
    expect(has0229).toBe(true);
  });

  it('finest level wins: a DAY price with an HOUR override', async () => {
    const repo = makeRepo();
    const svc = new CustomerTariffService(repo);
    await svc.replace(key, { monthly: { '07': { price: '2.000000', daily: { '01': { price: '2.000000', hourly: { '15': { price: '4.000000' } } } } } } }, null);
    const rows = upsertedHours(repo);
    // Only July written (31×24 = 744).
    expect(rows).toHaveLength(744);
    const h15 = rows.find((r) => r.month === 7 && r.day === 1 && r.hour === 15)!;
    const h0 = rows.find((r) => r.month === 7 && r.day === 1 && r.hour === 0)!;
    expect(h15).toMatchObject({ price: '4.000000', sourceLevel: 'HOUR', derived: false });
    expect(h0).toMatchObject({ price: '2.000000', sourceLevel: 'DAY', derived: true });
  });
});

describe('CustomerTariffService — roll-up (authored structure)', () => {
  it('reconstructs annual/day/hour bands from source_level', async () => {
    const rows: CustomerTariffHourRow[] = [
      hourRow(7, 1, 0, '2.000000', 'DAY', true),
      hourRow(7, 1, 15, '4.000000', 'HOUR', false),
      hourRow(1, 1, 0, '1.500000', 'YEAR', true),
    ];
    const repo = makeRepo({
      findHeader: jest.fn().mockResolvedValue(headerRow()),
      findHours: jest.fn().mockResolvedValue(rows),
    });
    const svc = new CustomerTariffService(repo);
    const res = await svc.get(key, 'hour', false);
    expect(res.tree.annual?.price).toBe('1.500000');
    expect(res.tree.daily?.['07-01']?.price).toBe('2.000000');
    expect(res.tree.hourly?.['07-01T15']?.price).toBe('4.000000');
    expect(res.tree.hourly?.['07-01T15']?.derived).toBe(false);
  });

  it('version 0 + empty tree when no tariff exists', async () => {
    const svc = new CustomerTariffService(makeRepo());
    const res = await svc.get(key, 'day', false);
    expect(res.version).toBe(0);
    expect(res.tree).toEqual({});
  });
});

describe('CustomerTariffService — optimistic concurrency', () => {
  it('bumps the version on an existing tariff write', async () => {
    const repo = makeRepo({ findHeader: jest.fn().mockResolvedValue(headerRow({ version: 3 })) });
    const svc = new CustomerTariffService(repo);
    const res = await svc.replace(key, { annual: { price: '1' } }, null);
    expect(repo.bumpVersion).toHaveBeenCalled();
    expect(res.version).toBe(4);
  });

  it('rejects a stale expectedVersion with 409', async () => {
    const repo = makeRepo({ findHeader: jest.fn().mockResolvedValue(headerRow({ version: 5 })) });
    const svc = new CustomerTariffService(repo);
    await expect(svc.replace(key, { annual: { price: '1' }, expectedVersion: 2 }, null))
      .rejects.toBeInstanceOf(TariffVersionConflictError);
  });

  it('rejects expectedVersion > 0 on a first write (no tariff yet)', async () => {
    const svc = new CustomerTariffService(makeRepo());
    await expect(svc.replace(key, { annual: { price: '1' }, expectedVersion: 1 }, null))
      .rejects.toBeInstanceOf(TariffVersionConflictError);
  });
});

describe('CustomerTariffService — delete', () => {
  it('whole-year delete removes hours and the header, version 0, idempotent when absent', async () => {
    const repo = makeRepo({
      // Header present on the first call, gone on the second (after the delete).
      findHeader: jest.fn().mockResolvedValueOnce(headerRow()).mockResolvedValue(null),
      deleteHours: jest.fn().mockResolvedValue(8760),
    });
    const svc = new CustomerTariffService(repo);
    const res = await svc.remove(key, undefined, undefined, null);
    expect(repo.deleteHeader).toHaveBeenCalled();
    expect(res.version).toBe(0);
    expect(res.deleted.hoursRemoved).toBe(8760);

    // Absent → idempotent no-op.
    const absent = await svc.remove(key, undefined, undefined, null);
    expect(absent.deleted.hoursRemoved).toBe(0);
  });

  it('sub-bucket delete narrows to the ref scope and keeps the header', async () => {
    const repo = makeRepo({
      findHeader: jest.fn().mockResolvedValue(headerRow({ version: 4 })),
      deleteHours: jest.fn().mockResolvedValue(1),
    });
    const svc = new CustomerTariffService(repo);
    const res = await svc.remove(key, { level: 'HOUR', ref: '2026-07-01T15' }, 4, null);
    expect(repo.deleteHeader).not.toHaveBeenCalled();
    expect(repo.deleteHours).toHaveBeenCalledWith(tariffId, { month: 7, day: 1, hour: 15 }, expect.anything());
    expect(res.deleted.hoursRemoved).toBe(1);
  });
});

describe('TariffsDTO — price & year contract', () => {
  it('accepts a positive decimal (≤6 places) and canonicalizes to 6 decimals', () => {
    expect(PriceSchema.parse('2.5')).toBe('2.500000');
    expect(PriceSchema.parse(1.234567)).toBe('1.234567');
    expect(PriceSchema.parse('4')).toBe('4.000000');
  });

  it('rejects zero, negative, and > 6 decimals', () => {
    expect(() => PriceSchema.parse('0')).toThrow();
    expect(() => PriceSchema.parse(-1)).toThrow();
    expect(() => PriceSchema.parse('1.1234567')).toThrow();
  });

  it('year is a required query discriminator', () => {
    expect(() => GetTariffQuerySchema.parse({ domain: 'ENERGY', category: 'SPECIFIC' })).toThrow();
    const q = GetTariffQuerySchema.parse({ domain: 'ENERGY', category: 'SPECIFIC', year: '2026' });
    expect(q.year).toBe(2026);
  });

  it('flags a bucket ref whose year mismatches the query year', () => {
    const issues = validateTariffBucketsYear([{ level: 'DAY', ref: '2027-07-01' }], 2026);
    expect(issues.length).toBeGreaterThan(0);
  });
});
