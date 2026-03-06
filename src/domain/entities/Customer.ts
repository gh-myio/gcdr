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
  // Token used by gateways/centrals to authenticate against the GCDR platform
  gatewayToken?: string;
}

export function createDefaultCustomerSettings(): CustomerSettings {
  return {
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL',
    inheritFromParent: true,
  };
}
