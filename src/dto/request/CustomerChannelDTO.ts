import { z } from 'zod';

export const ChannelTypeSchema = z.enum(['EMAIL_RELAY', 'TELEGRAM', 'WHATSAPP', 'WEBHOOK', 'SMS', 'SLACK', 'TEAMS', 'CUSTOM']);

export const CreateCustomerChannelSchema = z.object({
  channel: ChannelTypeSchema,
  active:  z.boolean().default(true),
  config:  z.record(z.unknown()).default({}),
});

export type CreateCustomerChannelDTO = z.infer<typeof CreateCustomerChannelSchema>;

export const UpdateCustomerChannelSchema = z.object({
  active: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export type UpdateCustomerChannelDTO = z.infer<typeof UpdateCustomerChannelSchema>;
