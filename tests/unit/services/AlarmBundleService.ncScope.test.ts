import { AlarmBundleService } from '../../../src/services/AlarmBundleService';

// RFC-0065 / ED-1257 — NO_CONSUMPTION scope coverage + hybrid central identity in
// the simplified bundle's deviceIndex. The builder/helpers are private and pure
// (no DB), so they are exercised directly; the DB-touching wrapper
// (generateSimplifiedBundle) is only spied on where its arguments matter.

const CUSTOMER_ID = '84e0370e-636a-4741-9874-504b5e0b3577';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const DEV_A = 'aaaaaaaa-0000-4000-8000-00000000000a'; // has an alarm rule
const DEV_B = 'bbbbbbbb-0000-4000-8000-00000000000b'; // only in a NO_CONSUMPTION scope
const DEV_C = 'cccccccc-0000-4000-8000-00000000000c'; // nothing

interface Internals {
  buildSimplifiedBundle: (...args: unknown[]) => {
    meta: { version: string };
    deviceIndex: Record<string, Record<string, unknown>>;
  };
  getCacheKey: (params: Record<string, unknown>, type: 'full' | 'simple') => string;
  loadCentralsById: (tenantId: string, customerIds: string[]) => Promise<Map<string, unknown>>;
}

function makeService(centralRepo: Record<string, unknown> = {}) {
  const svc = new AlarmBundleService({} as never, {} as never, {} as never, centralRepo as never);
  return { svc, internals: svc as unknown as Internals };
}

const customer = { id: CUSTOMER_ID, name: 'Moxuara', config: {} } as never;

const device = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: `dev-${id.slice(0, 4)}`,
    customerId: CUSTOMER_ID,
    slaveId: 7,
    centralId: 'central-1',
    metadata: {},
    attributes: {},
    ...over,
  }) as never;

const alarmRule = {
  id: 'rule-alarm',
  name: 'Temp alta',
  type: 'ALARM_THRESHOLD',
  enabled: true,
  scope: { type: 'DEVICE', entityIds: [DEV_A] },
  alarmConfig: { metric: 'temperature', operator: 'GT', value: 30 },
} as never;

const ncRule = (scope: Record<string, unknown>) =>
  ({
    id: 'rule-nc',
    name: 'Sem consumo (1h)',
    type: 'NO_CONSUMPTION',
    enabled: true,
    priority: 'MEDIUM',
    scope,
    noConsumptionConfig: { windowMinutes: 60 },
  }) as never;

const devices = [device(DEV_A), device(DEV_B), device(DEV_C)];

function build(
  internals: Internals,
  nc: unknown[],
  opts: Record<string, unknown> = {},
) {
  return internals.buildSimplifiedBundle(customer, devices, [alarmRule], TENANT_ID, nc, opts);
}

describe('buildSimplifiedBundle — NO_CONSUMPTION scope coverage (RFC-0065 A)', () => {
  const { internals } = makeService();
  const ncDeviceScope = ncRule({ type: 'DEVICE', entityIds: [DEV_B] });

  it('flag OFF (default): only devices with an alarm rule are indexed — unchanged behavior', () => {
    const b = build(internals, [ncDeviceScope]);
    expect(Object.keys(b.deviceIndex)).toEqual([DEV_A]);
  });

  it('flag ON: NC-scope-only device B is indexed with ruleIds [] and identity; C stays out', () => {
    const b = build(internals, [ncDeviceScope], { includeNcScope: true });
    expect(Object.keys(b.deviceIndex).sort()).toEqual([DEV_A, DEV_B].sort());
    expect(b.deviceIndex[DEV_B]).toMatchObject({ ruleIds: [], slaveId: 7, centralId: 'central-1' });
    expect(b.deviceIndex[DEV_A].ruleIds).toEqual(['rule-alarm']);
    expect(b.deviceIndex[DEV_C]).toBeUndefined();
  });

  it('flag ON: a device with BOTH an alarm rule and NC scope keeps its alarm ruleIds', () => {
    const both = ncRule({ type: 'DEVICE', entityIds: [DEV_A] });
    const b = build(internals, [both], { includeNcScope: true });
    expect(b.deviceIndex[DEV_A].ruleIds).toEqual(['rule-alarm']);
  });

  it('flag ON: non-DEVICE scopes are not expanded (CUSTOMER / ASSET / GLOBAL)', () => {
    for (const scope of [
      { type: 'CUSTOMER', entityId: CUSTOMER_ID },
      { type: 'ASSET', entityId: 'asset-1' },
      { type: 'GLOBAL' },
    ]) {
      const b = build(internals, [ncRule(scope)], { includeNcScope: true });
      expect(Object.keys(b.deviceIndex)).toEqual([DEV_A]);
    }
  });

  it('flag ON: single entityId fallback is honored, and ids match case-insensitively', () => {
    const single = ncRule({ type: 'DEVICE', entityId: DEV_B.toUpperCase() });
    const b = build(internals, [single], { includeNcScope: true });
    expect(b.deviceIndex[DEV_B]).toBeDefined();
  });

  it('flag ON with no NC rules: identical to flag OFF', () => {
    const off = build(internals, []);
    const on = build(internals, [], { includeNcScope: true });
    expect(on.deviceIndex).toEqual(off.deviceIndex);
  });

  it('versionId is a content hash: stable for identical input, different when the index grows', () => {
    const off1 = build(internals, [ncDeviceScope]);
    const off2 = build(internals, [ncDeviceScope]);
    const on = build(internals, [ncDeviceScope], { includeNcScope: true });
    expect(off1.meta.version).toBe(off2.meta.version);
    expect(on.meta.version).not.toBe(off1.meta.version);
  });
});

