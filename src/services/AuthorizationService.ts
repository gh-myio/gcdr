import { Role } from '../domain/entities/Role';
import { Policy, PolicyConditions } from '../domain/entities/Policy';
import { RoleAssignment } from '../domain/entities/RoleAssignment';
import {
  CreateRoleDTO,
  UpdateRoleDTO,
  CreatePolicyDTO,
  AssignRoleDTO,
  EvaluatePermissionDTO,
  EvaluateBatchDTO,
} from '../dto/request/AuthorizationDTO';
import { RoleRepository } from '../repositories/RoleRepository';
import { PolicyRepository } from '../repositories/PolicyRepository';
import { RoleAssignmentRepository } from '../repositories/RoleAssignmentRepository';
import { UserRepository } from '../repositories/UserRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { IRoleRepository, ListRolesParams } from '../repositories/interfaces/IRoleRepository';
import { IPolicyRepository, ListPoliciesParams, UpdatePolicyDTO } from '../repositories/interfaces/IPolicyRepository';
import { IRoleAssignmentRepository, UpdateRoleAssignmentDTO } from '../repositories/interfaces/IRoleAssignmentRepository';
import { PaginatedResult, RiskLevel } from '../shared/types';
import { NotFoundError, ForbiddenError, ConflictError } from '../shared/errors/AppError';
import { userService } from './UserService';

export interface PermissionEvaluationResult {
  allowed: boolean;
  reason: string;
  matchedPolicies: string[];
  evaluatedAt: string;
}

export interface EffectivePermission {
  permission: string;
  allowed: boolean;
  source: string;
  conditions?: PolicyConditions;
}

export interface BatchEvaluationResult {
  results: Record<string, PermissionEvaluationResult>;
  summary: {
    total: number;
    allowed: number;
    denied: number;
  };
}

export interface EnrichedPolicy {
  key: string;
  displayName: string;
  description: string;
  allow: string[];
  deny: string[];
  conditions?: PolicyConditions;
  riskLevel: RiskLevel;
}

export interface EnrichedRole {
  key: string;
  displayName: string;
  description: string;
  riskLevel: RiskLevel;
  isSystem: boolean;
  policies: EnrichedPolicy[];
}

export interface EnrichedAssignment {
  id: string;
  scope: string;
  status: string;
  grantedAt: string;
  grantedBy: string;
  expiresAt?: string;
  reason?: string;
  role: EnrichedRole | null;
}

export interface AssignmentUserRef {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AssignmentListItem extends RoleAssignment {
  user: AssignmentUserRef | null;
  grantedByUser: AssignmentUserRef | null;
  roleDisplayName: string | null;
}

export interface UserFullAuthz {
  assignments: EnrichedAssignment[];
  effectivePermissions: string[];
  deniedPatterns: string[];
}

function parseCustomerScope(scope: string): string | null {
  const match = /^customer:([0-9a-f-]{36})$/i.exec(scope);
  return match ? match[1]! : null;
}

export class AuthorizationService {
  private roleRepository: IRoleRepository;
  private policyRepository: IPolicyRepository;
  private roleAssignmentRepository: IRoleAssignmentRepository;
  private userRepository: UserRepository;
  private customerRepository: CustomerRepository;

  constructor(
    roleRepository?: IRoleRepository,
    policyRepository?: IPolicyRepository,
    roleAssignmentRepository?: IRoleAssignmentRepository
  ) {
    this.roleRepository = roleRepository || new RoleRepository();
    this.policyRepository = policyRepository || new PolicyRepository();
    this.roleAssignmentRepository = roleAssignmentRepository || new RoleAssignmentRepository();
    this.userRepository = new UserRepository();
    this.customerRepository = new CustomerRepository();
  }

  // ==================== Role Management ====================

  async createRole(tenantId: string, data: CreateRoleDTO, userId: string): Promise<Role> {
    // Validate policies exist
    const policies = await this.policyRepository.getByKeys(tenantId, data.policies);
    const foundKeys = policies.map((p) => p.key);
    const missingPolicies = data.policies.filter((k) => !foundKeys.includes(k));

    if (missingPolicies.length > 0) {
      throw new NotFoundError(`Policies not found: ${missingPolicies.join(', ')}`);
    }

    const role = await this.roleRepository.create(tenantId, data, userId);
    return role;
  }

  async getRoleById(tenantId: string, id: string): Promise<Role> {
    const role = await this.roleRepository.getById(tenantId, id);
    if (!role) {
      throw new NotFoundError(`Role ${id} not found`);
    }
    return role;
  }

