import { APIGatewayProxyResult } from 'aws-lambda';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../../shared/errors/AppError';
import { error } from './response';

export function handleError(err: unknown): APIGatewayProxyResult {
  console.error('Error:', err);

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
    return error('Validation failed', 'VALIDATION_ERROR', 400, details);
  }

  // Custom ValidationError with details
  if (err instanceof ValidationError) {
    return error(err.message, err.code, err.statusCode, err.details);
  }

  // Custom AppError
  if (err instanceof AppError) {
    return error(err.message, err.code, err.statusCode);
  }

  // DynamoDB conditional check failed (optimistic locking)
  if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
    return error(
      'Resource was modified by another request. Please retry.',
      'CONFLICT',
      409
    );
  }

  // Unknown errors
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  return error(message, 'INTERNAL_ERROR', 500);
}
