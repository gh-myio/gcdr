import { z } from 'zod';

// ─── App ─────────────────────────────────────────────────────────────────────

export const CreatePublicSingleAppSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  fieldsSchema: z.record(z.unknown()).optional().default({}),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED']).optional().default('ACTIVE'),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const UpdatePublicSingleAppSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  fieldsSchema: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Responses ────────────────────────────────────────────────────────────────

const SubmittedBySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  company: z.string().min(1).max(255),
});

export const SubmitResponseSchema = z.object({
  submittedBy: SubmittedBySchema,
  formData: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const ReviseResponseSchema = z.object({
  submittedBy: SubmittedBySchema,
  formData: z.record(z.unknown()),
  changeNotes: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const UpdateResponseStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']),
});

export const ListResponsesParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  email: z.string().email().optional(),
});

export type CreatePublicSingleAppDTO = z.infer<typeof CreatePublicSingleAppSchema>;
export type UpdatePublicSingleAppDTO = z.infer<typeof UpdatePublicSingleAppSchema>;
export type SubmitResponseDTO = z.infer<typeof SubmitResponseSchema>;
export type ReviseResponseDTO = z.infer<typeof ReviseResponseSchema>;
export type UpdateResponseStatusDTO = z.infer<typeof UpdateResponseStatusSchema>;
export type ListResponsesParams = z.infer<typeof ListResponsesParamsSchema>;
