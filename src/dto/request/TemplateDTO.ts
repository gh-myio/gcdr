import { z } from 'zod';

const TEMPLATE_TYPES = ['EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME', 'RELEASE_NOTE'] as const;
const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

export const CreateTemplateSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens only'),
  name: z.string().min(1).max(500),
  type: z.enum(TEMPLATE_TYPES),
  status: z.enum(TEMPLATE_STATUSES).default('DRAFT'),
  htmlContent: z.string().min(1),
  description: z.string().max(1000).optional(),
});

export type CreateTemplateDTO = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  htmlContent: z.string().min(1).optional(),
  description: z.string().max(1000).optional().nullable(),
});

export type UpdateTemplateDTO = z.infer<typeof UpdateTemplateSchema>;

export const PreviewTemplateSchema = z.object({
  data: z.record(z.unknown()),
});

export type PreviewTemplateDTO = z.infer<typeof PreviewTemplateSchema>;

export const ListTemplatesQuerySchema = z.object({
  type: z.enum(TEMPLATE_TYPES).optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
});

export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
