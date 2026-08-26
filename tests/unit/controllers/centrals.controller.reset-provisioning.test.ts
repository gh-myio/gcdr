// RFC-0056 (DEC-9) — POST /centrals/:id/reset-provisioning.
// Real Express app + ephemeral port (no supertest), mirroring
// entities.controller.test.ts. Mocks the service/repo layer only.

import http from 'http';
import type { AddressInfo } from 'net';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../../../src/services/CentralService', () => ({
  centralService: { getById: jest.fn() },
}));
jest.mock('../../../src/services/CustomerApiKeyService', () => ({
  customerApiKeyService: { revokeApiKey: jest.fn() },
}));
jest.mock('../../../src/repositories/CentralRepository', () => ({
  centralRepository: { patchConfig: jest.fn().mockResolvedValue({}) },
}));

import { centralService } from '../../../src/services/CentralService';
import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { centralRepository } from '../../../src/repositories/CentralRepository';
import centralsController from '../../../src/controllers/centrals.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { NotFoundError } from '../../../src/shared/errors/AppError';
import { defaultTenantId } from '../../../src/services/CentralInitialKeyService';

const getById = centralService.getById as jest.Mock;
const revokeApiKey = customerApiKeyService.revokeApiKey as jest.Mock;
const patchConfig = centralRepository.patchConfig as jest.Mock;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CENTRAL_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '72290bdb-9127-4049-83a9-3ebd1e40f99a';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      tenantId: TENANT_ID,
      userId: '00000000-0000-0000-0000-000000000099',
      requestId: REQUEST_ID,
      ip: '127.0.0.1',
    } as Request['context'];
    req.user = { roles: ['*'] } as Request['user'];
    next();
  });
  app.use('/centrals', centralsController);
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function central(config: Record<string, unknown>) {
  return { id: CENTRAL_ID, tenantId: TENANT_ID, config };
}

beforeEach(() => {
  jest.clearAllMocks();
  patchConfig.mockResolvedValue({});
  revokeApiKey.mockResolvedValue(undefined);
});

describe('POST /centrals/:id/reset-provisioning', () => {
  it('revokes both keys and resets provisioningState when both are bound', async () => {
    getById.mockResolvedValue(central({ centralInitialApiKeyId: 'init-key', centralApiKeyId: 'full-key' }));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      const body = (await res.json()) as { success: boolean; data: { provisioningState: string } };

      expect(res.status).toBe(200);
      expect(body.data.provisioningState).toBe('awaiting_provisioning');
      expect(revokeApiKey).toHaveBeenCalledTimes(2);
      expect(revokeApiKey).toHaveBeenCalledWith(defaultTenantId(), 'init-key');
      expect(revokeApiKey).toHaveBeenCalledWith(defaultTenantId(), 'full-key');
      expect(patchConfig).toHaveBeenCalledWith(TENANT_ID, CENTRAL_ID, {
        provisioningState: 'awaiting_provisioning',
        centralInitialApiKeyId: null,
        centralApiKeyId: null,
      });
    } finally {
      await srv.close();
    }
  });

  it('revokes only the key that is actually bound', async () => {
    getById.mockResolvedValue(central({ centralInitialApiKeyId: 'init-key' }));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(revokeApiKey).toHaveBeenCalledTimes(1);
      expect(revokeApiKey).toHaveBeenCalledWith(defaultTenantId(), 'init-key');
    } finally {
      await srv.close();
    }
  });

  it('still resets when no key was ever minted (pre-bootstrap reset)', async () => {
    getById.mockResolvedValue(central({}));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(revokeApiKey).not.toHaveBeenCalled();
      expect(patchConfig).toHaveBeenCalledTimes(1);
    } finally {
      await srv.close();
    }
  });

  it('swallows a NotFoundError from an already-revoked key and still resets', async () => {
    getById.mockResolvedValue(central({ centralInitialApiKeyId: 'init-key', centralApiKeyId: 'full-key' }));
    revokeApiKey.mockImplementation(async (_tenantId: string, keyId: string) => {
      if (keyId === 'init-key') throw new NotFoundError('API key not found');
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(revokeApiKey).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenCalledTimes(1);
    } finally {
      await srv.close();
    }
  });

  it('propagates a non-NotFoundError from revokeApiKey and does not reset', async () => {
    getById.mockResolvedValue(central({ centralInitialApiKeyId: 'init-key' }));
    revokeApiKey.mockRejectedValue(new Error('db exploded'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(patchConfig).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('404s when the central does not exist', async () => {
    getById.mockRejectedValue(new NotFoundError('Central not found'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/centrals/${CENTRAL_ID}/reset-provisioning`, { method: 'POST' });
      expect(res.status).toBe(404);
      expect(revokeApiKey).not.toHaveBeenCalled();
      expect(patchConfig).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
