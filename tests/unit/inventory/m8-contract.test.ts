/**
 * RFC-0061 M8 — wired-contract test for the REAL external routes + the now-real
 * POST /qr/generate.
 *
 * Same harness as m1..m7-contract: real router + real auth middleware, auth
 * leaves mocked, the M8 sync service mocked (no DB, NO network).
 *
 * SUPERSEDES the frozen case in tests/unit/controllers/inventory.contract.test.ts
 * ("POST /external/sync/run → 501 INV_NOT_IMPLEMENTED") — that file is frozen
 * for module PRs; remove that single case at wave-3 integration time.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

jest.mock('../../../src/services/CustomerApiKeyService', () => ({
  customerApiKeyService: {
    validateApiKey: jest.fn(),
    validateApiKeyWithTenant: jest.fn(),
  },
}));

jest.mock('../../../src/middleware/context', () => {
  const actual = jest.requireActual('../../../src/middleware/context');
  return { ...actual, decodeJWT: jest.fn() };
});

jest.mock('../../../src/services/inventory/InventoryExternalSyncService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryExternalSyncService');
  return {
    ...actual,
    inventoryExternalSyncService: {
      listStates: jest.fn(),
      getStatus: jest.fn(),
      runPull: jest.fn(),
      generateQr: jest.fn(),
    },
  };
});

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryExternalSyncService } from '../../../src/services/inventory/InventoryExternalSyncService';
import { externalNotConfigured } from '../../../src/services/inventory/ExternalPlatformClient';
import { ConflictError, ForbiddenError, ValidationError } from '../../../src/shared/errors/AppError';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';

const limiter = rateLimit({ windowMs: 60_000, limit: 10_000, validate: false });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware);
  app.use('/api/v1/inventory', limiter, hybridAuthByMethod('inventory:read', 'inventory:write'), inventoryController);
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function apiKeyCtx(scopes: string[]) {
  return { keyId: 'key-1', tenantId: TENANT, customerId: TENANT, scopes, name: 'inv-key', hierarchyAccess: 'SELF' };
}

const U = (base: string, path: string) => `${base}/api/v1/inventory${path}`;

type ErrBody = { success: boolean; error: { code: string } };
type OkBody<T> = { success: boolean; data: T };

const syncSvc = inventoryExternalSyncService as jest.Mocked<typeof inventoryExternalSyncService>;

const emptyPage = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M8 GET /external/states — real contract (was 501)', () => {
  it('200 with the paginated mirror; filters pass through', async () => {
    syncSvc.listStates.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/states?page=2&pageSize=50&location=cliente&q=2501'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(syncSvc.listStates).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ page: 2, pageSize: 50, location: 'cliente', q: '2501' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('bad pagination → 400 VALIDATION_ERROR', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/states?page=0'), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(400);
      expect(syncSvc.listStates).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('M8 GET /external/sync/status', () => {
  it('200 with sync state + outbox counters + mode', async () => {
    syncSvc.getStatus.mockResolvedValue({
      syncState: null,
      outbox: { pending: 0, retryable: 0, dead: 0, done: 0 },
      mode: { live: false, shadow: true },
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/status'), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ mode: { shadow: boolean } }>;
      expect(body.data.mode.shadow).toBe(true);
      expect(syncSvc.getStatus).toHaveBeenCalledWith(TENANT);
    } finally {
      await srv.close();
    }
  });
});

describe('M8 POST /external/sync/run — real contract (SUPERSEDES the frozen 501 case)', () => {
  it('200 with the run report (shadow default: live undefined)', async () => {
    syncSvc.runPull.mockResolvedValue({ ok: true, live: false, corrections: [], problems: [] } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(syncSvc.runPull).toHaveBeenCalledWith(TENANT, { live: undefined });
    } finally {
      await srv.close();
    }
  });

  it('?live=true forwards live: true to the service', async () => {
    syncSvc.runPull.mockResolvedValue({ ok: true, live: true, corrections: [], problems: [] } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run?live=true'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(syncSvc.runPull).toHaveBeenCalledWith(TENANT, { live: true });
    } finally {
      await srv.close();
    }
  });

  it('lease held → 409 CONFLICT', async () => {
    syncSvc.runPull.mockRejectedValue(new ConflictError('Sincronização externa já em execução (lease ativo)'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(409);
    } finally {
      await srv.close();
    }
  });

  it('?live=true without INV_SYNC_LIVE → 400 (service gate)', async () => {
    syncSvc.runPull.mockRejectedValue(new ValidationError('live=true requer INV_SYNC_LIVE=true'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run?live=true'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('?live=banana → 400 at the DTO boundary', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run?live=banana'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(400);
      expect(syncSvc.runPull).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('client not configured → 503 INV_EXTERNAL_NOT_CONFIGURED', async () => {
    syncSvc.runPull.mockRejectedValue(externalNotConfigured());
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_EXTERNAL_NOT_CONFIGURED');
    } finally {
      await srv.close();
    }
  });
});

describe('M8 POST /qr/generate — real contract (was 501)', () => {
  it('201 with {code, qrUrl}', async () => {
    syncSvc.generateQr.mockResolvedValue({ code: '250101_000123', qrUrl: 'https://produto.myio.com.br/250101_000123' });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/generate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ productType: 'SmartLight v3' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<{ code: string; qrUrl: string }>;
      expect(body.data.code).toBe('250101_000123');
      expect(body.data.qrUrl).toBe('https://produto.myio.com.br/250101_000123');
      expect(syncSvc.generateQr).toHaveBeenCalledWith({ productType: 'SmartLight v3' });
    } finally {
      await srv.close();
    }
  });

  it('missing productType → 400 at the DTO boundary', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/generate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(syncSvc.generateQr).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('no external client env → 503 with a clear code', async () => {
    syncSvc.generateQr.mockRejectedValue(externalNotConfigured());
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/generate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ productType: 'SmartLight v3' }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_EXTERNAL_NOT_CONFIGURED');
    } finally {
      await srv.close();
    }
  });
});

describe('M8 auth boundary', () => {
  it('write verbs demand inventory:write from the API key (403 from the scope check)', async () => {
    // The scope gate lives inside customerApiKeyService.validateApiKey — the
    // route passes 'inventory:write' for POST; a key without it is rejected.
    (customerApiKeyService.validateApiKey as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient scope'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/sync/run'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(403);
      expect(customerApiKeyService.validateApiKey).toHaveBeenCalledWith(
        'gcdr_cust_test',
        expect.anything(),
        'inventory:write',
      );
      expect(syncSvc.runPull).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('no credentials → 401', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/external/states'));
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });
});
