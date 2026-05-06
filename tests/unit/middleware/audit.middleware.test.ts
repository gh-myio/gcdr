import { EventEmitter } from 'events';
import type { NextFunction, Request, Response } from 'express';
import { logEvent, setAuditLogWriter } from '../../../src/middleware/audit';
import { EventType, CreateAuditLogInput } from '../../../src/shared/types/audit.types';

// Regression for the audit-write failures observed in prod after
// DISABLE_AUTH was flipped to false: the middleware was writing
// `req.user.sub` (which for API Key callers is "apikey:<keyId>", not a
// UUID) into audit_logs.user_id (a UUID column), so every successful
// M2M call crashed the audit insert downstream of the 200 response.
//
// Fix: prefer `req.context.apiKeyId` (a clean UUID) when present.

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const API_KEY_ID = 'cee00001-0001-0001-0001-000000000007';
const RULE_ID    = 'd23821c2-b72e-46b6-9b2a-b8a95817e3c8';
const REQUEST_ID = '72290bdb-9127-4049-83a9-3ebd1e40f99a';
const JWT_SUB    = '00000000-0000-0000-0000-000000000099';

function buildReq(overrides: Partial<Request>): Request {
  const base = {
    context: {
      tenantId: TENANT_ID,
      requestId: REQUEST_ID,
    },
    headers: { 'user-agent': 'node' },
    ip: '10.0.1.18',
    socket: { remoteAddress: '10.0.1.18' },
    method: 'POST',
    originalUrl: `/api/v1/rules/${RULE_ID}/trigger`,
    params: { id: RULE_ID },
  } as unknown as Request;
  return Object.assign(base, overrides);
}

function buildRes(): Response & EventEmitter {
  const emitter = new EventEmitter() as Response & EventEmitter;
  emitter.statusCode = 200;
  emitter.setHeader = jest.fn() as unknown as Response['setHeader'];
  emitter.json = jest.fn().mockReturnThis() as unknown as Response['json'];
  emitter.send = jest.fn().mockReturnThis() as unknown as Response['send'];
  return emitter;
}

async function flushFinishHook(res: Response & EventEmitter): Promise<void> {
  res.emit('finish');
  // The audit hook is `async () => {...}`. Yield twice so the microtask
  // queue drains and the writer.catch promise resolves before assertions.
  await Promise.resolve();
  await Promise.resolve();
}

describe('audit middleware — userId mapping', () => {
  let writer: jest.Mock<Promise<void>, [CreateAuditLogInput]>;

  beforeEach(() => {
    writer = jest.fn().mockResolvedValue(undefined);
    setAuditLogWriter(writer);
  });

  it('writes the bare apiKeyId UUID into userId for API Key callers', async () => {
    const req = buildReq({
      context: {
        tenantId:  TENANT_ID,
        requestId: REQUEST_ID,
        apiKeyId:  API_KEY_ID,
      },
      user: {
        sub:       `apikey:${API_KEY_ID}`,
        email:     'apikey:Alarm System Integration@system',
        tenant_id: TENANT_ID,
        type:      'SERVICE_ACCOUNT',
        roles:     ['scope:rules:write'],
      },
    } as unknown as Partial<Request>);
    const res = buildRes();

    logEvent({
      eventType:   EventType.RULE_TRIGGERED,
      description: () => `Rule ${RULE_ID} triggered`,
      getEntityId: () => RULE_ID,
    })(req, res, jest.fn() as NextFunction);

    await flushFinishHook(res);

    expect(writer).toHaveBeenCalledTimes(1);
    const payload = writer.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload!.userId).toBe(API_KEY_ID);
    // The "apikey:" prefix must NOT leak into user_id (UUID column).
    expect(payload!.userId).not.toMatch(/^apikey:/);
    expect(payload!.userEmail).toBe('apikey:Alarm System Integration@system');
  });

  it('falls back to req.user.sub when apiKeyId is not set (JWT path)', async () => {
    const req = buildReq({
      context: {
        tenantId:  TENANT_ID,
        requestId: REQUEST_ID,
      },
      user: {
        sub:       JWT_SUB,
        email:     'rplago@gmail.com',
        tenant_id: TENANT_ID,
        type:      'INTERNAL',
        roles:     ['admin'],
      },
    } as unknown as Partial<Request>);
    const res = buildRes();

    logEvent({
      eventType:   EventType.RULE_TRIGGERED,
      description: () => `Rule ${RULE_ID} triggered`,
      getEntityId: () => RULE_ID,
    })(req, res, jest.fn() as NextFunction);

    await flushFinishHook(res);

    expect(writer).toHaveBeenCalledTimes(1);
    const payload = writer.mock.calls[0]?.[0];
    expect(payload!.userId).toBe(JWT_SUB);
  });
});
