import { z } from 'zod';

// =============================================================================
// Access Bundle DTOs (RFC-0013)
// =============================================================================

// Get Access Bundle Query Parameters
export const GetAccessBundleQuerySchema = z.object({
  scope: z.string().optional().default('*'),
  includeFeatures: z.coerce.boolean().optional().default(true),
  includeDomains: z.coerce.boolean().optional().default(true),
  includeFlat: z.coerce.boolean().optional().default(true),
  ttl: z.coerce.number().min(60).max(86400).optional().default(3600),
  useCache: z.coerce.boolean().optional().default(true),
});

export type GetAccessBundleQuery = z.infer<typeof GetAccessBundleQuerySchema>;

// Refresh Bundle DTO
export const RefreshBundleSchema = z.object({
  reason: z.string().max(255).optional(),
});

export type RefreshBundleDTO = z.infer<typeof RefreshBundleSchema>;

// Invalidate Bundle DTO
export const InvalidateBundleSchema = z.object({
  reason: z.string().max(255).optional(),
  scope: z.string().optional(),
});

export type InvalidateBundleDTO = z.infer<typeof InvalidateBundleSchema>;

// =============================================================================
// Domain Permission DTOs
// =============================================================================

// Create Domain Permission DTO
export const CreateDomainPermissionSchema = z.object({
  domain: z.string().min(2).max(50).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Domain must start with a letter and contain only lowercase letters, numbers, and underscores',
  }),
  equipment: z.string().min(2).max(50).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Equipment must start with a letter and contain only lowercase letters, numbers, and underscores',
  }),
  location: z.string().min(2).max(50).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Location must start with a letter and contain only lowercase letters, numbers, and underscores',
  }),
  action: z.string().min(2).max(50).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'Action must start with a letter and contain only lowercase letters, numbers, and underscores',
  }),
  displayName: z.string().max(255).optional(),
  description: z.string().max(1000).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('low'),
});

export type CreateDomainPermissionDTO = z.infer<typeof CreateDomainPermissionSchema>;

// Update Domain Permission DTO
export const UpdateDomainPermissionSchema = z.object({
  displayName: z.string().max(255).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateDomainPermissionDTO = z.infer<typeof UpdateDomainPermissionSchema>;

// List Domain Permissions Query
export const ListDomainPermissionsQuerySchema = z.object({
  domain: z.string().optional(),
  equipment: z.string().optional(),
  location: z.string().optional(),
  action: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(500).optional().default(100),
  offset: z.coerce.number().min(0).optional().default(0),
});

export type ListDomainPermissionsQuery = z.infer<typeof ListDomainPermissionsQuerySchema>;

// Bulk Create Domain Permissions DTO
export const BulkCreateDomainPermissionsSchema = z.object({
  permissions: z.array(CreateDomainPermissionSchema).min(1).max(100),
});

export type BulkCreateDomainPermissionsDTO = z.infer<typeof BulkCreateDomainPermissionsSchema>;

// =============================================================================
// Check Permission DTO
// =============================================================================

export const CheckDomainPermissionSchema = z.object({
  domain: z.string(),
  equipment: z.string(),
  location: z.string(),
  action: z.string(),
});

export type CheckDomainPermissionDTO = z.infer<typeof CheckDomainPermissionSchema>;

export const CheckMultipleDomainPermissionsSchema = z.object({
  permissions: z.array(CheckDomainPermissionSchema).min(1).max(50),
});

export type CheckMultipleDomainPermissionsDTO = z.infer<typeof CheckMultipleDomainPermissionsSchema>;
