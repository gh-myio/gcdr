// RFC-0056 — pre-key authentication for GET /public/central/initial-key.
// Covers: generic 401 (no UUID/pre-key oracle), fail-closed on missing env
// var, progressive lockout by IP (growing Retry-After, decay, success reset).

process.env.CENTRAL_PRE_INITIAL_API_KEY = 'test-pre-key-value';

import { Request } from 'express';
import { makeCentralPreKeyAuth } from '../../../src/middleware/centralPreKeyAuth';
import { UnauthorizedError } from '../../../src/shared/errors/AppError';

const CENTRAL_UUID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PRE_KEY = 'test-pre-key-value';

function makeCentralRow(overrides: Record<string, unknown> = {}) {
  return { id: CENTRAL_UUID, tenantId: TENANT_ID, config: { foo: 'bar' }, ...overrides };
}

function mockReq(headers: Record<string, string | undefined>, ip: string): Request {
  return {
    headers,
    ip,
    socket: { remoteAddress: ip },
    context: { requestId: 'r1' },
  } as unknown as Request;
}

function mockRes(): any {
  const res: any = { statusCode: 200, headers: {} };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

let ipCounter = 0;
/** Fresh IP per test so the module-level lockout store never leaks state across tests. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe('centralPreKeyAuth — success', () => {
  it('accepts a correct pre-key + known uuid, sets req.centralBootstrapContext', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);

    const req = mockReq({ 'x-central-pre-key': PRE_KEY, uuid: CENTRAL_UUID }, freshIp());
    const res = mockRes();
    const next = jest.fn();

    await mw(req, res, next);

    expect(getByUuid).toHaveBeenCalledWith(CENTRAL_UUID);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect(req.centralBootstrapContext).toEqual({
      centralId: CENTRAL_UUID,
      tenantId: TENANT_ID,
      config: { foo: 'bar' },
    });
  });
});

describe('centralPreKeyAuth — generic 401 (no oracle)', () => {
  it('wrong pre-key + valid uuid → generic 401, but still looks up the central', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);

    const req = mockReq({ 'x-central-pre-key': 'wrong-key', uuid: CENTRAL_UUID }, freshIp());
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(getByUuid).toHaveBeenCalledWith(CENTRAL_UUID);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('correct pre-key + unknown central → generic 401', async () => {
    const getByUuid = jest.fn(async () => null);
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);

    const req = mockReq({ 'x-central-pre-key': PRE_KEY, uuid: CENTRAL_UUID }, freshIp());
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('malformed uuid → 401 without ever calling getByUuid', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);

    const req = mockReq({ 'x-central-pre-key': PRE_KEY, uuid: 'not-a-uuid' }, freshIp());
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(getByUuid).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('missing pre-key header → 401', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);

    const req = mockReq({ uuid: CENTRAL_UUID }, freshIp());
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('fails closed when CENTRAL_PRE_INITIAL_API_KEY is unset, even with a correct-looking key', async () => {
    const original = process.env.CENTRAL_PRE_INITIAL_API_KEY;
    delete process.env.CENTRAL_PRE_INITIAL_API_KEY;
    try {
      const getByUuid = jest.fn(async () => makeCentralRow());
      const mw = makeCentralPreKeyAuth({ getByUuid } as never);

      const req = mockReq({ 'x-central-pre-key': PRE_KEY, uuid: CENTRAL_UUID }, freshIp());
      const next = jest.fn();

      await mw(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    } finally {
      process.env.CENTRAL_PRE_INITIAL_API_KEY = original;
    }
  });
});

describe('centralPreKeyAuth — progressive lockout by IP', () => {
  it('locks the IP out after the failure threshold, with a growing Retry-After', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);
    const ip = freshIp();
    const badReq = () => mockReq({ 'x-central-pre-key': 'wrong', uuid: CENTRAL_UUID }, ip);

    let now = 1_000_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      // First 6 failures are answered as plain 401s (the lockout check runs
      // BEFORE the auth check, so it only takes effect on the NEXT request).
      for (let i = 0; i < 6; i += 1) {
        const next = jest.fn();
        const res = mockRes();
        await mw(badReq(), res, next);
        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
        expect(res.status).not.toHaveBeenCalled();
        now += 1000;
      }

      // 7th request: now locked out — short-circuits to 429 without touching auth.
      const res1 = mockRes();
      const next1 = jest.fn();
      await mw(badReq(), res1, next1);
      expect(next1).not.toHaveBeenCalled();
      expect(res1.status).toHaveBeenCalledWith(429);
      const firstRetryAfter = Number(res1.headers['Retry-After']);
      expect(firstRetryAfter).toBeGreaterThan(0);

      // Advance past the first lockout window, fail again → next lockout is longer.
      now += firstRetryAfter * 1000 + 1000;
      const res2 = mockRes();
      const next2 = jest.fn();
      await mw(badReq(), res2, next2);
      expect(next2).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      now += 1000;

      const res3 = mockRes();
      const next3 = jest.fn();
      await mw(badReq(), res3, next3);
      expect(res3.status).toHaveBeenCalledWith(429);
      const secondRetryAfter = Number(res3.headers['Retry-After']);
      expect(secondRetryAfter).toBeGreaterThanOrEqual(firstRetryAfter);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('a successful auth clears a prior failure count for that IP', async () => {
    const getByUuid = jest.fn(async () => makeCentralRow());
    const mw = makeCentralPreKeyAuth({ getByUuid } as never);
    const ip = freshIp();

    // A few failures, but under the lockout threshold.
    for (let i = 0; i < 3; i += 1) {
      const next = jest.fn();
      await mw(mockReq({ 'x-central-pre-key': 'wrong', uuid: CENTRAL_UUID }, ip), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    }

    // A correct request resets the counter.
    const okNext = jest.fn();
    await mw(mockReq({ 'x-central-pre-key': PRE_KEY, uuid: CENTRAL_UUID }, ip), mockRes(), okNext);
    expect(okNext.mock.calls[0][0]).toBeUndefined();

    // Immediately failing again should behave like a fresh IP (not locked).
    const next = jest.fn();
    const res = mockRes();
    await mw(mockReq({ 'x-central-pre-key': 'wrong', uuid: CENTRAL_UUID }, ip), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(res.status).not.toHaveBeenCalled();
  });
});
