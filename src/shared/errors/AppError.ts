export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ValidationError extends AppError {
  public readonly details?: Record<string, string[]>;

  constructor(message: string = 'Validation failed', details?: Record<string, string[]>) {
    super('VALIDATION_ERROR', message, 400);
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super('CONFLICT', message, 409);
  }
}

/**
 * 422: the request is well formed, the situation is not.
 *
 * Distinct from ValidationError (400) on purpose. A 400 tells a client it sent
 * something wrong and should fix the request; a 422 tells it the request was
 * fine and the world refused -- retrying it unchanged may well succeed later.
 * A firmware update declined because the other half of an HA pair is mid-update
 * is the second kind, and a client that cannot tell them apart cannot decide
 * whether to offer a retry.
 *
 * `reasons` carries the machine-readable refusals alongside the message, so a
 * screen can render every one of them rather than a single sentence.
 */
export class UnprocessableError extends AppError {
  public readonly reasons?: Array<{ code: string; message: string }>;

  constructor(message: string, reasons?: Array<{ code: string; message: string }>) {
    super('UNPROCESSABLE', message, 422);
    this.reasons = reasons;
  }
}
