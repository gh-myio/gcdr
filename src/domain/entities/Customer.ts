import { BaseEntity, CustomerType, EntityStatus } from '../../shared/types';

export interface CustomerSettings {
  timezone: string;
  locale: string;
  currency: string;
  inheritFromParent: boolean;
}

export interface CustomerTheme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  faviconUrl?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
}

export interface Customer extends BaseEntity {
  parentCustomerId: string | null;
  path: string;
  depth: number;

  // External integration
  externalId?: string;

  // Basic Info
  name: string;
  displayName: string;
  code: string;
  type: CustomerType;

  // Contact
  email?: string;
  phone?: string;
  address?: Address;

  // Configuration
  settings: CustomerSettings;
  theme?: CustomerTheme;
  metadata: Record<string, unknown>;
  config?: CustomerConfig;

  // Status
  status: EntityStatus;
  deletedAt?: string;
}

export interface CustomerBundleConfig {
  checkVersion?: boolean;  // default true — false = always return full bundle
}

export interface CustomerConfig {
  bundle?: CustomerBundleConfig;
}

// Single source of truth for auto-generated customer codes — the service uses it
// for the duplicate check and passes the result to the repository, so the value
// checked is always the value inserted (codes column is varchar(50)).
export function generateCustomerCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50)
    .replace(/^-|-$/g, '');
}

export function createDefaultCustomerSettings(): CustomerSettings {
  return {
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL',
    inheritFromParent: true,
  };
}
