import { IEntityRepository } from '../../../src/repositories/interfaces/IEntityRepository';
import { RegistryEntity, EntityType } from '../../../src/domain/entities/Entity';
import { AppError } from '../../../src/shared/errors/AppError';

export const tenantId = 'tenant-1';
export const userId = 'user-1';
export const customerId = '33333333-3333-3333-3333-333333333333';

/** Assert a rejected promise is an AppError with the expected `code`. */
export const expectErrorWithCode = async (p: Promise<unknown>, code: string): Promise<void> => {
  await expect(p).rejects.toThrow();
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
};

/** A fully-mocked IEntityRepository — every method a jest.fn(). */
export function makeRepo(): jest.Mocked<IEntityRepository> {
  return {
    listEntityTypes: jest.fn(),
    getEntityType: jest.fn(),
    createEntityType: jest.fn(),
    updateEntityType: jest.fn(),
    deleteEntityType: jest.fn(),
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    hardDelete: jest.fn(),
    restore: jest.fn(),
    list: jest.fn(),
    getChildren: jest.fn(),
    resolve: jest.fn(),
    clone: jest.fn(),
    revert: jest.fn(),
    bulkReplace: jest.fn(),
    hasCustomerRows: jest.fn(),
    getAncestorIds: jest.fn(),
    wouldCreateCycle: jest.fn(),
    countChildren: jest.fn(),
  };
}

export function makeType(overrides: Partial<EntityType> = {}): EntityType {
  return {
    entityType: 'GROUP',
    label: 'Group',
    description: null,
    allowedParentTypes: [],
    isActive: true,
    ...overrides,
  };
}

export function makeEntity(overrides: Partial<RegistryEntity> = {}): RegistryEntity {
  return {
    id: 'ent-1',
    tenantId,
    customerId: null,
    entityType: 'GROUP',
    entityKey: 'energy-entry',
    entityValue: 'Energy Entry',
    parentEntityId: null,
    sortOrder: 0,
    cloneScopeKey: '*',
    isSystem: false,
    isActive: true,
    isDeleted: false,
    metadata: {},
    createdAt: '2026-06-22T00:00:00Z',
    createdBy: userId,
    updatedAt: '2026-06-22T00:00:00Z',
    updatedBy: userId,
    version: 1,
    ...overrides,
  };
}
