/**
 * RFC-0061 M5 — wired-contract test for the REAL homologation & QR routes.
 *
 * Same harness as m1/m2-contract: real router + real auth middleware, auth
 * leaves mocked, M5 services mocked (no DB). Documents the standing guards
 * (missing Idempotency-Key → 400, DTO validation → 400) and the one route M5
 * intentionally keeps deferred: POST /qr/generate delegates QR generation to
 * the external platform, whose client ships with M8 → still 501.
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

jest.mock('../../../src/services/inventory/InventoryHomologationService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryHomologationService');
  return {
    ...actual,
    inventoryHomologationService: {
      listHomologations: jest.fn(),
      listBoxes: jest.fn(),
      createHomologation: jest.fn(),
      addUnitToBox: jest.fn(),
      removeFromBox: jest.fn(),
    },
  };
});

jest.mock('../../../src/services/inventory/InventoryQrService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryQrService');
  return {
    ...actual,
    inventoryQrService: {
      validate: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryHomologationService } from '../../../src/services/inventory/InventoryHomologationService';
import { inventoryQrService } from '../../../src/services/inventory/InventoryQrService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { NotFoundError } from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const BOX_ID = '77777777-7777-7777-7777-777777777777';
const UNIT_ID = '88888888-8888-8888-8888-888888888888';

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

type ErrBody = { success: boolean; error: { code: string; details?: Record<string, unknown> } };
type OkBody<T> = { success: boolean; data: T };

const homologSvc = inventoryHomologationService as jest.Mocked<typeof inventoryHomologationService>;
const qrSvc = inventoryQrService as jest.Mocked<typeof inventoryQrService>;

const goodHomologation = {
  itemId: ITEM_ID,
  boxSize: 1,
  units: [{ qrValue: '123_456' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M5 homologation routes — real contract (was 501)', () => {
  it('GET /homologations → 200 with the paginated listing', async () => {
    homologSvc.listHomologations.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/homologations?page=1&pageSize=20'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: unknown[] }>;
      expect(body.data.items).toEqual([]);
      expect(homologSvc.listHomologations).toHaveBeenCalledWith(TENANT, expect.objectContaining({ page: 1, pageSize: 20 }));
    } finally {
      await srv.close();
    }
  });

  it('POST /homologations without Idempotency-Key → 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/homologations'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify(goodHomologation),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(homologSvc.createHomologation).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /homologations with a bad body → 400 VALIDATION_ERROR', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/homologations'), {
        method: 'POST',
        headers: {
          'X-API-Key': 'gcdr_cust_test',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'k-1',
        },
        body: JSON.stringify({ itemId: ITEM_ID, boxSize: 5, units: [] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await srv.close();
    }
  });

  it('POST /homologations with key + valid body → 201 (was 501)', async () => {
    homologSvc.createHomologation.mockResolvedValue({
      id: BOX_ID,
      itemId: ITEM_ID,
      boxSize: 1,
      units: [{ id: UNIT_ID, qrValue: '123_456', position: 1 }],
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/homologations'), {
        method: 'POST',
        headers: {
          'X-API-Key': 'gcdr_cust_test',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'k-2',
        },
        body: JSON.stringify(goodHomologation),
      });
      expect(res.status).toBe(201);
      expect(homologSvc.createHomologation).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        expect.objectContaining({ itemId: ITEM_ID, boxSize: 1 }),
        'k-2',
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /homologations/boxes → 200', async () => {
    homologSvc.listBoxes.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/homologations/boxes'), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it('POST /homologations/boxes/:id/add-unit → 200; malformed box id → 400', async () => {
    homologSvc.addUnitToBox.mockResolvedValue({ id: BOX_ID, unitCount: 2, isFull: false } as never);
    const srv = await listen(buildApp());
    try {
      const ok = await fetch(U(srv.url, `/homologations/boxes/${BOX_ID}/add-unit`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: UNIT_ID }),
      });
      expect(ok.status).toBe(200);
      expect(homologSvc.addUnitToBox).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        BOX_ID,
        { unitId: UNIT_ID },
      );

      const bad = await fetch(U(srv.url, '/homologations/boxes/not-a-uuid/add-unit'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: UNIT_ID }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('POST /homologations/units/:id/remove-from-box → 200', async () => {
    homologSvc.removeFromBox.mockResolvedValue({ boxDeleted: true } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/homologations/units/${UNIT_ID}/remove-from-box`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(homologSvc.removeFromBox).toHaveBeenCalledWith({ tenantId: TENANT, userId: 'key-1' }, UNIT_ID);
    } finally {
      await srv.close();
    }
  });
});

describe('M5 QR routes — real contract', () => {
  it('POST /qr/validate → 200 with per-code verdicts', async () => {
    qrSvc.validate.mockResolvedValue({
      results: [{ code: '1_1', ok: false, reason: 'INV_QR_NOT_IN_REGISTRY' }],
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/validate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: ['1_1'] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ results: unknown[] }>;
      expect(body.data.results).toHaveLength(1);
      expect(qrSvc.validate).toHaveBeenCalledWith(TENANT, { codes: ['1_1'] });
    } finally {
      await srv.close();
    }
  });

  it('POST /qr/validate with a bad body → 400 VALIDATION_ERROR (batch guardrail)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/validate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: [] }),
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('GET /qr/trace/:code passes the URL-decoded code to the service', async () => {
    qrSvc.trace.mockResolvedValue({ code: '123_456', current: { location: null, status: null, client: null }, isBox: false, timeline: [] });
    const srv = await listen(buildApp());
    try {
      const encoded = encodeURIComponent('https://produto.myio.com.br/123_456');
      const res = await fetch(U(srv.url, `/qr/trace/${encoded}`), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(200);
      expect(qrSvc.trace).toHaveBeenCalledWith(TENANT, 'https://produto.myio.com.br/123_456');
    } finally {
      await srv.close();
    }
  });

  it('GET /qr/trace/:code for an unknown QR → 404', async () => {
    qrSvc.trace.mockRejectedValue(new NotFoundError('QR 9_9 not found'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/trace/9_9'), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it('POST /qr/generate is real since M8 (was 501): DTO gate → 400 on an empty body', async () => {
    // Full route coverage (201/503) lives in m8-contract.test.ts — here only
    // the M5-visible contract: the route validates before touching anything.
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/qr/generate'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await srv.close();
    }
  });
});
