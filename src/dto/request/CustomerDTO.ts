import { z } from 'zod';
import { CustomerType } from '../../shared/types';

// Create Customer DTO
export const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  type: z.enum(['HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE'] as const),
  parentCustomerId: z.string().uuid().optional().nullable(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z
    .object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
      postalCode: z.string(),
      coordinates: z
        .object({
          lat: z.number(),
          lng: z.number(),
        })
        .optional(),
    })
    .optional(),
  settings: z
    .object({
      timezone: z.string().default('America/Sao_Paulo'),
      locale: z.string().default('pt-BR'),
      currency: z.string().default('BRL'),
      inheritFromParent: z.boolean().default(true),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateCustomerDTO = z.infer<typeof CreateCustomerSchema>;

// Update Customer DTO
export const UpdateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  type: z.enum(['HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE'] as const).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z
    .object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
      postalCode: z.string(),
      coordinates: z
        .object({
          lat: z.number(),
          lng: z.number(),
        })
        .optional(),
    })
    .optional()
    .nullable(),
  settings: z
    .object({
      timezone: z.string().optional(),
      locale: z.string().optional(),
      currency: z.string().optional(),
      inheritFromParent: z.boolean().optional(),
    })
    .optional(),
  theme: z
    .object({
      primaryColor: z.string(),
      secondaryColor: z.string(),
      logoUrl: z.string().url().optional(),
      faviconUrl: z.string().url().optional(),
    })
    .optional()
    .nullable(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE'] as const).optional(),
});

export type UpdateCustomerDTO = z.infer<typeof UpdateCustomerSchema>;

// Move Customer DTO
export const MoveCustomerSchema = z.object({
  newParentCustomerId: z.string().uuid().nullable(),
});

export type MoveCustomerDTO = z.infer<typeof MoveCustomerSchema>;

// Query params
export interface ListCustomersParams {
  limit?: number;
  cursor?: string;
  type?: CustomerType;
  status?: 'ACTIVE' | 'INACTIVE';
  parentCustomerId?: string | null;
}

export interface GetDescendantsParams {
  maxDepth?: number;
  includeAssets?: boolean;
}
