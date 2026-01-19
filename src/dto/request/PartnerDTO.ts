import { z } from 'zod';
import { PARTNER_SCOPES } from '../../domain/entities/Partner';

// Register Partner DTO
export const RegisterPartnerSchema = z.object({
  companyName: z.string().min(1).max(255),
  companyWebsite: z.string().url(),
  companyDescription: z.string().min(10).max(2000),
  industry: z.string().min(1).max(100),
  country: z.string().min(2).max(100),
  contactName: z.string().min(1).max(255),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  technicalContactEmail: z.string().email(),
  intendedUse: z.string().min(10).max(2000),
  requestedScopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
});

export type RegisterPartnerDTO = z.infer<typeof RegisterPartnerSchema>;

// Update Partner DTO
export const UpdatePartnerSchema = z.object({
  companyName: z.string().min(1).max(255).optional(),
  companyWebsite: z.string().url().optional(),
  companyDescription: z.string().min(10).max(2000).optional(),
  industry: z.string().min(1).max(100).optional(),
  country: z.string().min(2).max(100).optional(),
  contactName: z.string().min(1).max(255).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional().nullable(),
  technicalContactEmail: z.string().email().optional(),
  webhookUrl: z.string().url().optional().nullable(),
  ipWhitelist: z.array(z.string()).optional(),
});

export type UpdatePartnerDTO = z.infer<typeof UpdatePartnerSchema>;

// Create API Key DTO
export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
  expiresAt: z.string().datetime().optional(),
});

export type CreateApiKeyDTO = z.infer<typeof CreateApiKeySchema>;

// Approve/Reject Partner DTO
export const ApprovePartnerSchema = z.object({
  scopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
  rateLimitPerMinute: z.number().min(1).max(10000).default(100),
  rateLimitPerDay: z.number().min(1).max(1000000).default(10000),
  monthlyQuota: z.number().min(1).max(100000000).default(100000),
});

export type ApprovePartnerDTO = z.infer<typeof ApprovePartnerSchema>;

export const RejectPartnerSchema = z.object({
  reason: z.string().min(10).max(1000),
});

export type RejectPartnerDTO = z.infer<typeof RejectPartnerSchema>;
