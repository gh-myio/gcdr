import { z } from 'zod';

/**
 * Available scopes for Customer API Keys
 */
export const ApiKeyScopeSchema = z.enum([
  'bundles:read',
  'devices:read',
  'rules:read',
  'assets:read',
  'groups:read',
  '*:read',
]);

/**
 * Schema for creating a new Customer API Key
 */
export const CreateCustomerApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),

  description: z
    .string()
    .max(500, 'Description must be at most 500 characters')
    .optional(),

  scopes: z
    .array(ApiKeyScopeSchema)
    .min(1, 'At least one scope is required')
    .default(['bundles:read']),

  expiresAt: z
    .string()
    .datetime()
    .optional()
    .nullable(),
});

export type CreateCustomerApiKeyDTO = z.infer<typeof CreateCustomerApiKeySchema>;

/**
 * Schema for updating a Customer API Key
 */
export const UpdateCustomerApiKeySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .optional(),

  description: z
    .string()
    .max(500)
    .optional(),

  scopes: z
    .array(ApiKeyScopeSchema)
    .min(1)
    .optional(),

  isActive: z
    .boolean()
    .optional(),
});

export type UpdateCustomerApiKeyDTO = z.infer<typeof UpdateCustomerApiKeySchema>;

/**
 * Schema for listing Customer API Keys
 */
export const ListCustomerApiKeysQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform(v => v === 'true')
    .optional(),
});

export type ListCustomerApiKeysQueryDTO = z.infer<typeof ListCustomerApiKeysQuerySchema>;
