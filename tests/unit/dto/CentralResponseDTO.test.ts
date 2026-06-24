import { toCentralSummaryDTO, toCentralDetailDTO } from '../../../src/dto/response/CentralResponseDTO';
import { Central } from '../../../src/domain/entities/Central';

// CR-B2 regression: the operator-facing central DTOs must NEVER echo the
// credential fields, even if a future refactor accidentally carries them onto
// the entity (e.g. a `...row` spread). We force the secrets onto the input and
// assert the serialized output omits them entirely.
const SECRET_KEYS = ['agentSecret', 'enrollTokenHash', 'enrollTokenExpiresAt', 'enrolledAt'] as const;

function centralWithSecrets(): Central {
  const base = {
    id: 'central-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    assetId: 'asset-1',
    name: 'central',
    displayName: 'Central 1',
    serialNumber: 'SN-0001',
    type: 'orange-pi',
    status: 'active',
    connectionStatus: 'online',
    firmwareVersion: '1.2.3',
    softwareVersion: '4.5.6',
    frequency: 60,
    config: {},
    stats: { connectedDevices: 3, lastHeartbeatAt: '2026-01-01T12:00:00Z' },
    location: undefined,
    tags: [],
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUpdateAt: undefined,
    // Credentials that must never serialize:
    agentSecret: 'SUPER-SECRET-AGENT-KEY',
    enrollTokenHash: 'ENROLL-TOKEN-HASH',
    enrollTokenExpiresAt: '2026-01-02T00:00:00Z',
    enrolledAt: '2026-01-01T12:00:00Z',
  };
  return base as unknown as Central;
}

describe('CentralResponseDTO — credential fields never leak (CR-B2)', () => {
  it('toCentralSummaryDTO omits agent_secret and enroll token fields', () => {
    const dto = toCentralSummaryDTO(centralWithSecrets());
    for (const k of SECRET_KEYS) expect(dto).not.toHaveProperty(k);
    const json = JSON.stringify(dto);
    expect(json).not.toContain('SUPER-SECRET-AGENT-KEY');
    expect(json).not.toContain('ENROLL-TOKEN-HASH');
  });

  it('toCentralDetailDTO omits agent_secret and enroll token fields', () => {
    const dto = toCentralDetailDTO(centralWithSecrets());
    for (const k of SECRET_KEYS) expect(dto).not.toHaveProperty(k);
    const json = JSON.stringify(dto);
    expect(json).not.toContain('SUPER-SECRET-AGENT-KEY');
    expect(json).not.toContain('ENROLL-TOKEN-HASH');
  });
});
