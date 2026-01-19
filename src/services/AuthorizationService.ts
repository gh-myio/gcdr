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
import { IRoleRepository, ListRolesParams } from '../repositories/interfaces/IRoleRepository';
import { IPolicyRepository, ListPoliciesParams, UpdatePolicyDTO } from '../repositories/interfaces/IPolicyRepository';
import { IRoleAssignmentRepository, UpdateRoleAssignmentDTO } from '../repositories/interfaces/IRoleAssignmentRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult, RiskLevel } from '../shared/types';
import { NotFoundError, ForbiddenError, ConflictError } from '../shared/errors/AppError';

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

export class AuthorizationService {
  private roleRepository: IRoleRepository;
  private policyRepository: IPolicyRepository;
  private roleAssignmentRepository: IRoleAssignmentRepository;

  constructor(
    roleRepository?: IRoleRepository,
    policyRepository?: IPolicyRepository,
    roleAssignmentRepository?: IRoleAssignmentRepository
  ) {
    this.roleRepository = roleRepository || new RoleRepository();
    this.policyRepository = policyRepository || new PolicyRepository();
    this.roleAssignmentRepository = roleAssignmentRepository || new RoleAssignmentRepository();
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

    await eventService.publish(EventType.ROLE_CREATED, {
      tenantId,
      entityType: 'role',
      entityId: role.id,
      action: 'created',
      data: { key: role.key, displayName: role.displayName },
      actor: { userId, type: 'user' },
    });

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

    await eventService.publish(EventType.ROLE_UPDATED, {
      tenantId,
      entityType: 'role',
      entityId: role.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

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

    await eventService.publish(EventType.ROLE_DELETED, {
      tenantId,
      entityType: 'role',
      entityId: id,
      action: 'deleted',
      data: { key: role.key },
      actor: { userId, type: 'user' },
    });
  }

  async listRoles(tenantId: string, params: ListRolesParams): Promise<PaginatedResult<Role>> {
    return this.roleRepository.listWithFilters(tenantId, params);
  }

  // ==================== Policy Management ====================

  async createPolicy(tenantId: string, data: CreatePolicyDTO, userId: string): Promise<Policy> {
    // Validate permissions format
    this.validatePermissionFormat([...data.allow, ...data.deny]);

    const policy = await this.policyRepository.create(tenantId, data, userId);

    await eventService.publish(EventType.POLICY_CREATED, {
      tenantId,
      entityType: 'policy',
      entityId: policy.id,
      action: 'created',
      data: { key: policy.key, displayName: policy.displayName },
      actor: { userId, type: 'user' },
    });

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

    await eventService.publish(EventType.POLICY_UPDATED, {
      tenantId,
      entityType: 'policy',
      entityId: policy.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

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

    await eventService.publish(EventType.POLICY_DELETED, {
      tenantId,
      entityType: 'policy',
      entityId: id,
      action: 'deleted',
      data: { key: policy.key },
      actor: { userId, type: 'user' },
    });
  }

  async listPolicies(tenantId: string, params: ListPoliciesParams): Promise<PaginatedResult<Policy>> {
    return this.policyRepository.listWithFilters(tenantId, params);
  }

  // ==================== Role Assignment ====================

  async assignRole(tenantId: string, data: AssignRoleDTO, grantedBy: string): Promise<RoleAssignment> {
    // Validate role exists
    const role = await this.roleRepository.getByKey(tenantId, data.roleKey);
    if (!role) {
      throw new NotFoundError(`Role with key '${data.roleKey}' not found`);
    }

    const assignment = await this.roleAssignmentRepository.create(tenantId, data, grantedBy);

    await eventService.publish(EventType.ROLE_ASSIGNED, {
      tenantId,
      entityType: 'roleAssignment',
      entityId: assignment.id,
      action: 'assigned',
      data: {
        userId: data.userId,
        roleKey: data.roleKey,
        scope: data.scope,
      },
      actor: { userId: grantedBy, type: 'user' },
    });

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

    await eventService.publish(EventType.ROLE_REVOKED, {
      tenantId,
      entityType: 'roleAssignment',
      entityId: assignmentId,
      action: 'revoked',
      data: {
        userId: assignment.userId,
        roleKey: assignment.roleKey,
        scope: assignment.scope,
      },
      actor: { userId: revokedBy, type: 'user' },
    });

    return updated;
  }

  async getUserAssignments(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    return this.roleAssignmentRepository.getActiveByUserId(tenantId, userId);
  }

  async listAssignments(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<RoleAssignment>> {
    return this.roleAssignmentRepository.list(tenantId, params);
  }

  // ==================== Permission Evaluation ====================

  async evaluatePermission(
    tenantId: string,
    data: EvaluatePermissionDTO,
    evaluatedBy?: string
  ): Promise<PermissionEvaluationResult> {
    const result = await this.checkPermission(tenantId, data.userId, data.permission, data.resourceScope);

    // Log evaluation
    await eventService.publish(EventType.PERMISSION_EVALUATED, {
      tenantId,
      entityType: 'permission',
      entityId: data.userId,
      action: 'evaluated',
      data: {
        permission: data.permission,
        resourceScope: data.resourceScope,
        allowed: result.allowed,
        reason: result.reason,
      },
      actor: evaluatedBy ? { userId: evaluatedBy, type: 'user' } : { userId: 'system', type: 'system' },
    });

    return result;
  }

  async evaluateBatch(
    tenantId: string,
    data: EvaluateBatchDTO,
    evaluatedBy?: string
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

    // Log batch evaluation
    await eventService.publish(EventType.PERMISSION_EVALUATED, {
      tenantId,
      entityType: 'permission',
      entityId: data.userId,
      action: 'batch_evaluated',
      data: {
        permissions: data.permissions,
        resourceScope: data.resourceScope,
        summary: { total: data.permissions.length, allowed, denied },
      },
      actor: evaluatedBy ? { userId: evaluatedBy, type: 'user' } : { userId: 'system', type: 'system' },
    });

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
