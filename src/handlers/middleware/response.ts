import { APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse } from '../../shared/types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
  'Content-Type': 'application/json',
};

export function success<T>(data: T, statusCode: number = 200): APIGatewayProxyResult {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(response),
  };
}

export function error(
  message: string,
  code: string,
  statusCode: number = 500,
  details?: Record<string, string[]>
): APIGatewayProxyResult {
  const response: ApiResponse = {
    success: false,
    error: {
      message,
      code,
      details,
    },
    meta: {
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(response),
  };
}

export function ok<T>(data: T): APIGatewayProxyResult {
  return success(data, 200);
}

export function created<T>(data: T): APIGatewayProxyResult {
  return success(data, 201);
}

export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}

export function unauthorized(message: string = 'Unauthorized'): APIGatewayProxyResult {
  return error(message, 'UNAUTHORIZED', 401);
}

export function forbidden(message: string = 'Forbidden'): APIGatewayProxyResult {
  return error(message, 'FORBIDDEN', 403);
}

export function notFound(message: string = 'Not found'): APIGatewayProxyResult {
  return error(message, 'NOT_FOUND', 404);
}
