import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { AppError, ValidationError } from '../shared/errors/AppError';
import { ApiResponse } from '../shared/types';

interface PostgresErrorShape {
  code: string;
  detail?: string;
  constraint_name?: string;
  column_name?: string;
  table_name?: string;
}

// Drizzle wraps postgres-js errors and re-throws with the original on `cause`.
// Walk the chain so the handler can read `code`, `detail`, `constraint_name`
// without leaking the wrapper's "Failed query: insert into ..." to the client.
function extractPostgresError(err: unknown): PostgresErrorShape | null {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return current as PostgresErrorShape;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

// Map a known PostgreSQL constraint error to an HTTP response. Extracted from
// errorHandler to keep that function's cognitive complexity in bounds.
/**
 * Maps a Postgres constraint-violation error to its HTTP response and sends
 * it. Returns true if it handled the error, false if the code isn't one of
 * the mapped ones (caller falls through to the generic 500 path). Split out
 * of errorHandler() purely to keep its cognitive complexity under the lint
 * threshold — no behavior change from the inline version.
 */
function sendPostgresErrorResponse(
  pgError: PostgresErrorShape,
  res: Response,
  requestId: string,
  timestamp: string,
): boolean {
  if (pgError.code === '23505') {
    // unique_violation
    const response: ApiResponse = {
      success: false,
      error: {
        message: pgError.detail || 'A resource with the same unique value already exists',
        code: 'CONFLICT',
        ...(pgError.constraint_name && { details: { constraint: pgError.constraint_name } }),
      },
      meta: { requestId, timestamp },
    };
    res.status(409).json(response);
    return true;
  }

  if (pgError.code === '23503') {
    // foreign_key_violation
    const response: ApiResponse = {
      success: false,
      error: {
        message: pgError.detail || 'Referenced resource does not exist or is still in use',
        code: 'FK_VIOLATION',
        ...(pgError.constraint_name && { details: { constraint: pgError.constraint_name } }),
      },
      meta: { requestId, timestamp },
    };
    res.status(409).json(response);
    return true;
  }

  if (pgError.code === '23502') {
    // not_null_violation
    const response: ApiResponse = {
      success: false,
      error: {
        message: pgError.column_name
          ? `Required column "${pgError.column_name}" is missing`
          : 'A required field is missing',
        code: 'VALIDATION_ERROR',
        ...(pgError.column_name && { details: { column: pgError.column_name } }),
      },
      meta: { requestId, timestamp },
    };
    res.status(400).json(response);
    return true;
  }

  return false;
}

/**
 * Global error handler middleware for Express
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Only log full stack trace for unexpected errors (5xx / non-operational)
  // Operational errors (4xx) are expected and get a brief log line
  if (err instanceof AppError && err.isOperational) {
    const requestId = req.context?.requestId || '-';
    const userId    = req.context?.userId    || '-';
    const ip        = req.context?.ip        || req.ip || '-';
    // err.message/req.path can carry attacker-controlled content; strip CR/LF
    // from each SOURCE value before interpolation (not the composed string
    // afterward) so static analysis can trace the sanitizer boundary and so
    // it can't forge extra log lines (log injection).
    const safeMessage = err.message.replace(/[\r\n]+/g, ' ');
    const safePath = req.path.replace(/[\r\n]+/g, ' ');
    const logLine = `[${err.statusCode}] ${err.code}: ${safeMessage} | ${req.method} ${safePath} | ip=${ip} | userId=${userId} | requestId=${requestId}`;
    console.warn(logLine);
  } else {
    console.error('Error:', err);
  }

  const requestId = req.context?.requestId || uuidv4();
  const timestamp = new Date().toISOString();

  // Zod validation errors
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const path = e.path.join('.');
      if (!details[path]) {
        details[path] = [];
      }
      details[path].push(e.message);
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details,
      },
      meta: { requestId, timestamp },
    };

    res.status(400).json(response);
    return;
  }

  // Custom ValidationError with details
  if (err instanceof ValidationError) {
    const response: ApiResponse = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
        details: err.details,
      },
      meta: { requestId, timestamp },
    };

    res.status(err.statusCode).json(response);
    return;
  }

  // Custom AppError. Some subclasses (e.g. RFC-0061 InventoryError) carry a
  // structured `details` payload with machine-readable params (Appendix D) —
  // surface it when present so the frontend can render from code + params.
  if (err instanceof AppError) {
    const details = (err as { details?: Record<string, unknown> }).details;
    const response: ApiResponse = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
        ...(details ? { details } : {}),
      },
      meta: { requestId, timestamp },
    };

    res.status(err.statusCode).json(response);
    return;
  }

  // DynamoDB conditional check failed (optimistic locking)
  if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Resource was modified by another request. Please retry.',
        code: 'CONFLICT',
      },
      meta: { requestId, timestamp },
    };

    res.status(409).json(response);
    return;
  }

  // PostgreSQL constraint errors — unwrap Drizzle's wrapper to read the
  // underlying postgres-js error (Drizzle exposes it on `cause`). Without
  // this, the wrapper's message is "Failed query: insert into ..." which
  // both leaks SQL/params to the client and is reported as 500.
  const pgError = extractPostgresError(err);
  if (pgError && sendPostgresErrorResponse(pgError, res, requestId, timestamp)) {
    return;
  }

  // Unknown errors
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  const response: ApiResponse = {
    success: false,
    error: {
      message,
      code: 'INTERNAL_ERROR',
    },
    meta: { requestId, timestamp },
  };

  res.status(500).json(response);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = req.context?.requestId || uuidv4();

  const response: ApiResponse = {
    success: false,
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(404).json(response);
}
