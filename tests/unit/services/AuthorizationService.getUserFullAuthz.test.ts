import { AuthorizationService } from '../../../src/services/AuthorizationService';
import { IRoleRepository } from '../../../src/repositories/interfaces/IRoleRepository';
import { IPolicyRepository } from '../../../src/repositories/interfaces/IPolicyRepository';
import { IRoleAssignmentRepository } from '../../../src/repositories/interfaces/IRoleAssignmentRepository';
import { RoleAssignment } from '../../../src/domain/entities/RoleAssignment';
import { Role } from '../../../src/domain/entities/Role';
import { Policy } from '../../../src/domain/entities/Policy';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const customerId = '33333333-3333-3333-3333-333333333333';
const grantedBy = '44444444-4444-4444-4444-444444444444';

const baseAudit = {
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const makeAssignment = (overrides: Partial<RoleAssignment> = {}): RoleAssignment => ({
  id: 'assignment-1',
  tenantId,
  userId,
  roleKey: 'customer-admin',
  scope: `customer:${customerId}`,
  status: 'active',
  grantedBy,
  grantedAt: '2026-01-01T00:00:00Z',
  ...baseAudit,
  ...overrides,
});

const makeRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-1',
  tenantId,
  key: 'customer-admin',
  displayName: 'Customer Admin',
  description: 'Admin of a customer',
  policies: ['policy.devices.read', 'policy.devices.write'],
  tags: [],
  riskLevel: 'medium',
  isSystem: false,
  ...baseAudit,
  ...overrides,
});

const makePolicy = (overrides: Partial<Policy> = {}): Policy => ({
  id: 'policy-1',
  tenantId,
  key: 'policy.devices.read',
  displayName: 'Read devices',
  description: 'Grants read on devices',
  allow: ['devices.read.any'],
  deny: [],
  riskLevel: 'low',
  isSystem: false,
  ...baseAudit,
  ...overrides,
});

describe('AuthorizationService.getUserFullAuthz', () => {
  let service: AuthorizationService;
  let roleRepo: jest.Mocked<Pick<IRoleRepository, 'getByKeys'>>;
  let policyRepo: jest.Mocked<Pick<IPolicyRepository, 'getByKeys'>>;
  let assignmentRepo: jest.Mocked<Pick<IRoleAssignmentRepository, 'getActiveByUserId'>>;

  beforeEach(() => {
    roleRepo = { getByKeys: jest.fn() };
    policyRepo = { getByKeys: jest.fn() };
    assignmentRepo = { getActiveByUserId: jest.fn() };

    service = new AuthorizationService(
      roleRepo as unknown as IRoleRepository,
      policyRepo as unknown as IPolicyRepository,
      assignmentRepo as unknown as IRoleAssignmentRepository,
    );
  });

  it('returns empty snapshot when user has no active assignments', async () => {
    assignmentRepo.getActiveByUserId.mockResolvedValue([]);

    const result = await service.getUserFullAuthz(tenantId, userId);

    expect(result.assignments).toEqual([]);
    expect(result.effectivePermissions).toEqual([]);
    expect(result.deniedPatterns).toEqual([]);
    expect(roleRepo.getByKeys).not.toHaveBeenCalled();
    expect(policyRepo.getByKeys).not.toHaveBeenCalled();
  });

  it('enriches assignments with role and expanded policies', async () => {
    assignmentRepo.getActiveByUserId.mockResolvedValue([makeAssignment()]);
    roleRepo.getByKeys.mockResolvedValue([makeRole()]);
    policyRepo.getByKeys.mockResolvedValue([
      makePolicy({ key: 'policy.devices.read', allow: ['devices.read.any'], deny: [] }),
      makePolicy({
        id: 'policy-2',
        key: 'policy.devices.write',
        allow: ['devices.write.any'],
        deny: [],
      }),
    ]);

    const result = await service.getUserFullAuthz(tenantId, userId);

    expect(result.assignments).toHaveLength(1);
    const assignment = result.assignments[0]!;
    expect(assignment.scope).toBe(`customer:${customerId}`);
    expect(assignment.role).not.toBeNull();
    expect(assignment.role!.key).toBe('customer-admin');
    expect(assignment.role!.policies).toHaveLength(2);
    expect(assignment.role!.policies.map((p) => p.key).sort()).toEqual([
      'policy.devices.read',
      'policy.devices.write',
    ]);
    expect(result.effectivePermissions.sort()).toEqual(['devices.read.any', 'devices.write.any']);
    expect(result.deniedPatterns).toEqual([]);
  });

  it('applies deny-wins semantics across policies', async () => {
    assignmentRepo.getActiveByUserId.mockResolvedValue([makeAssignment()]);
    roleRepo.getByKeys.mockResolvedValue([
      makeRole({ policies: ['policy.allow', 'policy.deny'] }),
    ]);
    policyRepo.getByKeys.mockResolvedValue([
      makePolicy({ key: 'policy.allow', allow: ['devices.write.any'], deny: [] }),
      makePolicy({ id: 'p2', key: 'policy.deny', allow: [], deny: ['devices.write.any'] }),
    ]);

    const result = await service.getUserFullAuthz(tenantId, userId);

    expect(result.effectivePermissions).not.toContain('devices.write.any');
    expect(result.deniedPatterns).toContain('devices.write.any');
  });

  it('leaves role as null when roleKey has no matching role (orphan assignment)', async () => {
    assignmentRepo.getActiveByUserId.mockResolvedValue([
      makeAssignment({ roleKey: 'missing-role' }),
    ]);
    roleRepo.getByKeys.mockResolvedValue([]);
    policyRepo.getByKeys.mockResolvedValue([]);

    const result = await service.getUserFullAuthz(tenantId, userId);

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.role).toBeNull();
  });

  it('deduplicates role and policy lookups when multiple assignments share the same role', async () => {
    assignmentRepo.getActiveByUserId.mockResolvedValue([
      makeAssignment({ id: 'a1', scope: 'customer:aaa' }),
      makeAssignment({ id: 'a2', scope: 'customer:bbb' }),
    ]);
    roleRepo.getByKeys.mockResolvedValue([makeRole({ policies: ['policy.one'] })]);
    policyRepo.getByKeys.mockResolvedValue([
      makePolicy({ key: 'policy.one', allow: ['things.read.any'] }),
    ]);

    const result = await service.getUserFullAuthz(tenantId, userId);

    expect(roleRepo.getByKeys).toHaveBeenCalledWith(tenantId, ['customer-admin']);
    expect(policyRepo.getByKeys).toHaveBeenCalledWith(tenantId, ['policy.one']);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]!.role!.key).toBe('customer-admin');
    expect(result.assignments[1]!.role!.key).toBe('customer-admin');
  });
});
