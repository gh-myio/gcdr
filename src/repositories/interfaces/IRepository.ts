import { PaginatedResult, PaginationParams } from '../../shared/types';

export interface IRepository<T, CreateDTO, UpdateDTO> {
  create(tenantId: string, data: CreateDTO, createdBy: string): Promise<T>;
  getById(tenantId: string, id: string): Promise<T | null>;
  update(tenantId: string, id: string, data: UpdateDTO, updatedBy: string): Promise<T>;
  delete(tenantId: string, id: string): Promise<void>;
  list(tenantId: string, params?: PaginationParams): Promise<PaginatedResult<T>>;
}

export interface QueryOptions {
  indexName?: string;
  limit?: number;
  cursor?: string;
  scanIndexForward?: boolean;
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}
