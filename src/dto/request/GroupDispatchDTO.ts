import { z } from 'zod';

export const AlarmActionSchema = z.enum(['OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY']);

const DispatchEntrySchema = z.object({
  channel:           z.string().min(1).max(50),
  action:            AlarmActionSchema,
  active:            z.boolean(),
  escalationDelayMs: z.number().int().min(0).default(0),
});

export const PutGroupDispatchSchema = z.object({
  entries: z.array(DispatchEntrySchema).min(1),
});

export type PutGroupDispatchDTO = z.infer<typeof PutGroupDispatchSchema>;

export const PatchGroupDispatchSchema = z.object({
  entries: z.array(DispatchEntrySchema).min(1),
});

export type PatchGroupDispatchDTO = z.infer<typeof PatchGroupDispatchSchema>;
