import { z } from 'zod';

// RFC-0032 — Visita Técnica + ambiente + product + observation inputs.

export const CreateVisitaSchema = z.object({
  customerId:  z.string().uuid().nullable().optional(),
  name:        z.string().min(1).max(200),
  observation: z.string().max(5000).nullable().optional(),
});
export type CreateVisitaDTO = z.infer<typeof CreateVisitaSchema>;

export const UpdateVisitaSchema = z.object({
  customerId:  z.string().uuid().nullable().optional(),
  name:        z.string().min(1).max(200).optional(),
  observation: z.string().max(5000).nullable().optional(),
  status:      z.enum(['pending', 'in_progress', 'done']).optional(),
});
export type UpdateVisitaDTO = z.infer<typeof UpdateVisitaSchema>;

export const CreateVisitaAmbienteSchema = z.object({
  name:            z.string().min(1).max(200),
  observation:     z.string().max(5000).nullable().optional(),
  acQuantity:      z.number().int().min(0).nullable().optional(),
  productQuantity: z.number().int().min(0).nullable().optional(),
  productType:     z.string().max(200).nullable().optional(),
});
export type CreateVisitaAmbienteDTO = z.infer<typeof CreateVisitaAmbienteSchema>;

export const UpdateVisitaAmbienteSchema = CreateVisitaAmbienteSchema.partial();
export type UpdateVisitaAmbienteDTO = z.infer<typeof UpdateVisitaAmbienteSchema>;

export const CreateVisitaAmbienteImageSchema = z.object({
  fileAssetId: z.string().uuid(),
  imageOrder:  z.number().int().min(0).max(49).optional(),
  caption:     z.string().max(500).nullable().optional(),
});
export type CreateVisitaAmbienteImageDTO = z.infer<typeof CreateVisitaAmbienteImageSchema>;

export const UpdateVisitaAmbienteImageSchema = z.object({
  imageOrder: z.number().int().min(0).max(49).optional(),
  caption:    z.string().max(500).nullable().optional(),
});
export type UpdateVisitaAmbienteImageDTO = z.infer<typeof UpdateVisitaAmbienteImageSchema>;

export const CreateVisitaProductSchema = z.object({
  productType: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  quantity:    z.number().int().min(1).default(1),
});
export type CreateVisitaProductDTO = z.infer<typeof CreateVisitaProductSchema>;

export const UpdateVisitaProductSchema = z.object({
  productType: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  quantity:    z.number().int().min(1).optional(),
});
export type UpdateVisitaProductDTO = z.infer<typeof UpdateVisitaProductSchema>;

export const CreateVisitaProductImageSchema = z.object({
  fileAssetId: z.string().uuid(),
  imageOrder:  z.number().int().min(0).max(4).optional(),
});
export type CreateVisitaProductImageDTO = z.infer<typeof CreateVisitaProductImageSchema>;

export const CreateVisitaObservationSchema = z.object({
  observation: z.string().min(1).max(5000),
  fileAssetId: z.string().uuid().nullable().optional(),
});
export type CreateVisitaObservationDTO = z.infer<typeof CreateVisitaObservationSchema>;
