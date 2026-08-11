import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

// RFC-0057 (P1.4) — exercise the REAL auth chain for /config and /config/secrets:
//   contextMiddleware → hybridAuthByMethod/authMiddleware → requireCustomerConfig*
// Only the leaf dependencies are mocked (API-key validation, JWT decode, RBAC
// evaluation, descendant lookup, and the config service itself).

// Config service — stub so handlers succeed once auth passes.
jest.mock('../../../src/services/CustomerConfigService', () => ({
  customerConfigService: {
    getConfig: jest.fn().mockResolvedValue({ version: 1 }),
    putConfig: jest.fn().mockResolvedValue({ version: 1 }),
    getSecrets: jest.fn().mockResolvedValue({ ingestion: { clientSecret: null }, security: { masterAdminPassword: null } }),
    putSecrets: jest.fn().mockResolvedValue({ version: 1 }),
    patchConfig: jest.fn(),
    deleteConfig: jest.fn(),
  },
}));

// API-key validation leaf used by hybridAuthMiddleware.
jest.mock('../../../src/services/CustomerApiKeyService', () => ({
  customerApiKeyService: {
    validateApiKey: jest.fn(),
    validateApiKeyWithTenant: jest.fn(),
  },
}));

// JWT decode leaf — keep contextMiddleware real, override decodeJWT only.
jest.mock('../../../src/middleware/context', () => {
  const actual = jest.requireActual('../../../src/middleware/context');
  return { ...actual, decodeJWT: jest.fn() };
});

// RBAC evaluation leaf.
jest.mock('../../../src/services/AuthorizationService', () => ({
  authorizationService: { evaluatePermission: jest.fn() },
}));

// Descendant lookup leaf (SUBTREE reach).
jest.mock('../../../src/repositories/CustomerRepository', () => ({
  customerRepository: { getDescendants: jest.fn().mockResolvedValue([]) },
  CustomerRepository: class {},
}));

import { customerApiKeyService } from '../../../src/services/CustomerApiKeyService';
import { decodeJWT } from '../../../src/middleware/context';
import { authorizationService } from '../../../src/services/AuthorizationService';
import { customerRepository } from '../../../src/repositories/CustomerRepository';
import { contextMiddleware } from '../../../src/middleware/context';
import { authMiddleware, hybridAuthByMethod } from '../../../src/middleware/auth';
import {
  requireCustomerConfigAccess,
  requireCustomerConfigSecretsAccess,
} from '../../../src/middleware/requireCustomerConfigAccess';
import configController, { configSecretsRouter } from '../../../src/controllers/customer-config.controller';
import { errorHandler } from '../../../src/middleware/errorHandler';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const OWN_CUSTOMER = '33333333-3333-3333-3333-333333333333';
const OTHER_CUSTOMER = '44444444-4444-4444-4444-444444444444';
const DESCENDANT = '55555555-5555-5555-5555-555555555555';

// Mirror production: an express-rate-limiter fronts the authed mounts (also keeps
// CodeQL js/missing-rate-limiting satisfied on this harness).
const limiter = rateLimit({ windowMs: 60_000, limit: 10_000, validate: false });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware);
  app.use(
    '/api/v1/customers/:customerId/config/secrets',
    limiter,
    authMiddleware,
    requireCustomerConfigSecretsAccess(),
    configSecretsRouter,
  );
  app.use(
    '/api/v1/customers/:customerId/config',
    limiter,
    hybridAuthByMethod('customers:read', 'customers:write'),
    requireCustomerConfigAccess(),
    configController,
  );
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function apiKeyCtx(hierarchyAccess: 'SELF' | 'SUBTREE' | 'TENANT') {
  return {
    keyId: 'key-1',
    tenantId: TENANT_A,
    customerId: OWN_CUSTOMER,
    scopes: ['customers:read', 'customers:write'],
    name: 'test-key',
    hierarchyAccess,
  };
}

const cfgUrl = (base: string, cid: string) => `${base}/api/v1/customers/${cid}/config`;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISABLE_AUTH;
  delete process.env.GCDR_MASTER_API_KEY;
  (customerRepository.getDescendants as jest.Mock).mockResolvedValue([]);
});

