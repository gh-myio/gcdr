import { z } from 'zod';

// RFC-0032 — qrc_customer_settings (opt-in QR-enabled extension on customers).

export const EnableQrcCustomerSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  qrcMetadata:      z.record(z.unknown()).optional(),
});
export type EnableQrcCustomerDTO = z.infer<typeof EnableQrcCustomerSchema>;

export const UpdateQrcCustomerSettingsSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  qrcMetadata:      z.record(z.unknown()).optional(),
});
export type UpdateQrcCustomerSettingsDTO = z.infer<typeof UpdateQrcCustomerSettingsSchema>;
