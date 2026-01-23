import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse } from '../shared/types';

/**
 * Send success response
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  requestId?: string
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      requestId: requestId || uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };

  res.status(statusCode).json(response);
}

/**
 * Send created response (201)
 */
export function sendCreated<T>(res: Response, data: T, requestId?: string): void {
  sendSuccess(res, data, 201, requestId);
}

/**
 * Send no content response (204)
 */
export function sendNoContent(res: Response): void {
  res.status(204).send();
}

/**
 * Send paginated response
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  pagination: {
    total?: number;
    hasMore: boolean;
    nextCursor?: string;
  },
  requestId?: string
): void {
  const response: ApiResponse<{ items: T[]; pagination: typeof pagination }> = {
    success: true,
    data: {
      items,
      pagination,
    },
    meta: {
      requestId: requestId || uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };

  res.status(200).json(response);
}
