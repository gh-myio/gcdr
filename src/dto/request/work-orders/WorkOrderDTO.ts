import { z } from 'zod';

// RFC-0037 — Work Orders (event-log model) request DTOs.

export const WORK_ORDER_TYPES = ['INSTALACAO', 'MANUTENCAO', 'VISITA_TECNICA'] as const;

export const WORK_ORDER_STATUSES = [
  'PLANEJADA',
  'EM_ANDAMENTO',
  'INTERROMPIDA',
  'AGUARDANDO',
  'REAGENDADA',
  'FINALIZADA',
  'CANCELADA',
] as const;

// ---------------------------------------------------------------------------
// Create work order
// ---------------------------------------------------------------------------
export const CreateWorkOrderSchema = z.object({
  customerId:  z.string().uuid(),
  type:        z.enum(WORK_ORDER_TYPES),
  rootAssetId: z.string().uuid().nullable().optional(),
  // Optional in the request — when absent the service generates a unique
  // OS-<Mercosul plate> code (no I/O/1/0).
  code:        z.string().trim().min(1).max(100).optional(),
  assignedTo:  z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  // Optional initial device scope.
  devices:     z.array(z.string().uuid()).max(500).optional(),
});
export type CreateWorkOrderDTO = z.infer<typeof CreateWorkOrderSchema>;

// ---------------------------------------------------------------------------
// Update work order (assignee, schedule, root asset, code)
// ---------------------------------------------------------------------------
export const UpdateWorkOrderSchema = z.object({
  rootAssetId: z.string().uuid().nullable().optional(),
  code:        z.string().trim().min(1).max(100).optional(),
  assignedTo:  z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type UpdateWorkOrderDTO = z.infer<typeof UpdateWorkOrderSchema>;

// ---------------------------------------------------------------------------
// List / filter work orders
// ---------------------------------------------------------------------------
export const WORK_ORDER_SORTS = [
  'createdAt_desc',
  'createdAt_asc',
  'updatedAt_desc',
  'updatedAt_asc',
  'scheduledAt_asc',
  'scheduledAt_desc',
] as const;
export type WorkOrderSort = (typeof WORK_ORDER_SORTS)[number];

export const ListWorkOrdersSchema = z.object({
  customerId:  z.string().uuid().optional(),
  status:      z.enum(WORK_ORDER_STATUSES).optional(),
  type:        z.enum(WORK_ORDER_TYPES).optional(),
  assignedTo:  z.string().uuid().optional(),
  deviceId:    z.string().uuid().optional(),
  // Opening (createdAt) range — inclusive ISO timestamps.
  createdFrom: z.string().datetime({ offset: true }).optional(),
  createdTo:   z.string().datetime({ offset: true }).optional(),
  sort:        z.enum(WORK_ORDER_SORTS).optional(),
  limit:       z.number().int().min(1).max(100).optional(),
  cursor:      z.string().optional(),
});
export type ListWorkOrdersDTO = z.infer<typeof ListWorkOrdersSchema>;

// ---------------------------------------------------------------------------
// Append an event
//
// Payload is validated loosely (z.record) per RFC-0037 — type-specific payload
// shapes (reason, schedule, annotation_id, …) are validated in the service as
// the catalog grows. OBSERVACAO_*/ANEXO_* markers reference annotation_id in
// the payload (the annotation itself is the annotations domain's concern).
// ---------------------------------------------------------------------------
export const AppendWorkOrderEventSchema = z.object({
  eventType: z.string().min(1).max(100),
  deviceId:  z.string().uuid().nullable().optional(),
  assetId:   z.string().uuid().nullable().optional(),
  payload:   z.record(z.unknown()).optional(),
});
export type AppendWorkOrderEventDTO = z.infer<typeof AppendWorkOrderEventSchema>;

// ---------------------------------------------------------------------------
// Scope: add a device to a work order
// ---------------------------------------------------------------------------
export const AddWorkOrderDeviceSchema = z.object({
  deviceId: z.string().uuid(),
});
export type AddWorkOrderDeviceDTO = z.infer<typeof AddWorkOrderDeviceSchema>;

// ---------------------------------------------------------------------------
// Files: link a file_asset to a work order (optionally tied to an event)
// ---------------------------------------------------------------------------
export const AddWorkOrderFileSchema = z.object({
  fileAssetId:      z.string().uuid(),
  workOrderEventId: z.string().uuid().nullable().optional(),
  imageOrder:       z.number().int().min(0).max(10000).optional(),
  caption:          z.string().max(500).nullable().optional(),
});
export type AddWorkOrderFileDTO = z.infer<typeof AddWorkOrderFileSchema>;
