import { CentralReplacementService } from '../../../src/services/CentralReplacementService';
import { ValidationError } from '../../../src/shared/errors/AppError';
import type { ReplaceCentralResult } from '../../../src/dto/request/CentralReplacementDTO';

const OLD_UUID = 'a1b2c3d4-0000-4000-8000-000000000001';
const NEW_UUID = 'f9e8d7c6-0000-4000-8000-000000000002';
const REPLACEMENT_ID = '11111111-2222-4333-8444-555555555555';

const DTO = {
  newUuid: NEW_UUID,
  newIpv6Yggdrasil: '200:1234:5678:9abc:def0:1234:5678:9abc',
  keepSerialNumber: true,
  replacementId: REPLACEMENT_ID,
};

const ACTOR = { userId: 'u1', userEmail: 'op@myio.com', requestId: undefined };

function makeResult(): ReplaceCentralResult {
  const summary = (id: string) => ({
    id,
    serialNumber: '219.19.169.246',
    name: 'central-1',
    displayName: 'Central 1',
    status: 'ACTIVE',
    customerId: 'cust-1',
    assetId: 'asset-1',
    frequency: 105,
    ipv6Yggdrasil: '200::1',
  });
  return {
    replacementId: REPLACEMENT_ID,
    oldCentral: { ...summary(OLD_UUID), status: 'INACTIVE' },
    newCentral: summary(NEW_UUID),
    devicesRepointed: 242,
  };
}

function makeService(outcome?: { result: ReplaceCentralResult; replayed: boolean }) {
  const repo = {
    replace: jest.fn(async () => outcome ?? { result: makeResult(), replayed: false }),
  };
  return { svc: new CentralReplacementService(repo), repo };
}

describe('CentralReplacementService.replace (RFC-0005)', () => {
  it('delegates to the repository and returns the RFC response shape', async () => {
    const { svc, repo } = makeService();
    const res = await svc.replace('t1', OLD_UUID, DTO, ACTOR);

    expect(repo.replace).toHaveBeenCalledWith('t1', OLD_UUID, DTO, ACTOR);
    expect(res.replacementId).toBe(REPLACEMENT_ID);
    expect(res.oldCentral.id).toBe(OLD_UUID);
    expect(res.oldCentral.status).toBe('INACTIVE');
    expect(res.newCentral.id).toBe(NEW_UUID);
    expect(res.devicesRepointed).toBe(242);
  });

  it('returns the SAME stored result on an idempotent replay', async () => {
    const stored = makeResult();
    const { svc } = makeService({ result: stored, replayed: true });
    const res = await svc.replace('t1', OLD_UUID, DTO, ACTOR);
    expect(res).toBe(stored);
  });

  it('rejects a non-UUID oldUuid without touching the repository', async () => {
    const { svc, repo } = makeService();
    await expect(svc.replace('t1', 'not-a-uuid', DTO, ACTOR)).rejects.toThrow(ValidationError);
    expect(repo.replace).not.toHaveBeenCalled();
  });

  it('rejects newUuid equal to oldUuid (case-insensitive) without touching the repository', async () => {
    const { svc, repo } = makeService();
    await expect(
      svc.replace('t1', OLD_UUID.toUpperCase(), { ...DTO, newUuid: OLD_UUID }, ACTOR),
    ).rejects.toThrow(ValidationError);
    expect(repo.replace).not.toHaveBeenCalled();
  });
});
