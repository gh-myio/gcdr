/**
 * RFC-0061 M2 — wired-contract test for the REAL stock routes.
 *
 * Supersedes the M2 cases of tests/unit/controllers/inventory.contract.test.ts
 * that asserted the 501 INV_NOT_IMPLEMENTED marker ("POST /stock/movements
 * with key + valid body → 501"): M2 now serves real handlers, so a valid
 * movement POST is a 201. Auth chain and guard behavior (missing
 * Idempotency-Key → 400, missing confirmationToken → 428) are unchanged.
 *
 * Same harness as the original contract test: real router + real auth
 * middleware, auth leaves mocked — plus the M2 service mocked (no DB).
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

jest.mock('../../../src/services/inventory/InventoryStockService', () => ({
  inventoryStockService: {
    getBalances: jest.fn(),
    getConsistency: jest.fn(),
    listMovements: jest.fn(),
    getMovement: jest.fn(),
    createMovement: jest.fn(),
    createTransfer: jest.fn(),
    reset: jest.fn(),
  },
}));

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryStockService } from '../../../src/services/inventory/InventoryStockService';
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

const U = (base: string, path: string) => `${base}/api/v1/inventory${path}`;

type ErrBody = { success: boolean; error: { code: string; details?: Record<string, unknown> } };
type OkBody<T> = { success: boolean; data: T };

const svc = inventoryStockService as jest.Mocked<typeof inventoryStockService>;

const goodMovement = { itemId: ITEM_ID, location: 'FABRICA', quantity: 3, type: 'ENTRADA' };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M2 stock routes — real contract (supersedes the 501 cases)', () => {
  it('POST /stock/movements with key + valid body → 201 with the movement (was 501)', async () => {
    const movement = { id: 'mov-1', itemId: ITEM_ID, location: 'FABRICA', quantity: 3, type: 'ENTRADA', qrs: [] };
    svc.createMovement.mockResolvedValue(movement as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'abc-123' },
        body: JSON.stringify(goodMovement),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<typeof movement>;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('mov-1');
      expect(svc.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        expect.objectContaining({ itemId: ITEM_ID, type: 'ENTRADA' }),
        'abc-123',
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /stock/movements without Idempotency-Key → still 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify(goodMovement),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(svc.createMovement).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /stock/movements with a transfer type → 400 (transfers have their own endpoint)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'k' },
        body: JSON.stringify({ ...goodMovement, type: 'TRANSFERENCIA_OUT' }),
      });
      expect(res.status).toBe(400);
      expect(svc.createMovement).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /stock/transfers → 201 with both legs', async () => {
    svc.createTransfer.mockResolvedValue({
      transferGroupId: 'tg-1',
      out: { id: 'a', type: 'TRANSFERENCIA_OUT' },
      in: { id: 'b', type: 'TRANSFERENCIA_IN' },
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/transfers'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 't-1' },
        body: JSON.stringify({ itemId: ITEM_ID, fromLocation: 'FABRICA', toLocation: 'ALMOXARIFADO', quantity: 2 }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<{ transferGroupId: string }>;
      expect(body.data.transferGroupId).toBe('tg-1');
    } finally {
      await srv.close();
    }
  });

  it('GET /stock/balances → 200 with the derived balances', async () => {
    svc.getBalances.mockResolvedValue([
      { itemId: ITEM_ID, itemName: 'X', domain: 'PRODUCT', location: 'FABRICA', balance: 7, totalIn: 10, totalOut: 3, lastMovementAt: null },
    ] as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/balances?location=FABRICA'), {
        headers: { 'x-api-key': 'gcdr_cust_x' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<Array<{ balance: number }>>;
      expect(body.data[0].balance).toBe(7);
      expect(svc.getBalances).toHaveBeenCalledWith(TENANT, expect.objectContaining({ location: 'FABRICA' }));
    } finally {
      await srv.close();
    }
  });

  it('GET /stock/movements → 200 paginated envelope (total/totalPages)', async () => {
    svc.listMovements.mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 25, totalPages: 3 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements?page=2&pageSize=10'), {
        headers: { 'x-api-key': 'gcdr_cust_x' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ total: number; totalPages: number }>;
      expect(body.data.total).toBe(25);
      expect(body.data.totalPages).toBe(3);
      expect(svc.listMovements).toHaveBeenCalledWith(TENANT, 2, 10);
    } finally {
      await srv.close();
    }
  });

  it('GET /stock/consistency → 200 with rows + driftCount', async () => {
    svc.getConsistency.mockResolvedValue([
      { itemId: ITEM_ID, location: 'FABRICA', ledgerBalance: 5, activeQrCount: 4, drift: 1 },
    ] as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/consistency'), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ driftCount: number }>;
      expect(body.data.driftCount).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('POST /stock/reset without confirmationToken → 428 (guard unchanged)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/reset'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(svc.reset).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /stock/reset with X-Confirmation-Token header → 200', async () => {
    svc.reset.mockResolvedValue({ deletedMovements: 12, location: null } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/reset'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'x-confirmation-token': 'excluir' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ deletedMovements: number }>;
      expect(body.data.deletedMovements).toBe(12);
    } finally {
      await srv.close();
    }
  });

  it('service InventoryError surfaces its code + details through the errorHandler', async () => {
    const { insufficientStock } = jest.requireActual<
      typeof import('../../../src/shared/errors/InventoryError')
    >('../../../src/shared/errors/InventoryError');
    svc.createMovement.mockRejectedValue(insufficientStock(ITEM_ID, 'FABRICA', 1, 5));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/stock/movements'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'k9' },
        body: JSON.stringify(goodMovement),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_INSUFFICIENT_STOCK');
    } finally {
      await srv.close();
    }
  });
});
