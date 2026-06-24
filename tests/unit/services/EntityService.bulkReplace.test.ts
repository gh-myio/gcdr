import { EntityService, computeVersion } from '../../../src/services/EntityService';
import { IEntityRepository } from '../../../src/repositories/interfaces/IEntityRepository';
import { BulkReplaceDTO } from '../../../src/dto/request/EntityDTO';
import { AppError } from '../../../src/shared/errors/AppError';
import {
  makeRepo,
  makeEntity,
  expectErrorWithCode,
  tenantId,
  userId,
  customerId,
} from './EntityService.helpers';

describe('EntityService — bulkReplace', () => {
  let repo: jest.Mocked<IEntityRepository>;
  let service: EntityService;

  const body: BulkReplaceDTO = {
    roots: [{ entityKey: 'energy-entry', entityValue: 'Energy', children: [] }],
  };

  beforeEach(() => {
    repo = makeRepo();
    service = new EntityService(repo);
  });

  it('replaces without If-Match and returns new version + replaced count', async () => {
    const roots = [makeEntity({ entityType: 'GROUP' })];
    repo.bulkReplace.mockResolvedValue({ replaced: 3, roots });

    const got = await service.bulkReplace(tenantId, customerId, 'GROUP', body, undefined, userId);
    expect(got).toEqual({ version: computeVersion(roots), source: 'customer', replaced: 3 });
    expect(repo.resolve).not.toHaveBeenCalled(); // no If-Match -> no precheck
  });

  it('proceeds when If-Match matches the current subtree version', async () => {
    const existing = [makeEntity({ entityType: 'GROUP', id: 'g1' })];
    repo.resolve.mockResolvedValue({ source: 'customer', roots: existing });
    const subtreeVersion = computeVersion(existing.filter((r) => r.entityType === 'GROUP'));

    const newRoots = [makeEntity({ entityType: 'GROUP', id: 'g2', entityValue: 'New' })];
    repo.bulkReplace.mockResolvedValue({ replaced: 1, roots: newRoots });

    const got = await service.bulkReplace(tenantId, customerId, 'GROUP', body, subtreeVersion, userId);
    expect(got.replaced).toBe(1);
    expect(repo.bulkReplace).toHaveBeenCalled();
  });

  it('accepts a quoted If-Match ETag', async () => {
    const existing = [makeEntity({ entityType: 'GROUP' })];
    repo.resolve.mockResolvedValue({ source: 'customer', roots: existing });
    const subtreeVersion = computeVersion(existing);
    repo.bulkReplace.mockResolvedValue({ replaced: 1, roots: existing });

    await service.bulkReplace(tenantId, customerId, 'GROUP', body, `"${subtreeVersion}"`, userId);
    expect(repo.bulkReplace).toHaveBeenCalled();
  });

  it('rejects VERSION_CONFLICT on a stale If-Match and carries currentVersion', async () => {
    const existing = [makeEntity({ entityType: 'GROUP' })];
    repo.resolve.mockResolvedValue({ source: 'customer', roots: existing });
    const currentVersion = computeVersion(existing);

    const promise = service.bulkReplace(tenantId, customerId, 'GROUP', body, 'v_stale', userId);
    await expectErrorWithCode(promise, 'VERSION_CONFLICT');
    expect(repo.bulkReplace).not.toHaveBeenCalled();

    const err = await promise.catch((e) => e as AppError & { details?: Record<string, unknown> });
    expect(err.details?.currentVersion).toBe(currentVersion);
  });

  it('rejects VALIDATION_ERROR when a node has invalid per-type metadata', async () => {
    const metaBody: BulkReplaceDTO = {
      roots: [
        {
          entityKey: 'energy',
          metadata: { unknownKey: 'x' }, // CLASSIFICATION_* schema is strict + needs label
          children: [],
        },
      ],
    };
    await expectErrorWithCode(
      service.bulkReplace(tenantId, customerId, 'CLASSIFICATION_ENERGY', metaBody, undefined, userId),
      'VALIDATION_ERROR',
    );
    expect(repo.bulkReplace).not.toHaveBeenCalled();
  });

  it('maps a SYSTEM_PROTECTED repo error to AppError SYSTEM_PROTECTED', async () => {
    repo.bulkReplace.mockRejectedValue(new Error('SYSTEM_PROTECTED: cannot modify system row'));
    await expectErrorWithCode(
      service.bulkReplace(tenantId, customerId, 'GROUP', body, undefined, userId),
      'SYSTEM_PROTECTED',
    );
  });
});
