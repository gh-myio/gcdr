import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

// RFC-0061 — inventory contract guard: mount the REAL router behind the REAL
// auth chain (contextMiddleware → hybridAuthByMethod inventory:read/write) and
// assert the wired contract: auth enforced, DTOs validated, the 501
// INV_NOT_IMPLEMENTED marker for deferred modules, idempotency/confirmation
// guards, and the concrete /meta payload. Only the auth leaves are mocked.

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

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { decodeJWT } from '../../../src/middleware/context';
import { ForbiddenError } from '../../../src/shared/errors/AppError';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';

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

const jwtUser = { sub: 'user-1', email: 'op@x', tenant_id: TENANT, roles: ['role:operator'], type: 'USER' };
const U = (base: string, path: string) => `${base}/api/v1/inventory${path}`;

type ErrBody = { success: boolean; error: { code: string; message?: string; details?: Record<string, unknown> } };
type MetaBody = { success: boolean; data: { stockLocations: string[]; purchaseOrderTransitions: Record<string, string[]>; errorCodes: string[] } };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(apiKeyCtx(['inventory:read', 'inventory:write']));
});

describe('auth', () => {
  it('rejects an unauthenticated request (401)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items'));
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  
  it('write verbs require inventory:write (403 when the key lacks it)', async () => {
    (customerApiKeyService.validateApiKey as jest.Mock).mockImplementation((_k, _ip, required) => {
      if (required === 'inventory:write') throw new ForbiddenError('scope inventory:write required');
      return Promise.resolve(apiKeyCtx(['inventory:read']));
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'P' }),
      });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });
});

describe('GET /meta (concrete)', () => {
  it('returns the enums and state machines (200)', async () => {
    (decodeJWT as jest.Mock).mockReturnValue(jwtUser);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/meta'), { headers: { authorization: 'Bearer jwt' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as MetaBody;
      expect(body.success).toBe(true);
      expect(body.data.stockLocations).toEqual(['FABRICA', 'ALMOXARIFADO', 'ALMOXARIFADO_GERAL']);
      expect(body.data.purchaseOrderTransitions.ENTREGUE).toEqual(['RECEBIDO_OK', 'RECEBIDO_PROBLEMA']);
      expect(body.data.errorCodes).toContain('INV_INSUFFICIENT_STOCK');
    } finally {
      await srv.close();
    }
  });
});

describe('deferred modules return the 501 contract', () => {
  it('GET /purchase-orders → 501 INV_NOT_IMPLEMENTED with { module, phase }', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders'), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(501);
      const body = (await res.json()) as ErrBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INV_NOT_IMPLEMENTED');
      expect(body.error.details).toEqual({ module: 'M3', phase: 'P1' });
    } finally {
      await srv.close();
    }
  });
});

describe('DTO validation at the boundary', () => {
  it('POST /items with a bad body → 400 VALIDATION_ERROR', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'PRODUCT' }), // missing name
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await srv.close();
    }
  });

  });

describe('idempotency guard (S1)', () => {
  const goodMovement = { itemId: ITEM_ID, location: 'FABRICA', quantity: 3, type: 'ENTRADA' };

  it('POST /stock/movements without Idempotency-Key → 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify(goodMovement),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
    } finally {
      await srv.close();
    }
  });

  });

describe('destructive confirmation guard (S3)', () => {
  it('DELETE /items/:id without a token → 428 INV_CONFIRMATION_REQUIRED', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}`), {
        method: 'DELETE',
        headers: { 'x-api-key': 'gcdr_cust_x' },
      });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
    } finally {
      await srv.close();
    }
  });

  
  it('DELETE /items/:id with a malformed id → 400', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items/not-a-uuid'), {
        method: 'DELETE',
        headers: { 'x-api-key': 'gcdr_cust_x', 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });
});
