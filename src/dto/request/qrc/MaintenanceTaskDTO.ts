import { z } from 'zod';

// RFC-0032 — Maintenance tasks scoped to an installation.

export const CreateMaintenanceTaskSchema = z.object({
  description: z.string().min(1).max(2000),
});
export type CreateMaintenanceTaskDTO = z.infer<typeof CreateMaintenanceTaskSchema>;

export const UpdateMaintenanceTaskSchema = z.object({
  status:          z.enum(['pending', 'pending_review', 'resolved', 'removido']).optional(),
  description:     z.string().min(1).max(2000).optional(),
  completedNotes:  z.string().max(2000).nullable().optional(),
});
export type UpdateMaintenanceTaskDTO = z.infer<typeof UpdateMaintenanceTaskSchema>;
