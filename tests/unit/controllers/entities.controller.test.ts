import http from 'http';
import type { AddressInfo } from 'net';
import express, { Request, Response, NextFunction } from 'express';

// Mock the service module BEFORE importing the controller so the router binds
// to the mocked singleton. The real EntityService is owned by agent A2 and is
// exercised by its own unit tests; here we test route -> service wiring only.
//
// A factory mock (rather than bare `jest.mock(path)`) is used so this file is
// loadable even before the real module lands at integration — it does not rely
// on jest auto-mocking the real export shape. Once merged, the controller still
// imports the real singleton's name; the factory below shadows it.
jest.mock('../../../src/services/EntityService', () => ({
  entityService: {
    listEntityTypes: jest.fn(),
    createEntityType: jest.fn(),
    create: jest.fn(),
    getById: jest.fn(),
    list: jest.fn(),
    getChildren: jest.fn(),
    resolve: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    restore: jest.fn(),
    clone: jest.fn(),
    revert: jest.fn(),
    bulkReplace: jest.fn(),
  },
}));

import { entityService } from '../../../src/services/EntityService';
import entitiesController from '../../../src/controllers/entities.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '00000000-0000-0000-0000-000000000099';
const REQUEST_ID = '72290bdb-9127-4049-83a9-3ebd1e40f99a';
const CUSTOMER_ID = '84e0370e-636a-4741-9874-504b5e0b3577';
const ENTITY_ID = '7f1c0000-0000-0000-0000-000000000001';

const svc = entityService as jest.Mocked<typeof entityService>;

/**
 * Build a tiny express app that injects a fake `req.context` (mimicking the
 * auth + context middleware) and mounts the router under /entities, with the
 * shared error handler so AppErrors map to their HTTP envelopes.
 *
 * `contextOverrides` lets a test simulate a read-only customer key, an admin
 * scope, etc.
 */
function buildApp(contextOverrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      requestId: REQUEST_ID,
      ip: '127.0.0.1',
      ...contextOverrides,
    } as Request['context'];
    next();
  });
  app.use('/entities', entitiesController);
  app.use(errorHandler);
  return app;
}

