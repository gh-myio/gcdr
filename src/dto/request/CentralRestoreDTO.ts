import { z } from 'zod';

export const RESTORE_PHASES = [
  'QUEUED',
  'DOWNLOAD',
  'VERIFY',
  'STOP_SERVICES',
  'RESTORE_DB',
  'START_SERVICES',
  'DONE',
] as const;

export const RESTORE_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED'] as const;

// POST /centrals/:id/restore — start a restore of this central from one of its
// own backups (the replacement hardware already adopted this central's id).
export const StartRestoreSchema = z.object({
  sourceBackupId: z.string().uuid(),
  dryRun: z.boolean().optional(),
});
export type StartRestoreDTO = z.infer<typeof StartRestoreSchema>;

// PATCH /centrals/:id/restore/:jobId — the central reports progress as it runs
// download -> verify -> stop services -> pg_restore -> start services.
export const UpdateRestoreProgressSchema = z
  .object({
    status: z.enum(RESTORE_STATUSES).optional(),
    currentPhase: z.enum(RESTORE_PHASES).optional(),
    message: z.string().max(1000).optional(),
    errorMessage: z.string().max(2000).optional(),
  })
  .refine(
    (d) => d.status || d.currentPhase || d.message || d.errorMessage,
    'at least one of status, currentPhase, message or errorMessage is required',
  );
export type UpdateRestoreProgressDTO = z.infer<typeof UpdateRestoreProgressSchema>;
