import { z } from 'zod';

/**
 * Notification channels supported for user contacts (RFC-0025).
 * Mirrors the values documented in migration 0016_user_contacts.sql.
 */
export const USER_CONTACT_CHANNELS = [
  'EMAIL',
  'TELEGRAM',
  'WHATSAPP',
  'SMS',
  'SLACK',
  'TEAMS',
  'CUSTOM',
] as const;

export type UserContactChannel = (typeof USER_CONTACT_CHANNELS)[number];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164-ish: leading +, 8-15 digits (after stripping spaces, dashes, parens).
const PHONE_REGEX = /^\+\d{8,15}$/;

/**
 * Validate a contact `value` against its `channel`. Returns an error message
 * when invalid, or `null` when the value is acceptable.
 *
 * Shared between the Zod create schema (via superRefine) and the service's
 * PATCH path (where the channel is not part of the request body and must be
 * read from the persisted contact).
 */
export function validateValueForChannel(
  channel: UserContactChannel,
  value: string,
): string | null {
  switch (channel) {
    case 'EMAIL':
      return EMAIL_REGEX.test(value) ? null : 'value must be a valid email address for channel EMAIL';
    case 'WHATSAPP':
    case 'SMS': {
      const normalized = value.replace(/[\s\-()]/g, '');
      return PHONE_REGEX.test(normalized)
        ? null
        : `value must be an E.164 phone number (e.g. +5527999999999) for channel ${channel}`;
    }
    // TELEGRAM (@handle or chat_id), SLACK (@user or member_id), TEAMS, CUSTOM:
    // accept any non-empty string (already enforced by the min(1) below).
    default:
      return null;
  }
}

export const CreateUserContactSchema = z
  .object({
    channel: z.enum(USER_CONTACT_CHANNELS),
    value: z.string().min(1).max(500),
    label: z.string().max(100).optional(),
    active: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    const error = validateValueForChannel(data.channel, data.value);
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: error });
    }
  });

export type CreateUserContactDTO = z.infer<typeof CreateUserContactSchema>;

export const UpdateUserContactSchema = z.object({
  value: z.string().min(1).max(500).optional(),
  label: z.string().max(100).optional(),
  active: z.boolean().optional(),
});

export type UpdateUserContactDTO = z.infer<typeof UpdateUserContactSchema>;
