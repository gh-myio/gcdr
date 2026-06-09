import {
  pinLookupToken,
  pinHash,
  pinVerify,
  pinColumnsForWrite,
  constantTimeEqual,
} from '../../../../src/services/wo/WoPinService';

// RFC-0032 Phase 2 — PIN crypto helpers.
//
// The pepper is required by the helpers; we set a deterministic test
// value here so the HMAC outputs are stable across runs.
beforeAll(() => {
  process.env.WO_PIN_PEPPER = 'test-pepper-32-chars-min-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});

describe('WoPinService', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';

  describe('pinLookupToken', () => {
    it('returns a 64-char hex string (HMAC-SHA256)', () => {
      const token = pinLookupToken(tenantA, '1234');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic: same (tenantId, pin) always yields the same token', () => {
      const a = pinLookupToken(tenantA, '1234');
      const b = pinLookupToken(tenantA, '1234');
      expect(a).toBe(b);
    });

    it('is tenant-scoped: same PIN in different tenants yields different tokens', () => {
      const a = pinLookupToken(tenantA, '1234');
      const b = pinLookupToken(tenantB, '1234');
      expect(a).not.toBe(b);
    });

    it('is PIN-sensitive: different PINs in the same tenant yield different tokens', () => {
      const a = pinLookupToken(tenantA, '1234');
      const b = pinLookupToken(tenantA, '5678');
      expect(a).not.toBe(b);
    });

    it('throws when PIN is not 4 digits', () => {
      expect(() => pinLookupToken(tenantA, '123')).toThrow(/4 digits/);
      expect(() => pinLookupToken(tenantA, '12345')).toThrow(/4 digits/);
      expect(() => pinLookupToken(tenantA, 'abcd')).toThrow(/4 digits/);
      expect(() => pinLookupToken(tenantA, '')).toThrow(/4 digits/);
    });

    it('throws when tenantId is missing', () => {
      expect(() => pinLookupToken('', '1234')).toThrow(/tenantId/);
    });

    it('throws if pepper is missing or too short', () => {
      const saved = process.env.WO_PIN_PEPPER;
      try {
        process.env.WO_PIN_PEPPER = 'short';
        expect(() => pinLookupToken(tenantA, '1234')).toThrow(/WO_PIN_PEPPER/);

        delete process.env.WO_PIN_PEPPER;
        expect(() => pinLookupToken(tenantA, '1234')).toThrow(/WO_PIN_PEPPER/);
      } finally {
        process.env.WO_PIN_PEPPER = saved;
      }
    });
  });

  describe('pinHash + pinVerify', () => {
    it('produces a bcrypt hash that verifies against the original PIN', async () => {
      const hash = await pinHash('1234');
      expect(hash).toMatch(/^\$2[aby]\$/);
      await expect(pinVerify('1234', hash)).resolves.toBe(true);
    });

    it('rejects a wrong PIN', async () => {
      const hash = await pinHash('1234');
      await expect(pinVerify('5678', hash)).resolves.toBe(false);
    });

    it('uses a random salt: same PIN twice produces different hashes', async () => {
      const a = await pinHash('1234');
      const b = await pinHash('1234');
      expect(a).not.toBe(b);
      // both still verify
      await expect(pinVerify('1234', a)).resolves.toBe(true);
      await expect(pinVerify('1234', b)).resolves.toBe(true);
    });

    it('returns false on null hash without throwing', async () => {
      await expect(pinVerify('1234', null)).resolves.toBe(false);
    });

    it('returns false on a malformed PIN without comparing', async () => {
      const hash = await pinHash('1234');
      await expect(pinVerify('abc', hash)).resolves.toBe(false);
    });

    it('throws on hash() with non-4-digit PIN', async () => {
      await expect(pinHash('123')).rejects.toThrow(/4 digits/);
    });
  });

  describe('pinColumnsForWrite', () => {
    it('returns both lookup and hash columns', async () => {
      const cols = await pinColumnsForWrite(tenantA, '1234');
      expect(cols.lookup).toMatch(/^[0-9a-f]{64}$/);
      expect(cols.hash).toMatch(/^\$2[aby]\$/);
    });

    it('lookup is identical to pinLookupToken; hash verifies independently', async () => {
      const cols = await pinColumnsForWrite(tenantA, '1234');
      expect(cols.lookup).toBe(pinLookupToken(tenantA, '1234'));
      await expect(pinVerify('1234', cols.hash)).resolves.toBe(true);
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for identical strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths (without throwing)', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
      expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    });
  });
});