describe('buildSimplifiedBundle — hybrid central identity (RFC-0065 B)', () => {
  const { internals } = makeService();
  const ncDeviceScope = ncRule({ type: 'DEVICE', entityIds: [DEV_B] });
  const opts = (centrals: Record<string, unknown>) => ({
    includeNcScope: true,
    centralsById: new Map(Object.entries(centrals)),
  });

  it('emits centralHardwareId next to centralId when the central has one', () => {
    const b = build(internals, [ncDeviceScope], opts({
      'central-1': { id: 'central-1', hardwareId: 'hw-1' },
    }));
    expect(b.deviceIndex[DEV_B]).toMatchObject({ centralId: 'central-1', centralHardwareId: 'hw-1' });
  });

  it('never emits the central serialNumber — it is the radio address, not a gateway identity', () => {
    const b = build(internals, [ncDeviceScope], opts({
      'central-1': { id: 'central-1', status: 'ACTIVE', hardwareId: 'hw-1', serialNumber: '219.19.169.246' },
    }));
    expect(b.deviceIndex[DEV_B]).not.toHaveProperty('centralSerialNumber');
    expect(JSON.stringify(b.deviceIndex)).not.toContain('219.19.169.246');
  });

  it('keeps the hardware id of a non-ACTIVE (replaced) central — it is still the physical id', () => {
    const b = build(internals, [ncDeviceScope], opts({
      'central-1': { id: 'central-1', status: 'INACTIVE', hardwareId: 'hw-1' },
    }));
    expect(b.deviceIndex[DEV_B].centralHardwareId).toBe('hw-1');
  });

  it('omits the field when unset — never fabricated (null hardwareId, unknown central)', () => {
    const nullHw = build(internals, [ncDeviceScope], opts({
      'central-1': { id: 'central-1', hardwareId: null },
    }));
    expect(nullHw.deviceIndex[DEV_B]).not.toHaveProperty('centralHardwareId');

    const unknown = build(internals, [ncDeviceScope], opts({}));
    expect(unknown.deviceIndex[DEV_B]).not.toHaveProperty('centralHardwareId');
    expect(unknown.deviceIndex[DEV_B].centralId).toBe('central-1');
  });

  it('a device without centralId gets no hybrid field', () => {
    const orphan = internals.buildSimplifiedBundle(
      customer, [device(DEV_A, { centralId: undefined })], [alarmRule], TENANT_ID, [],
      opts({ 'central-1': { id: 'central-1', hardwareId: 'hw-1' } }),
    );
    expect(orphan.deviceIndex[DEV_A]).not.toHaveProperty('centralHardwareId');
  });
});

describe('getCacheKey — includeNoConsumptionScope is part of the key (RFC-0065 A)', () => {
  const { internals } = makeService();
  const base = { tenantId: TENANT_ID, customerId: CUSTOMER_ID };

  it('default equals an explicit false; true gets its own slot', () => {
    expect(internals.getCacheKey(base, 'simple')).toBe(
      internals.getCacheKey({ ...base, includeNoConsumptionScope: false }, 'simple'),
    );
    expect(internals.getCacheKey({ ...base, includeNoConsumptionScope: true }, 'simple')).not.toBe(
      internals.getCacheKey(base, 'simple'),
    );
  });
});

describe('loadCentralsById (RFC-0065 B)', () => {
  it('queries once per customer and keys centrals by id', async () => {
    const listByCustomer = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
      .mockResolvedValueOnce([{ id: 'c3' }]);
    const { internals } = makeService({ listByCustomer });
    const map = await internals.loadCentralsById(TENANT_ID, ['cust-1', 'cust-2']);
    expect(listByCustomer).toHaveBeenCalledTimes(2);
    expect([...map.keys()].sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('never throws: a failed lookup yields an empty map (hybrid fields omitted, bundle still built)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { internals } = makeService({ listByCustomer: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(internals.loadCentralsById(TENANT_ID, ['cust-1'])).resolves.toEqual(new Map());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('verifyBundle opts in to NO_CONSUMPTION scope (RFC-0065 A)', () => {
  it('calls generateSimplifiedBundle with includeNoConsumptionScope: true', async () => {
    const ruleRepo = { getByCustomerId: jest.fn().mockResolvedValue([]) };
    const svc = new AlarmBundleService(ruleRepo as never, {} as never, {} as never, {} as never);
    const spy = jest.spyOn(svc, 'generateSimplifiedBundle').mockResolvedValue({
      meta: { version: 'v1-x' },
      deviceIndex: {},
      rules: {},
    } as never);

    await svc.verifyBundle({ tenantId: TENANT_ID, customerId: CUSTOMER_ID });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ includeNoConsumptionScope: true }));
  });
});
