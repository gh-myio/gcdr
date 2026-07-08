import { z } from 'zod';

export const COMMAND_TYPES = ['REBOOT', 'RESTART_ERLANG', 'RESTART_MYIOAPI', 'SET_WIFI'] as const;
export const COMMAND_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;

// SET_WIFI payload — the target network the central applies via myio-wifi-set.
// The password is a secret: it is written for the central to consume and is
// stripped from every operator-facing response (see CentralCommandService).
export const WifiPayloadSchema = z.object({
  ssid: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
  country: z.string().length(2).optional(),
});
export type WifiPayloadDTO = z.infer<typeof WifiPayloadSchema>;

// POST /centrals/:id/commands — operator sends an operational command to the
// central (reboot the box, restart the erlang/myio-core service, restart the
// myioapi service, or configure WiFi). Only SET_WIFI carries a payload; the
// refine makes a valid network mandatory for it and irrelevant for the rest.
export const CreateCommandSchema = z
  .object({
    type: z.enum(COMMAND_TYPES),
    payload: WifiPayloadSchema.optional(),
  })
  .refine((d) => d.type !== 'SET_WIFI' || d.payload !== undefined, {
    message: 'SET_WIFI requires a payload with { ssid, password }',
    path: ['payload'],
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
