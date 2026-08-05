import { ReplaceCentralSchema } from '../../../src/dto/request/CentralReplacementDTO';

const NEW_UUID = '3f2e1d0c-9b8a-4765-8321-0fedcba98765';
const REPLACEMENT_ID = '11111111-2222-4333-8444-555555555555';
const IPV6 = '200:1234:5678:9abc:def0:1234:5678:9abc';

const base = {
  newUuid: NEW_UUID,
  newIpv6Yggdrasil: IPV6,
  replacementId: REPLACEMENT_ID,
};

describe('ReplaceCentralSchema (RFC-0005)', () => {
  it('accepts the minimal body and defaults keepSerialNumber to true', () => {
    const parsed = ReplaceCentralSchema.parse(base);
    expect(parsed.keepSerialNumber).toBe(true);
    expect(parsed.newSerialNumber ?? null).toBeNull();
  });

  it('accepts an explicit serial reissue', () => {
    const parsed = ReplaceCentralSchema.parse({
      ...base,
      keepSerialNumber: false,
      newSerialNumber: '10.20.30.40',
    });
    expect(parsed.keepSerialNumber).toBe(false);
    expect(parsed.newSerialNumber).toBe('10.20.30.40');
  });

  it('requires newSerialNumber when keepSerialNumber is false', () => {
    const res = ReplaceCentralSchema.safeParse({ ...base, keepSerialNumber: false });
    expect(res.success).toBe(false);
  });

  it('rejects newSerialNumber when keepSerialNumber is true (ambiguous intent)', () => {
    const res = ReplaceCentralSchema.safeParse({
      ...base,
      keepSerialNumber: true,
      newSerialNumber: '10.20.30.40',
    });
    expect(res.success).toBe(false);
  });

  it('allows newSerialNumber: null alongside keepSerialNumber: true (RFC body shape)', () => {
    const res = ReplaceCentralSchema.safeParse({
      ...base,
      keepSerialNumber: true,
      newSerialNumber: null,
    });
    expect(res.success).toBe(true);
  });

  it('rejects a non-UUID newUuid and a non-UUID replacementId', () => {
    expect(ReplaceCentralSchema.safeParse({ ...base, newUuid: 'not-a-uuid' }).success).toBe(false);
    expect(ReplaceCentralSchema.safeParse({ ...base, replacementId: '123' }).success).toBe(false);
  });

  it('rejects an invalid IPv6 (including IPv4 values)', () => {
    expect(
      ReplaceCentralSchema.safeParse({ ...base, newIpv6Yggdrasil: '192.168.0.1' }).success,
    ).toBe(false);
    expect(
      ReplaceCentralSchema.safeParse({ ...base, newIpv6Yggdrasil: 'zz::1::bad' }).success,
    ).toBe(false);
  });
});
