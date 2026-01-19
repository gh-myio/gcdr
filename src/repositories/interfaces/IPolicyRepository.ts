import { Policy } from '../../domain/entities/Policy';
import { CreatePolicyDTO } from '../../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../../shared/types';
import { IRepository } from './IRepository';

export interface UpdatePolicyDTO {
  displayName?: string;
  description?: string;
  allow?: string[];
  deny?: string[];
  conditions?: {
    requiresMFA?: boolean;
    onlyBusinessHours?: boolean;
    allowedDeviceTypes?: string[];
    ipAllowlist?: string[];
    maxSessionDuration?: number;
  };
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ListPoliciesParams {
  limit?: number;
  cursor?: string;
  riskLevel?: string;
  isSystem?: boolean;
}

export interface IPolicyRepository extends IRepository<Policy, CreatePolicyDTO, UpdatePolicyDTO> {
  getByKey(tenantId: string, key: string): Promise<Policy | null>;
  listWithFilters(tenantId: string, params: ListPoliciesParams): Promise<PaginatedResult<Policy>>;
  getByKeys(tenantId: string, keys: string[]): Promise<Policy[]>;
}
