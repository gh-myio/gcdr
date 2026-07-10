import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  consumptionGoalService,
  VersionConflictError,
} from '../services/ConsumptionGoalService';
import {
  GetGoalsQuerySchema,
  GoalsTargetQuerySchema,
  ImportGoalsQuerySchema,
  ReplaceGoalsBodySchema,
  MergeGoalsBodySchema,
  DeleteGoalsBodySchema,
  SetGoalMarginBodySchema,
  ClearGoalMarginBodySchema,
  validateReplaceTreeCalendar,
} from '../dto/request/GoalsDTO';
import { customerService } from '../services/CustomerService';
import { sendSuccess, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { ApiResponse, EventType } from '../shared/types';

// =============================================================================
// RFC-0046 — Customer Consumption Goals (controller)
//
// Mounted at /customers/:customerId/goals in app.ts. The router uses
// `mergeParams` so :customerId from the parent route is visible in req.params.
//
// Routes:
//   GET    /                  — list domains with goals  (no query)
//                            OR get the derived tree     (with ?domain&year)
//   PUT    /?domain=&year=    — replace whole year+domain (DEC-5)
//   PATCH  /?domain=&year=    — merge sent buckets        (DEC-5)
//   POST   /import?domain=&year=&dryRun=
//                            — CSV import; dryRun=true previews (stateless,
//                              nothing persisted), dryRun=false persists
//   DELETE /?domain=&year=    — delete a year or a sub-bucket
//
// Auth (hybridAuthByMethod('goals:read','goals:write')) and hierarchy access are
// applied at mount time in app.ts.
//
// The version-conflict (409) is serialised inline so the body carries
// `currentVersion` + `details` per RFC-0046 §4.4 (the global error handler emits
// only message+code for a bare AppError).
// =============================================================================

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Import body (csv text + optional optimistic guard); query carries dryRun/domain/year. */
const ImportGoalsBodySchema = z.object({
  csv: z.string().min(1, 'csv content is required'),
  expectedVersion: z.number().int().positive().optional(),
});

function requireUuid(name: string, value: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${name}: "${value ?? ''}"`);
  }
}

/** The actor recorded on writes/history — the JWT user or the API-key id. */
function actorOf(req: Request): string | null {
  return req.context?.userId ?? req.context?.apiKeyId ?? req.user?.sub ?? null;
}

/**
 * Serialises a VersionConflictError into the RFC-0046 §4.4 body and returns
 * `true` when it handled the error; otherwise returns `false` so the caller
 * forwards to the global handler.
 */
function handleVersionConflict(err: unknown, req: Request, res: Response): boolean {
  if (!(err instanceof VersionConflictError)) return false;
  const response: ApiResponse = {
    success: false,
    error: {
      message: err.message,
      code: err.code,
      currentVersion: err.currentVersion,
      details: err.details,
    } as ApiResponse['error'] & { currentVersion: number },
    meta: {
      requestId: req.context?.requestId ?? '',
      timestamp: new Date().toISOString(),
    },
  };
  res.status(err.statusCode).json(response);
  return true;
}

/** Validates customer existence (404) and tenant/hierarchy scoping. */
async function ensureCustomer(tenantId: string, customerId: string): Promise<void> {
  requireUuid('customerId', customerId);
  await customerService.getById(tenantId, customerId); // throws NotFoundError if absent
}

/**
 * GET /customers/:customerId/goals
 *   - no `domain`/`year`  → list domains that have goals (RFC §3.1)
 *   - with `domain&year`  → derived tree at `granularity` (RFC §3.2)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    // Summary mode when no discriminator is supplied.
    if (req.query.domain === undefined && req.query.year === undefined) {
      const result = await consumptionGoalService.list(tenantId, customerId);
      sendSuccess(res, result, 200, requestId);
      return;
    }

    const query = GetGoalsQuerySchema.parse(req.query);
    const result = await consumptionGoalService.get(
      { tenantId, customerId, domain: query.domain, year: query.year },
      query.granularity,
      query.fetchHistory,
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /customers/:customerId/goals?domain=&year=
 * Replace the whole (year, domain). Buckets absent from the payload are removed.
 */
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const { domain, year } = GoalsTargetQuerySchema.parse(req.query);
    const body = ReplaceGoalsBodySchema.parse(req.body ?? {});

    // Cross-field calendar validity (leap-year aware) — needs the year from query.
    const calIssues = validateReplaceTreeCalendar(body, year);
    if (calIssues.length > 0) {
      throw new ValidationError('Validation failed', issuesToDetails(calIssues));
    }

    const result = await consumptionGoalService.replace(
      { tenantId, customerId, domain, year },
      body,
      actorOf(req),
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

/**
 * PATCH /customers/:customerId/goals?domain=&year=
 * Merge only the sent buckets; everything else is preserved.
 */
router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const { domain, year } = GoalsTargetQuerySchema.parse(req.query);
    const body = MergeGoalsBodySchema.parse(req.body ?? {});

    const result = await consumptionGoalService.merge(
      { tenantId, customerId, domain, year },
      body,
      actorOf(req),
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

/**
 * POST /customers/:customerId/goals/import?domain=&year=&dryRun=
 * CSV import. dryRun=true (default) returns a preview + diagnostics WITHOUT
 * persisting (stateless — no previewToken); dryRun=false persists via merge.
 */
router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const { domain, year, dryRun } = ImportGoalsQuerySchema.parse(req.query);
    const body = ImportGoalsBodySchema.parse(req.body ?? {});

    const result = await consumptionGoalService.importData(
      { tenantId, customerId, domain, year },
      body.csv,
      dryRun,
      body.expectedVersion,
      actorOf(req),
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

/**
 * PUT /customers/:customerId/goals/margin?domain=&year=
 * RFC-0052: sets (or changes) the margin overlay — upsert, optimistic lock via
 * body.expectedVersion, one MARGIN history row per effective change, audited.
 */
router.put(
  '/margin',
  logEvent({
    eventType: EventType.GOAL_MARGIN_CHANGED,
    description: (req) =>
      `Goal margin set to ${req.body?.goalMarginPct}% (${req.query.domain}/${req.query.year}) for customer ${req.params.customerId}`,
    getEntityId: (req) => req.params.customerId,
    getCustomerId: (req) => req.params.customerId,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { customerId } = req.params;
      await ensureCustomer(tenantId, customerId);

      const { domain, year } = GoalsTargetQuerySchema.parse(req.query);
      const body = SetGoalMarginBodySchema.parse(req.body ?? {});

      const result = await consumptionGoalService.setMargin(
        { tenantId, customerId, domain, year },
        body,
        actorOf(req),
      );
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      if (handleVersionConflict(err, req, res)) return;
      next(err);
    }
  },
);

/**
 * DELETE /customers/:customerId/goals/margin?domain=&year=
 * RFC-0052: clears the margin overlay (history records old pct → null).
 */
router.delete(
  '/margin',
  logEvent({
    eventType: EventType.GOAL_MARGIN_CHANGED,
    description: (req) =>
      `Goal margin cleared (${req.query.domain}/${req.query.year}) for customer ${req.params.customerId}`,
    getEntityId: (req) => req.params.customerId,
    getCustomerId: (req) => req.params.customerId,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { customerId } = req.params;
      await ensureCustomer(tenantId, customerId);

      const { domain, year } = GoalsTargetQuerySchema.parse(req.query);
      const body = ClearGoalMarginBodySchema.parse(req.body ?? undefined);

      const result = await consumptionGoalService.clearMargin(
        { tenantId, customerId, domain, year },
        body?.expectedVersion,
        actorOf(req),
      );
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      if (handleVersionConflict(err, req, res)) return;
      next(err);
    }
  },
);

/**
 * DELETE /customers/:customerId/goals?domain=&year=
 * Removes the whole year (or a sub-bucket via body.bucket). A whole-year delete
 * with no expectedVersion returns 204; with a guard it returns 200 + body.
 */
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    await ensureCustomer(tenantId, customerId);

    const { domain, year } = GoalsTargetQuerySchema.parse(req.query);
    const body = DeleteGoalsBodySchema.parse(req.body ?? undefined);

    const result = await consumptionGoalService.remove(
      { tenantId, customerId, domain, year },
      body,
      actorOf(req),
    );

    // Whole-year delete with no optimistic guard → 204 No Content (RFC §3.6).
    if (result && result.deleted.bucket === null && body?.expectedVersion === undefined) {
      sendNoContent(res);
      return;
    }
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    if (handleVersionConflict(err, req, res)) return;
    next(err);
  }
});

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function issuesToDetails(issues: Array<{ path: string; message: string }>): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const i of issues) {
    (details[i.path] ??= []).push(i.message);
  }
  return details;
}

export default router;
