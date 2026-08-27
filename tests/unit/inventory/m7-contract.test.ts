/**
 * RFC-0061 M7 — wired-contract test for the REAL field routes.
 *
 * Same harness as m1..m5-contract: real router + real auth middleware, auth
 * leaves mocked, the M7 service mocked (no DB). Documents the standing guards:
 * the movement-writing POSTs (move / technician-moves / damaged-items /
 * recover) require an Idempotency-Key; DTO validation → 400; malformed path
 * ids → 400.
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

jest.mock('../../../src/services/inventory/InventoryFieldService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryFieldService');
  return {
    ...actual,
    inventoryFieldService: {
      listUnitProducts: jest.fn(),
      createUnitProduct: jest.fn(),
      updateUnitProduct: jest.fn(),
      moveUnitProduct: jest.fn(),
      listTechnicianItems: jest.fn(),
      createTechnicianMove: jest.fn(),
      listDamagedItems: jest.fn(),
      createDamagedItem: jest.fn(),
      recoverDamagedItem: jest.fn(),
    },
  };
});

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryFieldService } from '../../../src/services/inventory/InventoryFieldService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';
const UNIT_ID = '99999999-9999-4999-8999-999999999999';
const DAMAGED_ID = 'dddddddd-4444-4444-8444-444444444444';
const DISPATCH_ID = 'cccccccc-3333-4333-8333-333333333333';
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

const fieldSvc = inventoryFieldService as jest.Mocked<typeof inventoryFieldService>;

const emptyPage = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M7 unit-product routes — real contract (was 501)', () => {
  it('GET /unit-products → 200; defaults to active-only listing', async () => {
    fieldSvc.listUnitProducts.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/unit-products?page=1&pageSize=20'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(fieldSvc.listUnitProducts).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ page: 1, pageSize: 20, includeMoved: false }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /unit-products?includeMoved=true passes the filter through', async () => {
    fieldSvc.listUnitProducts.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/unit-products?includeMoved=true'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(fieldSvc.listUnitProducts).toHaveBeenCalledWith(TENANT, expect.objectContaining({ includeMoved: true }));
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products with a valid body → 201 (no Idempotency-Key needed — no ledger write)', async () => {
    fieldSvc.createUnitProduct.mockResolvedValue({ id: UNIT_ID, status: 'PARADO' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/unit-products'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: ITEM_ID, label: '1_2' }),
      });
      expect(res.status).toBe(201);
      expect(fieldSvc.createUnitProduct).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        expect.objectContaining({ itemId: ITEM_ID, label: '1_2' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products with a bad body → 400 VALIDATION_ERROR', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/unit-products'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: '1_2' }), // itemId missing
      });
      expect(res.status).toBe(400);
      expect(fieldSvc.createUnitProduct).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('PATCH /unit-products/:id toggles the status; malformed id → 400', async () => {
    fieldSvc.updateUnitProduct.mockResolvedValue({ id: UNIT_ID, status: 'INSTALADO' } as never);
    const srv = await listen(buildApp());
    try {
      const ok = await fetch(U(srv.url, `/unit-products/${UNIT_ID}`), {
        method: 'PATCH',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INSTALADO' }),
      });
      expect(ok.status).toBe(200);
      expect(fieldSvc.updateUnitProduct).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        UNIT_ID,
        { status: 'INSTALADO' },
      );

      const bad = await fetch(U(srv.url, '/unit-products/not-a-uuid'), {
        method: 'PATCH',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INSTALADO' }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products/:id/move without Idempotency-Key → 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/unit-products/${UNIT_ID}/move`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'ALMOXARIFADO' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(fieldSvc.moveUnitProduct).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products/:id/move — TECNICO without technician → 400 (DTO superRefine)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/unit-products/${UNIT_ID}/move`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'k-1' },
        body: JSON.stringify({ destination: 'TECNICO' }),
      });
      expect(res.status).toBe(400);
      expect(fieldSvc.moveUnitProduct).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products/:id/move — AVARIADO without notes → 400 (DTO superRefine)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/unit-products/${UNIT_ID}/move`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'k-2' },
        body: JSON.stringify({ destination: 'AVARIADO' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('POST /unit-products/:id/move with key + valid body → 200', async () => {
    fieldSvc.moveUnitProduct.mockResolvedValue({ unit: { id: UNIT_ID }, stockMovementId: null, damagedItemId: null } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/unit-products/${UNIT_ID}/move`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'k-3' },
        body: JSON.stringify({ destination: 'PERDIDO' }),
      });
      expect(res.status).toBe(200);
      expect(fieldSvc.moveUnitProduct).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        UNIT_ID,
        expect.objectContaining({ destination: 'PERDIDO' }),
        'k-3',
      );
    } finally {
      await srv.close();
    }
  });
});

describe('M7 technician routes — real contract', () => {
  it('GET /technician-items → 200 grouped listing', async () => {
    fieldSvc.listTechnicianItems.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/technician-items'), { headers: { 'X-API-Key': 'gcdr_cust_test' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: unknown[] }>;
      expect(body.data.items).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('POST /technician-moves without Idempotency-Key → 400', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/technician-moves'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 1 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
    } finally {
      await srv.close();
    }
  });

  it('POST /technician-moves — UNIDADE without projectId → 400 (DTO superRefine)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/technician-moves'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 't-1' },
        body: JSON.stringify({ movementId: DISPATCH_ID, destination: 'UNIDADE', quantity: 1 }),
      });
      expect(res.status).toBe(400);
      expect(fieldSvc.createTechnicianMove).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /technician-moves with key + valid body → 201', async () => {
    fieldSvc.createTechnicianMove.mockResolvedValue({ id: 'm-1', destination: 'PERDIDO' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/technician-moves'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 't-2' },
        body: JSON.stringify({ movementId: DISPATCH_ID, destination: 'PERDIDO', quantity: 1 }),
      });
      expect(res.status).toBe(201);
      expect(fieldSvc.createTechnicianMove).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        expect.objectContaining({ movementId: DISPATCH_ID, quantity: 1 }),
        't-2',
      );
    } finally {
      await srv.close();
    }
  });
});

describe('M7 damaged routes — real contract', () => {
  it('GET /damaged-items → 200', async () => {
    fieldSvc.listDamagedItems.mockResolvedValue(emptyPage as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/damaged-items?status=AVARIADO'), {
        headers: { 'X-API-Key': 'gcdr_cust_test' },
      });
      expect(res.status).toBe(200);
      expect(fieldSvc.listDamagedItems).toHaveBeenCalledWith(TENANT, expect.objectContaining({ status: 'AVARIADO' }));
    } finally {
      await srv.close();
    }
  });

  it('POST /damaged-items without Idempotency-Key → 400 (it writes a SAIDA)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/damaged-items'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: ITEM_ID, quantity: 1, location: 'ALMOXARIFADO', reason: 'x' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
    } finally {
      await srv.close();
    }
  });

  it('POST /damaged-items with key + valid body → 201', async () => {
    fieldSvc.createDamagedItem.mockResolvedValue({ damaged: { id: DAMAGED_ID }, stockMovementId: 'mv-1' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/damaged-items'), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'd-1' },
        body: JSON.stringify({ itemId: ITEM_ID, quantity: 1, location: 'ALMOXARIFADO', reason: 'oxidação' }),
      });
      expect(res.status).toBe(201);
      expect(fieldSvc.createDamagedItem).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        expect.objectContaining({ itemId: ITEM_ID, location: 'ALMOXARIFADO' }),
        'd-1',
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /damaged-items/:id/recover — TECNICO without technician → 400; valid → 200', async () => {
    fieldSvc.recoverDamagedItem.mockResolvedValue({
      damaged: { id: DAMAGED_ID, status: 'RECUPERADO' },
      entryMovementId: 'mv-2',
      exitMovementId: null,
      createdUnitProductIds: [],
      relinkedQr: null,
    } as never);
    const srv = await listen(buildApp());
    try {
      const bad = await fetch(U(srv.url, `/damaged-items/${DAMAGED_ID}/recover`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'r-1' },
        body: JSON.stringify({ destination: 'TECNICO' }),
      });
      expect(bad.status).toBe(400);

      const ok = await fetch(U(srv.url, `/damaged-items/${DAMAGED_ID}/recover`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'r-2' },
        body: JSON.stringify({ destination: 'ESTOQUE' }),
      });
      expect(ok.status).toBe(200);
      expect(fieldSvc.recoverDamagedItem).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        DAMAGED_ID,
        expect.objectContaining({ destination: 'ESTOQUE', location: 'ALMOXARIFADO' }),
        'r-2',
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /damaged-items/:id/recover without Idempotency-Key → 400', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/damaged-items/${DAMAGED_ID}/recover`), {
        method: 'POST',
        headers: { 'X-API-Key': 'gcdr_cust_test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'ESTOQUE' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(fieldSvc.recoverDamagedItem).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
