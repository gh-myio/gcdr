import { EntityService, computeVersion } from '../../../src/services/EntityService';
import { IEntityRepository } from '../../../src/repositories/interfaces/IEntityRepository';
import {
  makeRepo,
  makeEntity,
  expectErrorWithCode,
  tenantId,
  userId,
  customerId,
} from './EntityService.helpers';

describe('EntityService — resolve / clone / revert', () => {
  let repo: jest.Mocked<IEntityRepository>;
  let service: EntityService;

  beforeEach(() => {
    repo = makeRepo();
    service = new EntityService(repo);
  });

  describe('computeVersion', () => {
    it('is deterministic and order-independent across sibling order', () => {
      const a = makeEntity({ id: 'a' });
      const b = makeEntity({ id: 'b', entityKey: 'water-entry' });
      expect(computeVersion([a, b])).toBe(computeVersion([b, a]));
    });

    it('changes when a node value changes', () => {
      const v1 = computeVersion([makeEntity({ entityValue: 'X' })]);
      const v2 = computeVersion([makeEntity({ entityValue: 'Y' })]);
      expect(v1).not.toBe(v2);
    });
  });

  describe('resolve', () => {
    it('returns source + computed version + roots', async () => {
      const roots = [makeEntity()];
      repo.resolve.mockResolvedValue({ source: 'customer', roots });

      const got = await service.resolve(tenantId, customerId);
      expect(got.source).toBe('customer');
      expect(got.roots).toBe(roots);
      expect(got.version).toBe(computeVersion(roots));
    });

    it('falls back to system source from the repo', async () => {
      repo.resolve.mockResolvedValue({ source: 'system', roots: [] });
      const got = await service.resolve(tenantId, customerId);
      expect(got.source).toBe('system');
    });
  });

  describe('clone', () => {
    it('rejects ALREADY_CLONED when the customer already has rows', async () => {
      repo.hasCustomerRows.mockResolvedValue(true);
      await expectErrorWithCode(service.clone(tenantId, customerId, userId), 'ALREADY_CLONED');
      expect(repo.clone).not.toHaveBeenCalled();
    });

    it('clones and returns count + customerId', async () => {
      repo.hasCustomerRows.mockResolvedValue(false);
      repo.clone.mockResolvedValue({ cloned: 7 });
      const got = await service.clone(tenantId, customerId, userId);
      expect(got).toEqual({ cloned: 7, customerId });
    });
  });

  describe('revert', () => {
    it('reverts and returns count + customerId', async () => {
      repo.revert.mockResolvedValue({ reverted: 4 });
      const got = await service.revert(tenantId, customerId, userId);
      expect(got).toEqual({ reverted: 4, customerId });
    });
  });
});
