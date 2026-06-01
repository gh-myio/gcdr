import { CustomerIntegrationService } from '../../../src/services/CustomerIntegrationService';
import type { CustomerIntegrationRepository } from '../../../src/repositories/CustomerIntegrationRepository';
import type { CentralEntry, CentralsIntegrationState, IntegrationState } from '../../../src/dto/request/CustomerIntegrationDTO';

// Audit emission is fire-and-forget inside the service (try/catch swallow).
// We mock logAuditEvent to capture the metadata that would be written.
jest.mock('../../../src/middleware/audit', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logAuditEvent } from '../../../src/middleware/audit';

const TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const CENTRAL_ID  = 'e982edf9-edb1-4aa6-8a14-4782465ae5a3';

function freshRepoMock(): jest.Mocked<CustomerIntegrationRepository> {
  return {
    getAll:            jest.fn(),
    getOne:            jest.fn(),
    setIntegration:    jest.fn().mockResolvedValue(undefined),
    clearIntegration:  jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CustomerIntegrationRepository>;
}

describe('CustomerIntegrationService', () => {
  let repo: jest.Mocked<CustomerIntegrationRepository>;
  let svc:  CustomerIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = freshRepoMock();
    svc  = new CustomerIntegrationService(repo);
  });

  describe('recordSync', () => {
    it('initialises state from {} on first sync and writes via setIntegration', async () => {
      repo.getOne.mockResolvedValue(null);

      const next = await svc.recordSync(TENANT_ID, CUSTOMER_ID, 'thingsboard', {
        status:  'OK',
        version: 'v1',
        actor:   'tb-bridge:cron',
      });

      expect(next.status).toBe('OK');
      expect(next.version).toBe('v1');
      expect(next.syncCount).toBe(1);
      expect(next.failureCount).toBe(0);
      expect(next.lastSyncAt).toBeTruthy();
      expect(next.lastSuccessAt).toBe(next.lastSyncAt);
      expect(next.lastError).toBeNull();

      expect(repo.setIntegration).toHaveBeenCalledTimes(1);
      const [, , key, payload] = repo.setIntegration.mock.calls[0];
      expect(key).toBe('thingsboard');
      expect((payload as IntegrationState).status).toBe('OK');
    });

    it('increments failureCount on FAILED and resets it on the next OK', async () => {
      repo.getOne
        // First call: previous state has 0 syncs.
        .mockResolvedValueOnce(null)
        // Second call: read back the post-failure state.
        .mockResolvedValueOnce({
          status:        'FAILED',
          version:       null,
          lastSyncAt:    new Date().toISOString(),
          lastSuccessAt: null,
          lastError:     'boom',
          syncCount:     1,
          failureCount:  1,
          payload:       {},
        });

      const afterFail = await svc.recordSync(TENANT_ID, CUSTOMER_ID, 'thingsboard', {
        status: 'FAILED',
        actor:  'tb-bridge',
        error:  'boom',
      });
      expect(afterFail.status).toBe('FAILED');
      expect(afterFail.failureCount).toBe(1);
      expect(afterFail.lastError).toBe('boom');
      expect(afterFail.lastSuccessAt).toBeNull();

      const afterOk = await svc.recordSync(TENANT_ID, CUSTOMER_ID, 'thingsboard', {
        status: 'OK',
        actor:  'tb-bridge',
      });
      expect(afterOk.status).toBe('OK');
      expect(afterOk.failureCount).toBe(0); // reset on success
      expect(afterOk.lastError).toBeNull(); // cleared on success
      expect(afterOk.lastSuccessAt).toBe(afterOk.lastSyncAt);
      expect(afterOk.syncCount).toBe(2);
    });

    it('persists centrals.items[] verbatim and strips mqttPassword from audit metadata', async () => {
      repo.getOne.mockResolvedValue(null);

      const item: CentralEntry = {
        uuid:          CENTRAL_ID,
        mqttPasswords: { ingestion: 'super-secret-mqtt-password-do-not-leak' },
      };

      const next = await svc.recordSync(TENANT_ID, CUSTOMER_ID, 'centrals', {
        status: 'OK',
        actor:  'presetup-nextjs',
        items:  [item],
      });

      // The state actually persisted in the row keeps the password (this
      // is the trade-off documented in RFC-0033 Security).
      const persisted = repo.setIntegration.mock.calls[0][3] as unknown as CentralsIntegrationState;
      expect(persisted.items).toHaveLength(1);
      expect(persisted.items[0].mqttPasswords.ingestion).toBe('super-secret-mqtt-password-do-not-leak');

      // The return value mirrors what was persisted — no masking at the
      // service layer (controller is responsible for that).
      expect((next as CentralsIntegrationState).items[0].mqttPasswords.ingestion).toBe(
        'super-secret-mqtt-password-do-not-leak',
      );

      // The audit row MUST NOT carry the plaintext password.
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      const auditMetadata = (logAuditEvent as jest.Mock).mock.calls[0][2].metadata;
      const auditedNext = auditMetadata.next as { items: Array<Record<string, unknown>> };
      expect(auditedNext.items[0]).not.toHaveProperty('mqttPasswords');
      expect(auditedNext.items[0].mqttPasswordsSet).toEqual({ ingestion: true });
      // Sanity: serialising the whole audit metadata must not contain the password string.
      expect(JSON.stringify(auditMetadata)).not.toContain('super-secret-mqtt-password-do-not-leak');
    });
  });

  describe('disable', () => {
    it('flips status to DISABLED without touching previously stored payload/items', async () => {
      const previous = {
        status:        'OK',
        version:       'v9',
        lastSyncAt:    '2026-05-06T12:30:00.000Z',
        lastSuccessAt: '2026-05-06T12:30:00.000Z',
        lastError:     null,
        syncCount:     7,
        failureCount:  0,
        payload:       { entitiesUpdated: 12 },
      };
      repo.getOne.mockResolvedValue(previous);

      const next = await svc.disable(TENANT_ID, CUSTOMER_ID, 'thingsboard', {
        actorLabel: 'admin@gcdr.io',
      });

      expect(next.status).toBe('DISABLED');
      expect(next.version).toBe('v9');
      expect(next.payload).toEqual({ entitiesUpdated: 12 });
      expect(next.syncCount).toBe(7);
      expect(repo.setIntegration).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('clears the integration via clearIntegration and emits one audit row', async () => {
      const previous = {
        status:        'FAILED',
        version:       null,
        lastSyncAt:    '2026-05-06T12:30:00.000Z',
        lastSuccessAt: null,
        lastError:     'boom',
        syncCount:     3,
        failureCount:  3,
        payload:       {},
      };
      repo.getOne.mockResolvedValue(previous);

      await svc.reset(TENANT_ID, CUSTOMER_ID, 'thingsboard', { actorLabel: 'admin@gcdr.io' });

      expect(repo.clearIntegration).toHaveBeenCalledTimes(1);
      expect(repo.setIntegration).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('get / list', () => {
    it('returns null for absent integrations', async () => {
      repo.getOne.mockResolvedValue(null);
      const state = await svc.get(TENANT_ID, CUSTOMER_ID, 'freshdesk');
      expect(state).toBeNull();
    });

    it('parses centrals through the extended schema (items[] preserved)', async () => {
      repo.getOne.mockResolvedValue({
        status:        'OK',
        version:       'rev-1',
        lastSyncAt:    '2026-05-06T12:30:00.000Z',
        lastSuccessAt: '2026-05-06T12:30:00.000Z',
        lastError:     null,
        syncCount:     1,
        failureCount:  0,
        payload:       {},
        items: [
          {
            uuid:          CENTRAL_ID,
            mqttPasswords: { ingestion: 'pw' },
          },
        ],
      });

      const state = await svc.get(TENANT_ID, CUSTOMER_ID, 'centrals');
      expect(state).not.toBeNull();
      const centrals = state as CentralsIntegrationState;
      expect(centrals.items).toHaveLength(1);
      expect(centrals.items[0].uuid).toBe(CENTRAL_ID);
      expect(centrals.items[0].mqttPasswords.ingestion).toBe('pw');
    });
  });
});
