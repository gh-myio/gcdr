import * as crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../shared/errors/AppError';
import { centralRepository } from '../repositories/CentralRepository';

// =============================================================================
// Central-agent authentication (field-swap backup/restore poll loop).
//
// The central authenticates its poll loop the SAME way the existing central code
// already sends it on the wire (so this is drop-in compatible):
//   - header `authorization: <raw JWT>`   (NO "Bearer" prefix)
//   - header `uuid: <central-UUID>`        (the central's own id)
//
// gcdr looks the central up by UUID, then HMAC-verifies (HS256) the token with
// THAT central's `agent_secret` — using the exact same createHmac('sha256') +
// timingSafeEqual scheme as AuthService.verifyJWT. The tenant is derived from
// the central row (the device does not know its tenant).
// =============================================================================

/** Identity of the authenticated central, set on req.context.central. */
export interface CentralIdentity {
  centralId: string;
  tenantId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Populated by centralAuthMiddleware after a successful HMAC verify.
      centralContext?: CentralIdentity;
    }
  }
}

// Structural dep for unit testing — mirrors the DI style used by the services.
type CentralRepoDep = Pick<typeof centralRepository, 'getByUuid'>;

function base64UrlDecode(input: string): Buffer {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) {
    base64 += '='.repeat(padding);
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Verify an HS256 JWT against `secret` using the SAME scheme as
 * AuthService.verifyJWT: HMAC-SHA256 over `${header}.${payload}` compared with
 * crypto.timingSafeEqual. Returns the decoded payload, or null if the token is
 * malformed, the signature is wrong, or `exp` (when present) is in the past.
 */
function verifyHs256<T extends { exp?: number }>(token: string, secret: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest();

    const actualSignature = base64UrlDecode(signature);

    if (expectedSignature.length !== actualSignature.length) return null;
    if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) return null;

    const decoded = JSON.parse(base64UrlDecode(payload).toString('utf-8')) as T;

    // exp is optional; when present it must be in the future.
    if (typeof decoded.exp === 'number') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (decoded.exp < nowSeconds) return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/** Read the `UUID` claim from a JWT payload WITHOUT verifying — used only to
 * find which central (and thus which secret) the token claims to be from. */
function readUuidClaim(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(base64UrlDecode(payload).toString('utf-8')) as { UUID?: string };
    return typeof decoded.UUID === 'string' && decoded.UUID ? decoded.UUID : null;
  } catch {
    return null;
  }
}

/**
 * Factory so unit tests can inject a mock CentralRepository. The default export
 * (`centralAuthMiddleware`) is wired to the real singleton.
 */
export function makeCentralAuthMiddleware(centrals: CentralRepoDep = centralRepository) {
  return async function centralAuth(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const token = req.headers['authorization'];
      const uuidHeader = req.headers['uuid'];

      // NOTE: these are INPUT-PRESENCE checks, not the security boundary. The
      // uuid header only SELECTS which central (and thus which agent_secret) the
      // token is verified against; authentication is decided solely by the HMAC
      // verify below (verifyHs256 + timingSafeEqual). A caller cannot bypass it
      // by manipulating these headers — without the central's agent_secret the
      // signature check fails. (Re: CodeQL "user-controlled bypass" here.)
      if (typeof token !== 'string' || !token) {
        throw new UnauthorizedError('Central token não fornecido');
      }
      if (typeof uuidHeader !== 'string' || !uuidHeader) {
        throw new UnauthorizedError('Central UUID não fornecido');
      }

      // The header UUID is authoritative for the lookup; if the token also
      // carries a UUID claim it must agree (defence against header/token mismatch).
      const claimUuid = readUuidClaim(token);
      if (claimUuid && claimUuid !== uuidHeader) {
        throw new UnauthorizedError('Central UUID inconsistente');
      }

      const central = await centrals.getByUuid(uuidHeader);
      if (!central) {
        throw new UnauthorizedError('Central desconhecida');
      }
      if (!central.agentSecret) {
        throw new UnauthorizedError('Central sem credencial de agente');
      }

      const payload = verifyHs256(token, central.agentSecret);
      if (!payload) {
        throw new UnauthorizedError('Token de central inválido ou expirado');
      }

      // Authenticated: derive tenant from the row, expose the central identity.
      req.context.tenantId = central.tenantId;
      req.context.userId = `central:${central.id}`;
      req.centralContext = { centralId: central.id, tenantId: central.tenantId };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const centralAuthMiddleware = makeCentralAuthMiddleware();
