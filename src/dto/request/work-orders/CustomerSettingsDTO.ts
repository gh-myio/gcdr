import { z } from 'zod';

// RFC-0037 §6 — work_orders_customer_settings (opt-in WO-enabled extension on
// customers). Carried over from the old wo_customer_settings (unchanged shape).

export const EnableWoCustomerSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  woMetadata:       z.record(z.unknown()).optional(),
});
export type EnableWoCustomerDTO = z.infer<typeof EnableWoCustomerSchema>;

export const UpdateWoCustomerSettingsSchema = z.object({
  defaultCentralId: z.string().uuid().nullable().optional(),
  viewerPassword:   z.string().min(4).max(128).nullable().optional(),
  woMetadata:       z.record(z.unknown()).optional(),
});
export type UpdateWoCustomerSettingsDTO = z.infer<typeof UpdateWoCustomerSettingsSchema>;

// Public viewer-login: a single read-only password gates a customer's WO data.
export const ViewerLoginSchema = z.object({ password: z.string().min(1) });
export type ViewerLoginDTO = z.infer<typeof ViewerLoginSchema>;
