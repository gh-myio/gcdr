import { z } from 'zod';

export const ChannelTypeSchema = z.enum([
  'EMAIL', 'TELEGRAM', 'WHATSAPP', 'WEBHOOK', 'SLACK', 'SMS', 'TEAMS', 'CUSTOM',
]);

export const UpsertGroupChannelSchema = z.object({
  channel: ChannelTypeSchema,
  active:  z.boolean().default(true),
  target:  z.string().min(1).max(500),
  config:  z.record(z.unknown()).optional().default({}),
});

export type UpsertGroupChannelDTO = z.infer<typeof UpsertGroupChannelSchema>;

export const PutGroupChannelsSchema = z.object({
  channels: z.array(UpsertGroupChannelSchema).min(1),
});

export type PutGroupChannelsDTO = z.infer<typeof PutGroupChannelsSchema>;

export const PatchGroupChannelSchema = z.object({
  active: z.boolean().optional(),
  target: z.string().min(1).max(500).optional(),
  config: z.record(z.unknown()).optional(),
});

export type PatchGroupChannelDTO = z.infer<typeof PatchGroupChannelSchema>;
