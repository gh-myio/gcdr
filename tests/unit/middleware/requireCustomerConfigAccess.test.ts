import type { Request } from 'express';

jest.mock('../../../src/services/AuthorizationService', () => ({
  authorizationService: { evaluatePermission: jest.fn() },
}));
jest.mock('../../../src/repositories/CustomerRepository', () => ({
  customerRepository: { getDescendants: jest.fn().mockResolvedValue([]) },
  CustomerRepository: class {},
}));

import {
  assertCustomerConfigAccess,
  assertCustomerConfigSecretsAccess,
} from '../../../src/middleware/requireCustomerConfigAccess';
import { authorizationService } from '../../../src/services/AuthorizationService';
import { customerRepository } from '../../../src/repositories/CustomerRepository';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/shared/errors/AppError';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OWN = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';

function req(overrides: { user?: unknown; context?: Record<string, unknown> }): Request {
  return {
    user: overrides.user,
    context: { tenantId: TENANT, ...(overrides.context ?? {}) },
  } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('assertCustomerConfigAccess', () => {
  it('bypasses for the master/DISABLE_AUTH * role', async () => {
    await expect(assertCustomerConfigAccess(req({ user: { roles: ['*'] } }), OWN, 'GET')).resolves.toBeUndefined();
  });

  it('rejects a malformed customerId with 400', async () => {
    await expect(assertCustomerConfigAccess(req({ user: { roles: [] } }), 'not-a-uuid', 'GET')).rejects.toBeInstanceOf(ValidationError);
  });

  it('API key SELF: allows its own, 404 for another', async () => {
    const base = { apiKeyId: 'k', apiKeyHierarchyAccess: 'SELF', customerId: OWN };
    await expect(assertCustomerConfigAccess(req({ context: base }), OWN, 'GET')).resolves.toBeUndefined();
    await expect(assertCustomerConfigAccess(req({ context: base }), OTHER, 'GET')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('API key SUBTREE: allows a descendant, 404 outside', async () => {
    (customerRepository.getDescendants as jest.Mock).mockResolvedValue([{ id: OTHER }]);
    const base = { apiKeyId: 'k', apiKeyHierarchyAccess: 'SUBTREE', customerId: OWN };
    await expect(assertCustomerConfigAccess(req({ context: base }), OTHER, 'GET')).resolves.toBeUndefined();
    (customerRepository.getDescendants as jest.Mock).mockResolvedValue([]);
    await expect(assertCustomerConfigAccess(req({ context: base }), OTHER, 'GET')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('JWT without userId → 401', async () => {
    await expect(assertCustomerConfigAccess(req({ user: { roles: [] }, context: {} }), OWN, 'GET')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('JWT with permission → allowed; without → 403', async () => {
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValueOnce({ allowed: true });
    await expect(assertCustomerConfigAccess(req({ user: { roles: [] }, context: { userId: 'u' } }), OWN, 'GET')).resolves.toBeUndefined();
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValueOnce({ allowed: false });
    await expect(assertCustomerConfigAccess(req({ user: { roles: [] }, context: { userId: 'u' } }), OWN, 'PUT')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('assertCustomerConfigSecretsAccess', () => {
  it('bypasses for the master/DISABLE_AUTH * role', async () => {
    await expect(assertCustomerConfigSecretsAccess(req({ user: { roles: ['*'] } }), OWN)).resolves.toBeUndefined();
  });

  it('rejects a malformed customerId with 400', async () => {
    await expect(assertCustomerConfigSecretsAccess(req({ user: { roles: [] } }), 'bad')).rejects.toBeInstanceOf(ValidationError);
  });

  it('always denies an API key (403)', async () => {
    await expect(assertCustomerConfigSecretsAccess(req({ context: { apiKeyId: 'k', customerId: OWN } }), OWN)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('JWT without userId → 401', async () => {
    await expect(assertCustomerConfigSecretsAccess(req({ user: { roles: [] }, context: {} }), OWN)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('JWT with the secret permission → allowed; without → 403', async () => {
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValueOnce({ allowed: true });
    await expect(assertCustomerConfigSecretsAccess(req({ user: { roles: [] }, context: { userId: 'u' } }), OWN)).resolves.toBeUndefined();
    (authorizationService.evaluatePermission as jest.Mock).mockResolvedValueOnce({ allowed: false });
    await expect(assertCustomerConfigSecretsAccess(req({ user: { roles: [] }, context: { userId: 'u' } }), OWN)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
