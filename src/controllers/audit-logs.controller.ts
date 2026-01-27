// =============================================================================
// RFC-0009: Audit Logs Controller
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditLogRepository } from '../repositories/AuditLogRepository';
import { sendSuccess, sendPaginated } from '../middleware/response';
import { AppError, ValidationError } from '../shared/errors/AppError';
import {
  EventType,
  EventCategory,
  ActionType,
  AuditLogFilters,
} from '../shared/types/audit.types';
import { AUDIT_QUERY_LIMITS } from '../shared/config/audit.config';

const router = Router();

// =============================================================================
// Validation Schemas
// =============================================================================

const ListAuditLogsSchema = z.object({
  customerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  eventType: z.nativeEnum(EventType).optional(),
  eventCategory: z.nativeEnum(EventCategory).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  action: z.nativeEnum(ActionType).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(AUDIT_QUERY_LIMITS.maxLimit).optional(),
  cursor: z.string().optional(),
  orderBy: z.enum(['createdAt:asc', 'createdAt:desc']).optional(),
}).refine(data => {
  // Validate date range
  if (data.from && data.to) {
    const from = new Date(data.from);
    const to = new Date(data.to);
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > AUDIT_QUERY_LIMITS.maxDateRangeDays) {
      return false;
    }
  }
  return true;
}, {
  message: `Date range cannot exceed ${AUDIT_QUERY_LIMITS.maxDateRangeDays} days`,
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /audit-logs
 * List audit logs with filtering and pagination
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    // Validate query params
    const validation = ListAuditLogsSchema.safeParse(req.query);
    if (!validation.success) {
      throw new ValidationError('Invalid query parameters', validation.error.flatten().fieldErrors);
    }

    const params = validation.data;

    // Set default date range if not provided (last 7 days)
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const filters: AuditLogFilters = {
      tenantId,
      customerId: params.customerId,
      userId: params.userId,
      eventType: params.eventType,
      eventCategory: params.eventCategory,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      from: params.from ? new Date(params.from) : defaultFrom,
      to: params.to ? new Date(params.to) : now,
      limit: params.limit ?? AUDIT_QUERY_LIMITS.defaultLimit,
      cursor: params.cursor,
      orderBy: params.orderBy ?? 'createdAt:desc',
    };

    const result = await auditLogRepository.findMany(filters);

    sendPaginated(res, result.data, {
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/:id
 * Get a single audit log entry by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    const { id } = req.params;

    const auditLog = await auditLogRepository.findById(tenantId, id);
    if (!auditLog) {
      throw new AppError('NOT_FOUND', 'Audit log not found', 404);
    }

    sendSuccess(res, auditLog);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/entity/:entityType/:entityId
 * Get audit logs for a specific entity
 */
router.get('/entity/:entityType/:entityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    const { entityType, entityId } = req.params;
    const { limit, cursor, orderBy } = req.query;

    // Set default date range (last 30 days for entity history)
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const filters: AuditLogFilters = {
      tenantId,
      entityType,
      entityId,
      from,
      to: now,
      limit: limit ? Math.min(Number(limit), AUDIT_QUERY_LIMITS.maxLimit) : AUDIT_QUERY_LIMITS.defaultLimit,
      cursor: cursor as string | undefined,
      orderBy: (orderBy as 'createdAt:asc' | 'createdAt:desc') ?? 'createdAt:desc',
    };

    const result = await auditLogRepository.findMany(filters);

    sendPaginated(res, result.data, {
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/user/:userId
 * Get audit logs for a specific user
 */
router.get('/user/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    const { userId } = req.params;
    const { limit, cursor, orderBy, from, to } = req.query;

    // Set default date range (last 7 days)
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const filters: AuditLogFilters = {
      tenantId,
      userId,
      from: from ? new Date(from as string) : defaultFrom,
      to: to ? new Date(to as string) : now,
      limit: limit ? Math.min(Number(limit), AUDIT_QUERY_LIMITS.maxLimit) : AUDIT_QUERY_LIMITS.defaultLimit,
      cursor: cursor as string | undefined,
      orderBy: (orderBy as 'createdAt:asc' | 'createdAt:desc') ?? 'createdAt:desc',
    };

    const result = await auditLogRepository.findMany(filters);

    sendPaginated(res, result.data, {
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /audit-logs/stats
 * Get audit log statistics
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    const { from, to } = req.query;

    // Set default date range (last 24 hours)
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const dateFrom = from ? new Date(from as string) : defaultFrom;
    const dateTo = to ? new Date(to as string) : now;

    // Get counts by category
    const totalCount = await auditLogRepository.countByFilters({
      tenantId,
      from: dateFrom,
      to: dateTo,
    });

    // Get counts by event category
    const categoryStats: Record<string, number> = {};
    for (const category of Object.values(EventCategory)) {
      categoryStats[category] = await auditLogRepository.countByFilters({
        tenantId,
        eventCategory: category,
        from: dateFrom,
        to: dateTo,
      });
    }

    // Get counts by action
    const actionStats: Record<string, number> = {};
    for (const action of Object.values(ActionType)) {
      actionStats[action] = await auditLogRepository.countByFilters({
        tenantId,
        action,
        from: dateFrom,
        to: dateTo,
      });
    }

    sendSuccess(res, {
      period: {
        from: dateFrom.toISOString(),
        to: dateTo.toISOString(),
      },
      total: totalCount,
      byCategory: categoryStats,
      byAction: actionStats,
    });
  } catch (error) {
    next(error);
  }
});

export const auditLogsController = router;
