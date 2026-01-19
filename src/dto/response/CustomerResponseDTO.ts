import { Customer, CustomerSettings, CustomerTheme, Address } from '../../domain/entities/Customer';
import { CustomerType, EntityStatus } from '../../shared/types';

export interface CustomerResponseDTO {
  id: string;
  tenantId: string;
  parentCustomerId: string | null;
  path: string;
  depth: number;
  name: string;
  displayName: string;
  code: string;
  type: CustomerType;
  email?: string;
  phone?: string;
  address?: Address;
  settings: CustomerSettings;
  theme?: CustomerTheme;
  metadata: Record<string, unknown>;
  status: EntityStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTreeNodeDTO {
  id: string;
  name: string;
  displayName: string;
  type: CustomerType;
  status: EntityStatus;
  childrenCount: number;
  children: CustomerTreeNodeDTO[];
}

export interface CustomerWithCountsDTO extends CustomerResponseDTO {
  childrenCount: number;
  assetsCount?: number;
}

export function toCustomerResponseDTO(customer: Customer): CustomerResponseDTO {
  return {
    id: customer.id,
    tenantId: customer.tenantId,
    parentCustomerId: customer.parentCustomerId,
    path: customer.path,
    depth: customer.depth,
    name: customer.name,
    displayName: customer.displayName,
    code: customer.code,
    type: customer.type,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    settings: customer.settings,
    theme: customer.theme,
    metadata: customer.metadata,
    status: customer.status,
    version: customer.version,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function toCustomerResponseDTOList(customers: Customer[]): CustomerResponseDTO[] {
  return customers.map(toCustomerResponseDTO);
}
