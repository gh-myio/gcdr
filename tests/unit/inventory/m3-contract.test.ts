// RFC-0061 M3 — purchases contract test. Supersedes the M3 case of the frozen
// tests/unit/controllers/inventory.contract.test.ts: the module now answers
// concretely instead of the 501 INV_NOT_IMPLEMENTED marker. Mounts the REAL
// router behind the REAL auth chain (contextMiddleware → hybridAuthByMethod)
// with only the auth leaves and the M3 service mocked.
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

jest.mock('../../../src/services/inventory/InventoryPurchaseOrderService', () => ({
  inventoryPurchaseOrderService: {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    changeStatus: jest.fn(),
    listEvents: jest.fn(),
    addFiles: jest.fn(),
    removeFiles: jest.fn(),
    delete: jest.fn(),
  },
}));

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryPurchaseOrderService } from '../../../src/services/inventory/InventoryPurchaseOrderService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { NotFoundError } from '../../../src/shared/errors/AppError';
import {
  alreadyInState,
  editLockedState,
  illegalTransition,
} from '../../../src/shared/errors/InventoryError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';
const FILE_ID = '55555555-5555-5555-5555-555555555555';

const order = {
  id: ORDER_ID,
  projectId: PROJECT_ID,
  itemId: ITEM_ID,
  itemNameSnapshot: 'Resistor 10k',
  quantity: 50,
  status: 'PENDENTE',
  deadlineType: 'ESTA_SEMANA',
  deadlineDate: null,
  deliveryForecast: null,
  requesterNotes: null,
  buyerNotes: null,
  createdAt: '2026-08-26T10:00:00.000Z',
  updatedAt: '2026-08-26T10:00:00.000Z',
  allowedTransitions: ['COMPRADO_AGUARDANDO', 'CANCELADO'],
  requesterId: null,
  itemLink: null,
  recipient: null,
  deliveryPoint: null,
  passphrase: null,
};

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
const KEY = { 'x-api-key': 'gcdr_cust_x' };
const JSON_KEY = { ...KEY, 'content-type': 'application/json' };

type ErrBody = { success: boolean; error: { code: string; message?: string; details?: Record<string, unknown> } };
type OkBody<T> = { success: boolean; data: T; meta: { requestId: string } };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue({
    keyId: 'key-1',
    tenantId: TENANT,
    customerId: TENANT,
    scopes: ['inventory:read', 'inventory:write'],
    name: 'inv-key',
    hierarchyAccess: 'SELF',
  });
});

describe('GET /purchase-orders', () => {
  it('returns the paginated buyer queue (200) with the parsed filters', async () => {
    (inventoryPurchaseOrderService.list as jest.Mock).mockResolvedValue({
      items: [order], page: 1, pageSize: 20, total: 1, totalPages: 1,
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(
        U(srv.url, `/purchase-orders?status=PENDENTE&projectId=${PROJECT_ID}&purchaseType=NACIONAL&groupByProject=true`),
        { headers: KEY },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: unknown[]; total: number }>;
      expect(body.data.items).toHaveLength(1);
      expect(inventoryPurchaseOrderService.list).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          status: 'PENDENTE',
          projectId: PROJECT_ID,
          purchaseType: 'NACIONAL',
          groupByProject: true,
        }),
      );
    } finally {
      await srv.close();
    }
  });

  it('rejects an unknown status filter (400) before reaching the service', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders?status=EM_ANDAMENTO'), { headers: KEY });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.list).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('POST /purchase-orders', () => {
  const validBody = {
    projectId: PROJECT_ID,
    itemId: ITEM_ID,
    quantity: 50,
    deadlineType: 'ESTA_SEMANA',
  };

  it('creates and answers 201 with allowedTransitions (S3)', async () => {
    (inventoryPurchaseOrderService.create as jest.Mock).mockResolvedValue(order);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders'), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<typeof order>;
      expect(body.data.allowedTransitions).toEqual(['COMPRADO_AGUARDANDO', 'CANCELADO']);
    } finally {
      await srv.close();
    }
  });

  it('rejects deadlineType=CUSTOMIZADO without deadlineDate (400) at the DTO', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders'), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ ...validBody, deadlineType: 'CUSTOMIZADO' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.create).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('rejects a body without itemId (400)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders'), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ projectId: PROJECT_ID, quantity: 1, deadlineType: 'URGENTE' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.create).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('GET /purchase-orders/:id', () => {
  it('returns the detail (200)', async () => {
    (inventoryPurchaseOrderService.getById as jest.Mock).mockResolvedValue({ ...order, files: [] });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), { headers: KEY });
      expect(res.status).toBe(200);
      expect(((await res.json()) as OkBody<typeof order>).data.id).toBe(ORDER_ID);
    } finally {
      await srv.close();
    }
  });

  it('rejects a malformed id (400) before reaching the service', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/purchase-orders/not-a-uuid'), { headers: KEY });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.getById).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('propagates NotFoundError (404)', async () => {
    (inventoryPurchaseOrderService.getById as jest.Mock).mockRejectedValue(new NotFoundError('missing'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), { headers: KEY });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});

