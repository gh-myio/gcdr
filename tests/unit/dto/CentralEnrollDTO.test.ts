import { EnrollCentralSchema } from '../../../src/dto/request/CentralEnrollDTO';

const VALID_UUID = '22222222-2222-2222-2222-222222222222';
const VALID_TOKEN = 'a'.repeat(64); // hex enroll token

describe('EnrollCentralSchema', () => {
  it('accepts a valid uuid + enrollToken', () => {
    const result = EnrollCentralSchema.safeParse({ uuid: VALID_UUID, enrollToken: VALID_TOKEN });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid central id', () => {
    const result = EnrollCentralSchema.safeParse({ uuid: 'not-a-uuid', enrollToken: VALID_TOKEN });
    expect(result.success).toBe(false);
  });

  it('rejects a too-short enrollToken (< 20 chars)', () => {
    const result = EnrollCentralSchema.safeParse({ uuid: VALID_UUID, enrollToken: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing enrollToken', () => {
    const result = EnrollCentralSchema.safeParse({ uuid: VALID_UUID });
    expect(result.success).toBe(false);
  });
});