  async getRoleByKey(tenantId: string, key: string): Promise<Role> {
    const role = await this.roleRepository.getByKey(tenantId, key);
    if (!role) {
      throw new NotFoundError(`Role with key '${key}' not found`);
    }
    return role;
  }

  async updateRole(tenantId: string, id: string, data: UpdateRoleDTO, userId: string): Promise<Role> {
    const existing = await this.getRoleById(tenantId, id);

    if (existing.isSystem) {
      throw new ForbiddenError('Cannot modify system role');
    }

    // Validate policies if being updated
    if (data.policies) {
      const policies = await this.policyRepository.getByKeys(tenantId, data.policies);
      const foundKeys = policies.map((p) => p.key);
      const missingPolicies = data.policies.filter((k) => !foundKeys.includes(k));

      if (missingPolicies.length > 0) {
        throw new NotFoundError(`Policies not found: ${missingPolicies.join(', ')}`);
      }
    }

    const role = await this.roleRepository.update(tenantId, id, data, userId);
    return role;
  }

  async deleteRole(tenantId: string, id: string, userId: string): Promise<void> {
    const role = await this.getRoleById(tenantId, id);

    if (role.isSystem) {
      throw new ForbiddenError('Cannot delete system role');
    }

    // Check if role is assigned to any users
    const assignments = await this.roleAssignmentRepository.getByRoleKey(tenantId, role.key);
    const activeAssignments = assignments.filter((a) => a.status === 'active');

    if (activeAssignments.length > 0) {
      throw new ConflictError(
        `Cannot delete role with ${activeAssignments.length} active assignments. Revoke assignments first.`
      );
    }

    await this.roleRepository.delete(tenantId, id);
  }

  async listRoles(tenantId: string, params: ListRolesParams): Promise<PaginatedResult<Role>> {
    return this.roleRepository.listWithFilters(tenantId, params);
  }

  // ==================== Policy Management ====================

  async createPolicy(tenantId: string, data: CreatePolicyDTO, userId: string): Promise<Policy> {
    // Validate permissions format
    this.validatePermissionFormat([...data.allow, ...data.deny]);

    const policy = await this.policyRepository.create(tenantId, data, userId);
    return policy;
  }

  async getPolicyById(tenantId: string, id: string): Promise<Policy> {
    const policy = await this.policyRepository.getById(tenantId, id);
    if (!policy) {
      throw new NotFoundError(`Policy ${id} not found`);
    }
    return policy;
  }

  async getPolicyByKey(tenantId: string, key: string): Promise<Policy> {
    const policy = await this.policyRepository.getByKey(tenantId, key);
    if (!policy) {
      throw new NotFoundError(`Policy with key '${key}' not found`);
    }
    return policy;
  }

  async updatePolicy(tenantId: string, id: string, data: UpdatePolicyDTO, userId: string): Promise<Policy> {
    const existing = await this.getPolicyById(tenantId, id);

    if (existing.isSystem) {
      throw new ForbiddenError('Cannot modify system policy');
    }

    // Validate permissions format if being updated
    const allPermissions = [...(data.allow || []), ...(data.deny || [])];
    if (allPermissions.length > 0) {
      this.validatePermissionFormat(allPermissions);
    }

    const policy = await this.policyRepository.update(tenantId, id, data, userId);
    return policy;
  }

  async deletePolicy(tenantId: string, id: string, userId: string): Promise<void> {
    const policy = await this.getPolicyById(tenantId, id);

    if (policy.isSystem) {
      throw new ForbiddenError('Cannot delete system policy');
    }

    // Check if policy is used by any roles
    const allRoles = await this.roleRepository.list(tenantId, { limit: 1000 });
    const rolesUsingPolicy = allRoles.items.filter((r) => r.policies.includes(policy.key));

    if (rolesUsingPolicy.length > 0) {
      throw new ConflictError(
        `Cannot delete policy used by ${rolesUsingPolicy.length} roles: ${rolesUsingPolicy.map((r) => r.key).join(', ')}`
      );
    }

    await this.policyRepository.delete(tenantId, id);
  }

  async listPolicies(tenantId: string, params: ListPoliciesParams): Promise<PaginatedResult<Policy>> {
    return this.policyRepository.listWithFilters(tenantId, params);
  }

  // ==================== Role Assignment ====================

  async assignRole(tenantId: string, data: AssignRoleDTO, grantedBy: string): Promise<RoleAssignment> {
    // Validate user exists
    const user = await this.userRepository.getById(tenantId, data.userId);
    if (!user) {
      throw new NotFoundError(`User '${data.userId}' not found`);
    }

    // Validate role exists
    const role = await this.roleRepository.getByKey(tenantId, data.roleKey);
    if (!role) {
      throw new NotFoundError(`Role with key '${data.roleKey}' not found`);
    }

    const assignment = await this.roleAssignmentRepository.create(tenantId, data, grantedBy);
    return assignment;
  }

