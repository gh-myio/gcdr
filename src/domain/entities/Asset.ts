import { BaseEntity, EntityStatus } from '../../shared/types';

export type AssetType = 'BUILDING' | 'FLOOR' | 'ROOM' | 'EQUIPMENT' | 'ZONE' | 'OTHER';

export interface AssetLocation {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  floor?: string;
  room?: string;
  zone?: string;
}

export interface AssetSpecs {
  area?: number;           // square meters
  capacity?: number;       // people or units
  powerRating?: number;    // kW
  voltage?: number;        // V
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  warrantyExpiration?: string;
}

export interface Asset extends BaseEntity {
  customerId: string;
  parentAssetId: string | null;
  path: string;
  depth: number;

  // Basic Info
  name: string;
  displayName: string;
  code: string;
  type: AssetType;
  description?: string;

  // Location
  location?: AssetLocation;

  // Specifications
  specs?: AssetSpecs;

  // Configuration
  tags: string[];
  metadata: Record<string, unknown>;

  // Status
  status: EntityStatus;
  deletedAt?: string;
}

export function createDefaultAssetLocation(): AssetLocation {
  return {};
}

export function createDefaultAssetSpecs(): AssetSpecs {
  return {};
}
