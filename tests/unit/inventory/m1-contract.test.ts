import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

// RFC-0061 M1 — catalog contract, now CONCRETE (was 501 in the shared
// tests/unit/controllers/inventory.contract.test.ts — its M1 cases are
// superseded by this file and should be removed at integration time).
// Same harness: REAL router + REAL auth chain (contextMiddleware →
// hybridAuthByMethod); only the auth leaves and the M1 service are mocked,
// so no database is touched.

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

jest.mock('../../../src/services/inventory/InventoryItemService', () => ({
  inventoryItemService: {
    listItems: jest.fn(),
    getItem: jest.fn(),
    createItem: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    getItemStock: jest.fn(),
    getBom: jest.fn(),
    putBom: jest.fn(),
  },
}));

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryItemService } from '../../../src/services/inventory/InventoryItemService';
import { ConflictError, NotFoundError } from '../../../src/shared/errors/AppError';
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

const U = (base: string, path: string) => `${base}/api/v1/inventory${path}`;
const KEY_HEADERS = { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' };

const itemResponse = {
  id: ITEM_ID,
  name: 'Medidor V6',
  domain: 'PRODUCT',
  link: null,
  description: null,
  isManufactured: true,
  lossPercent: 2.5,
  lotQuantity: null,
  purchaseType: null,
  photoFileId: null,
  active: true,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
};

type OkBody<T> = { success: boolean; data: T };
type ErrBody = { success: boolean; error: { code: string; message?: string } };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue({
    keyId: 'key-1', tenantId: TENANT, customerId: TENANT,
    scopes: ['inventory:read', 'inventory:write'], name: 'inv-key', hierarchyAccess: 'SELF',
  });
});

describe('M1 catalog — concrete contract (supersedes the 501 M1 cases)', () => {
  it('GET /items → 200 with the paginated envelope (was: 501 stub)', async () => {
    (inventoryItemService.listItems as jest.Mock).mockResolvedValue({
      items: [itemResponse], page: 1, pageSize: 20, total: 1, totalPages: 1,
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items?domain=PRODUCT'), { headers: KEY_HEADERS });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: unknown[]; total: number; totalPages: number }>;
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(1);
      expect(body.data.totalPages).toBe(1);
      expect(inventoryItemService.listItems).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ page: 1, pageSize: 20, domain: 'PRODUCT' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /items still validates the query DTO (pageSize over the cap → 400)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items?pageSize=999'), { headers: KEY_HEADERS });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrBody).error.code).toBe('VALIDATION_ERROR');
      expect(inventoryItemService.listItems).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /items with a valid body → 201 (was: 501 after validation)', async () => {
    (inventoryItemService.createItem as jest.Mock).mockResolvedValue(itemResponse);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items'), {
        method: 'POST',
        headers: KEY_HEADERS,
        body: JSON.stringify({ name: 'Medidor', domain: 'PRODUCT' }),
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as OkBody<typeof itemResponse>).data.id).toBe(ITEM_ID);
    } finally {
      await srv.close();
    }
  });

  it('POST /items with a bad body → 400 VALIDATION_ERROR (unchanged)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items'), {
        method: 'POST',
        headers: KEY_HEADERS,
        body: JSON.stringify({ domain: 'PRODUCT' }), // missing name
      });
      expect(res.status).toBe(400);
      expect(inventoryItemService.createItem).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('a duplicate name surfaces as 409 CONFLICT at the HTTP boundary', async () => {
    (inventoryItemService.createItem as jest.Mock).mockRejectedValue(
      new ConflictError('Já existe um item com o nome "Medidor" no domínio PRODUCT'),
    );
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/items'), {
        method: 'POST',
        headers: KEY_HEADERS,
        body: JSON.stringify({ name: 'Medidor', domain: 'PRODUCT' }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as ErrBody).error.code).toBe('CONFLICT');
    } finally {
      await srv.close();
    }
  });

  it('GET /items/:id → 404 NOT_FOUND propagates from the service', async () => {
    (inventoryItemService.getItem as jest.Mock).mockRejectedValue(new NotFoundError('Item not found'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}`), { headers: KEY_HEADERS });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it('DELETE /items/:id with x-confirmation-token → 204 (was: 501 past the guard)', async () => {
    (inventoryItemService.deleteItem as jest.Mock).mockResolvedValue(undefined);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}`), {
        method: 'DELETE',
        headers: { ...KEY_HEADERS, 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(204);
      expect(inventoryItemService.deleteItem).toHaveBeenCalledWith(TENANT, ITEM_ID);
    } finally {
      await srv.close();
    }
  });

  it('DELETE /items/:id without a token still 428s BEFORE reaching the service', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}`), { method: 'DELETE', headers: KEY_HEADERS });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(inventoryItemService.deleteItem).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('GET /items/:id/stock → 200 with the per-location balance rows', async () => {
    (inventoryItemService.getItemStock as jest.Mock).mockResolvedValue([
      { itemId: ITEM_ID, itemName: 'Medidor V6', domain: 'PRODUCT', location: 'FABRICA', balance: 7, totalIn: 10, totalOut: 3, lastMovementAt: null },
    ]);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}/stock`), { headers: KEY_HEADERS });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<Array<{ location: string; balance: number }>>;
      expect(body.data[0]).toMatchObject({ location: 'FABRICA', balance: 7 });
    } finally {
      await srv.close();
    }
  });

  it('PUT /items/:id/bom validates the DTO then hits the service → 200', async () => {
    (inventoryItemService.putBom as jest.Mock).mockResolvedValue({
      productItemId: ITEM_ID,
      components: [{ componentItemId: TENANT, componentName: 'Sensor', quantity: 2 }],
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}/bom`), {
        method: 'PUT',
        headers: KEY_HEADERS,
        body: JSON.stringify({ components: [{ componentItemId: TENANT, quantity: 2 }] }),
      });
      expect(res.status).toBe(200);
      expect(inventoryItemService.putBom).toHaveBeenCalledWith(
        TENANT, ITEM_ID, { components: [{ componentItemId: TENANT, quantity: 2 }] }, expect.anything(),
      );
    } finally {
      await srv.close();
    }
  });

  it('PUT /items/:id/bom with a 4-decimal quantity → 400 (numeric(12,3) grain)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/items/${ITEM_ID}/bom`), {
        method: 'PUT',
        headers: KEY_HEADERS,
        body: JSON.stringify({ components: [{ componentItemId: TENANT, quantity: 0.0001 }] }),
      });
      expect(res.status).toBe(400);
      expect(inventoryItemService.putBom).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
