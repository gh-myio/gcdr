// =============================================================================
// RFC-0009: Audit Logging Middleware
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import {
  EventType,
  EventCategory,
  ActorType,
  ActionType,
  AuditLevel,
  CreateAuditLogInput,
} from '../shared/types/audit.types';
import { sanitizePII } from '../shared/utils/pii-sanitizer';
import {
  AUDIT_PAYLOAD_LIMITS,
  truncateString,
  truncateMetadata,
  inferEventCategory,
  inferActionType,
  inferAuditLevel,
  inferEntityType,
  shouldLogEvent,
} from '../shared/config/audit.config';
import { JWTUser } from './context';

// =============================================================================
// Types
// =============================================================================

// Extended request with audit-specific properties
interface AuditRequest extends Request {
  tenantId?: string;
  apiKey?: {
    id: string;
    customerId: string;
  };
  requestId?: string;
  startTime?: number;
  auditPreviousData?: Record<string, unknown>;
}

export interface LogEventOptions {
  /**
   * The type of event being logged
   */
  eventType: EventType;

  /**
   * Optional category override (will be inferred if not provided)
   */
  eventCategory?: EventCategory;

  /**
   * Optional audit level override (will be inferred if not provided)
   */
  auditLevel?: AuditLevel;

  /**
   * Optional action override (will be inferred if not provided)
   */
  action?: ActionType;

  /**
   * Description of the event (can be static string or function)
   */
  description?: string | ((req: Request, res: Response) => string);

  /**
   * Get entity type (defaults to inference from eventType)
   */
  getEntityType?: (req: Request) => string;

  /**
   * Get entity ID from request/response
   */
  getEntityId?: (req: Request, res: Response) => string | null;

  /**
   * Get customer ID from request/response
   */
  getCustomerId?: (req: Request, res: Response) => string | null;

  /**
   * Get additional metadata
   */
  getMetadata?: (req: Request, res: Response) => Record<string, unknown>;

  /**
   * Get previous value (for UPDATE operations)
   */
  getPreviousValue?: (req: Request, res: Response) => Record<string, unknown> | null;

  /**
   * Get new value (for CREATE/UPDATE operations)
   */
  getNewValue?: (req: Request, res: Response) => Record<string, unknown> | null;

  /**
   * Get external link (for cross-reference)
   */
  getExternalLink?: (req: Request) => string | null;

  /**
   * Whether to log on error responses (default: true)
   */
  logOnError?: boolean;

  /**
   * Whether to log on success responses (default: true)
   */
  logOnSuccess?: boolean;
}

// =============================================================================
// Audit Log Writer (placeholder - will use repository)
// =============================================================================

type AuditLogWriter = (log: CreateAuditLogInput) => Promise<void>;

let auditLogWriter: AuditLogWriter = async (log) => {
  // Default: just log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('[AUDIT]', JSON.stringify(log, null, 2));
  }
};

/**
 * Set the audit log writer function (called from repository initialization)
 */
export function setAuditLogWriter(writer: AuditLogWriter): void {
  auditLogWriter = writer;
}

// =============================================================================
// Helper Functions
// =============================================================================

function determineActorType(req: Request): ActorType {
  const auditReq = req as AuditRequest;
  if (auditReq.apiKey) return ActorType.API_KEY;
  if (req.user?.type === 'SERVICE_ACCOUNT') return ActorType.SERVICE_ACCOUNT;
  if (req.user) return ActorType.USER;
  return ActorType.ANONYMOUS;
}

function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (obj.error && typeof obj.error === 'object') {
      const error = obj.error as Record<string, unknown>;
      return (error.message as string) || null;
    }
    return (obj.message as string) || (obj.error as string) || null;
  }
  return null;
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Express middleware for logging audit events
 *
 * @example
 * router.post('/', authMiddleware, logEvent({
 *   eventType: EventType.CUSTOMER_CREATED,
 *   description: (req) => `Customer "${req.body.name}" created`,
 *   getEntityId: (req, res) => res.locals.createdId,
 * }), createHandler);
 */
