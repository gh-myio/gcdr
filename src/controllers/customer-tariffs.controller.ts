import { Router, Request, Response, NextFunction } from 'express';
import {
  customerTariffService,
  TariffVersionConflictError,
} from '../services/CustomerTariffService';
import {
  GetTariffQuerySchema,
  TariffTargetQuerySchema,
  ReplaceTariffBodySchema,
  MergeTariffBodySchema,
  DeleteTariffBodySchema,
  validateReplaceTariffCalendar,
  validateTariffBucketsYear,
} from '../dto/request/TariffsDTO';
import { customerService } from '../services/CustomerService';
import { sendSuccess, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { ApiResponse } from '../shared/types';

// =============================================================================
// RFC-0054 — Customer Tariffs (controller). Mounted at
// /customers/:customerId/tariffs in app.ts. `year` is a REQUIRED discriminator
// on every verb; PATCH/DELETE refs must match the query year.
//
// Routes:
//   GET    /?domain=&category=&year=&granularity=&fetchHistory=
//   PUT    /?domain=&category=&year=    — replace the whole year
//   PATCH  /?domain=&category=&year=    — merge sparse price buckets
//   DELETE /?domain=&category=&year=    — whole year or a sub-bucket (idempotent)
//
// hybridAuth (tariffs:read/tariffs:write) + requireTariffAccess applied at mount.
// =============================================================================

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(name: string, value: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${name}: "${value ?? ''}"`);
  }
}

function actorOf(req: Request): string | null {
  return req.context?.userId ?? req.context?.apiKeyId ?? req.user?.sub ?? null;
}

/** Serialises a TariffVersionConflictError with currentVersion in the body. */
function handleVersionConflict(err: unknown, req: Request, res: Response): boolean {
  if (!(err instanceof TariffVersionConflictError)) return false;
  const response: ApiResponse = {
    success: false,
    error: {
      message: err.message,
      code: err.code,
      currentVersion: err.currentVersion,
      details: err.details,
    } as ApiResponse['error'] & { currentVersion: number },
    meta: { requestId: req.context?.requestId ?? '', timestamp: new Date().toISOString() },
  };
  res.status(err.statusCode).json(response);
  return true;
}

async function ensureCustomer(tenantId: string, customerId: string): Promise<void> {
  requireUuid('customerId', customerId);
  await customerService.getById(tenantId, customerId); // NotFoundError if absent
}

// GET — derived tree for (customer, domain, category, year).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const q = GetTariffQuerySchema.parse(req.query);
    const result = await customerTariffService.get(
      { tenantId, customerId, domain: q.domain, category: q.category, year: q.year },
      q.granularity,
      q.fetchHistory,
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// PUT — replace the whole year.
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const q = TariffTargetQuerySchema.parse(req.query);
    const body = ReplaceTariffBodySchema.parse(req.body);
    const issues = validateReplaceTariffCalendar(body, q.year);
    if (issues.length > 0) {
      throw new ValidationError('Invalid tariff tree', { issues } as unknown as Record<string, string[]>);
    }

    const result = await customerTariffService.replace(
      { tenantId, customerId, domain: q.domain, category: q.category, year: q.year },
      body,
      actorOf(req),
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

// PATCH — merge sparse price buckets.
router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const q = TariffTargetQuerySchema.parse(req.query);
    const body = MergeTariffBodySchema.parse(req.body);
    const issues = validateTariffBucketsYear(body.buckets, q.year);
    if (issues.length > 0) {
      throw new ValidationError('Invalid tariff buckets', { issues } as unknown as Record<string, string[]>);
    }

    const result = await customerTariffService.merge(
      { tenantId, customerId, domain: q.domain, category: q.category, year: q.year },
      body.buckets,
      actorOf(req),
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

// DELETE — whole year (no/empty body → 204) or a sub-bucket (200 + body).
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const q = TariffTargetQuerySchema.parse(req.query);
    const body = DeleteTariffBodySchema.parse(req.body ?? undefined);
    if (body?.bucket) {
      const issues = validateTariffBucketsYear([body.bucket], q.year);
      if (issues.length > 0) {
        throw new ValidationError('Invalid tariff bucket', { issues } as unknown as Record<string, string[]>);
      }
    }

    const result = await customerTariffService.remove(
      { tenantId, customerId, domain: q.domain, category: q.category, year: q.year },
      body?.bucket,
      body?.expectedVersion,
      actorOf(req),
    );

    // Whole-year delete with no optimistic guard → 204 (idempotent).
    if (!body?.bucket && body?.expectedVersion === undefined) {
      sendNoContent(res);
      return;
    }
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

export default router;
