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
