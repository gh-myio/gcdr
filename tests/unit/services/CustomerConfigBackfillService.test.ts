import {
  CustomerConfigBackfillService,
  mapCanShowDemandButtons,
  mapTbAttributesToConfig,
  diffConfig,
} from '../../../src/services/CustomerConfigBackfillService';
import type { CustomerRepository } from '../../../src/repositories/CustomerRepository';
import type { Customer, CustomerConfig } from '../../../src/domain/entities/Customer';
import { NotFoundError } from '../../../src/shared/errors/AppError';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';

const ALL_TRUE = { entrada: true, areacomum: true, lojas: true };
const ALL_FALSE = { entrada: false, areacomum: false, lojas: false };
const DEFAULT_MATRIX = { entrada: true, areacomum: true, lojas: false };

function makeCustomer(config?: CustomerConfig, metadata: Record<string, unknown> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    tenantId: TENANT_ID,
    parentCustomerId: null,
    path: `/${TENANT_ID}/${CUSTOMER_ID}`,
    depth: 0,
    name: 'C',
    displayName: 'C',
    code: 'C',
    type: 'COMPANY' as Customer['type'],
    settings: { timezone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL', inheritFromParent: true },
    metadata,
    config,
    status: 'ACTIVE' as Customer['status'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  };
}

function makeRepo(initial: Customer): jest.Mocked<CustomerRepository> {
  let current = initial;
  return {
    getById: jest.fn(async () => current),
    update: jest.fn(async (_t: string, _id: string, data: Record<string, unknown>) => {
      current = {
        ...current,
        config: data.config !== undefined ? (data.config as CustomerConfig) : current.config,
        metadata:
          data.metadata !== undefined
            ? { ...current.metadata, ...(data.metadata as Record<string, unknown>) }
            : current.metadata,
        version: current.version + 1,
      };
      return current;
    }),
  } as unknown as jest.Mocked<CustomerRepository>;
}

beforeEach(() => jest.clearAllMocks());

describe('mapCanShowDemandButtons (AC #11)', () => {
  it('true → all groups true for both features', () => {
    expect(mapCanShowDemandButtons(true)).toEqual({ demandPeak: ALL_TRUE, instantTelemetry: ALL_TRUE });
    expect(mapCanShowDemandButtons('true')).toEqual({ demandPeak: ALL_TRUE, instantTelemetry: ALL_TRUE });
  });
  it('false → all groups false for both features', () => {
    expect(mapCanShowDemandButtons(false)).toEqual({ demandPeak: ALL_FALSE, instantTelemetry: ALL_FALSE });
    expect(mapCanShowDemandButtons('false')).toEqual({ demandPeak: ALL_FALSE, instantTelemetry: ALL_FALSE });
  });
  it('unset / unrecognised → canonical default for both features', () => {
    expect(mapCanShowDemandButtons(undefined)).toEqual({ demandPeak: DEFAULT_MATRIX, instantTelemetry: DEFAULT_MATRIX });
    expect(mapCanShowDemandButtons(null)).toEqual({ demandPeak: DEFAULT_MATRIX, instantTelemetry: DEFAULT_MATRIX });
    expect(mapCanShowDemandButtons('maybe')).toEqual({ demandPeak: DEFAULT_MATRIX, instantTelemetry: DEFAULT_MATRIX });
  });
});

describe('mapTbAttributesToConfig', () => {
  it('maps flat TB attributes (mostly strings) to the config document', () => {
    const { config, metadata } = mapTbAttributesToConfig({
      canShowDemandButtons: 'true',
      alarmNotificationsEnabled: 'false',
      showOfflineAlarms: 'true',
      isInternalSupportRule: 'true',
      tickets_enabled: 'true',
      tickets_only_to_myio: 'false',
      minTemperature: '18',
      maxTemperature: '27',
      temperatureClampMin: '15',
      temperatureClampMax: '40',
      measurementDisplaySettings: { unit: 'kWh' },
      mapInstantaneousPower: true,
      customerDefaultDashboard: 'dash-1',
      deviceClassificationProfile: { profile: 'x' },
      client_id: 'myio-prod',
      inauguration_date: '2020-01-01',
      obs: 'hello',
    });

    expect(config.featureButtons).toEqual({ demandPeak: ALL_TRUE, instantTelemetry: ALL_TRUE });
    expect(config.alarms).toEqual({ notificationsEnabled: false, showOffline: true, showInternalSupport: true });
    expect(config.tickets).toEqual({ enabled: true, onlyToMyio: false });
    expect(config.temperature).toEqual({ min: 18, max: 27, clampMin: 15, clampMax: 40 });
    expect(config.display).toEqual({ measurementDisplaySettings: { unit: 'kWh' }, mapInstantaneousPower: true });
    expect(config.defaultDashboard).toEqual({ id: 'dash-1', cfg: null });
    expect(config.classificationProfile).toEqual({ profile: 'x' });
    expect(config.ingestion).toEqual({ clientId: 'myio-prod' });
    expect(metadata).toEqual({ inaugurationDate: '2020-01-01', obs: 'hello' });
  });

  it('emits only featureButtons (default) when the source is empty', () => {
    const { config, metadata } = mapTbAttributesToConfig({});
    expect(config).toEqual({ featureButtons: { demandPeak: DEFAULT_MATRIX, instantTelemetry: DEFAULT_MATRIX } });
    expect(metadata).toEqual({});
  });

  it('maps an object-form customerDefaultDashboard', () => {
    const { config } = mapTbAttributesToConfig({ customerDefaultDashboard: { id: 'd2', cfg: { a: 1 } } });
    expect(config.defaultDashboard).toEqual({ id: 'd2', cfg: { a: 1 } });
  });

  it('does NOT map secret attributes (client_secret / master_admin_password)', () => {
    const { config } = mapTbAttributesToConfig({ client_secret: 'leak', master_admin_password: 'leak2' });
    expect(JSON.stringify(config)).not.toContain('leak');
    expect(config.ingestion).toBeUndefined();
  });
});

describe('diffConfig', () => {
  it('reports only changed leaves with from/to', () => {
    const d = diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } });
    expect(d).toEqual([{ path: 'b.c', from: 2, to: 3 }]);
  });
  it('reports an added subtree at its object path', () => {
    const d = diffConfig({}, { a: { b: true } });
    expect(d).toEqual([{ path: 'a', from: undefined, to: { b: true } }]);
  });

  it('reports a nested added leaf when the parent already exists', () => {
    const d = diffConfig({ a: { c: 1 } }, { a: { c: 1, b: true } });
    expect(d).toEqual([{ path: 'a.b', from: undefined, to: true }]);
  });
});

