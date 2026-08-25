// =============================================================================
// RFC-0057 DEC-8 (revised, feedback-pre-merge P0.3) — regression guard.
//
// The customer secrets guard originally evaluated `customers.secret.read`.
// Because policy:read-only allows `*.*.read` / `*.*.list`, that action matched
// and ANY viewer scoped on the customer could reveal real secrets. The fix
// splits the verbs into `customers.secret.reveal` (GET) / `customers.secret.manage`
// (PUT), which the read-only allow list cannot match, and grants them only via
// the high-risk policy:customer-secrets.
//
// This test exercises the REAL AuthorizationService.permissionMatches /
// scopeMatches / deny-wins pipeline (repositories mocked) against the exact
// policy definitions shipped in scripts/db/seeds/04-policies.sql.
// =============================================================================
import { AuthorizationService } from '../../../src/services/AuthorizationService';
import { IRoleRepository } from '../../../src/repositories/interfaces/IRoleRepository';
import { IPolicyRepository } from '../../../src/repositories/interfaces/IPolicyRepository';
import { IRoleAssignmentRepository } from '../../../src/repositories/interfaces/IRoleAssignmentRepository';
import { Role } from '../../../src/domain/entities/Role';
import { Policy } from '../../../src/domain/entities/Policy';
import { RoleAssignment } from '../../../src/domain/entities/RoleAssignment';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const SCOPE = `customer:${CUSTOMER}`;

const audit = { version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

// Policy definitions copied verbatim from scripts/db/seeds/04-policies.sql.
const READ_ONLY: Policy = {
  id: 'p-ro', tenantId: TENANT, key: 'policy:read-only', displayName: 'Read Only',
  description: '', allow: ['*.*.read', '*.*.list'],
  deny: ['*.*.create', '*.*.update', '*.*.delete', '*.*.execute', '*.*.admin'],
  riskLevel: 'low', isSystem: true, ...audit,
} as Policy;

const CUSTOMER_SECRETS: Policy = {
  id: 'p-cs', tenantId: TENANT, key: 'policy:customer-secrets', displayName: 'Customer Secrets',
  description: '', allow: ['customers.secret.reveal', 'customers.secret.manage'],
  deny: [], riskLevel: 'critical', isSystem: true, ...audit,
} as Policy;

function serviceWith(policyKeys: string[], policies: Policy[]): AuthorizationService {
  const assignment: RoleAssignment = {
    id: 'a1', tenantId: TENANT, userId: USER, roleKey: 'role:x', scope: SCOPE,
    status: 'active', grantedBy: USER, grantedAt: '2026-01-01T00:00:00Z', ...audit,
  } as RoleAssignment;

  const role: Role = {
    id: 'r1', tenantId: TENANT, key: 'role:x', displayName: 'Role X', description: '',
    policies: policyKeys, tags: [], riskLevel: 'low', isSystem: false, ...audit,
  } as Role;

  const roleRepo = { getByKeys: jest.fn().mockResolvedValue([role]) } as unknown as IRoleRepository;
  const policyRepo = { getByKeys: jest.fn().mockResolvedValue(policies) } as unknown as IPolicyRepository;
  const assignmentRepo = {
    getActiveByUserId: jest.fn().mockResolvedValue([assignment]),
  } as unknown as IRoleAssignmentRepository;

  return new AuthorizationService(roleRepo, policyRepo, assignmentRepo);
}

describe('RFC-0057 secrets — RBAC policy matching', () => {
  it('read-only viewer is DENIED customers.secret.reveal (the P0.3 blocker)', async () => {
    const svc = serviceWith(['policy:read-only'], [READ_ONLY]);
    const res = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.reveal', resourceScope: SCOPE,
    });
    expect(res.allowed).toBe(false);
  });

  it('read-only viewer is DENIED customers.secret.manage', async () => {
    const svc = serviceWith(['policy:read-only'], [READ_ONLY]);
    const res = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.manage', resourceScope: SCOPE,
    });
    expect(res.allowed).toBe(false);
  });

  it('documents the old vuln: read-only WOULD have matched the retired customers.secret.read', async () => {
    const svc = serviceWith(['policy:read-only'], [READ_ONLY]);
    const res = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.read', resourceScope: SCOPE,
    });
    expect(res.allowed).toBe(true); // exactly why we moved off the `.read` action
  });

  it('policy:customer-secrets GRANTS reveal and manage', async () => {
    const svc = serviceWith(['policy:customer-secrets'], [CUSTOMER_SECRETS]);
    const reveal = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.reveal', resourceScope: SCOPE,
    });
    const manage = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.manage', resourceScope: SCOPE,
    });
    expect(reveal.allowed).toBe(true);
    expect(manage.allowed).toBe(true);
  });

  it('a viewer that ALSO holds customer-secrets is still granted (no deny-wins on reveal/manage)', async () => {
    const svc = serviceWith(['policy:read-only', 'policy:customer-secrets'], [READ_ONLY, CUSTOMER_SECRETS]);
    const res = await svc.evaluatePermission(TENANT, {
      userId: USER, permission: 'customers.secret.reveal', resourceScope: SCOPE,
    });
    expect(res.allowed).toBe(true);
  });
});
