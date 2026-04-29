import { z } from 'zod';

// RFC-0032 — Customer-level observations (separate from installation obs).

export const CreateCustomerObservationSchema = z.object({
  observation: z.string().min(1).max(5000),
  fileAssetId: z.string().uuid().nullable().optional(),
});
export type CreateCustomerObservationDTO = z.infer<typeof CreateCustomerObservationSchema>;