describe('/config — API key hierarchy (DEC-8)', () => {
  it('SELF key reaches its own customer (200)', async () => {
    (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(apiKeyCtx('SELF'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OWN_CUSTOMER), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it('SELF key is DENIED another customer of the same tenant (404)', async () => {
    (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(apiKeyCtx('SELF'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OTHER_CUSTOMER), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it('SUBTREE key reaches a descendant (200) but denies outside the subtree (404)', async () => {
    (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(apiKeyCtx('SUBTREE'));
    (customerRepository.getDescendants as jest.Mock).mockResolvedValue([{ id: DESCENDANT }]);
    const srv = await listen(buildApp());
    try {
      const ok = await fetch(cfgUrl(srv.url, DESCENDANT), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(ok.status).toBe(200);
      const denied = await fetch(cfgUrl(srv.url, OTHER_CUSTOMER), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(denied.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  it('TENANT key reaches any customer in the tenant (200)', async () => {
    (customerApiKeyService.validateApiKey as jest.Mock).mockResolvedValue(apiKeyCtx('TENANT'));
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OTHER_CUSTOMER), { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe('/config — JWT RBAC (DEC-8)', () => {
  const jwtUser = { sub: 'user-1', email: 'op@x', tenant_id: TENANT_A, roles: ['role:operator'], type: 'USER' };

  it('grants GET when RBAC allows (200)', async () => {
    (decodeJWT as jest.Mock).mockReturnValue(jwtUser);
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValue({ allowed: true });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OWN_CUSTOMER), { headers: { authorization: 'Bearer jwt' } });
      expect(res.status).toBe(200);
      expect(authorizationService.evaluatePermission).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ permission: 'customers.hierarchy.read', resourceScope: `customer:${OWN_CUSTOMER}` }),
      );
    } finally {
      await srv.close();
    }
  });

  it('denies a JWT without the required permission (403)', async () => {
    (decodeJWT as jest.Mock).mockReturnValue(jwtUser);
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValue({ allowed: false });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OWN_CUSTOMER), { headers: { authorization: 'Bearer jwt' } });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });

  it('checks the write permission on PUT (200 when allowed)', async () => {
    (decodeJWT as jest.Mock).mockReturnValue(jwtUser);
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValue({ allowed: true });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(cfgUrl(srv.url, OWN_CUSTOMER), {
        method: 'PUT',
        headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
        body: JSON.stringify({ alarms: { showOffline: true } }),
      });
      expect(res.status).toBe(200);
      expect(authorizationService.evaluatePermission).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ permission: 'customers.hierarchy.update' }),
      );
    } finally {
      await srv.close();
    }
  });
});

describe('/config/secrets — gating (DEC-7/DEC-8)', () => {
  it('denies a customer API key at the door (401)', async () => {
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${cfgUrl(srv.url, OWN_CUSTOMER)}/secrets`, { headers: { 'x-api-key': 'gcdr_cust_x' } });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it('denies a JWT lacking customers:secrets:read (403)', async () => {
    (decodeJWT as jest.Mock).mockReturnValue({ sub: 'u', email: 'o@x', tenant_id: TENANT_A, roles: ['role:operator'], type: 'USER' });
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValue({ allowed: false });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${cfgUrl(srv.url, OWN_CUSTOMER)}/secrets`, { headers: { authorization: 'Bearer jwt' } });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });

  it('grants a JWT with customers:secrets:read (200) using the secret permission', async () => {
    (decodeJWT as jest.Mock).mockReturnValue({ sub: 'u', email: 'o@x', tenant_id: TENANT_A, roles: ['role:operator'], type: 'USER' });
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValue({ allowed: true });
    const srv = await listen(buildApp());
    try {
      const res = await fetch(`${cfgUrl(srv.url, OWN_CUSTOMER)}/secrets`, { headers: { authorization: 'Bearer jwt' } });
      expect(res.status).toBe(200);
      expect(authorizationService.evaluatePermission).toHaveBeenCalledWith(
        TENANT_A,
        expect.objectContaining({ permission: 'customers.secret.read', resourceScope: `customer:${OWN_CUSTOMER}` }),
      );
    } finally {
      await srv.close();
    }
  });
});
