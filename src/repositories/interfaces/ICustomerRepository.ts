import { Customer } from '../../domain/entities/Customer';
import { CreateCustomerDTO, UpdateCustomerDTO, ListCustomersParams } from '../../dto/request/CustomerDTO';
import { PaginatedResult } from '../../shared/types';
import { IRepository } from './IRepository';

export interface CustomerTreeNode extends Customer {
  children: CustomerTreeNode[];
}

export interface ForceDeleteOptions {
  keepApiKeys?: boolean;
  keepCentrals?: boolean;
}

export interface ForceDeleteResult {
  deletedCustomers: number;
  summary: {
    users: number;
    assets: number;
    devices: number;
    rules: number;
    centrals: number;
    groups: number;
    lookAndFeels: number;
    customerApiKeys: number;
    maintenanceGroups: number;
    alarmBundleVersions: number;
  };
}

export interface ICustomerRepository extends IRepository<Customer, CreateCustomerDTO, UpdateCustomerDTO> {
  getByCode(tenantId: string, code: string): Promise<Customer | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<Customer | null>;
  getChildren(tenantId: string, parentCustomerId: string | null): Promise<Customer[]>;
  getDescendants(tenantId: string, customerId: string, maxDepth?: number): Promise<Customer[]>;
  getAncestors(tenantId: string, customerId: string): Promise<Customer[]>;
  getTree(tenantId: string, rootCustomerId?: string): Promise<CustomerTreeNode[]>;
  move(tenantId: string, customerId: string, newParentId: string | null, updatedBy: string): Promise<Customer>;
  listWithFilters(tenantId: string, params: ListCustomersParams): Promise<PaginatedResult<Customer>>;
  updatePath(tenantId: string, customerId: string, newPath: string, newDepth: number): Promise<void>;
  forceDelete(tenantId: string, customerId: string, options?: ForceDeleteOptions): Promise<ForceDeleteResult>;
}