  async revokeAssignment(tenantId: string, assignmentId: string, revokedBy: string): Promise<RoleAssignment> {
    const assignment = await this.roleAssignmentRepository.getById(tenantId, assignmentId);
    if (!assignment) {
      throw new NotFoundError(`Assignment ${assignmentId} not found`);
    }

    const updated = await this.roleAssignmentRepository.update(
      tenantId,
      assignmentId,
      { status: 'inactive' },
      revokedBy
    );

    // If that was the user's last active path to a customer scope, clear any
    // matching preferences.defaultCustomerId so it cannot become a dangling pointer.
    const customerId = parseCustomerScope(assignment.scope);
    if (customerId) {
      const remaining = await this.roleAssignmentRepository.getActiveByUserId(tenantId, assignment.userId);
      const stillHasAccess = remaining.some(
        (a) => a.scope === '*' || a.scope === `customer:${customerId}`
      );
      if (!stillHasAccess) {
        await userService.clearDefaultCustomerIfMatches(tenantId, assignment.userId, customerId, revokedBy);
      }
    }

    return updated;
  }

  async getUserAssignments(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    const assignments = await this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);
    return this.withScopeNames(tenantId, assignments);
  }

  /**
   * Resolve human-readable names for `customer:<uuid>` scopes so UIs can show
   * "Myio" instead of the raw uuid (UserDetail/RoleDetail already prefer
   * `scopeName` and fall back to the raw scope). Other scope forms (global,
   * partner:, ...) are returned untouched. Read-only enrichment — never persisted.
   */
  private async withScopeNames(tenantId: string, assignments: RoleAssignment[]): Promise<RoleAssignment[]> {
    const customerIds = [...new Set(
      assignments
        .map((a) => a.scope)
        .filter((s): s is string => !!s && s.startsWith('customer:'))
        .map((s) => s.slice('customer:'.length)),
    )];
    if (customerIds.length === 0) return assignments;

    const entries = await Promise.all(
      customerIds.map(async (id) => {
        try {
          const customer = await this.customerRepository.getById(tenantId, id);
          return [id, customer?.name] as const;
        } catch {
          return [id, undefined] as const; // enrichment must never break the listing
        }
      }),
    );
    const nameById = new Map(entries.filter(([, name]) => !!name));

    return assignments.map((a) => {
      if (!a.scope?.startsWith('customer:')) return a;
      const name = nameById.get(a.scope.slice('customer:'.length));
      return name ? { ...a, scopeName: name } : a;
    });
  }

