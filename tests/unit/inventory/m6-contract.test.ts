/**
 * RFC-0061 M6 — wired-contract test for the REAL expedition routes (+ the
 * resolve-demand route in the production router).
 *
 * Same harness as m1/m2/m5-contract: real router + real auth middleware, auth
 * leaves mocked, M6 service mocked (no DB). Documents the standing guards
 * (missing Idempotency-Key → 400, missing confirmationToken → 428, DTO
 * validation → 400) and SUPERSEDES the deferred-501 case for
 * GET /expedition-orders in tests/unit/controllers/inventory.contract.test.ts
 * (that file is frozen for this PR — the retarget lands in the wave-2
 * integration).
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

jest.mock('../../../src/services/inventory/InventoryExpeditionService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryExpeditionService');
  return {
    ...actual,
    inventoryExpeditionService: {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      changeStatus: jest.fn(),
      deliverItem: jest.fn(),
      ship: jest.fn(),
      returnToExpedition: jest.fn(),
      markLost: jest.fn(),
      markFound: jest.fn(),
      transitProgress: jest.fn(),
      resolveDemand: jest.fn(),
    },
  };
});

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryExpeditionService } from '../../../src/services/inventory/InventoryExpeditionService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { NotFoundError } from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ORDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
const ORDER_ITEM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const ITEM_ID = 'ffffffff-ffff-4fff-8fff-ffffffffff01';
const PHOTO_ID = '44444444-4444-4444-4444-444444444444';
const PROOF_ID = '44444444-4444-4444-4444-444444444445';

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

const svc = inventoryExpeditionService as jest.Mocked<typeof inventoryExpeditionService>;

const emptyPage = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M6 expedition routes — real contract (supersedes the deferred 501 case)', () => {
  it('GET /expedition-orders → 200 with the paginated listing (was 501 M6/P3)', async () => {
    svc.list.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/expedition-orders?page=1&pageSize=20'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<typeof emptyPage>;
      expect(body.success).toBe(true);
      expect(body.data).toEqual(emptyPage);
      expect(svc.list).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /expedition-orders → 201 with a valid payload', async () => {
    svc.create.mockResolvedValue({ id: ORDER_ID, status: 'PENDENTE' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/expedition-orders'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: PROJECT_ID,
          deliveryDate: '2026-09-30T00:00:00.000Z',
          items: [{ itemId: ITEM_ID, quantity: 2 }],
        }),
      });
      expect(res.status).toBe(201);
    } finally {
      await srv.close();
    }
  });

  it('POST /expedition-orders without projectId → 400 (Zod, project required)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/expedition-orders'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryDate: '2026-09-30T00:00:00.000Z', items: [{ itemId: ITEM_ID, quantity: 2 }] }),
      });
      expect(res.status).toBe(400);
      expect(svc.create).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('GET /expedition-orders/:id with a malformed id → 400', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/expedition-orders/not-a-uuid'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(400);
      expect(svc.getById).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('GET /expedition-orders/:id → 404 from the service NotFoundError', async () => {
    svc.getById.mockRejectedValue(new NotFoundError(`Expedition order ${ORDER_ID} not found`));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}`), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it('DELETE /expedition-orders/:id without confirmationToken → 428 INV_CONFIRMATION_REQUIRED', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}`), {
        method: 'DELETE',
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(428);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(svc.delete).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('DELETE /expedition-orders/:id with the token → 200', async () => {
    svc.delete.mockResolvedValue({ deleted: true });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}`), {
        method: 'DELETE',
        headers: {
          'X-API-Key': 'gcdr_cust_test',
          'Content-Type': 'application/json',
          'X-Confirmation-Token': 'excluir',
        },
      });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it('POST …/deliver without Idempotency-Key → 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/items/${ORDER_ITEM_ID}/deliver`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1, photoFileId: PHOTO_ID, qrs: ['100_1'] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(svc.deliverItem).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST …/deliver with the key → 201, forwarding the key to the service', async () => {
    svc.deliverItem.mockResolvedValue({ movementId: 'm-1' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/items/${ORDER_ITEM_ID}/deliver`), {
        method: 'POST',
        headers: {
          'X-API-Key': 'gcdr_cust_test',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'baixa-abc-1',
        },
        body: JSON.stringify({ quantity: 1, photoFileId: PHOTO_ID, qrs: ['100_1'] }),
      });
      expect(res.status).toBe(201);
      expect(svc.deliverItem).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        ORDER_ID,
        ORDER_ITEM_ID,
        expect.objectContaining({ quantity: 1, photoFileId: PHOTO_ID }),
        'baixa-abc-1',
      );
    } finally {
      await srv.close();
    }
  });

  it('POST …/ship with an unknown method → 400 (enum)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/ship`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: 'Rua X',
          shippingMethod: 'SEDEX',
          responsible: 'João',
          trackingCode: 'BR1',
          proofFileId: PROOF_ID,
        }),
      });
      expect(res.status).toBe(400);
      expect(svc.ship).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST …/status → 200 via the mocked service', async () => {
    svc.changeStatus.mockResolvedValue({ order: { id: ORDER_ID, status: 'PRODUZINDO' } } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/status`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PRODUZINDO' }),
      });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it('POST …/return without reason → 400 (Zod)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/return`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(svc.returnToExpedition).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST …/found → 200 with a valid sector', async () => {
    svc.markFound.mockResolvedValue({ order: { id: ORDER_ID, status: 'PRONTO_ENTREGA' } } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/found`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector: 'EXPEDICAO' }),
      });
      expect(res.status).toBe(200);
      expect(svc.markFound).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        ORDER_ID,
        { sector: 'EXPEDICAO' },
      );
    } finally {
      await srv.close();
    }
  });

  it('GET …/transit-progress → 200 with the badge summary', async () => {
    svc.transitProgress.mockResolvedValue({
      orderId: ORDER_ID,
      status: 'EM_TRANSITO',
      totalUnits: 3,
      unitsInTransit: 2,
      summary: '2 de 3 em transporte',
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/expedition-orders/${ORDER_ID}/transit-progress`), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ summary: string }>;
      expect(body.data.summary).toBe('2 de 3 em transporte');
    } finally {
      await srv.close();
    }
  });
});

describe('M4 resolve-demand route — real contract (was 501 M4/P3)', () => {
  it('POST /production/resolve-demand → 200 via the expedition service', async () => {
    svc.resolveDemand.mockResolvedValue({ orderId: ORDER_ID, items: [] });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/resolve-demand'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ expeditionOrderId: ORDER_ID }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ orderId: string }>;
      expect(body.data.orderId).toBe(ORDER_ID);
      expect(svc.resolveDemand).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), {
        expeditionOrderId: ORDER_ID,
      });
    } finally {
      await srv.close();
    }
  });

  it('POST /production/resolve-demand with a malformed body → 400 (Zod)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/resolve-demand'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ expeditionOrderId: 'nope' }),
      });
      expect(res.status).toBe(400);
      expect(svc.resolveDemand).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('M6 — auth still guards the module', () => {
  it('GET /expedition-orders without credentials → 401', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/expedition-orders'));
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });
});
