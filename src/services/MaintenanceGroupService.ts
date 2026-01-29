import {
  MaintenanceGroup,
  MaintenanceGroupWithMembers,
  MaintenanceGroupMember,
} from '../domain/entities/MaintenanceGroup';
import {
  CreateMaintenanceGroupDTO,
  UpdateMaintenanceGroupDTO,
  ListMaintenanceGroupsQuery,
} from '../dto/request/MaintenanceGroupDTO';
import {
  maintenanceGroupRepository,
  MaintenanceGroupRepository,
} from '../repositories/MaintenanceGroupRepository';
import { userRepository, UserRepository } from '../repositories/UserRepository';
import { PaginatedResult } from '../shared/types';
import { AppError } from '../shared/errors/AppError';
import { eventService, EventType } from '../shared/events';

export class MaintenanceGroupService {
  constructor(
    private groupRepository: MaintenanceGroupRepository = maintenanceGroupRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  // =========================================================================
  // Group CRUD
  // =========================================================================

  async createGroup(
    tenantId: string,
    data: CreateMaintenanceGroupDTO,
    createdBy: string
  ): Promise<MaintenanceGroup> {
    const group = await this.groupRepository.create(tenantId, data, createdBy);

    await eventService.publish(EventType.ENTITY_CREATED, {
      tenantId,
      entityType: 'maintenance_group',
      entityId: group.id,
      action: 'CREATE',
      userId: createdBy,
      newValues: { key: group.key, name: group.name },
    });

    return group;
  }

  async getGroupById(tenantId: string, id: string): Promise<MaintenanceGroup | null> {
    return this.groupRepository.getById(tenantId, id);
  }

  async getGroupByKey(tenantId: string, key: string): Promise<MaintenanceGroup | null> {
    return this.groupRepository.getByKey(tenantId, key);
  }

  async getGroupWithMembers(tenantId: string, id: string): Promise<MaintenanceGroupWithMembers | null> {
    return this.groupRepository.getByIdWithMembers(tenantId, id);
  }

  async updateGroup(
    tenantId: string,
    id: string,
    data: UpdateMaintenanceGroupDTO,
    updatedBy: string
  ): Promise<MaintenanceGroup> {
    const group = await this.groupRepository.update(tenantId, id, data, updatedBy);

    await eventService.publish(EventType.ENTITY_UPDATED, {
      tenantId,
      entityType: 'maintenance_group',
      entityId: group.id,
      action: 'UPDATE',
      userId: updatedBy,
      newValues: data,
    });

    return group;
  }

  async deleteGroup(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const group = await this.groupRepository.getById(tenantId, id);
    if (!group) {
      throw new AppError('MAINTENANCE_GROUP_NOT_FOUND', 'Maintenance group not found', 404);
    }

    await this.groupRepository.delete(tenantId, id);

    await eventService.publish(EventType.ENTITY_DELETED, {
      tenantId,
      entityType: 'maintenance_group',
      entityId: id,
      action: 'DELETE',
      userId: deletedBy,
      oldValues: { key: group.key, name: group.name },
    });
  }

  async listGroups(
    tenantId: string,
    params?: ListMaintenanceGroupsQuery
  ): Promise<PaginatedResult<MaintenanceGroup>> {
    return this.groupRepository.list(tenantId, params);
  }

  // =========================================================================
  // Member Management
  // =========================================================================

  async addMember(
    tenantId: string,
    groupId: string,
    userId: string,
    assignedBy: string,
    expiresAt?: string
  ): Promise<void> {
    // Verify user exists
    const user = await this.userRepo.getById(tenantId, userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    await this.groupRepository.addMember(tenantId, groupId, userId, assignedBy, expiresAt);

    await eventService.publish(EventType.USER_GROUP_CHANGED, {
      tenantId,
      entityType: 'user_maintenance_group',
      entityId: `${groupId}:${userId}`,
      action: 'MEMBER_ADDED',
      userId: assignedBy,
      newValues: { groupId, userId, expiresAt },
    });
  }

  async addMembers(
    tenantId: string,
    groupId: string,
    userIds: string[],
    assignedBy: string,
    expiresAt?: string
  ): Promise<void> {
    // Verify all users exist
    for (const userId of userIds) {
      const user = await this.userRepo.getById(tenantId, userId);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', `User ${userId} not found`, 404);
      }
    }

    await this.groupRepository.addMembers(tenantId, groupId, userIds, assignedBy, expiresAt);

    await eventService.publish(EventType.USER_GROUP_CHANGED, {
      tenantId,
      entityType: 'user_maintenance_group',
      entityId: groupId,
      action: 'MEMBERS_ADDED',
      userId: assignedBy,
      newValues: { groupId, userIds, count: userIds.length },
    });
  }

  async removeMember(tenantId: string, groupId: string, userId: string, removedBy: string): Promise<void> {
    await this.groupRepository.removeMember(tenantId, groupId, userId);

    await eventService.publish(EventType.USER_GROUP_CHANGED, {
      tenantId,
      entityType: 'user_maintenance_group',
      entityId: `${groupId}:${userId}`,
      action: 'MEMBER_REMOVED',
      userId: removedBy,
      oldValues: { groupId, userId },
    });
  }

  async removeMembers(
    tenantId: string,
    groupId: string,
    userIds: string[],
    removedBy: string
  ): Promise<void> {
    await this.groupRepository.removeMembers(tenantId, groupId, userIds);

    await eventService.publish(EventType.USER_GROUP_CHANGED, {
      tenantId,
      entityType: 'user_maintenance_group',
      entityId: groupId,
      action: 'MEMBERS_REMOVED',
      userId: removedBy,
      oldValues: { groupId, userIds, count: userIds.length },
    });
  }

  async getMembers(
    tenantId: string,
    groupId: string,
    includeExpired = false
  ): Promise<MaintenanceGroupMember[]> {
    return this.groupRepository.getMembers(tenantId, groupId, includeExpired);
  }

  // =========================================================================
  // User's Groups
  // =========================================================================

  async getUserGroups(
    tenantId: string,
    userId: string,
    includeExpired = false
  ): Promise<MaintenanceGroup[]> {
    return this.groupRepository.getUserGroups(tenantId, userId, includeExpired);
  }

  async getUserPrimaryGroup(tenantId: string, userId: string): Promise<MaintenanceGroup | null> {
    return this.groupRepository.getUserPrimaryGroup(tenantId, userId);
  }
}

// Export singleton instance
export const maintenanceGroupService = new MaintenanceGroupService();
