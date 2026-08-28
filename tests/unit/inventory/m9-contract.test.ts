// RFC-0061 M9 — projects contract test. Supersedes the M9 cases of the frozen
// tests/unit/controllers/inventory.contract.test.ts: the module now answers
// concretely instead of the 501 INV_NOT_IMPLEMENTED marker. Mounts the REAL
// router behind the REAL auth chain (contextMiddleware → hybridAuthByMethod)
// with only the auth leaves and the M9 service mocked.
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

jest.mock('../../../src/services/inventory/InventoryProjectService', () => ({
  inventoryProjectService: {
    listProjects: jest.fn(),
    createProject: jest.fn(),
    updateProject: jest.fn(),
    deleteProject: jest.fn(),
  },
}));

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { inventoryProjectService } from '../../../src/services/inventory/InventoryProjectService';
import { contextMiddleware } from '../../../src/middleware/context';
import { hybridAuthByMethod } from '../../../src/middleware/auth';
import inventoryController from '../../../src/controllers/inventory.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { ConflictError, NotFoundError } from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';

const project = {
  id: PROJECT_ID,
  name: 'Projeto Moxuara',
  description: null,
  customerId: null,
  legacyClientName: null,
  legacyClientCnpj: null,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
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

type ErrBody = { success: boolean; error: { code: string; message?: string } };
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

describe('GET /projects', () => {
  it('returns the paginated list (200) with tenant from the auth context', async () => {
    (inventoryProjectService.listProjects as jest.Mock).mockResolvedValue({
      items: [project], page: 1, pageSize: 20, total: 1, totalPages: 1,
    });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects?page=1&pageSize=20'), { headers: KEY });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ items: unknown[]; total: number; totalPages: number }>;
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.total).toBe(1);
      expect(inventoryProjectService.listProjects).toHaveBeenCalledWith(TENANT, { page: 1, pageSize: 20 });
    } finally {
      await srv.close();
    }
  });

  it('rejects an out-of-range pageSize (400 VALIDATION_ERROR)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects?pageSize=999'), { headers: KEY });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrBody).error.code).toBe('VALIDATION_ERROR');
      expect(inventoryProjectService.listProjects).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('POST /projects', () => {
  it('creates and answers 201 with the row', async () => {
    (inventoryProjectService.createProject as jest.Mock).mockResolvedValue(project);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects'), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ name: 'Projeto Moxuara' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as OkBody<typeof project>;
      expect(body.data.id).toBe(PROJECT_ID);
    } finally {
      await srv.close();
    }
  });

  it('rejects a body without name (400) before reaching the service', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects'), {
        method: 'POST',
        headers: JSON_KEY,
        body: JSON.stringify({ description: 'sem nome' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryProjectService.createProject).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe('PATCH /projects/:id', () => {
  it('updates and answers 200', async () => {
    (inventoryProjectService.updateProject as jest.Mock).mockResolvedValue({ ...project, name: 'Novo' });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/projects/${PROJECT_ID}`), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ name: 'Novo' }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as OkBody<typeof project>).data.name).toBe('Novo');
    } finally {
      await srv.close();
    }
  });

  it('rejects a malformed id (400) before reaching the service', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, '/projects/not-a-uuid'), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ name: 'X' }),
      });
      expect(res.status).toBe(400);
      expect(inventoryProjectService.updateProject).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('propagates NotFoundError from the service (404)', async () => {
    (inventoryProjectService.updateProject as jest.Mock).mockRejectedValue(new NotFoundError('Project not found'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/projects/${PROJECT_ID}`), {
        method: 'PATCH',
        headers: JSON_KEY,
        body: JSON.stringify({ name: 'X' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});

describe('DELETE /projects/:id', () => {
  it('still enforces the confirmation guard (428) without a token', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/projects/${PROJECT_ID}`), { method: 'DELETE', headers: KEY });
      expect(res.status).toBe(428);
      expect(((await res.json()) as ErrBody).error.code).toBe('INV_CONFIRMATION_REQUIRED');
      expect(inventoryProjectService.deleteProject).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('deletes with x-confirmation-token (200)', async () => {
    (inventoryProjectService.deleteProject as jest.Mock).mockResolvedValue(undefined);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/projects/${PROJECT_ID}`), {
        method: 'DELETE',
        headers: { ...KEY, 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as OkBody<{ id: string; deleted: boolean }>;
      expect(body.data).toEqual({ id: PROJECT_ID, deleted: true });
      expect(inventoryProjectService.deleteProject).toHaveBeenCalledWith(TENANT, PROJECT_ID);
    } finally {
      await srv.close();
    }
  });

  it('surfaces the friendly FK conflict as 409', async () => {
    (inventoryProjectService.deleteProject as jest.Mock).mockRejectedValue(
      new ConflictError('Projeto possui pedidos de compra ou expedições vinculados e não pode ser excluído'),
    );
    const srv = await listen(buildApp());
    try {
      const res = await fetch(U(srv.url, `/projects/${PROJECT_ID}`), {
        method: 'DELETE',
        headers: { ...KEY, 'x-confirmation-token': 'excluir' },
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as ErrBody).error.code).toBe('CONFLICT');
    } finally {
      await srv.close();
    }
  });
});
