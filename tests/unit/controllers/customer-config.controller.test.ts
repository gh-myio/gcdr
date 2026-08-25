import http from 'http';
import type { AddressInfo } from 'net';
import express, { Request, Response, NextFunction } from 'express';

// Mock the service BEFORE importing the controller so the router binds to the
// mocked singleton. Route -> service wiring + validation are tested here; the
// service itself has its own unit suite.
jest.mock('../../../src/services/CustomerConfigService', () => ({
  customerConfigService: {
    getConfig: jest.fn(),
    putConfig: jest.fn(),
    patchConfig: jest.fn(),
    deleteConfig: jest.fn(),
    getSecrets: jest.fn(),
    putSecrets: jest.fn(),
  },
}));

import { customerConfigService } from '../../../src/services/CustomerConfigService';
import configController, { configSecretsRouter } from '../../../src/controllers/customer-config.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '00000000-0000-0000-0000-000000000099';
const REQUEST_ID = '72290bdb-9127-4049-83a9-3ebd1e40f99a';
const CUSTOMER_ID = '84e0370e-636a-4741-9874-504b5e0b3577';

const svc = customerConfigService as jest.Mocked<typeof customerConfigService>;

function buildApp(contextOverrides: Record<string, unknown> = {}, user?: Request['user']) {
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
    if (user) req.user = user;
    next();
  });
  // Mirror production mounts: secrets first, then general config CRUD.
  app.use('/customers/:customerId/config/secrets', configSecretsRouter);
  app.use('/customers/:customerId/config', configController);
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const base = (url: string) => `${url}/customers/${CUSTOMER_ID}/config`;

beforeEach(() => jest.clearAllMocks());

describe('customer-config.controller — config CRUD', () => {
  it('GET /config -> getConfig(tenantId, customerId)', async () => {
    svc.getConfig.mockResolvedValue({ version: 1 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url));
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(svc.getConfig).toHaveBeenCalledWith(TENANT_ID, CUSTOMER_ID);
    } finally {
      await srv.close();
    }
  });

  it('GET /config -> 400 on an invalid customerId', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${srv.url}/customers/not-a-uuid/config`);
      expect(res.status).toBe(400);
      expect(svc.getConfig).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('PUT /config -> putConfig with the parsed body', async () => {
    svc.putConfig.mockResolvedValue({ version: 1 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alarms: { showOffline: true } }),
      });
      expect(res.status).toBe(200);
      expect(svc.putConfig).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        expect.objectContaining({ alarms: { showOffline: true } }),
        expect.any(Object),
      );
    } finally {
      await srv.close();
    }
  });

  it('PUT /config -> 400 when a secret field is present', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingestion: { clientSecret: 'leak' } }),
      });
      expect(res.status).toBe(400);
      expect(svc.putConfig).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('PATCH /config -> patchConfig with a partial feature toggle', async () => {
    svc.patchConfig.mockResolvedValue({ version: 1 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featureButtons: { demandPeak: { lojas: true } } }),
      });
      expect(res.status).toBe(200);
      expect(svc.patchConfig).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        expect.objectContaining({ featureButtons: { demandPeak: { lojas: true } } }),
        expect.any(Object),
      );
    } finally {
      await srv.close();
    }
  });

  it('PATCH /config -> 400 on an unknown feature group', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featureButtons: { demandPeak: { bogus: true } } }),
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('DELETE /config -> deleteConfig', async () => {
    svc.deleteConfig.mockResolvedValue({ version: 1 } as never);
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url), { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(svc.deleteConfig).toHaveBeenCalledWith(TENANT_ID, CUSTOMER_ID, expect.any(Object));
    } finally {
      await srv.close();
    }
  });

  it('propagates a service error through the error handler (404)', async () => {
    const { NotFoundError } = jest.requireActual('../../../src/shared/errors/AppError');
    svc.getConfig.mockRejectedValue(new NotFoundError('nope'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(base(srv.url));
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});

describe('customer-config.controller — secrets', () => {
  it('GET /config/secrets -> getSecrets', async () => {
    svc.getSecrets.mockResolvedValue({
      ingestion: { clientSecret: 'x' },
      security: { masterAdminPassword: null },
    } as never);
    const srv = await listen(buildApp({}, { sub: USER_ID, email: 'op@x', tenant_id: TENANT_ID, roles: [], type: 'USER' }));
    try {
      const res = await fetch(`${base(srv.url)}/secrets`);
      expect(res.status).toBe(200);
      expect(svc.getSecrets).toHaveBeenCalledWith(TENANT_ID, CUSTOMER_ID, expect.any(Object));
    } finally {
      await srv.close();
    }
  });

  it('PUT /config/secrets -> putSecrets with the parsed body', async () => {
    svc.putSecrets.mockResolvedValue({ version: 1 } as never);
    const srv = await listen(buildApp({}, { sub: USER_ID, email: 'op@x', tenant_id: TENANT_ID, roles: [], type: 'USER' }));
    try {
      const res = await fetch(`${base(srv.url)}/secrets`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingestion: { clientSecret: 'real' } }),
      });
      expect(res.status).toBe(200);
      expect(svc.putSecrets).toHaveBeenCalledWith(
        TENANT_ID,
        CUSTOMER_ID,
        expect.objectContaining({ ingestion: { clientSecret: 'real' } }),
        expect.any(Object),
      );
    } finally {
      await srv.close();
    }
  });

  it('PUT /config/secrets -> 400 when the masked sentinel is sent', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${base(srv.url)}/secrets`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingestion: { clientSecret: '***' } }),
      });
      expect(res.status).toBe(400);
      expect(svc.putSecrets).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
