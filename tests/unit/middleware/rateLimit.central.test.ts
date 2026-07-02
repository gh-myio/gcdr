import {
  centralEnrollRateLimiter,
  centralPollRateLimiter,
  centralPollIpRateLimiter,
  sweepExpiredBuckets,
} from '../../../src/middleware/rateLimit';

// Mocks for the express req/res/next triple used by the rate-limit middleware.
// clientIp() now reads Express's vetted req.ip (CR-S7), so set it here.
function mockReq(headers: Record<string, string>, ip = '10.0.0.1'): any {
  return { ip, headers, socket: { remoteAddress: ip }, context: { requestId: 'r' } };
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
      centralEnrollRateLimiter(mockReq({}, ip), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
    const res = mockRes();
    const next = jest.fn();
    centralEnrollRateLimiter(mockReq({}, ip), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('keeps separate budgets per IP', () => {
    const resA = mockRes();
    const nextA = jest.fn();
    centralEnrollRateLimiter(mockReq({}, '203.0.113.10'), resA, nextA);
    const resB = mockRes();
    const nextB = jest.fn();
    centralEnrollRateLimiter(mockReq({}, '203.0.113.11'), resB, nextB);
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

describe('centralPollIpRateLimiter (outer pre-auth bound)', () => {
  it('caps total poll load per IP even when the uuid header is rotated', () => {
    const ip = '203.0.113.99';
    // Attacker rotates a fresh uuid every request to dodge the per-central
    // bucket; the outer IP bound must still cap them at 600/min.
    for (let i = 0; i < 600; i++) {
      const res = mockRes();
      const next = jest.fn();
      centralPollIpRateLimiter(mockReq({ uuid: `spoof-${i}` }, ip), res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    const res = mockRes();
    const next = jest.fn();
    centralPollIpRateLimiter(mockReq({ uuid: 'spoof-601' }, ip), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('keeps separate budgets per source IP', () => {
    const resA = mockRes();
    const nextA = jest.fn();
    centralPollIpRateLimiter(mockReq({ uuid: 'x' }, '198.51.100.20'), resA, nextA);
    const resB = mockRes();
    const nextB = jest.fn();
    centralPollIpRateLimiter(mockReq({ uuid: 'x' }, '198.51.100.21'), resB, nextB);
    expect(nextA).toHaveBeenCalled();
    expect(nextB).toHaveBeenCalled();
  });
});

describe('sweepExpiredBuckets (round-3 #6 eviction)', () => {
  it('evicts entries whose window has elapsed so rotated keys do not leak', () => {
    // Seed distinct uuid buckets, then sweep with a far-future clock so every
    // window is expired: the janitor must reclaim them (no unbounded growth).
    const ip = '198.51.100.200';
    for (let i = 0; i < 25; i++) {
      centralPollIpRateLimiter(mockReq({ uuid: `rot-${i}` }, ip), mockRes(), jest.fn());
    }
    const farFuture = Date.now() + 60 * 60 * 1000;
    const removed = sweepExpiredBuckets(farFuture);
    expect(removed).toBeGreaterThan(0);
    // a fresh window is available again after eviction (count resets)
    const res = mockRes();
    const next = jest.fn();
    centralPollIpRateLimiter(mockReq({ uuid: 'rot-0' }, ip), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
