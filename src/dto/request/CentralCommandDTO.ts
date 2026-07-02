import { z } from 'zod';

export const COMMAND_TYPES = ['REBOOT', 'RESTART_ERLANG'] as const;
export const COMMAND_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;

// POST /centrals/:id/commands — operator sends an operational command to the
// central (reboot the box, or restart the erlang/myio-core service).
export const CreateCommandSchema = z.object({
  type: z.enum(COMMAND_TYPES),
});
export type CreateCommandDTO = z.infer<typeof CreateCommandSchema>;

// PATCH /central-agent/commands/:cmdId — the central reports the result of the
// command it ran (exit code + captured stdout/stderr). stdout/stderr are capped
// so a runaway command output can't bloat the row.
export const UpdateCommandResultSchema = z
  .object({
    status: z.enum(COMMAND_STATUSES).optional(),
    exitCode: z.number().int().optional(),
    stdout: z.string().max(20000).optional(),
    stderr: z.string().max(20000).optional(),
    errorMessage: z.string().max(2000).optional(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.exitCode !== undefined ||
      d.stdout !== undefined ||
      d.stderr !== undefined ||
      d.errorMessage !== undefined,
    'at least one of status, exitCode, stdout, stderr or errorMessage is required',
  );
export type UpdateCommandResultDTO = z.infer<typeof UpdateCommandResultSchema>;