/** Start the app on an ephemeral port and return a base URL + closer. */
async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('entities.controller — route -> service wiring', () => {
  it('GET /entities/entity-types -> listEntityTypes(tenantId)', async () => {
    svc.listEntityTypes.mockResolvedValue([{ entityType: 'GROUP' }] as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/entity-types`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(svc.listEntityTypes).toHaveBeenCalledWith(TENANT_ID);
    } finally {
      await srv.close();
    }
  });

  it('POST /entities/entity-types -> createEntityType with isAdmin:false for a non-admin caller', async () => {
    svc.createEntityType.mockResolvedValue({ entityType: 'PROFILE' } as never);
    const srv = await listen(buildApp({ apiKeyScopes: ['entities:write'] }));
    try {
      const res = await fetch(`${srv.url}/entities/entity-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROFILE', label: 'Profile' }),
      });
      expect(res.status).toBe(201);
      expect(svc.createEntityType).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ entityType: 'PROFILE' }),
        { isAdmin: false },
      );
    } finally {
      await srv.close();
    }
  });

  it('POST /entities/entity-types -> isAdmin:true when caller has entities:admin', async () => {
    svc.createEntityType.mockResolvedValue({ entityType: 'PROFILE' } as never);
    const srv = await listen(buildApp({ apiKeyScopes: ['entities:admin'] }));
    try {
      await fetch(`${srv.url}/entities/entity-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROFILE' }),
      });
      expect(svc.createEntityType).toHaveBeenCalledWith(
        TENANT_ID,
        expect.anything(),
        { isAdmin: true },
      );
    } finally {
      await srv.close();
    }
  });

  it('isAdmin:true via JWT *:* role (scope:*:* form)', async () => {
    svc.createEntityType.mockResolvedValue({} as never);
    const app = buildApp();
    // Inject req.user with a wildcard role after context middleware.
    app.use((req: Request, _res, next) => {
      req.user = { sub: USER_ID, tenant_id: TENANT_ID, email: 'op@myio', roles: ['scope:*:*'], type: 'USER' };
      next();
    });
    app.use('/entities', entitiesController);
    app.use(errorHandler);
    const srv = await listen(app);
    try {
      await fetch(`${srv.url}/entities/entity-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'X' }),
      });
      expect(svc.createEntityType).toHaveBeenCalledWith(TENANT_ID, expect.anything(), { isAdmin: true });
    } finally {
      await srv.close();
    }
  });

  it('POST /entities -> create(tenantId, dto, userId)', async () => {
    svc.create.mockResolvedValue({ id: ENTITY_ID } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROFILE', entityKey: 'CHILLER' }),
      });
      expect(res.status).toBe(201);
      expect(svc.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ entityType: 'PROFILE', entityKey: 'CHILLER' }),
        USER_ID,
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /entities -> list(tenantId, query)', async () => {
    svc.list.mockResolvedValue({ items: [], pagination: {} } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities?type=GROUP&scope=system`);
      expect(res.status).toBe(200);
      expect(svc.list).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ type: ['GROUP'], scope: 'system' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /entities/:id -> getById with deep opts', async () => {
    svc.getById.mockResolvedValue({ id: ENTITY_ID } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/${ENTITY_ID}?deep=1&state=active`);
      expect(res.status).toBe(200);
      expect(svc.getById).toHaveBeenCalledWith(
        TENANT_ID,
        ENTITY_ID,
        expect.objectContaining({ deep: '1', state: 'active' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('GET /entities/:id/children -> getChildren', async () => {
    svc.getChildren.mockResolvedValue([] as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/${ENTITY_ID}/children?deep=all`);
      expect(res.status).toBe(200);
      expect(svc.getChildren).toHaveBeenCalledWith(
        TENANT_ID,
        ENTITY_ID,
        expect.objectContaining({ deep: 'all' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('PATCH /entities/:id -> update with metadataMode=replace + isAdmin', async () => {
    svc.update.mockResolvedValue({ id: ENTITY_ID } as never);
    const srv = await listen(buildApp({ apiKeyScopes: ['entities:admin'] }));
    try {
      const res = await fetch(`${srv.url}/entities/${ENTITY_ID}?metadataMode=replace`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityValue: 'Chiller A', version: 3 }),
      });
      expect(res.status).toBe(200);
      expect(svc.update).toHaveBeenCalledWith(
        TENANT_ID,
        ENTITY_ID,
        expect.objectContaining({ entityValue: 'Chiller A', version: 3 }),
        USER_ID,
        { isAdmin: true, metadataMode: 'replace' },
      );
    } finally {
      await srv.close();
    }
  });

  it('DELETE /entities/:id -> remove with hard+cascade flags, 204', async () => {
    svc.remove.mockResolvedValue(undefined as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/${ENTITY_ID}?hard=true&cascade=true`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(svc.remove).toHaveBeenCalledWith(TENANT_ID, ENTITY_ID, USER_ID, {
        hard: true,
        cascade: true,
      });
    } finally {
      await srv.close();
    }
  });

  it('POST /entities/:id/restore -> restore', async () => {
    svc.restore.mockResolvedValue({ id: ENTITY_ID } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/${ENTITY_ID}/restore`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(svc.restore).toHaveBeenCalledWith(TENANT_ID, ENTITY_ID, USER_ID);
    } finally {
      await srv.close();
    }
  });

  it('POST /entities/clone -> clone(tenantId, customerId, userId)', async () => {
    svc.clone.mockResolvedValue({ cloned: 17, customerId: CUSTOMER_ID } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/clone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: CUSTOMER_ID }),
      });
      expect(res.status).toBe(201);
      expect(svc.clone).toHaveBeenCalledWith(TENANT_ID, CUSTOMER_ID, USER_ID);
    } finally {
      await srv.close();
    }
  });

  it('POST /entities/revert -> revert(tenantId, customerId, userId)', async () => {
    svc.revert.mockResolvedValue({ reverted: 17, customerId: CUSTOMER_ID } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: CUSTOMER_ID }),
      });
      expect(res.status).toBe(200);
      expect(svc.revert).toHaveBeenCalledWith(TENANT_ID, CUSTOMER_ID, USER_ID);
    } finally {
      await srv.close();
    }
  });
});

describe('entities.controller — /resolve versioning', () => {
  it('200 with envelope + X-Version-Id header when no If-None-Match', async () => {
    svc.resolve.mockResolvedValue({
      source: 'customer',
      version: 'v_2026_06_23_a',
      roots: [],
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/resolve?customerId=${CUSTOMER_ID}&deep=all`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-version-id')).toBe('v_2026_06_23_a');
      const body = await res.json();
      expect(body.data.source).toBe('customer');
      expect(svc.resolve).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        expect.objectContaining({ deep: 'all' }),
      );
    } finally {
      await srv.close();
    }
  });

  it('304 (no body) when If-None-Match matches the resolved version', async () => {
    svc.resolve.mockResolvedValue({
      source: 'system',
      version: 'v_2026_06_23_a',
      roots: [],
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/resolve?customerId=${CUSTOMER_ID}`, {
        headers: { 'if-none-match': '"v_2026_06_23_a"' },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get('x-version-id')).toBe('v_2026_06_23_a');
      const text = await res.text();
      expect(text).toBe('');
    } finally {
      await srv.close();
    }
  });

  it('200 when If-None-Match is a stale version', async () => {
    svc.resolve.mockResolvedValue({
      source: 'system',
      version: 'v_new',
      roots: [],
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/entities/resolve?customerId=${CUSTOMER_ID}`, {
        headers: { 'if-none-match': '"v_old"' },
      });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe('entities.controller — /bulk-replace If-Match', () => {
  it('PUT passes the (unquoted) If-Match header to bulkReplace and sets X-Version-Id', async () => {
    svc.bulkReplace.mockResolvedValue({
      version: 'v_next',
      source: 'customer',
      replaced: 4,
    } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(
        `${srv.url}/entities/bulk-replace?customerId=${CUSTOMER_ID}&type=CLASSIFICATION_ENERGY`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'if-match': '"v_2026_06_23_a"' },
          body: JSON.stringify({ roots: [] }),
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('x-version-id')).toBe('v_next');
      expect(svc.bulkReplace).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        'CLASSIFICATION_ENERGY',
        expect.objectContaining({ roots: [] }),
        'v_2026_06_23_a',
        USER_ID,
      );
    } finally {
      await srv.close();
    }
  });

  it('PUT passes undefined If-Match when the header is absent', async () => {
    svc.bulkReplace.mockResolvedValue({ version: 'v', source: 'customer', replaced: 0 } as never);
    const srv = await listen(buildApp());
    try {
      await fetch(
        `${srv.url}/entities/bulk-replace?customerId=${CUSTOMER_ID}&type=CLASSIFICATION_ENERGY`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roots: [] }),
        },
      );
      expect(svc.bulkReplace).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        'CLASSIFICATION_ENERGY',
        expect.anything(),
        undefined,
        USER_ID,
      );
    } finally {
      await srv.close();
    }
  });
});

describe('entities.controller — write authorization (documented)', () => {
  // The controller itself is mounted in app.ts behind
  // `hybridAuthByMethod('entities:read','entities:write')`. That mount is what
  // rejects a read-only customer key (gcdr_cust_*, scopes ['entities:read'])
  // on any write method with 403 FORBIDDEN — the router under test here is
  // mounted WITHOUT that guard, so write methods reach the service. We assert
  // the wiring (service is reachable) and document that the 403 is enforced at
  // the mount, not in the router. A read-only key never carries entities:write,
  // so hybridAuthByMethod denies POST/PATCH/PUT/DELETE before this code runs.
  it('write reaches the service when auth is NOT applied (guard lives at the mount)', async () => {
    svc.create.mockResolvedValue({ id: ENTITY_ID } as never);
    const srv = await listen(buildApp({ apiKeyScopes: ['entities:read'] }));
    try {
      const res = await fetch(`${srv.url}/entities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROFILE', entityKey: 'K' }),
      });
      // No 403 here because the mount-level hybridAuthByMethod guard is not
      // wired in this isolated test app; the service is invoked.
      expect(res.status).toBe(201);
      expect(svc.create).toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