export function logEvent(options: LogEventOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auditReq = req as AuditRequest;
    const startTime = Date.now();
    auditReq.startTime = startTime;

    // Ensure request ID exists (use context if available, otherwise generate)
    const requestId = req.context?.requestId || (req.headers['x-request-id'] as string) || randomUUID();
    auditReq.requestId = requestId;

    // Capture request context
    const context = {
      requestId,
      ipAddress: req.ip || req.socket.remoteAddress || '',
      userAgent: truncateString(req.headers['user-agent'], AUDIT_PAYLOAD_LIMITS.userAgent.maxLength),
      httpMethod: req.method,
      httpPath: truncateString(req.originalUrl, AUDIT_PAYLOAD_LIMITS.httpPath.maxLength),
      tenantId: req.context?.tenantId || auditReq.tenantId,
      userId: req.user?.sub,
      userEmail: req.user?.email,
      actorType: determineActorType(req),
    };

    // Propagate requestId in response header
    res.setHeader('X-Request-Id', requestId);

    // Store original response body
    let responseBody: unknown;

    // Intercept response methods to capture body
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function(body: unknown) {
      responseBody = body;
      return originalJson(body);
    };

    res.send = function(body: unknown) {
      if (!responseBody) {
        responseBody = body;
      }
      return originalSend(body);
    };

    // Hook to execute after response is finished
    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const isError = statusCode >= 400;

      // Check if we should log this event
      if (isError && options.logOnError === false) return;
      if (!isError && options.logOnSuccess === false) return;

      // Check audit level
      const eventLevel = options.auditLevel ?? inferAuditLevel(options.eventType);
      if (!shouldLogEvent(eventLevel)) return;

      // Skip if no tenant (can't log without tenant context)
      if (!context.tenantId) {
        console.warn('[AUDIT] Skipping log - no tenantId:', options.eventType);
        return;
      }

      try {
        // Build description
        const description = typeof options.description === 'function'
          ? options.description(req, res)
          : options.description;

        // Get values for diff
        const oldValues = options.getPreviousValue?.(req, res);
        const newValues = options.getNewValue?.(req, res);

        // Build audit log entry
        const auditLog: CreateAuditLogInput = {
          tenantId: context.tenantId,
          eventType: options.eventType,
          eventCategory: options.eventCategory ?? inferEventCategory(options.eventType),
          auditLevel: eventLevel,
          description: truncateString(description, AUDIT_PAYLOAD_LIMITS.description.maxLength),
          action: options.action ?? inferActionType(options.eventType),
          entityType: options.getEntityType?.(req) ?? inferEntityType(options.eventType),
          entityId: options.getEntityId?.(req, res) ?? undefined,
          customerId: options.getCustomerId?.(req, res) ?? undefined,
          userId: context.userId,
          userEmail: context.userEmail,
          actorType: context.actorType,
          oldValues: oldValues ? sanitizePII(oldValues) : undefined,
          newValues: newValues ? sanitizePII(newValues) : undefined,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          httpMethod: context.httpMethod,
          httpPath: context.httpPath,
          statusCode,
          errorMessage: isError
            ? truncateString(extractErrorMessage(responseBody) || undefined, AUDIT_PAYLOAD_LIMITS.errorMessage.maxLength)
            : undefined,
          durationMs: duration,
          metadata: truncateMetadata(sanitizePII(options.getMetadata?.(req, res) ?? {})),
          externalLink: truncateString(
            options.getExternalLink?.(req) || undefined,
            AUDIT_PAYLOAD_LIMITS.externalLink.maxLength
          ),
        };

        // Write audit log asynchronously - fire and forget with error logging
        auditLogWriter(auditLog).catch(error => {
          console.error('[AUDIT] Failed to write audit log:', {
            eventType: options.eventType,
            requestId: context.requestId,
            error: error.message,
          });
        });
      } catch (error) {
        console.error('[AUDIT] Error preparing audit log:', error);
      }
    });

    next();
  };
}

/**
 * Log an audit event programmatically (not via middleware)
 */
export async function logAuditEvent(
  tenantId: string,
  eventType: EventType,
  options: {
    entityType?: string;
    entityId?: string;
    customerId?: string;
    userId?: string;
    userEmail?: string;
    actorType?: ActorType;
    description?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    requestId?: string;
  } = {}
): Promise<void> {
  const auditLog: CreateAuditLogInput = {
    tenantId,
    eventType,
    eventCategory: inferEventCategory(eventType),
    auditLevel: inferAuditLevel(eventType),
    action: inferActionType(eventType),
    entityType: options.entityType ?? inferEntityType(eventType),
    entityId: options.entityId,
    customerId: options.customerId,
    userId: options.userId,
    userEmail: options.userEmail,
    actorType: options.actorType ?? ActorType.SYSTEM,
    description: truncateString(options.description, AUDIT_PAYLOAD_LIMITS.description.maxLength),
    oldValues: options.oldValues ? sanitizePII(options.oldValues) : undefined,
    newValues: options.newValues ? sanitizePII(options.newValues) : undefined,
    metadata: truncateMetadata(sanitizePII(options.metadata ?? {})),
    requestId: options.requestId,
  };

  await auditLogWriter(auditLog);
}
