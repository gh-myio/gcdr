// RFC-0056 feedback (P1) — CentralInitialKeyService.getOrCreateInitialKey.
// Covers: first-call mint, idempotent cache-reveal, the 409 already-provisioned
// path, the reveal rate limit, and — most importantly — the race-condition fix:
// the mint decision must come from the FRESH row read under the transaction's
// row lock, never from the `central.config` snapshot passed into the method
// (which centralPreKeyAuth resolved before the call, and can be stale by the
// time this method runs).

const FAKE_TX = 'FAKE_TX' as never;

jest.mock('../../../src/repositories/CentralRepository', () => ({
  centralRepository: {
    withTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn('FAKE_TX')),
    lockByIdQuery: jest.fn(),
    patchConfig: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../../src/services/CustomerApiKeyService', () => ({
  customerApiKeyService: {
    createApiKey: jest.fn(),
    revealApiKey: jest.fn(),
  },
}));
jest.mock('../../../src/middleware/rateLimit', () => ({
  consumeIfAllowed: jest.fn(),
}));
jest.mock('../../../src/middleware/audit', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  CentralInitialKeyService,
  defaultTenantId,
  initialKeyCustomerId,
} from '../../../src/services/CentralInitialKeyService';
import { centralRepository } from '../../../src/repositories/CentralRepository';
import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { consumeIfAllowed } from '../../../src/middleware/rateLimit';
import { logAuditEvent } from '../../../src/middleware/audit';
import { EventType } from '../../../src/shared/types/audit.types';
import { AppError, ConflictError, NotFoundError } from '../../../src/shared/errors/AppError';
import type { CentralBootstrapIdentity } from '../../../src/middleware/centralPreKeyAuth';

const withTransaction = centralRepository.withTransaction as jest.Mock;
const lockByIdQuery = centralRepository.lockByIdQuery as jest.Mock;
const patchConfig = centralRepository.patchConfig as jest.Mock;
const createApiKey = customerApiKeyService.createApiKey as jest.Mock;
const revealApiKey = customerApiKeyService.revealApiKey as jest.Mock;
const consumeIfAllowedMock = consumeIfAllowed as jest.Mock;
const logAuditEventMock = logAuditEvent as jest.Mock;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CENTRAL_ID = '22222222-2222-2222-2222-222222222222';
const UUID = CENTRAL_ID;
const CLIENT_IP = '203.0.113.9';

function identity(config: Record<string, unknown>): CentralBootstrapIdentity {
  return { centralId: CENTRAL_ID, tenantId: TENANT_ID, config };
}

describe('CentralInitialKeyService.getOrCreateInitialKey', () => {
  let svc: CentralInitialKeyService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CentralInitialKeyService();
    consumeIfAllowedMock.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    withTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(FAKE_TX));
    patchConfig.mockResolvedValue({});
  });

  it('first call: mints a new key inside the tx and patches config with its id', async () => {
    lockByIdQuery.mockResolvedValue([{ config: {} }]);
    createApiKey.mockResolvedValue({ plaintextKey: 'plain-new', apiKey: { id: 'key-new' } });

    const result = await svc.getOrCreateInitialKey(UUID, identity({}), CLIENT_IP);

    expect(lockByIdQuery).toHaveBeenCalledWith(TENANT_ID, CENTRAL_ID, FAKE_TX);
    expect(createApiKey).toHaveBeenCalledWith(
      defaultTenantId(),
      initialKeyCustomerId(),
      expect.objectContaining({ hierarchyAccess: 'SELF' }),
      expect.any(String),
      FAKE_TX,
    );
    expect(patchConfig).toHaveBeenCalledWith(
      TENANT_ID,
      CENTRAL_ID,
      { provisioningState: 'awaiting_provisioning', centralInitialApiKeyId: 'key-new' },
      FAKE_TX,
    );
    expect(revealApiKey).not.toHaveBeenCalled();
    expect(result).toEqual({
      apiKey: 'plain-new',
      scopes: expect.any(Array),
      customerId: initialKeyCustomerId(),
      cached: false,
    });
    expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    expect(logAuditEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      EventType.CENTRAL_BOOTSTRAP_ISSUED,
      expect.objectContaining({ metadata: expect.objectContaining({ cached: false }) }),
    );
  });

  it('repeated call: reveals the cached key from the row read under the lock, does not mint again', async () => {
    lockByIdQuery.mockResolvedValue([{ config: { centralInitialApiKeyId: 'key-existing' } }]);
    revealApiKey.mockResolvedValue('plain-existing');

    const result = await svc.getOrCreateInitialKey(UUID, identity({ centralInitialApiKeyId: 'key-existing' }), CLIENT_IP);

    expect(revealApiKey).toHaveBeenCalledWith(defaultTenantId(), 'key-existing');
    expect(createApiKey).not.toHaveBeenCalled();
    expect(patchConfig).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.apiKey).toBe('plain-existing');
  });

  it('race regression: a stale "no key yet" snapshot must not cause a second mint once the lock reveals a key was already created', async () => {
    // The identity passed in (as centralPreKeyAuth resolved it before this
    // call) says there's no key yet — but by the time we acquire the row
    // lock, a concurrent request already committed one.
    const staleIdentity = identity({});
    lockByIdQuery.mockResolvedValue([{ config: { centralInitialApiKeyId: 'key-from-other-request' } }]);
    revealApiKey.mockResolvedValue('plain-from-other-request');

    const result = await svc.getOrCreateInitialKey(UUID, staleIdentity, CLIENT_IP);

    expect(createApiKey).not.toHaveBeenCalled();
    expect(patchConfig).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.apiKey).toBe('plain-from-other-request');
  });

  it('race regression: a stale "not provisioned" snapshot must not bypass the 409 once the lock reveals provisioned', async () => {
    const staleIdentity = identity({}); // stale: says not provisioned
    lockByIdQuery.mockResolvedValue([{ config: { provisioningState: 'provisioned' } }]);

    await expect(svc.getOrCreateInitialKey(UUID, staleIdentity, CLIENT_IP)).rejects.toBeInstanceOf(ConflictError);

    expect(createApiKey).not.toHaveBeenCalled();
    expect(patchConfig).not.toHaveBeenCalled();
    expect(logAuditEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      EventType.CENTRAL_BOOTSTRAP_FAILED,
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'already_provisioned' }) }),
    );
  });

  it('409 when already provisioned (non-stale case too)', async () => {
    lockByIdQuery.mockResolvedValue([{ config: { provisioningState: 'provisioned' } }]);

    await expect(
      svc.getOrCreateInitialKey(UUID, identity({ provisioningState: 'provisioned' }), CLIENT_IP),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rate limit denies reveal before opening a transaction', async () => {
    consumeIfAllowedMock.mockReturnValue({ allowed: false, retryAfterSeconds: 60 });

    await expect(svc.getOrCreateInitialKey(UUID, identity({}), CLIENT_IP)).rejects.toBeInstanceOf(AppError);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError if the row disappears under the lock (defensive)', async () => {
    lockByIdQuery.mockResolvedValue([]);

    await expect(svc.getOrCreateInitialKey(UUID, identity({}), CLIENT_IP)).rejects.toBeInstanceOf(NotFoundError);
    expect(createApiKey).not.toHaveBeenCalled();
  });
});
