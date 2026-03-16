import { z } from 'zod';

export const CreateUserContactSchema = z.object({
  channel: z.string().min(1).max(50),
  value:   z.string().min(1).max(500),
  label:   z.string().max(100).optional(),
  active:  z.boolean().default(true),
});

export type CreateUserContactDTO = z.infer<typeof CreateUserContactSchema>;

export const UpdateUserContactSchema = z.object({
  value:  z.string().min(1).max(500).optional(),
  label:  z.string().max(100).optional(),
  active: z.boolean().optional(),
});

export type UpdateUserContactDTO = z.infer<typeof UpdateUserContactSchema>;
