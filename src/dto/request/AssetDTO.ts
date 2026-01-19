import { z } from 'zod';
import { PaginationParams } from '../../shared/types';

// Asset Location Schema
const AssetLocationSchema = z.object({
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  floor: z.string().max(50).optional(),
  room: z.string().max(50).optional(),
  zone: z.string().max(50).optional(),
}).optional();

// Asset Specs Schema
const AssetSpecsSchema = z.object({
  area: z.number().positive().optional(),
  capacity: z.number().int().positive().optional(),
  powerRating: z.number().positive().optional(),
  voltage: z.number().positive().optional(),
  manufacturer: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  serialNumber: z.string().max(100).optional(),
  installationDate: z.string().datetime().optional(),
  warrantyExpiration: z.string().datetime().optional(),
}).optional();

// Create Asset Schema
export const CreateAssetSchema = z.object({
  customerId: z.string().uuid(),
  parentAssetId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
  code: z.string().max(50).optional(),
  type: z.enum(['BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT', 'ZONE', 'OTHER']),
  description: z.string().max(1000).optional(),
  location: AssetLocationSchema,
  specs: AssetSpecsSchema,
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateAssetDTO = z.infer<typeof CreateAssetSchema>;

// Update Asset Schema
export const UpdateAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().max(255).optional(),
  code: z.string().max(50).optional(),
  type: z.enum(['BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT', 'ZONE', 'OTHER']).optional(),
  description: z.string().max(1000).optional(),
  location: AssetLocationSchema,
  specs: AssetSpecsSchema,
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type UpdateAssetDTO = z.infer<typeof UpdateAssetSchema>;

// Move Asset Schema
export const MoveAssetSchema = z.object({
  newParentAssetId: z.string().uuid().nullable(),
  newCustomerId: z.string().uuid().optional(), // Optional: move to different customer
});

export type MoveAssetDTO = z.infer<typeof MoveAssetSchema>;

// List Assets Params
export interface ListAssetsParams extends PaginationParams {
  customerId?: string;
  parentAssetId?: string | null;
  type?: string;
  status?: string;
  includeDescendants?: boolean;
}

// Get Descendants Params
export interface GetAssetDescendantsParams {
  maxDepth?: number;
}
