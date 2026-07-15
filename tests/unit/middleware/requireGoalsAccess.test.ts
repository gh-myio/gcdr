// RFC-0046 feedback P0.1 — authorization guard for /customers/:customerId/goals.
// Covers: API-key hierarchy (SELF / SUBTREE / TENANT, cross-customer → 404),
// JWT RBAC (goals.goal.read on GET, goals.goal.update on writes, 403 when
// denied), the master-key '*' bypass and malformed-id handling.

import { Request, Response } from 'express';
import {
  requireGoalsAccess,
  PERM_GOALS_READ,
  PERM_GOALS_WRITE,
} from '../../../src/middleware/requireGoalsAccess';
import { authorizationService } from '../../../src/services/AuthorizationService';
import { customerRepository } from '../../../src/repositories/CustomerRepository';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/shared/errors/AppError';

jest.mock('../../../src/services/AuthorizationService', () => ({
  authorizationService: { evaluatePermission: jest.fn() },
}));
jest.mock('../../../src/repositories/CustomerRepository', () => ({
  customerRepository: { getDescendants: jest.fn() },
}));

const evaluatePermission = authorizationService.evaluatePermission as jest.Mock;
const getDescendants = customerRepository.getDescendants as jest.Mock;

const tenantId = '11111111-1111-1111-1111-111111111111';
const keyCustomer = '33333333-3333-3333-3333-333333333333';
const otherCustomer = '84e0370e-636a-4741-9874-504b5e0b3577';
const userId = '22222222-2222-2222-2222-222222222222';

interface ReqOptions {
  method?: string;
  customerId?: string;
  roles?: string[];
  apiKeyId?: string;
  hierarchy?: 'SELF' | 'SUBTREE' | 'TENANT';
  contextCustomerId?: string;
  userId?: string | undefined;
}

function makeReq(opts: ReqOptions = {}): Request {
  return {
    method: opts.method ?? 'GET',
    params: { customerId: opts.customerId ?? otherCustomer },
    user: { roles: opts.roles ?? [] },
    context: {
      tenantId,
      userId: 'userId' in opts ? opts.userId : userId,
      apiKeyId: opts.apiKeyId,
      apiKeyHierarchyAccess: opts.hierarchy,
      customerId: opts.contextCustomerId,
      requestId: 'req-1',
    },
  } as unknown as Request;
}

async function run(req: Request): Promise<unknown> {
  const next = jest.fn();
  await requireGoalsAccess()(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0]; // undefined = allowed; Error = denied
}

beforeEach(() => {
  jest.clearAllMocks();
  evaluatePermission.mockResolvedValue({ allowed: false });
  getDescendants.mockResolvedValue([]);
});

describe('requireGoalsAccess — master / dev bypass', () => {
  it("allows the '*' role (master key / DISABLE_AUTH) without touching RBAC", async () => {
    const err = await run(makeReq({ roles: ['*'] }));
    expect(err).toBeUndefined();
    expect(evaluatePermission).not.toHaveBeenCalled();
  });
});

describe('requireGoalsAccess — API-key hierarchy', () => {
  it('TENANT key reaches any customer of the tenant', async () => {
    const err = await run(makeReq({ apiKeyId: 'k1', hierarchy: 'TENANT' }));
    expect(err).toBeUndefined();
  });

  it('SELF key reaches its own customer', async () => {
    const err = await run(
      makeReq({ apiKeyId: 'k1', hierarchy: 'SELF', contextCustomerId: keyCustomer, customerId: keyCustomer }),
    );
    expect(err).toBeUndefined();
  });

  it('SELF key gets 404 (not 403) on another customer of the same tenant', async () => {
    const err = await run(
      makeReq({ apiKeyId: 'k1', hierarchy: 'SELF', contextCustomerId: keyCustomer, customerId: otherCustomer }),
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('SUBTREE key reaches a descendant', async () => {
    getDescendants.mockResolvedValue([{ id: otherCustomer }]);
    const err = await run(
      makeReq({ apiKeyId: 'k1', hierarchy: 'SUBTREE', contextCustomerId: keyCustomer, customerId: otherCustomer }),
    );
    expect(err).toBeUndefined();
    expect(getDescendants).toHaveBeenCalledWith(tenantId, keyCustomer);
  });

  it('SUBTREE key gets 404 outside its subtree', async () => {
    getDescendants.mockResolvedValue([{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]);
    const err = await run(
      makeReq({ apiKeyId: 'k1', hierarchy: 'SUBTREE', contextCustomerId: keyCustomer, customerId: otherCustomer }),
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });
});

describe('requireGoalsAccess — JWT RBAC', () => {
  it('GET evaluates goals.goal.read against customer:<id> and allows on grant', async () => {
    evaluatePermission.mockResolvedValue({ allowed: true });
    const err = await run(makeReq({ method: 'GET' }));
    expect(err).toBeUndefined();
    expect(evaluatePermission).toHaveBeenCalledWith(tenantId, {
      userId,
      permission: PERM_GOALS_READ,
      resourceScope: `customer:${otherCustomer}`,
    });
  });

  it('PUT evaluates goals.goal.update', async () => {
    evaluatePermission.mockResolvedValue({ allowed: true });
    const err = await run(makeReq({ method: 'PUT' }));
    expect(err).toBeUndefined();
    expect(evaluatePermission).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ permission: PERM_GOALS_WRITE }),
    );
  });

  it('403 when RBAC denies (valid session, no goals grant)', async () => {
    const err = await run(makeReq({ method: 'PATCH' }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('401 when there is no user id at all', async () => {
    const err = await run(makeReq({ userId: undefined }));
    expect(err).toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireGoalsAccess — input hygiene', () => {
  it('400 on a malformed customerId before any lookup', async () => {
    const err = await run(makeReq({ customerId: 'not-a-uuid' }));
    expect(err).toBeInstanceOf(ValidationError);
    expect(evaluatePermission).not.toHaveBeenCalled();
    expect(getDescendants).not.toHaveBeenCalled();
  });
});
