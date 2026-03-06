import { z } from 'zod';

export const UpdateTemplateTypeSchema = z.object({
  label:       z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  icon:        z.string().max(50).optional().nullable(),
  sortOrder:   z.number().int().min(0).optional(),
  active:      z.boolean().optional(),
});

export type UpdateTemplateTypeDTO = z.infer<typeof UpdateTemplateTypeSchema>;
