/**
 * RFC-0050 — role gate + feature flag unit tests.
 *
 * The gate must handle all three auth forms this codebase produces on
 * req.user.roles (see reference_gcdr_auth_admin_detection):
 * - JWT users → RBAC role KEYS ('role:super-admin', 'role:presetup-operator')
 * - master key / service accounts → ['*']
 * - customer API keys → 'scope:<s>' pseudo-roles (must be REJECTED here)
 */
import { Request, Response, NextFunction } from 'express';
import {
  requirePresetupOperator,
  isPresetupProxyEnabled,
} from '../../../src/controllers/integrationsProxy.controller';
import {
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../src/shared/errors/AppError';

function makeReq(roles?: string[]): Request {
  return {
    method: 'GET',
    originalUrl: '/api/v1/integrations/ingestion/customers?x=1',
    user: roles ? { sub: 'u1', email: 'u@x', tenant_id: 't1', type: 'USER', roles } : undefined,
    context: { tenantId: 't1', userId: 'u1', requestId: 'r1' },
  } as unknown as Request;
}

const res = {} as Response;

describe('isPresetupProxyEnabled', () => {
  const saved = process.env.PRESETUP_PROXY_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.PRESETUP_PROXY_ENABLED;
    else process.env.PRESETUP_PROXY_ENABLED = saved;
  });

  it('is disabled by default (deploy dark)', () => {
    delete process.env.PRESETUP_PROXY_ENABLED;
    expect(isPresetupProxyEnabled()).toBe(false);
  });

  it('is enabled only by the literal string true', () => {
    process.env.PRESETUP_PROXY_ENABLED = '1';
    expect(isPresetupProxyEnabled()).toBe(false);
    process.env.PRESETUP_PROXY_ENABLED = 'true';
    expect(isPresetupProxyEnabled()).toBe(true);
  });
});

describe('requirePresetupOperator', () => {
  const saved = process.env.PRESETUP_PROXY_ENABLED;

  beforeEach(() => {
    process.env.PRESETUP_PROXY_ENABLED = 'true';
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.PRESETUP_PROXY_ENABLED;
    else process.env.PRESETUP_PROXY_ENABLED = saved;
  });

  function run(req: Request): unknown {
    let captured: unknown = 'next-called-clean';
    const next: NextFunction = (err?: unknown) => {
      if (err !== undefined) captured = err;
    };
    requirePresetupOperator(req, res, next);
    return captured;
  }

  it('answers 404 when the flag is off, regardless of role', () => {
    process.env.PRESETUP_PROXY_ENABLED = 'false';
    expect(run(makeReq(['*']))).toBeInstanceOf(NotFoundError);
  });

  it('rejects unauthenticated requests with 401', () => {
    expect(run(makeReq(undefined))).toBeInstanceOf(UnauthorizedError);
  });

  it('allows master key / service accounts (roles: ["*"])', () => {
    expect(run(makeReq(['*']))).toBe('next-called-clean');
  });

  it('allows JWT with role:presetup-operator', () => {
    expect(run(makeReq(['role:viewer', 'role:presetup-operator']))).toBe('next-called-clean');
  });

  it('allows JWT with role:super-admin', () => {
    expect(run(makeReq(['role:super-admin']))).toBe('next-called-clean');
  });

  it('rejects JWT without the role (403)', () => {
    expect(run(makeReq(['role:viewer', 'role:os-only']))).toBeInstanceOf(ForbiddenError);
  });

  it('rejects customer API keys (scope pseudo-roles) even with write scopes', () => {
    expect(run(makeReq(['scope:customers:write', 'scope:devices:write']))).toBeInstanceOf(
      ForbiddenError
    );
  });
});
