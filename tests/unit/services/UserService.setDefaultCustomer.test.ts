import { UserService } from '../../../src/services/UserService';
import { IUserRepository } from '../../../src/repositories/interfaces/IUserRepository';
import { ICustomerRepository } from '../../../src/repositories/interfaces/ICustomerRepository';
import { IRoleAssignmentRepository } from '../../../src/repositories/interfaces/IRoleAssignmentRepository';
import { User, createDefaultPreferences, createDefaultSecurity } from '../../../src/domain/entities/User';
import { Customer } from '../../../src/domain/entities/Customer';
import { RoleAssignment } from '../../../src/domain/entities/RoleAssignment';
import { NotFoundError, ValidationError } from '../../../src/shared/errors/AppError';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const customerId = '33333333-3333-3333-3333-333333333333';
const actingUserId = '44444444-4444-4444-4444-444444444444';

const mockUser: User = {
  id: userId,
  tenantId,
  email: 'user@test.com',
  emailVerified: true,
  type: 'CUSTOMER',
  status: 'ACTIVE',
  profile: { firstName: 'Jane', lastName: 'Doe' },
  security: createDefaultSecurity(),
  preferences: createDefaultPreferences(),
  activeSessions: 0,
  tags: [],
  metadata: {},
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockCustomer: Customer = {
  id: customerId,
  tenantId,
  parentCustomerId: null,
  path: `/${tenantId}/${customerId}`,
  depth: 0,
  name: 'Acme',
  displayName: 'Acme',
  code: 'ACME',
  type: 'COMPANY',
  email: 'acme@test.com',
  settings: {
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL',
    inheritFromParent: false,
  },
  metadata: {},
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdBy: actingUserId,
};

const makeAssignment = (scope: string): RoleAssignment => ({
  id: 'assignment-1',
  tenantId,
  userId,
  roleKey: 'customer-admin',
  scope,
  status: 'active',
  grantedBy: actingUserId,
  grantedAt: '2026-01-01T00:00:00Z',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('UserService.setDefaultCustomer', () => {
  let service: UserService;
  let userRepo: jest.Mocked<IUserRepository>;
  let customerRepo: jest.Mocked<Pick<ICustomerRepository, 'getById'>>;
  let assignmentRepo: jest.Mocked<Pick<IRoleAssignmentRepository, 'getActiveByUserId'>>;

  beforeEach(() => {
    userRepo = {
      getById: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockImplementation(async (_t, _id, data: { preferences?: Record<string, unknown> }) => ({
        ...mockUser,
        preferences: { ...mockUser.preferences, ...(data.preferences || {}) },
      })),
    } as unknown as jest.Mocked<IUserRepository>;

    customerRepo = { getById: jest.fn() };
    assignmentRepo = { getActiveByUserId: jest.fn() };

    service = new UserService(
      userRepo,
      customerRepo as unknown as ICustomerRepository,
      assignmentRepo as unknown as IRoleAssignmentRepository,
    );
  });

  it('sets defaultCustomerId when user has a matching customer-scoped assignment', async () => {
    customerRepo.getById.mockResolvedValue(mockCustomer);
    assignmentRepo.getActiveByUserId.mockResolvedValue([makeAssignment(`customer:${customerId}`)]);

    const result = await service.setDefaultCustomer(tenantId, userId, customerId, actingUserId);

    expect(result.preferences.defaultCustomerId).toBe(customerId);
    expect(userRepo.update).toHaveBeenCalledWith(
      tenantId,
      userId,
      { preferences: expect.objectContaining({ defaultCustomerId: customerId }) },
      actingUserId,
    );
  });

  it('sets defaultCustomerId when user has a wildcard (*) assignment', async () => {
    customerRepo.getById.mockResolvedValue(mockCustomer);
    assignmentRepo.getActiveByUserId.mockResolvedValue([makeAssignment('*')]);

    const result = await service.setDefaultCustomer(tenantId, userId, customerId, actingUserId);

    expect(result.preferences.defaultCustomerId).toBe(customerId);
  });

  it('clears defaultCustomerId when customerId is null (no validation performed)', async () => {
    const result = await service.setDefaultCustomer(tenantId, userId, null, actingUserId);

    expect(result.preferences.defaultCustomerId).toBeNull();
    expect(customerRepo.getById).not.toHaveBeenCalled();
    expect(assignmentRepo.getActiveByUserId).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when customer does not exist', async () => {
    customerRepo.getById.mockResolvedValue(null);

    await expect(
      service.setDefaultCustomer(tenantId, userId, customerId, actingUserId),
    ).rejects.toThrow(NotFoundError);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('throws ValidationError when user has no matching assignment', async () => {
    customerRepo.getById.mockResolvedValue(mockCustomer);
    assignmentRepo.getActiveByUserId.mockResolvedValue([
      makeAssignment('customer:99999999-9999-9999-9999-999999999999'),
    ]);

    await expect(
      service.setDefaultCustomer(tenantId, userId, customerId, actingUserId),
    ).rejects.toThrow(ValidationError);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when user does not exist', async () => {
    userRepo.getById.mockResolvedValue(null);

    await expect(
      service.setDefaultCustomer(tenantId, userId, customerId, actingUserId),
    ).rejects.toThrow(NotFoundError);
  });
});
