import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { AppError, ValidationError } from '../shared/errors/AppError';
import { ApiResponse } from '../shared/types';

/**
 * Global error handler middleware for Express
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

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

  // Custom AppError
  if (err instanceof AppError) {
    const response: ApiResponse = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
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
