import {
  CreateUserContactSchema,
  validateValueForChannel,
  USER_CONTACT_CHANNELS,
} from '../../../src/dto/request/UserContactDTO';

describe('validateValueForChannel', () => {
  it('accepts a valid email for EMAIL', () => {
    expect(validateValueForChannel('EMAIL', 'jane@example.com')).toBeNull();
  });

  it('rejects an invalid email for EMAIL', () => {
    expect(validateValueForChannel('EMAIL', 'not-an-email')).toMatch(/email/i);
  });

  it.each(['WHATSAPP', 'SMS'] as const)('accepts an E.164 phone for %s', (channel) => {
    expect(validateValueForChannel(channel, '+55 27 99999-9999')).toBeNull();
  });

  it.each(['WHATSAPP', 'SMS'] as const)('rejects a non-phone for %s', (channel) => {
    expect(validateValueForChannel(channel, 'hello')).toMatch(/E\.164/);
  });

  it.each(['TELEGRAM', 'SLACK', 'TEAMS', 'CUSTOM'] as const)(
    'accepts any non-empty value for %s',
    (channel) => {
      expect(validateValueForChannel(channel, '@whatever')).toBeNull();
    },
  );
});

describe('CreateUserContactSchema', () => {
  it('rejects an unknown channel', () => {
    const result = CreateUserContactSchema.safeParse({ channel: 'CARRIER_PIGEON', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid value for the channel (superRefine)', () => {
    const result = CreateUserContactSchema.safeParse({ channel: 'EMAIL', value: 'nope' });
    expect(result.success).toBe(false);
  });

  it('defaults active to true', () => {
    const data = CreateUserContactSchema.parse({ channel: 'EMAIL', value: 'jane@example.com' });
    expect(data.active).toBe(true);
  });

  it('exposes the documented channel set', () => {
    expect(USER_CONTACT_CHANNELS).toEqual([
      'EMAIL',
      'TELEGRAM',
      'WHATSAPP',
      'SMS',
      'SLACK',
      'TEAMS',
      'CUSTOM',
    ]);
  });
});
