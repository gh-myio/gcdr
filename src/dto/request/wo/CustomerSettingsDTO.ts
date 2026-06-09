import { z } from 'zod';

// RFC-0032 — wo_customer_settings (opt-in QR-enabled extension on customers).

export const EnableWoCustomerSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  woMetadata:      z.record(z.unknown()).optional(),
});
export type EnableWoCustomerDTO = z.infer<typeof EnableWoCustomerSchema>;

export const UpdateWoCustomerSettingsSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  woMetadata:      z.record(z.unknown()).optional(),
});
export type UpdateWoCustomerSettingsDTO = z.infer<typeof UpdateWoCustomerSettingsSchema>;
