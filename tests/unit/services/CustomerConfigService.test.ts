import { CustomerConfigService, leafPaths, CONFIG_VERSION } from '../../../src/services/CustomerConfigService';
import type { CustomerRepository } from '../../../src/repositories/CustomerRepository';
import type { Customer, CustomerConfig } from '../../../src/domain/entities/Customer';
import { MASKED_SECRET } from '../../../src/dto/request/CustomerConfigDTO';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

// --- mocks -----------------------------------------------------------------

jest.mock('../../../src/middleware/audit', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
import { logAuditEvent } from '../../../src/middleware/audit';

jest.mock('../../../src/shared/utils/secretEnvelope', () => ({
  encryptSecret: jest.fn((p: string) => `enc(${p})`),
  decryptSecret: jest.fn((v: string) => (v.startsWith('enc(') ? v.slice(4, -1) : v)),
}));
import { encryptSecret, decryptSecret } from '../../../src/shared/utils/secretEnvelope';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    tenantId: TENANT_ID,
    parentCustomerId: null,
    path: `/${TENANT_ID}/${CUSTOMER_ID}`,
    depth: 0,
    name: 'Test Customer',
    displayName: 'Test Customer',
    code: 'TEST',
    type: 'COMPANY' as Customer['type'],
    settings: { timezone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL', inheritFromParent: true },
    theme: { primaryColor: '#123456', secondaryColor: '#654321' },
    metadata: {},
    config: undefined,
    status: 'ACTIVE' as Customer['status'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

/**
 * A repo mock backed by a mutable in-memory customer so `update` actually
 * reflects config/metadata into subsequent reads and the returned read model.
 * `update` mirrors the real repo: config = full replace; metadata = shallow merge.
 */
function makeRepo(initial: Customer): jest.Mocked<CustomerRepository> {
  let current = initial;
  return {
    getById: jest.fn(async () => current),
    update: jest.fn(async (_tenantId: string, _id: string, data: Record<string, unknown>) => {
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

function makeService(customer: Customer) {
  const repo = makeRepo(customer);
  return { repo, svc: new CustomerConfigService(repo) };
}

beforeEach(() => jest.clearAllMocks());

// --- leafPaths -------------------------------------------------------------

describe('leafPaths', () => {
  it('flattens nested objects to dotted paths', () => {
    expect(leafPaths({ a: 1, b: { c: 2, d: { e: 3 } } }).sort()).toEqual(['a', 'b.c', 'b.d.e']);
  });
  it('treats arrays and null as leaves', () => {
    expect(leafPaths({ a: [1, 2], b: null }).sort()).toEqual(['a', 'b']);
  });
  it('returns an empty array for a non-object', () => {
    expect(leafPaths(42)).toEqual([]);
  });
  it('contributes nothing for an empty nested object (no phantom path)', () => {
    expect(leafPaths({ a: {} })).toEqual([]);
    expect(leafPaths({ a: { b: {} } })).toEqual([]);
  });
});

// --- getConfig / defaults / masking ---------------------------------------

describe('getConfig', () => {
  it('fills all defaults (DEC-5) so nothing is undefined', async () => {
    const { svc } = makeService(makeCustomer());
    const doc = await svc.getConfig(TENANT_ID, CUSTOMER_ID);

    expect(doc.version).toBe(CONFIG_VERSION);
    expect(doc.featureButtons).toEqual({
      demandPeak: { entrada: true, areacomum: true, lojas: false },
      instantTelemetry: { entrada: true, areacomum: true, lojas: false },
    });
    expect(doc.alarms).toEqual({ notificationsEnabled: true, showOffline: false, showInternalSupport: false });
    expect(doc.tickets).toEqual({ enabled: false, onlyToMyio: true });
    expect(doc.temperature).toEqual({ min: 18, max: 27, clampMin: 15, clampMax: 40 });
    expect(doc.display).toEqual({ measurementDisplaySettings: null, mapInstantaneousPower: null });
    expect(doc.defaultDashboard).toEqual({ id: null, cfg: null });
    expect(doc.classificationProfile).toBeNull();
    expect(doc.locale).toEqual({ timezone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL' });
    expect(doc.theme).toEqual({ primaryColor: '#123456', secondaryColor: '#654321' });
    expect(doc.metadata).toEqual({ inaugurationDate: null, obs: '' });
    // Never leak undefined values.
    expect(Object.values(doc).every((v) => v !== undefined)).toBe(true);
  });

  it('masks secrets even when they are set (acceptance #4)', async () => {
    const { svc } = makeService(
      makeCustomer({
        config: {
          ingestion: { clientId: 'cid', clientSecret: 'enc(supersecret)' },
          security: { masterAdminPassword: 'enc(masterpw)' },
        },
      }),
    );
    const doc = await svc.getConfig(TENANT_ID, CUSTOMER_ID);
    expect(doc.ingestion).toEqual({ clientId: 'cid', clientSecret: MASKED_SECRET });
    expect(doc.security).toEqual({ masterAdminPassword: MASKED_SECRET });
    expect(JSON.stringify(doc)).not.toContain('supersecret');
    expect(JSON.stringify(doc)).not.toContain('masterpw');
  });

  it('throws NotFoundError for unknown / cross-tenant customer (acceptance #9)', async () => {
    const repo = { getById: jest.fn(async () => null) } as unknown as CustomerRepository;
    const svc = new CustomerConfigService(repo);
    await expect(svc.getConfig(TENANT_ID, CUSTOMER_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('falls back to locale defaults when settings are absent', async () => {
    const { svc } = makeService(makeCustomer({ settings: undefined as unknown as Customer['settings'], theme: undefined }));
    const doc = await svc.getConfig(TENANT_ID, CUSTOMER_ID);
    expect(doc.locale).toEqual({ timezone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL' });
    expect(doc.theme).toEqual({ primaryColor: null, secondaryColor: null });
  });
});

// --- putConfig (full replace) ---------------------------------------------

describe('putConfig', () => {
  it('replaces provided sections and resets omitted ones to defaults (DEC-9)', async () => {
    const { svc } = makeService(
      makeCustomer({
        config: { tickets: { enabled: true, onlyToMyio: false }, alarms: { showOffline: true } },
      }),
    );
    const doc = await svc.putConfig(TENANT_ID, CUSTOMER_ID, {
      featureButtons: {
        demandPeak: { entrada: false, areacomum: false, lojas: true },
        instantTelemetry: { entrada: true, areacomum: true, lojas: true },
      },
    });
    // Provided section applied.
    expect(doc.featureButtons.demandPeak).toEqual({ entrada: false, areacomum: false, lojas: true });
    // Omitted sections reset to defaults.
    expect(doc.tickets).toEqual({ enabled: false, onlyToMyio: true });
    expect(doc.alarms).toEqual({ notificationsEnabled: true, showOffline: false, showInternalSupport: false });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect((logAuditEvent as jest.Mock).mock.calls[0][2].metadata.method).toBe('PUT');
  });

  it('preserves bundle and at-rest secrets across a full replace (DEC-6/DEC-7)', async () => {
    const { repo, svc } = makeService(
      makeCustomer({
        config: {
          bundle: { checkVersion: false },
          ingestion: { clientId: 'old', clientSecret: 'enc(keep-me)' },
          security: { masterAdminPassword: 'enc(keep-pw)' },
        },
      }),
    );
    await svc.putConfig(TENANT_ID, CUSTOMER_ID, { alarms: { showOffline: true } });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.bundle).toEqual({ checkVersion: false });
    expect(persisted.ingestion?.clientSecret).toBe('enc(keep-me)');
    expect(persisted.security?.masterAdminPassword).toBe('enc(keep-pw)');
    // clientId was omitted on PUT → reset (not carried over).
    expect(persisted.ingestion?.clientId).toBeUndefined();
  });

  it('writes ingestion.clientId while keeping the secret', async () => {
    const { repo, svc } = makeService(
      makeCustomer({ config: { ingestion: { clientId: 'old', clientSecret: 'enc(s)' } } }),
    );
    await svc.putConfig(TENANT_ID, CUSTOMER_ID, { ingestion: { clientId: 'new-client' } });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.ingestion).toEqual({ clientSecret: 'enc(s)', clientId: 'new-client' });
  });

  it('persists metadata via customers.metadata', async () => {
    const { repo, svc } = makeService(makeCustomer());
    const doc = await svc.putConfig(TENANT_ID, CUSTOMER_ID, { metadata: { obs: 'note' } });
    expect((repo.update as jest.Mock).mock.calls[0][2].metadata).toEqual({ obs: 'note' });
    expect(doc.metadata.obs).toBe('note');
  });
});

// --- patchConfig (deep-merge) ---------------------------------------------

describe('patchConfig', () => {
  it('merges a single feature toggle, preserving the other five (acceptance #2)', async () => {
    const { svc } = makeService(makeCustomer());
    const doc = await svc.patchConfig(TENANT_ID, CUSTOMER_ID, {
      featureButtons: { demandPeak: { lojas: true } },
    });
    expect(doc.featureButtons).toEqual({
      demandPeak: { entrada: true, areacomum: true, lojas: true },
      instantTelemetry: { entrada: true, areacomum: true, lojas: false },
    });
    expect((logAuditEvent as jest.Mock).mock.calls[0][2].metadata.method).toBe('PATCH');
  });

  it('merges onto previously stored featureButtons', async () => {
    const { svc } = makeService(
      makeCustomer({
        config: {
          featureButtons: {
            demandPeak: { entrada: false, areacomum: false, lojas: false },
            instantTelemetry: { entrada: false, areacomum: false, lojas: false },
          },
        },
      }),
    );
    const doc = await svc.patchConfig(TENANT_ID, CUSTOMER_ID, {
      featureButtons: { instantTelemetry: { entrada: true } },
    });
    expect(doc.featureButtons.demandPeak).toEqual({ entrada: false, areacomum: false, lojas: false });
    expect(doc.featureButtons.instantTelemetry).toEqual({ entrada: true, areacomum: false, lojas: false });
  });

  it('shallow-merges scalar sections and keeps untouched fields', async () => {
    const { svc } = makeService(makeCustomer({ config: { alarms: { showOffline: true } } }));
    const doc = await svc.patchConfig(TENANT_ID, CUSTOMER_ID, { alarms: { notificationsEnabled: false } });
    expect(doc.alarms).toEqual({ notificationsEnabled: false, showOffline: true, showInternalSupport: false });
  });

  it('treats an empty section object as a no-op', async () => {
    const { svc } = makeService(makeCustomer({ config: { tickets: { enabled: true, onlyToMyio: false } } }));
    const doc = await svc.patchConfig(TENANT_ID, CUSTOMER_ID, { tickets: {} });
    expect(doc.tickets).toEqual({ enabled: true, onlyToMyio: false });
  });

  it('merges defaultDashboard and replaces classificationProfile', async () => {
    const { svc } = makeService(makeCustomer({ config: { defaultDashboard: { id: 'a', cfg: { x: 1 } } } }));
    const doc = await svc.patchConfig(TENANT_ID, CUSTOMER_ID, {
      defaultDashboard: { id: 'b' },
      classificationProfile: { p: 2 },
      temperature: { min: 20 },
      display: { mapInstantaneousPower: true },
      ingestion: { clientId: 'ci' },
    });
    expect(doc.defaultDashboard).toEqual({ id: 'b', cfg: { x: 1 } });
    expect(doc.classificationProfile).toEqual({ p: 2 });
    expect(doc.temperature.min).toBe(20);
    expect(doc.display.mapInstantaneousPower).toBe(true);
    expect(doc.ingestion.clientId).toBe('ci');
  });

  it('treats an empty featureButtons patch as a true no-op (P2.3)', async () => {
    const { repo, svc } = makeService(makeCustomer());
    await svc.patchConfig(TENANT_ID, CUSTOMER_ID, { featureButtons: {} });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.featureButtons).toBeUndefined();
    const meta = (logAuditEvent as jest.Mock).mock.calls[0][2].metadata;
    expect(meta.changedPaths).toEqual([]);
  });

  it('treats featureButtons with only empty groups as a no-op (P2.3)', async () => {
    const { repo, svc } = makeService(makeCustomer());
    await svc.patchConfig(TENANT_ID, CUSTOMER_ID, { featureButtons: { demandPeak: {} } });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.featureButtons).toBeUndefined();
  });
});

describe('audit before/after (DEC-12 / P1.2)', () => {
  it('CUSTOMER_CONFIG_UPDATED carries redacted before/after read models', async () => {
    const { svc } = makeService(makeCustomer({ config: { ingestion: { clientSecret: 'enc(x)' } } }));
    await svc.patchConfig(TENANT_ID, CUSTOMER_ID, { tickets: { enabled: true } });
    const meta = (logAuditEvent as jest.Mock).mock.calls[0][2].metadata;
    expect(meta.method).toBe('PATCH');
    expect(meta.changedPaths).toEqual(['tickets.enabled']);
    expect(meta.before.tickets.enabled).toBe(false);
    expect(meta.after.tickets.enabled).toBe(true);
    // secrets masked in BOTH snapshots — no plaintext/ciphertext ever in audit.
    expect(meta.before.ingestion.clientSecret).toBe(MASKED_SECRET);
    expect(meta.after.ingestion.clientSecret).toBe(MASKED_SECRET);
    expect(JSON.stringify(meta)).not.toContain('enc(x)');
  });

  it('DELETE carries a before/after showing the reset to defaults', async () => {
    const { svc } = makeService(
      makeCustomer({ config: { tickets: { enabled: true, onlyToMyio: false } } }),
    );
    await svc.deleteConfig(TENANT_ID, CUSTOMER_ID);
    const meta = (logAuditEvent as jest.Mock).mock.calls[0][2].metadata;
    expect(meta.before.tickets).toEqual({ enabled: true, onlyToMyio: false });
    expect(meta.after.tickets).toEqual({ enabled: false, onlyToMyio: true });
  });
});

// --- deleteConfig ----------------------------------------------------------

describe('deleteConfig', () => {
  it('resets writable sections to defaults but preserves settings/theme/bundle & secrets (acceptance #10)', async () => {
    const { repo, svc } = makeService(
      makeCustomer({
        config: {
          bundle: { checkVersion: false },
          featureButtons: {
            demandPeak: { entrada: false, areacomum: false, lojas: false },
            instantTelemetry: { entrada: false, areacomum: false, lojas: false },
          },
          tickets: { enabled: true, onlyToMyio: false },
          ingestion: { clientId: 'cid', clientSecret: 'enc(s)' },
        },
      }),
    );
    const doc = await svc.deleteConfig(TENANT_ID, CUSTOMER_ID);
    // Read model back to defaults.
    expect(doc.featureButtons.demandPeak).toEqual({ entrada: true, areacomum: true, lojas: false });
    expect(doc.tickets).toEqual({ enabled: false, onlyToMyio: true });
    // settings/theme untouched.
    expect(doc.locale.timezone).toBe('America/Sao_Paulo');
    expect(doc.theme.primaryColor).toBe('#123456');
    // bundle + secret preserved in storage.
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.bundle).toEqual({ checkVersion: false });
    expect(persisted.ingestion?.clientSecret).toBe('enc(s)');
    expect(persisted.featureButtons).toBeUndefined();
    expect((logAuditEvent as jest.Mock).mock.calls[0][2].metadata.method).toBe('DELETE');
  });
});

// --- secrets ---------------------------------------------------------------

describe('putSecrets', () => {
  it('encrypts a string secret at rest', async () => {
    const { repo, svc } = makeService(makeCustomer());
    await svc.putSecrets(TENANT_ID, CUSTOMER_ID, { ingestion: { clientSecret: 'brand-new' } });
    expect(encryptSecret).toHaveBeenCalledWith('brand-new');
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.ingestion?.clientSecret).toBe('enc(brand-new)');
  });

  it('clears a secret when given null (acceptance #6)', async () => {
    const { repo, svc } = makeService(
      makeCustomer({ config: { ingestion: { clientId: 'cid', clientSecret: 'enc(old)' } } }),
    );
    await svc.putSecrets(TENANT_ID, CUSTOMER_ID, { ingestion: { clientSecret: null } });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.ingestion?.clientSecret).toBeUndefined();
    // Non-secret sibling kept.
    expect(persisted.ingestion?.clientId).toBe('cid');
  });

  it('rejects the masked sentinel at the service layer (acceptance #5)', async () => {
    const { svc } = makeService(makeCustomer());
    await expect(
      svc.putSecrets(TENANT_ID, CUSTOMER_ID, { ingestion: { clientSecret: MASKED_SECRET } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.putSecrets(TENANT_ID, CUSTOMER_ID, { security: { masterAdminPassword: MASKED_SECRET } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sets the master admin password and emits an audit event without the value', async () => {
    const { repo, svc } = makeService(makeCustomer());
    await svc.putSecrets(TENANT_ID, CUSTOMER_ID, { security: { masterAdminPassword: 'topsecret' } });
    const persisted = (repo.update as jest.Mock).mock.calls[0][2].config as CustomerConfig;
    expect(persisted.security?.masterAdminPassword).toBe('enc(topsecret)');
    const auditMeta = (logAuditEvent as jest.Mock).mock.calls[0][2].metadata;
    expect(auditMeta.changedPaths).toContain('security.masterAdminPassword');
    expect(JSON.stringify(auditMeta)).not.toContain('topsecret');
  });

  it('returns a masked read model after writing secrets', async () => {
    const { svc } = makeService(makeCustomer());
    const doc = await svc.putSecrets(TENANT_ID, CUSTOMER_ID, { ingestion: { clientSecret: 'x' } });
    expect(doc.ingestion.clientSecret).toBe(MASKED_SECRET);
  });
});

describe('getSecrets', () => {
  it('decrypts and returns real values, emitting a reveal audit', async () => {
    const { svc } = makeService(
      makeCustomer({
        config: {
          ingestion: { clientSecret: 'enc(realsecret)' },
          security: { masterAdminPassword: 'enc(realpw)' },
        },
      }),
    );
    const out = await svc.getSecrets(TENANT_ID, CUSTOMER_ID);
    expect(decryptSecret).toHaveBeenCalled();
    expect(out).toEqual({
      ingestion: { clientSecret: 'realsecret' },
      security: { masterAdminPassword: 'realpw' },
    });
    const call = (logAuditEvent as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('CUSTOMER_CONFIG_SECRET_REVEALED');
    expect(call[2].metadata.fields).toEqual(['ingestion.clientSecret', 'security.masterAdminPassword']);
  });

  it('returns null for unset secrets', async () => {
    const { svc } = makeService(makeCustomer());
    const out = await svc.getSecrets(TENANT_ID, CUSTOMER_ID);
    expect(out).toEqual({
      ingestion: { clientSecret: null },
      security: { masterAdminPassword: null },
    });
  });
});

describe('audit resilience', () => {
  it('does not fail a write when audit emission throws', async () => {
    (logAuditEvent as jest.Mock).mockRejectedValueOnce(new Error('audit down'));
    const { svc } = makeService(makeCustomer());
    await expect(svc.patchConfig(TENANT_ID, CUSTOMER_ID, { tickets: { enabled: true } })).resolves.toBeDefined();
  });
});