describe('CustomerConfigBackfillService.backfillCustomer', () => {
  it('dry-run computes a diff but does NOT write', async () => {
    const repo = makeRepo(makeCustomer());
    const svc = new CustomerConfigBackfillService(repo);
    const res = await svc.backfillCustomer(TENANT_ID, CUSTOMER_ID, { canShowDemandButtons: 'true' }, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.applied).toBe(false);
    expect(res.changed).toBe(true);
    expect(res.diff.some((e) => e.path.startsWith('config.featureButtons'))).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('applies the mapping and is idempotent on re-run (AC #11 + DEC-14)', async () => {
    const repo = makeRepo(makeCustomer());
    const svc = new CustomerConfigBackfillService(repo);

    const first = await svc.backfillCustomer(TENANT_ID, CUSTOMER_ID, {
      canShowDemandButtons: 'false',
      alarmNotificationsEnabled: 'true',
    });
    expect(first.applied).toBe(true);
    expect(first.changed).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.featureButtons).toEqual({ demandPeak: ALL_FALSE, instantTelemetry: ALL_FALSE });

    // Re-run with the same attributes → no change, no write.
    const second = await svc.backfillCustomer(TENANT_ID, CUSTOMER_ID, {
      canShowDemandButtons: 'false',
      alarmNotificationsEnabled: 'true',
    });
    expect(second.changed).toBe(false);
    expect(second.applied).toBe(false);
    expect(repo.update).toHaveBeenCalledTimes(1); // still only the first apply
  });

  it('preserves an existing bundle while backfilling config', async () => {
    const repo = makeRepo(makeCustomer({ bundle: { checkVersion: false } }));
    const svc = new CustomerConfigBackfillService(repo);
    await svc.backfillCustomer(TENANT_ID, CUSTOMER_ID, { canShowDemandButtons: 'true' });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.bundle).toEqual({ checkVersion: false });
  });

  it('throws NotFoundError for an unknown customer', async () => {
    const repo = { getById: jest.fn(async () => null) } as unknown as CustomerRepository;
    const svc = new CustomerConfigBackfillService(repo);
    await expect(svc.backfillCustomer(TENANT_ID, CUSTOMER_ID, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});