describe('PATCH /purchase-orders/:id', () => {
  it('updates and answers 200', async () => {
    (inventoryPurchaseOrderService.update as jest.Mock).mockResolvedValue({ ...order, quantity: 99 });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ quantity: 99 }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as OkBody<typeof order>).data.quantity).toBe(99);
    } finally {
      await srv.close();
    }
  });

  it('surfaces INV_EDIT_LOCKED_STATE as 409 with the current state', async () => {
    (inventoryPurchaseOrderService.update as jest.Mock).mockRejectedValue(editLockedState('ENTREGUE'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ quantity: 99 }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_EDIT_LOCKED_STATE');
      expect(body.error.details).toEqual({ current: 'ENTREGUE' });
    } finally {
      await srv.close();
    }
  });

  it('rejects unknown body fields (400, strict DTO)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ status: 'CANCELADO' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.update).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('POST /purchase-orders/:id/status', () => {
  it('transitions and answers 200 with the fresh allowedTransitions', async () => {
    (inventoryPurchaseOrderService.changeStatus as jest.Mock).mockResolvedValue({
      ...order,
      status: 'COMPRADO_AGUARDANDO',
      allowedTransitions: ['ENTREGUE', 'CANCELADO'],
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/status`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ status: 'COMPRADO_AGUARDANDO' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<typeof order>;
      expect(body.data.status).toBe('COMPRADO_AGUARDANDO');
      expect(body.data.allowedTransitions).toEqual(['ENTREGUE', 'CANCELADO']);
      expect(inventoryPurchaseOrderService.changeStatus).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        ORDER_ID,
        { status: 'COMPRADO_AGUARDANDO' },
      );
    } finally {
      await srv.close();
    }
  });

  it('rejects PENDENTE as a target (400) — creation-only status', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/status`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ status: 'PENDENTE' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.changeStatus).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('surfaces INV_ILLEGAL_TRANSITION as 409 carrying current + allowedTransitions', async () => {
    (inventoryPurchaseOrderService.changeStatus as jest.Mock).mockRejectedValue(
      illegalTransition('RECEBIDO_OK', []),
    );
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/status`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ status: 'CANCELADO' }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_ILLEGAL_TRANSITION');
      expect(body.error.details).toEqual({ current: 'RECEBIDO_OK', allowedTransitions: [] });
    } finally {
      await srv.close();
    }
  });

  it('surfaces INV_ALREADY_IN_STATE as 409 with the standing state (A1)', async () => {
    (inventoryPurchaseOrderService.changeStatus as jest.Mock).mockRejectedValue(
      alreadyInState('RECEBIDO_OK'),
    );
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/status`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ status: 'RECEBIDO_OK' }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_ALREADY_IN_STATE');
      expect(body.error.details).toEqual({ current: 'RECEBIDO_OK' });
    } finally {
      await srv.close();
    }
  });
});

describe('GET /purchase-orders/:id/events', () => {
  it('returns the paginated timeline (200)', async () => {
    (inventoryPurchaseOrderService.listEvents as jest.Mock).mockResolvedValue({
      items: [{ id: 'ev-1', orderId: ORDER_ID, actorId: null, eventType: 'CRIADO', details: {}, createdAt: '2026-08-26T10:00:00.000Z' }],
      page: 1, pageSize: 20, total: 1, totalPages: 1,
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/events?page=1&pageSize=20`), { headers: KEY });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: Array<{ eventType: string }>; total: number }>;
      expect(body.data.items[0].eventType).toBe('CRIADO');
      expect(inventoryPurchaseOrderService.listEvents).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        ORDER_ID,
        1,
        20,
      );
    } finally {
      await srv.close();
    }
  });
});

describe('POST /purchase-orders/:id/files', () => {
  it('links pre-uploaded file_assets and answers 201', async () => {
    (inventoryPurchaseOrderService.addFiles as jest.Mock).mockResolvedValue({
      orderId: ORDER_ID,
      files: [{ id: 'link-1', fileId: FILE_ID, createdAt: '2026-08-26T10:00:00.000Z' }],
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/files`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ fileIds: [FILE_ID] }),
      });
      expect(res.status).toBe(201);
      expect(inventoryPurchaseOrderService.addFiles).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        ORDER_ID,
        [FILE_ID],
      );
    } finally {
      await srv.close();
    }
  });

  it('rejects an empty fileIds array (400)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/files`), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ fileIds: [] }),
      });
      expect(res.status).toBe(400);
      expect(inventoryPurchaseOrderService.addFiles).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('DELETE /purchase-orders/:id/files', () => {
  it('unlinks the given fileIds (200)', async () => {
    (inventoryPurchaseOrderService.removeFiles as jest.Mock).mockResolvedValue({ orderId: ORDER_ID, removed: 1 });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}/files`), {
        method: 'DELETE',
        headers: JSON_KEY,
        body: JSON.stringify({ fileIds: [FILE_ID] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ removed: number }>;
      expect(body.data.removed).toBe(1);
      expect(inventoryPurchaseOrderService.removeFiles).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        ORDER_ID,
        [FILE_ID],
      );
    } finally {
      await srv.close();
    }
  });
});

describe('DELETE /purchase-orders/:id', () => {
  it('still enforces the confirmation guard (428) without a token', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), { method: 'DELETE', headers: KEY });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(inventoryPurchaseOrderService.delete).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('deletes with x-confirmation-token (200)', async () => {
    (inventoryPurchaseOrderService.delete as jest.Mock).mockResolvedValue(undefined);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/purchase-orders/${ORDER_ID}`), {
        method: 'DELETE',
        headers: { ...KEY, 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ id: string; deleted: boolean }>;
      expect(body.data).toEqual({ id: ORDER_ID, deleted: true });
      expect(inventoryPurchaseOrderService.delete).toHaveBeenCalledWith(
        { tenantId: TENANT, userId: 'key-1' },
        ORDER_ID,
      );
    } finally {
      await srv.close();
    }
  });
});
