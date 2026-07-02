process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? 'a'.repeat(64);

import * as crypto from 'crypto';
import { makeCentralAuthMiddleware } from '../../../src/middleware/centralAuth';
import { UnauthorizedError } from '../../../src/shared/errors/AppError';
import { encryptSecret } from '../../../src/shared/utils/secretEnvelope';

// -----------------------------------------------------------------------------
// HS256 token helper — mints a token the SAME way the central does: HMAC-SHA256
// over `${headerB64}.${payloadB64}` with the central's agent_secret. Mirrors
// AuthService.createJWT / verifyJWT so centralAuthMiddleware can verify it.
// -----------------------------------------------------------------------------
function base64Url(input: Buffer | string): string {
  const str = typeof input === 'string' ? input : input.toString('base64');
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signHs256(payload: object, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64Url(Buffer.from(JSON.stringify(payload)));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  return `${headerB64}.${payloadB64}.${base64Url(signature)}`;
}

const SECRET = 'super-secret-agent-key';
const CENTRAL_UUID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function makeCentralRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CENTRAL_UUID,
    tenantId: TENANT_ID,
    agentSecret: SECRET,
    ...overrides,
  };
}

function makeReq(headers: Record<string, string | undefined>) {
  return {
    headers,
    context: { tenantId: '', userId: '', requestId: 'r1', ip: '' },
  } as unknown as import('express').Request;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe('centralAuthMiddleware', () => {
  it('accepts a valid HS256 token for a known central and sets req.context', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, SECRET);
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(getByUuid).toHaveBeenCalledWith(CENTRAL_UUID);
    expect(next).toHaveBeenCalledTimes(1);
    // next() called with NO error argument on success.
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect(req.context.tenantId).toBe(TENANT_ID);
    expect(req.centralContext).toEqual({ centralId: CENTRAL_UUID, tenantId: TENANT_ID });
  });

  it('verifies a token when agent_secret is stored ENCRYPTED at rest (CR-S3)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow({ agentSecret: encryptSecret(SECRET) }));
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, SECRET);
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect(req.centralContext).toEqual({ centralId: CENTRAL_UUID, tenantId: TENANT_ID });
  });

  it('rejects a token signed with the wrong secret (401)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, 'WRONG-secret');
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(req.centralContext).toBeUndefined();
  });

  it('rejects an unknown UUID (central not found → 401)', async () => {
    const getByUuid = jest.fn(async () => null);
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, SECRET);
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects a central with a null agent_secret (not yet provisioned → 401)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow({ agentSecret: null }));
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, SECRET);
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects an expired token (exp in the past → 401)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() - 10 }, SECRET);
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects a token with NO exp claim (replay protection → 401, CR-S1)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID }, SECRET); // no exp
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(req.centralContext).toBeUndefined();
  });

  it('rejects a token whose iat is older than the max age (401, CR-S1)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    // Future exp but a stale iat (signed long ago) → rejected.
    const token = signHs256(
      { UUID: CENTRAL_UUID, iat: nowSeconds() - 3600, exp: nowSeconds() + 3600 },
      SECRET,
    );
    const req = makeReq({ authorization: token, uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects when the authorization header is missing (401)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const req = makeReq({ uuid: CENTRAL_UUID });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(getByUuid).not.toHaveBeenCalled();
  });

  it('rejects when the uuid header is missing (401)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ UUID: CENTRAL_UUID, exp: nowSeconds() + 3600 }, SECRET);
    const req = makeReq({ authorization: token });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(getByUuid).not.toHaveBeenCalled();
  });

  it('rejects a malformed uuid header as 401 without hitting the DB (round-3 #4)', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralAuthMiddleware({ getByUuid } as never);

    const token = signHs256({ exp: nowSeconds() + 3600 }, SECRET);
    // not a UUID → would otherwise reach the typed `uuid` column and 500/leak
    const req = makeReq({ authorization: token, uuid: "not-a-uuid'; DROP TABLE" });
    const next = jest.fn();

    await mw(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(getByUuid).not.toHaveBeenCalled();
  });
});
