import { z } from 'zod';

// POST /centrals/:id/backup
// Body is optional; sourceLabel records WHY the backup was taken.
export const CreateCentralBackupSchema = z.object({
  sourceLabel: z.enum(['manual', 'scheduled', 'pre-restore']).optional(),
});
export type CreateCentralBackupDTO = z.infer<typeof CreateCentralBackupSchema>;

// POST /centrals/:id/backups/:backupId/confirm
// The central confirms the upload finished, reporting the integrity digest and
// size so a later restore can verify the object before pg_restore.
export const ConfirmCentralBackupSchema = z.object({
  sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/, 'sha256 must be 64 hex chars'),
  byteSize: z.number().int().positive(),
});
export type ConfirmCentralBackupDTO = z.infer<typeof ConfirmCentralBackupSchema>;