  /**
   * Get role keys for a user (used by AuthService for JWT/login response)
   * Returns array of role keys like ['role:super-admin', 'role:viewer']
   */
  async getUserRoleKeys(tenantId: string, userId: string): Promise<string[]> {
    const assignments = await this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);
    return [...new Set(assignments.map(a => a.roleKey))];
  }

  async listAssignments(
    tenantId: string,
    params?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResult<AssignmentListItem>> {
    const page = await this.roleAssignmentRepository.list(tenantId, params);

    const userIds = new Set<string>();
    const roleKeys = new Set<string>();
    for (const a of page.items) {
      if (a.userId) userIds.add(a.userId);
      if (a.grantedBy) userIds.add(a.grantedBy);
      if (a.roleKey) roleKeys.add(a.roleKey);
    }

    const [userRows, roleRows] = await Promise.all([
      userIds.size > 0
        ? this.userRepository.getByIds(tenantId, Array.from(userIds))
        : Promise.resolve([]),
      roleKeys.size > 0
        ? Promise.all(
            Array.from(roleKeys).map((k) => this.roleRepository.getByKey(tenantId, k)),
          )
        : Promise.resolve([]),
    ]);

    const userMap = new Map<string, AssignmentUserRef>();
    for (const u of userRows) {
      const displayName =
        u.profile?.displayName ||
        `${u.profile?.firstName ?? ''} ${u.profile?.lastName ?? ''}`.trim() ||
        null;
      userMap.set(u.id, { id: u.id, email: u.email ?? null, displayName });
    }

    const roleMap = new Map<string, string>();
    for (const r of roleRows) {
      if (r) roleMap.set(r.key, r.displayName);
    }

    const items: AssignmentListItem[] = page.items.map((a) => ({
      ...a,
      user: userMap.get(a.userId) ?? null,
      grantedByUser: a.grantedBy ? userMap.get(a.grantedBy) ?? null : null,
      roleDisplayName: roleMap.get(a.roleKey) ?? null,
    }));

    return { items, pagination: page.pagination };
  }

  // ==================== Permission Evaluation ====================

  async evaluatePermission(
    tenantId: string,
    data: EvaluatePermissionDTO
  ): Promise<PermissionEvaluationResult> {
    const result = await this.checkPermission(tenantId, data.userId, data.permission, data.resourceScope);
    return result;
  }

  async evaluateBatch(
    tenantId: string,
    data: EvaluateBatchDTO
  ): Promise<BatchEvaluationResult> {
    const results: Record<string, PermissionEvaluationResult> = {};
    let allowed = 0;
    let denied = 0;

    for (const permission of data.permissions) {
      const result = await this.checkPermission(tenantId, data.userId, permission, data.resourceScope);
      results[permission] = result;

      if (result.allowed) {
        allowed++;
      } else {
        denied++;
      }
    }

    return {
      results,
      summary: {
        total: data.permissions.length,
        allowed,
        denied,
      },
    };
  }

  async getEffectivePermissions(
    tenantId: string,
    userId: string,
    scope?: string
  ): Promise<EffectivePermission[]> {
    // Get user's active assignments
    const assignments = await this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);

    // Filter by scope if provided
    const relevantAssignments = scope
      ? assignments.filter((a) => this.scopeMatches(a.scope, scope))
      : assignments;

    // Get all roles
    const roleKeys = [...new Set(relevantAssignments.map((a) => a.roleKey))];
    const roles = await this.roleRepository.getByKeys(tenantId, roleKeys);

    // Get all policies from roles
    const policyKeys = [...new Set(roles.flatMap((r) => r.policies))];
    const policies = await this.policyRepository.getByKeys(tenantId, policyKeys);

    // Build effective permissions map
    const permissionsMap = new Map<string, EffectivePermission>();

    // Process allow permissions
    for (const policy of policies) {
      for (const perm of policy.allow) {
        const existing = permissionsMap.get(perm);
        if (!existing || !existing.allowed) {
          permissionsMap.set(perm, {
            permission: perm,
            allowed: true,
            source: policy.key,
            conditions: policy.conditions,
          });
        }
      }

      // Process deny (deny always wins)
      for (const perm of policy.deny) {
        permissionsMap.set(perm, {
          permission: perm,
          allowed: false,
          source: policy.key,
          conditions: policy.conditions,
        });
      }
    }

    return Array.from(permissionsMap.values());
  }

  /**
   * Returns the full authorization snapshot for a user: every active assignment
   * with its role expanded and each role's policies fully loaded (allow, deny,
   * conditions), plus the flat effective-permissions view.
   *
   * Designed to be the one-shot backing endpoint for `GET /auth/me`.
   * Cost: 3 queries total (assignments, roles by keys, policies by keys).
   */
  async getUserFullAuthz(tenantId: string, userId: string): Promise<UserFullAuthz> {
    const assignments = await this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);

    const roleKeys = [...new Set(assignments.map((a) => a.roleKey))];
    const roles = roleKeys.length > 0 ? await this.roleRepository.getByKeys(tenantId, roleKeys) : [];
    const rolesByKey = new Map(roles.map((r) => [r.key, r]));

    const policyKeys = [...new Set(roles.flatMap((r) => r.policies))];
    const policies = policyKeys.length > 0 ? await this.policyRepository.getByKeys(tenantId, policyKeys) : [];
    const policiesByKey = new Map(policies.map((p) => [p.key, p]));

    const toEnrichedPolicy = (p: Policy): EnrichedPolicy => ({
      key: p.key,
      displayName: p.displayName,
      description: p.description,
      allow: p.allow,
      deny: p.deny,
      conditions: p.conditions,
      riskLevel: p.riskLevel,
    });

    const toEnrichedRole = (r: Role): EnrichedRole => ({
      key: r.key,
      displayName: r.displayName,
      description: r.description,
      riskLevel: r.riskLevel,
      isSystem: r.isSystem,
      policies: r.policies
        .map((pk) => policiesByKey.get(pk))
        .filter((p): p is Policy => p !== undefined)
        .map(toEnrichedPolicy),
    });

    const enrichedAssignments: EnrichedAssignment[] = assignments.map((a) => {
      const role = rolesByKey.get(a.roleKey);
      return {
        id: a.id,
        scope: a.scope,
        status: a.status,
        grantedAt: a.grantedAt,
        grantedBy: a.grantedBy,
        expiresAt: a.expiresAt,
        reason: a.reason,
        role: role ? toEnrichedRole(role) : null,
      };
    });

    // Compute effective/denied from the already-loaded policies (no extra queries).
    const effectiveMap = new Map<string, boolean>();
    for (const policy of policies) {
      for (const perm of policy.allow) {
        if (!effectiveMap.has(perm)) effectiveMap.set(perm, true);
      }
      for (const perm of policy.deny) {
        effectiveMap.set(perm, false);
      }
    }

    const effectivePermissions: string[] = [];
    const deniedPatterns: string[] = [];
    for (const [perm, allowed] of effectiveMap) {
      (allowed ? effectivePermissions : deniedPatterns).push(perm);
    }

    return { assignments: enrichedAssignments, effectivePermissions, deniedPatterns };
  }

  // ==================== Private Helpers ====================

  private async checkPermission(
    tenantId: string,
    userId: string,
    permission: string,
    resourceScope: string
  ): Promise<PermissionEvaluationResult> {
    const evaluatedAt = new Date().toISOString();

    // Get user's active role assignments
    const assignments = await this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);

    // Filter assignments by scope
    const relevantAssignments = assignments.filter((a) => this.scopeMatches(a.scope, resourceScope));

    if (relevantAssignments.length === 0) {
      return {
        allowed: false,
        reason: 'No active role assignments found for this scope',
        matchedPolicies: [],
        evaluatedAt,
      };
    }

    // Get roles
    const roleKeys = relevantAssignments.map((a) => a.roleKey);
    const roles = await this.roleRepository.getByKeys(tenantId, roleKeys);

    if (roles.length === 0) {
      return {
        allowed: false,
        reason: 'No roles found for assignments',
        matchedPolicies: [],
        evaluatedAt,
      };
    }

    // Get all policies from roles
    const policyKeys = [...new Set(roles.flatMap((r) => r.policies))];
    const policies = await this.policyRepository.getByKeys(tenantId, policyKeys);

    const matchedPolicies: string[] = [];
    let isAllowed = false;
    let isDenied = false;
    let denyReason = '';

    for (const policy of policies) {
      // Check deny first (deny always wins)
      if (this.permissionMatches(policy.deny, permission)) {
        isDenied = true;
        denyReason = `Explicitly denied by policy: ${policy.key}`;
        matchedPolicies.push(policy.key);
        break;
      }

      // Check allow
      if (this.permissionMatches(policy.allow, permission)) {
        isAllowed = true;
        matchedPolicies.push(policy.key);
      }
    }

    if (isDenied) {
      return {
        allowed: false,
        reason: denyReason,
        matchedPolicies,
        evaluatedAt,
      };
    }

    if (isAllowed) {
      return {
        allowed: true,
        reason: 'Permission granted by policy',
        matchedPolicies,
        evaluatedAt,
      };
    }

    return {
      allowed: false,
      reason: 'Permission not found in any assigned policies',
      matchedPolicies: [],
      evaluatedAt,
    };
  }

  private scopeMatches(assignmentScope: string, resourceScope: string): boolean {
    // Exact match
    if (assignmentScope === resourceScope) {
      return true;
    }

    // Wildcard match (e.g., "customer:*" matches "customer:123")
    if (assignmentScope.endsWith('*')) {
      const prefix = assignmentScope.slice(0, -1);
      return resourceScope.startsWith(prefix);
    }

    // Hierarchical match (e.g., "customer:123" should match "customer:123/asset:456")
    if (resourceScope.startsWith(assignmentScope + '/')) {
      return true;
    }

    // Global scope
    if (assignmentScope === '*') {
      return true;
    }

    return false;
  }

  private permissionMatches(permissions: string[], targetPermission: string): boolean {
    const [targetDomain, targetFunction, targetAction] = targetPermission.split('.');

    for (const perm of permissions) {
      const [domain, func, action] = perm.split('.');

      // Check domain
      if (domain !== '*' && domain !== targetDomain) {
        continue;
      }

      // Check function
      if (func !== '*' && func !== targetFunction) {
        continue;
      }

      // Check action
      if (action !== '*' && action !== targetAction) {
        continue;
      }

      return true;
    }

    return false;
  }

  private validatePermissionFormat(permissions: string[]): void {
    const permissionRegex = /^[a-z*]+\.[a-z*]+\.[a-z*]+$/;

    for (const perm of permissions) {
      if (!permissionRegex.test(perm)) {
        throw new Error(
          `Invalid permission format: ${perm}. Expected format: domain.function.action (e.g., energy.settings.read)`
        );
      }
    }
  }
}

export const authorizationService = new AuthorizationService();
