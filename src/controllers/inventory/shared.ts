import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../shared/errors/AppError';
import {
  notImplemented,
  idempotencyKeyMissing,
  confirmationRequired,
} from '../../shared/errors/InventoryError';

// =============================================================================
// RFC-0061 — shared guards for the per-module inventory routers.
// Each module (M1..M10) owns its own <module>.controller.ts; this file carries
// only the cross-cutting request guards so module PRs never touch each other.
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(name: string, value: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${name}: "${value ?? ''}"`);
  }
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.headers['idempotency-key'];
  const value = Array.isArray(key) ? key[0] : key;
  if (!value || String(value).trim() === '') {
    throw idempotencyKeyMissing();
  }
  return String(value).trim();
}

export function requireConfirmation(req: Request): string {
  const header = req.headers['x-confirmation-token'];
  const body = (req.body ?? {}) as { confirmationToken?: unknown };
  const token = (Array.isArray(header) ? header[0] : header) ?? body.confirmationToken;
  if (!token || String(token).trim() === '') {
    throw confirmationRequired();
  }
  return String(token).trim();
}

/**
 * Build a deferred handler: run optional validation (path params, DTO,
 * idempotency/confirmation guards) then return the 501 contract marker.
 */
export function defer(module: string, phase: string, validate?: (req: Request) => void) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (validate) validate(req);
      throw notImplemented(module, phase);
    } catch (err) {
      next(err);
    }
  };
}
