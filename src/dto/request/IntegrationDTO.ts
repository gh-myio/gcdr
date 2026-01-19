import { z } from 'zod';
import { PACKAGE_CATEGORIES } from '../../domain/entities/IntegrationPackage';

// Auth Config Schema
const AuthConfigSchema = z.object({
  type: z.enum(['none', 'api_key', 'oauth2', 'basic', 'custom']),
  config: z.record(z.unknown()).optional(),
});

// Rate Limit Config Schema
const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().min(1).optional(),
  requestsPerDay: z.number().min(1).optional(),
  monthlyQuota: z.number().min(1).optional(),
});

// Capability Schema
const CapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  requiredScopes: z.array(z.string()).default([]),
});

// Endpoint Schema
const EndpointSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  description: z.string().max(500),
  requiredScopes: z.array(z.string()).default([]),
  rateLimit: RateLimitConfigSchema.optional(),
});

// Event Schema
const EventSchema = z.object({
  eventType: z.string().min(1),
  description: z.string().max(500),
  payloadSchema: z.record(z.unknown()).optional(),
});

// Pricing Schema
const PricingSchema = z.object({
  model: z.enum(['FREE', 'PER_REQUEST', 'MONTHLY', 'ANNUAL', 'CUSTOM']),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  includedRequests: z.number().min(0).optional(),
  overagePrice: z.number().min(0).optional(),
});

// Create Package DTO
export const CreatePackageSchema = z.object({
  name: z.string().min(3).max(100),
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(10).max(500),
  longDescription: z.string().max(5000).optional(),
  category: z.enum(PACKAGE_CATEGORIES),
  tags: z.array(z.string().max(50)).max(10).default([]),
  iconUrl: z.string().url().optional(),
  documentationUrl: z.string().url().optional(),
  type: z.enum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL']),
  scopes: z.array(z.string()).min(1),
  capabilities: z.array(CapabilitySchema).default([]),
  endpoints: z.array(EndpointSchema).default([]),
  events: z.array(EventSchema).default([]),
  auth: AuthConfigSchema.default({ type: 'none' }),
  rateLimits: RateLimitConfigSchema.default({}),
  pricing: PricingSchema.default({ model: 'FREE' }),
});

export type CreatePackageDTO = z.infer<typeof CreatePackageSchema>;

// Update Package DTO
export const UpdatePackageSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().min(10).max(500).optional(),
  longDescription: z.string().max(5000).optional(),
  category: z.enum(PACKAGE_CATEGORIES).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  iconUrl: z.string().url().optional().nullable(),
  documentationUrl: z.string().url().optional().nullable(),
  capabilities: z.array(CapabilitySchema).optional(),
  endpoints: z.array(EndpointSchema).optional(),
  events: z.array(EventSchema).optional(),
  auth: AuthConfigSchema.optional(),
  rateLimits: RateLimitConfigSchema.optional(),
  pricing: PricingSchema.optional(),
});

export type UpdatePackageDTO = z.infer<typeof UpdatePackageSchema>;

// Publish Version DTO
export const PublishVersionSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver format (e.g., 1.0.0)'),
  releaseNotes: z.string().min(10).max(2000),
  breaking: z.boolean().default(false),
});

export type PublishVersionDTO = z.infer<typeof PublishVersionSchema>;

// Subscribe to Package DTO
export const SubscribePackageSchema = z.object({
  packageId: z.string().uuid(),
  version: z.string().optional(), // If not provided, uses latest
  config: z.record(z.unknown()).optional(),
});

export type SubscribePackageDTO = z.infer<typeof SubscribePackageSchema>;

// Update Subscription DTO
export const UpdateSubscriptionSchema = z.object({
  version: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export type UpdateSubscriptionDTO = z.infer<typeof UpdateSubscriptionSchema>;

// Search/Filter Packages DTO
export const SearchPackagesSchema = z.object({
  query: z.string().optional(),
  category: z.enum(PACKAGE_CATEGORIES).optional(),
  type: z.enum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL']).optional(),
  status: z.enum(['PUBLISHED']).optional(), // Only published for public search
  pricing: z.enum(['FREE', 'PER_REQUEST', 'MONTHLY', 'ANNUAL', 'CUSTOM']).optional(),
  verified: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  sortBy: z.enum(['name', 'subscriberCount', 'publishedAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type SearchPackagesDTO = z.infer<typeof SearchPackagesSchema>;

// Review Package DTO (admin)
export const ReviewPackageSchema = z.object({
  approved: z.boolean(),
  reason: z.string().min(10).max(1000).optional(),
});

export type ReviewPackageDTO = z.infer<typeof ReviewPackageSchema>;
