import { Request, Response, NextFunction } from 'express';
import { centralInitialKeyService } from '../services/CentralInitialKeyService';
import { sendSuccess } from '../middleware';
import { clientIp } from '../middleware/rateLimit';
 
// =============================================================================
// RFC-0056 — GET /api/v1/public/central/initial-key
//
// Mounted PUBLIC in app.ts, gated by centralBootstrapIpRateLimiter +
// centralBootstrapUuidRateLimiter + centralPreKeyAuth (in that order — the
// request-entry rate limiters run before the auth check does any DB work).
// centralPreKeyAuth populates req.centralBootstrapContext; this handler only
// wires that into the service and shapes the response.
//
// Response is wrapped in the standard { success, data, meta } envelope like
// every other GCDR endpoint (data = { apiKey, scopes, customerId, cached }),
// not the bare object shown in the RFC's contract shorthand.
// =============================================================================
 
export async function getInitialKeyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const central = req.centralBootstrapContext;
    if (!central) {
      // Unreachable when centralPreKeyAuth is mounted in front of this
      // handler (it always sets this or calls next(err) first).
      throw new Error('centralPreKeyAuth did not populate centralBootstrapContext');
    }
 
    const uuidHeader = req.headers['uuid'] as string;
    const result = await centralInitialKeyService.getOrCreateInitialKey(
      uuidHeader,
      central,
      clientIp(req),
    );
 
    sendSuccess(res, result, 200, req.context?.requestId);
  } catch (err) {
    next(err);
  }
}
 