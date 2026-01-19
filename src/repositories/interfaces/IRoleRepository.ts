import { Role } from '../../domain/entities/Role';
import { CreateRoleDTO, UpdateRoleDTO } from '../../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../../shared/types';
import { IRepository } from './IRepository';

export interface ListRolesParams {
  limit?: number;
  cursor?: string;
  riskLevel?: string;
  isSystem?: boolean;
}

export interface IRoleRepository extends IRepository<Role, CreateRoleDTO, UpdateRoleDTO> {
  getByKey(tenantId: string, key: string): Promise<Role | null>;
  listWithFilters(tenantId: string, params: ListRolesParams): Promise<PaginatedResult<Role>>;
  getByKeys(tenantId: string, keys: string[]): Promise<Role[]>;
}
