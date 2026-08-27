/**
 * RFC-0061 M4 — wired-contract test for the REAL production routes.
 *
 * M4 now serves real handlers for demands / capacity / simulator preview /
 * assembly releases / issues; POST /production/resolve-demand intentionally
 * stays the 501 marker (P3 with M6 — A4). Auth chain and guard behavior
 * (missing Idempotency-Key → 400, missing confirmationToken → 428) unchanged.
 *
 * Same harness as m2-contract.test.ts: real router + real auth middleware,
 * auth leaves mocked — plus the M4 service mocked (no DB).
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

// Mock ONLY the service singleton — the Zod schemas the controller imports
// from the same module must stay real.
jest.mock('../../../src/services/inventory/InventoryProductionService', () => {
  const actual = jest.requireActual('../../../src/services/inventory/InventoryProductionService');
  return {
    ...actual,
    inventoryProductionService: {
      listDemands: jest.fn(),
      listReleases: jest.fn(),
      createRelease: jest.fn(),
      reportIssue: jest.fn(),
      listIssues: jest.fn(),
      resolveIssue: jest.fn(),
      correctRelease: jest.fn(),
      deleteRelease: jest.fn(),
      getCapacity: jest.fn(),
      previewSimulation: jest.fn(),
    },
  };
});

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryProductionService } from '../../../src/services/inventory/InventoryProductionService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const RELEASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ISSUE_ID = '66666666-6666-4666-8666-666666666666';
const PHOTO_ID = '44444444-4444-4444-4444-444444444444';
const USER_ID = '22222222-2222-2222-2222-222222222222';

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

const svc = inventoryProductionService as jest.Mocked<typeof inventoryProductionService>;

const goodRelease = {
  photoFileId: PHOTO_ID,
  responsibles: [USER_ID],
  items: [{ itemId: ITEM_ID, quantity: 3 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(
    apiKeyCtx(['inventory:read', 'inventory:write']),
  );
});

describe('M4 production routes — real contract', () => {
  it('GET /production/demands → 200 paginated groups', async () => {
    svc.listDemands.mockResolvedValue({
      items: [{ itemId: ITEM_ID, itemName: 'P', totalQuantity: 5, demandCount: 2, oldestCreatedAt: null, almoxarifadoBalance: 1 }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/demands'), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: Array<{ totalQuantity: number }> }>;
      expect(body.data.items[0].totalQuantity).toBe(5);
      expect(svc.listDemands).toHaveBeenCalledWith(TENANT, 1, 20);
    } finally {
      await srv.close();
    }
  });

  // Was "STILL 501 (P3 with M6 — A4)": demand resolution shipped with M6 —
  // the route is real now. The full route contract lives in m6-contract; here
  // we keep the DTO gate (empty body → 400) so the M4 router stays covered.
  it('POST /production/resolve-demand → 400 without expeditionOrderId (real route — was 501)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/resolve-demand'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('POST /assembly-releases with key + valid body → 201', async () => {
    svc.createRelease.mockResolvedValue({
      release: { id: RELEASE_ID, items: [] },
      consumedComponents: [],
      demandSummary: { concluded: 0, reducedPartial: 0 },
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/assembly-releases'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'rel-1' },
        body: JSON.stringify(goodRelease),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<{ release: { id: string } }>;
      expect(body.data.release.id).toBe(RELEASE_ID);
      expect(svc.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        expect.objectContaining({ photoFileId: PHOTO_ID }),
        'rel-1',
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /assembly-releases without Idempotency-Key → 400 INV_IDEMPOTENCY_KEY_MISSING', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/assembly-releases'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify(goodRelease),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_IDEMPOTENCY_KEY_MISSING');
      expect(svc.createRelease).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('POST /assembly-releases without photo/responsibles → 400, service untouched', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/assembly-releases'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'rel-2' },
        body: JSON.stringify({ items: [{ itemId: ITEM_ID, quantity: 1 }] }),
      });
      expect(res.status).toBe(400);
      expect(svc.createRelease).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('GET /assembly-releases → 200 paginated', async () => {
    svc.listReleases.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/assembly-releases'), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
      expect(svc.listReleases).toHaveBeenCalledWith(TENANT, 1, 20);
    } finally {
      await srv.close();
    }
  });

  it('POST /assembly-releases/:id/correct → 200 with adjustments', async () => {
    svc.correctRelease.mockResolvedValue({ release: { id: RELEASE_ID }, adjustments: [], resolvedIssues: 1 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/assembly-releases/${RELEASE_ID}/correct`), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ releaseItemId: ISSUE_ID, quantity: 5 }] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ resolvedIssues: number }>;
      expect(body.data.resolvedIssues).toBe(1);
      expect(svc.correctRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        RELEASE_ID,
        expect.objectContaining({ items: [{ releaseItemId: ISSUE_ID, quantity: 5 }] }),
      );
    } finally {
      await srv.close();
    }
  });

  it('DELETE /assembly-releases/:id without confirmationToken → 428', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/assembly-releases/${RELEASE_ID}`), {
        method: 'DELETE',
        headers: { 'x-api-key': 'gcdr_cust_x' },
      });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(svc.deleteRelease).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('DELETE /assembly-releases/:id with X-Confirmation-Token → 200', async () => {
    svc.deleteRelease.mockResolvedValue({ deleted: true } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/assembly-releases/${RELEASE_ID}`), {
        method: 'DELETE',
        headers: { 'x-api-key': 'gcdr_cust_x', 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(200);
      expect(svc.deleteRelease).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), RELEASE_ID);
    } finally {
      await srv.close();
    }
  });

  it('POST /assembly-releases/:id/issues → 201 (reported_by from context)', async () => {
    svc.reportIssue.mockResolvedValue({ id: ISSUE_ID, status: 'ABERTA' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/assembly-releases/${RELEASE_ID}/issues`), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'faltou 1 unidade' }),
      });
      expect(res.status).toBe(201);
      expect(svc.reportIssue).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        RELEASE_ID,
        expect.objectContaining({ message: 'faltou 1 unidade' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /assembly-releases/:id/issues → 200 paginated', async () => {
    svc.listIssues.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/assembly-releases/${RELEASE_ID}/issues`), {
        headers: { 'x-api-key': 'gcdr_cust_x' },
      });
      expect(res.status).toBe(200);
      expect(svc.listIssues).toHaveBeenCalledWith(TENANT, RELEASE_ID, 1, 20);
    } finally {
      await srv.close();
    }
  });

  it('POST /issues/:id/resolve → 200', async () => {
    svc.resolveIssue.mockResolvedValue({ id: ISSUE_ID, status: 'RESOLVIDA' } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/issues/${ISSUE_ID}/resolve`), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ resolutionNote: 'corrigido' }),
      });
      expect(res.status).toBe(200);
      expect(svc.resolveIssue).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT }),
        ISSUE_ID,
        expect.objectContaining({ resolutionNote: 'corrigido' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /production/capacity → 200', async () => {
    svc.getCapacity.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/capacity'), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
      expect(svc.getCapacity).toHaveBeenCalledWith(TENANT, 1, 20);
    } finally {
      await srv.close();
    }
  });

  it('POST /production/simulator/preview → 200 (DEC-13 preview-only)', async () => {
    svc.previewSimulation.mockResolvedValue({
      location: 'FABRICA',
      products: [],
      components: [],
      feasible: true,
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/simulator/preview'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ itemId: ITEM_ID, quantity: 2 }] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ feasible: boolean }>;
      expect(body.data.feasible).toBe(true);
      expect(svc.previewSimulation).toHaveBeenCalledWith(TENANT, expect.objectContaining({ items: [{ itemId: ITEM_ID, quantity: 2 }] }));
    } finally {
      await srv.close();
    }
  });

  it('POST /production/simulator/preview with a bad body → 400, service untouched', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/production/simulator/preview'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      });
      expect(res.status).toBe(400);
      expect(svc.previewSimulation).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('service InventoryError surfaces its code through the errorHandler', async () => {
    const { insufficientStock } = jest.requireActual<
      typeof import('../../../src/shared/errors/InventoryError')
    >('../../../src/shared/errors/InventoryError');
    svc.createRelease.mockRejectedValue(insufficientStock(ITEM_ID, 'FABRICA', 1, 22));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/assembly-releases'), {
        method: 'POST',
        headers: { 'x-api-key': 'gcdr_cust_x', 'content-type': 'application/json', 'idempotency-key': 'rel-9' },
        body: JSON.stringify(goodRelease),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as ErrBody;
      expect(body.error.code).toBe('INV_INSUFFICIENT_STOCK');
    } finally {
      await srv.close();
    }
  });
});
