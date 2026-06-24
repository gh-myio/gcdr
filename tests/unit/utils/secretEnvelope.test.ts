process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? 'a'.repeat(64);

import { encryptSecret, decryptSecret, isEnvelope } from '../../../src/shared/utils/secretEnvelope';

describe('secretEnvelope (CR-S3)', () => {
  it('round-trips encrypt -> decrypt', () => {
    const secret = 'super-secret-agent-key-1234567890';
    const env = encryptSecret(secret);
    expect(isEnvelope(env)).toBe(true);
    expect(env.startsWith('v1:')).toBe(true);
    expect(env).not.toContain(secret); // stored as ciphertext, not plaintext
    expect(decryptSecret(env)).toBe(secret);
  });

  it('uses a random IV (different envelope each time) but decrypts equally', () => {
    const secret = 'x'.repeat(64);
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it('passes a legacy plaintext value through unchanged', () => {
    expect(isEnvelope('legacy-plaintext-secret')).toBe(false);
    expect(decryptSecret('legacy-plaintext-secret')).toBe('legacy-plaintext-secret');
  });

  it('throws on a tampered envelope (GCM auth-tag mismatch)', () => {
    const env = encryptSecret('tamper-me');
    const parts = env.split(':');
    const ct = parts[3];
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => decryptSecret(`${parts[0]}:${parts[1]}:${parts[2]}:${flipped}`)).toThrow();
  });
});
