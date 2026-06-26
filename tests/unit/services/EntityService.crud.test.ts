import { EntityService } from '../../../src/services/EntityService';
import {
  IEntityRepository,
} from '../../../src/repositories/interfaces/IEntityRepository';
import {
  makeRepo,
  makeEntity,
  makeType,
  expectErrorWithCode,
  tenantId,
  userId,
} from './EntityService.helpers';

describe('EntityService — CRUD + entity_types', () => {
  let repo: jest.Mocked<IEntityRepository>;
  let service: EntityService;

  beforeEach(() => {
    repo = makeRepo();
    service = new EntityService(repo);
  });

  // ---- entity_types ---------------------------------------------------------

  describe('createEntityType', () => {
    it('rejects FORBIDDEN for a non-admin caller', async () => {
      await expectErrorWithCode(
        service.createEntityType(
          tenantId,
          { entityType: 'GROUP', label: 'Group', allowedParentTypes: [] },
          { isAdmin: false },
        ),
        'FORBIDDEN',
      );
      expect(repo.createEntityType).not.toHaveBeenCalled();
    });

    it('creates the type for an admin caller', async () => {
      repo.getEntityType.mockResolvedValue(null);
      repo.createEntityType.mockResolvedValue(makeType({ entityType: 'PROFILE', label: 'Profile' }));

      const got = await service.createEntityType(
        tenantId,
        { entityType: 'PROFILE', label: 'Profile', allowedParentTypes: ['GROUP'] },
        { isAdmin: true },
      );
      expect(got.entityType).toBe('PROFILE');
      expect(repo.createEntityType).toHaveBeenCalled();
    });

    it('rejects DUPLICATE_KEY when the type already exists', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'GROUP' }));
      await expectErrorWithCode(
        service.createEntityType(
          tenantId,
          { entityType: 'GROUP', label: 'Group', allowedParentTypes: [] },
          { isAdmin: true },
        ),
        'DUPLICATE_KEY',
      );
    });
  });

  describe('updateEntityType', () => {
    it('rejects FORBIDDEN for a non-admin caller', async () => {
      await expectErrorWithCode(
        service.updateEntityType(tenantId, 'GROUP', { label: 'X' }, { isAdmin: false }),
        'FORBIDDEN',
      );
      expect(repo.updateEntityType).not.toHaveBeenCalled();
    });

    it('rejects NOT_FOUND when the type does not exist', async () => {
      repo.getEntityType.mockResolvedValue(null);
      await expectErrorWithCode(
        service.updateEntityType(tenantId, 'NOPE', { label: 'X' }, { isAdmin: true }),
        'NOT_FOUND',
      );
    });

    it('updates the type for an admin caller', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'GROUP' }));
      repo.updateEntityType.mockResolvedValue(makeType({ entityType: 'GROUP', label: 'Grupo' }));
      const got = await service.updateEntityType(tenantId, 'GROUP', { label: 'Grupo' }, { isAdmin: true });
      expect(got.label).toBe('Grupo');
      expect(repo.updateEntityType).toHaveBeenCalledWith(tenantId, 'GROUP', { label: 'Grupo' });
    });
  });

  describe('deleteEntityType', () => {
    it('rejects FORBIDDEN for a non-admin caller', async () => {
      await expectErrorWithCode(
        service.deleteEntityType(tenantId, 'GROUP', { isAdmin: false }),
        'FORBIDDEN',
      );
      expect(repo.deleteEntityType).not.toHaveBeenCalled();
    });

    it('rejects NOT_FOUND when the type does not exist', async () => {
      repo.getEntityType.mockResolvedValue(null);
      await expectErrorWithCode(
        service.deleteEntityType(tenantId, 'NOPE', { isAdmin: true }),
        'NOT_FOUND',
      );
    });

    it('maps an FK violation (still in use) to TYPE_IN_USE', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'GROUP' }));
      repo.deleteEntityType.mockRejectedValue(
        Object.assign(new Error('update or delete violates foreign key constraint'), { code: '23503' }),
      );
      await expectErrorWithCode(
        service.deleteEntityType(tenantId, 'GROUP', { isAdmin: true }),
        'TYPE_IN_USE',
      );
    });

    it('deletes the type for an admin caller', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'CUSTOM' }));
      repo.deleteEntityType.mockResolvedValue();
      await service.deleteEntityType(tenantId, 'CUSTOM', { isAdmin: true });
      expect(repo.deleteEntityType).toHaveBeenCalledWith(tenantId, 'CUSTOM');
    });
  });

  // ---- create ---------------------------------------------------------------

  describe('create', () => {
    const baseDto = {
      entityType: 'GROUP',
      entityKey: 'energy-entry',
      entityValue: 'Energy Entry',
      parentEntityId: null,
      customerId: null,
      sortOrder: 0,
      isActive: true,
      metadata: {},
    };

    it('creates a root node of a registered type', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ allowedParentTypes: [] }));
      repo.create.mockResolvedValue(makeEntity());

      const got = await service.create(tenantId, baseDto as never, userId);
      expect(got.id).toBe('ent-1');
      expect(repo.create).toHaveBeenCalledWith(tenantId, baseDto, userId);
    });

    it('rejects VALIDATION_ERROR for an unknown type', async () => {
      repo.getEntityType.mockResolvedValue(null);
      await expectErrorWithCode(service.create(tenantId, baseDto as never, userId), 'VALIDATION_ERROR');
    });

    it('rejects INVALID_PARENT_TYPE when parent is not an allowed parent', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'PROFILE', allowedParentTypes: ['GROUP'] }));
      repo.getById.mockResolvedValue(makeEntity({ id: 'parent-1', entityType: 'EQUIPMENT' }));

      await expectErrorWithCode(
        service.create(
          tenantId,
          { ...baseDto, entityType: 'PROFILE', parentEntityId: 'parent-1' } as never,
          userId,
        ),
        'INVALID_PARENT_TYPE',
      );
    });

    it('rejects VALIDATION_ERROR on bad per-type metadata (strict schema)', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'CLASSIFICATION_ENERGY' }));
      await expectErrorWithCode(
        service.create(
          tenantId,
          {
            ...baseDto,
            entityType: 'CLASSIFICATION_ENERGY',
            metadata: { unknownKey: 'x' }, // strict() -> rejected, and label missing
          } as never,
          userId,
        ),
        'VALIDATION_ERROR',
      );
    });

    it('maps a unique-violation from the repo to DUPLICATE_KEY', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ allowedParentTypes: [] }));
      repo.create.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));
      await expectErrorWithCode(service.create(tenantId, baseDto as never, userId), 'DUPLICATE_KEY');
    });

    it('rejects FORBIDDEN when a non-admin mints a system default (isSystem)', async () => {
      await expectErrorWithCode(
        service.create(tenantId, { ...baseDto, isSystem: true } as never, userId, { isAdmin: false }),
        'FORBIDDEN',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects VALIDATION_ERROR when an admin scopes a system default to a customer', async () => {
      await expectErrorWithCode(
        service.create(
          tenantId,
          { ...baseDto, isSystem: true, customerId: '33333333-3333-3333-3333-333333333333' } as never,
          userId,
          { isAdmin: true },
        ),
        'VALIDATION_ERROR',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('lets an admin mint an unscoped system default', async () => {
      repo.getEntityType.mockResolvedValue(makeType({ allowedParentTypes: [] }));
      repo.create.mockResolvedValue(makeEntity({ isSystem: true }));
      const got = await service.create(tenantId, { ...baseDto, isSystem: true } as never, userId, {
        isAdmin: true,
      });
      expect(got.isSystem).toBe(true);
      expect(repo.create).toHaveBeenCalled();
    });
  });

  // ---- getById / getChildren ------------------------------------------------

  describe('getById', () => {
    it('returns the entity', async () => {
      repo.getById.mockResolvedValue(makeEntity());
      const got = await service.getById(tenantId, 'ent-1');
      expect(got.id).toBe('ent-1');
    });

    it('throws NOT_FOUND when missing', async () => {
      repo.getById.mockResolvedValue(null);
      await expectErrorWithCode(service.getById(tenantId, 'missing'), 'NOT_FOUND');
    });
  });

  describe('getChildren', () => {
    it('throws NOT_FOUND when the parent does not exist', async () => {
      repo.getById.mockResolvedValue(null);
      await expectErrorWithCode(service.getChildren(tenantId, 'missing'), 'NOT_FOUND');
    });

    it('returns children when the parent exists', async () => {
      repo.getById.mockResolvedValue(makeEntity());
      repo.getChildren.mockResolvedValue([makeEntity({ id: 'child-1' })]);
      const got = await service.getChildren(tenantId, 'ent-1');
      expect(got).toHaveLength(1);
    });
  });

  // ---- update ---------------------------------------------------------------

  describe('update', () => {
    it('rejects SYSTEM_PROTECTED when a non-admin edits an is_system row', async () => {
      repo.getById.mockResolvedValue(makeEntity({ isSystem: true }));
      await expectErrorWithCode(
        service.update(tenantId, 'ent-1', { entityValue: 'x' }, userId, { isAdmin: false }),
        'SYSTEM_PROTECTED',
      );
    });

    it('rejects VERSION_CONFLICT on a stale version', async () => {
      repo.getById.mockResolvedValue(makeEntity({ version: 5 }));
      await expectErrorWithCode(
        service.update(tenantId, 'ent-1', { version: 3 }, userId, { isAdmin: true }),
        'VERSION_CONFLICT',
      );
    });

    it('rejects ENTITY_CYCLE on a re-parent that would cycle', async () => {
      repo.getById.mockResolvedValue(makeEntity({ parentEntityId: null }));
      repo.wouldCreateCycle.mockResolvedValue(true);
      await expectErrorWithCode(
        service.update(tenantId, 'ent-1', { parentEntityId: 'desc-1' }, userId, { isAdmin: true }),
        'ENTITY_CYCLE',
      );
    });

    it('rejects INVALID_PARENT_TYPE on a re-parent to a disallowed type', async () => {
      repo.getById
        .mockResolvedValueOnce(makeEntity({ entityType: 'PROFILE', parentEntityId: null })) // the node
        .mockResolvedValueOnce(makeEntity({ id: 'parent-1', entityType: 'EQUIPMENT' })); // the new parent
      repo.wouldCreateCycle.mockResolvedValue(false);
      repo.getEntityType.mockResolvedValue(makeType({ entityType: 'PROFILE', allowedParentTypes: ['GROUP'] }));

      await expectErrorWithCode(
        service.update(tenantId, 'ent-1', { parentEntityId: 'parent-1' }, userId, { isAdmin: true }),
        'INVALID_PARENT_TYPE',
      );
    });

    it('updates and validates merged metadata for free-form types', async () => {
      repo.getById.mockResolvedValue(makeEntity({ metadata: { a: 1 } }));
      repo.update.mockResolvedValue(makeEntity({ metadata: { a: 1, b: 2 }, version: 2 }));

      const got = await service.update(
        tenantId,
        'ent-1',
        { metadata: { b: 2 } },
        userId,
        { isAdmin: false, metadataMode: 'merge' },
      );
      expect(got.version).toBe(2);
      expect(repo.update).toHaveBeenCalled();
    });
  });

  // ---- remove ---------------------------------------------------------------

  describe('remove', () => {
    it('soft-deletes by default', async () => {
      repo.getById.mockResolvedValue(makeEntity());
      repo.softDelete.mockResolvedValue();
      await service.remove(tenantId, 'ent-1', userId);
      expect(repo.softDelete).toHaveBeenCalledWith(tenantId, 'ent-1', userId);
    });

    it('rejects SYSTEM_PROTECTED on an is_system row', async () => {
      repo.getById.mockResolvedValue(makeEntity({ isSystem: true }));
      await expectErrorWithCode(service.remove(tenantId, 'ent-1', userId), 'SYSTEM_PROTECTED');
    });

    it('rejects HAS_CHILDREN on hard-delete with children and no cascade', async () => {
      repo.getById.mockResolvedValue(makeEntity());
      repo.countChildren.mockResolvedValue(2);
      await expectErrorWithCode(
        service.remove(tenantId, 'ent-1', userId, { hard: true }),
        'HAS_CHILDREN',
      );
    });

    it('hard-deletes with cascade without counting children', async () => {
      repo.getById.mockResolvedValue(makeEntity());
      repo.hardDelete.mockResolvedValue();
      await service.remove(tenantId, 'ent-1', userId, { hard: true, cascade: true });
      expect(repo.countChildren).not.toHaveBeenCalled();
      expect(repo.hardDelete).toHaveBeenCalledWith(tenantId, 'ent-1', { cascade: true });
    });
  });

  // ---- restore --------------------------------------------------------------

  describe('restore', () => {
    it('restores the entity', async () => {
      repo.restore.mockResolvedValue(makeEntity({ isDeleted: false }));
      const got = await service.restore(tenantId, 'ent-1', userId);
      expect(got.isDeleted).toBe(false);
    });

    it('maps a unique-violation to RESTORE_CONFLICT', async () => {
      repo.restore.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));
      await expectErrorWithCode(service.restore(tenantId, 'ent-1', userId), 'RESTORE_CONFLICT');
    });
  });
});
