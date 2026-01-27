// Base entity interface
export interface BaseEntity {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  version: number;
}

// Pagination
export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    total?: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

// API Response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: Record<string, string[]>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

// Status types
export type EntityStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';

// Customer types
export type CustomerType = 'HOLDING' | 'COMPANY' | 'BRANCH' | 'FRANCHISE';

// Partner types
export type PartnerStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

// Authorization types
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// Event types for logging
export interface EventLog {
  eventType: string;
  description: string;
  timestamp: string;
  correlationId: string;
  actor: {
    userId: string | null;
    tenantId: string | null;
    ip: string;
  };
  request: {
    method: string;
    path: string;
    pathParameters: Record<string, string> | null;
    queryParameters: Record<string, string> | null;
  };
  payload?: Record<string, unknown>;
}

// Audit types (RFC-0009)
export * from './audit.types';
