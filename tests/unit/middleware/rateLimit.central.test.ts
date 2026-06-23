import { centralEnrollRateLimiter, centralPollRateLimiter } from '../../../src/middleware/rateLimit';

// Mocks for the express req/res/next triple used by the rate-limit middleware.
function mockReq(headers: Record<string, string>, ip = '10.0.0.1'): any {
  return { headers, socket: { remoteAddress: ip }, context: { requestId: 'r' } };
}

function mockRes(): any {
  const res: any = { statusCode: 200, headers: {} };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  res.status = jest.fn().mockImplementation((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('centralEnrollRateLimiter', () => {
  it('allows up to 30 attempts per IP, then 429s', () => {
    const ip = '203.0.113.5';
    for (let i = 0; i < 30; i++) {
      const res = mockRes();
      const next = jest.fn();
      centralEnrollRateLimiter(mockReq({ 'x-forwarded-for': ip }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
    const res = mockRes();
    const next = jest.fn();
    centralEnrollRateLimiter(mockReq({ 'x-forwarded-for': ip }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('keeps separate budgets per IP', () => {
    const resA = mockRes();
    const nextA = jest.fn();
    centralEnrollRateLimiter(mockReq({ 'x-forwarded-for': '203.0.113.10' }), resA, nextA);
    const resB = mockRes();
    const nextB = jest.fn();
    centralEnrollRateLimiter(mockReq({ 'x-forwarded-for': '203.0.113.11' }), resB, nextB);
    expect(nextA).toHaveBeenCalled();
    expect(nextB).toHaveBeenCalled();
  });
});

describe('centralPollRateLimiter', () => {
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('is keyed by uuid: one central hitting the cap does not block another', () => {
    for (let i = 0; i < 60; i++) {
      const next = jest.fn();
      centralPollRateLimiter(mockReq({ uuid: A }), mockRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    // 61st request for A is throttled.
    const resA = mockRes();
    const nextA = jest.fn();
    centralPollRateLimiter(mockReq({ uuid: A }), resA, nextA);
    expect(nextA).not.toHaveBeenCalled();
    expect(resA.status).toHaveBeenCalledWith(429);

    // A different central (B) shares the same NAT/IP but its own bucket.
    const resB = mockRes();
    const nextB = jest.fn();
    centralPollRateLimiter(mockReq({ uuid: B }), resB, nextB);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(resB.status).not.toHaveBeenCalled();
  });

  it('falls back to IP keying when the uuid header is absent', () => {
    const res = mockRes();
    const next = jest.fn();
    centralPollRateLimiter(mockReq({}, '198.51.100.7'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
