import { EnrichmentResolveSchema } from '../../../src/dto/request/EnrichmentDTO';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

describe('EnrichmentDTO — resolve (RFC-0055 / ED-1080)', () => {
  it('accepts a request with deviceIds only and defaults the other lists to []', () => {
    const parsed = EnrichmentResolveSchema.parse({ deviceIds: [UUID_A, UUID_B] });
    expect(parsed.deviceIds).toEqual([UUID_A, UUID_B]);
    expect(parsed.centralIds).toEqual([]);
    expect(parsed.customerIds).toEqual([]);
  });

  it('accepts a mixed request', () => {
    const parsed = EnrichmentResolveSchema.parse({
      deviceIds: [UUID_A],
      centralIds: [UUID_B],
      customerIds: [UUID_A],
    });
    expect(parsed.centralIds).toEqual([UUID_B]);
  });

  it('rejects an empty request (no ids at all)', () => {
    expect(() => EnrichmentResolveSchema.parse({})).toThrow();
    expect(() =>
      EnrichmentResolveSchema.parse({ deviceIds: [], centralIds: [], customerIds: [] })
    ).toThrow();
  });

  it('rejects non-uuid ids', () => {
    expect(() => EnrichmentResolveSchema.parse({ deviceIds: ['not-a-uuid'] })).toThrow();
  });

  it('rejects more than 500 ids of a single type', () => {
    const many = Array.from({ length: 501 }, () => UUID_A);
    expect(() => EnrichmentResolveSchema.parse({ deviceIds: many })).toThrow();
  });
});
