import { Group, GroupSummary } from '../domain/entities/Group';
import {
  CreateGroupDTO,
  UpdateGroupDTO,
  AddMembersDTO,
  ListGroupsQuery,
} from '../dto/request/GroupDTO';
import { GroupRepository, groupRepository } from '../repositories/GroupRepository';
import { IGroupRepository } from '../repositories/interfaces/IGroupRepository';
import { PaginatedResult } from '../shared/types';
import { AppError } from '../shared/errors/AppError';

export class GroupService {
  private groupRepository: IGroupRepository;

  constructor(repository?: IGroupRepository) {
    this.groupRepository = repository || groupRepository;
  }

  /**
   * Create a new group
   */
  async createGroup(
    tenantId: string,
    customerId: string,
    data: CreateGroupDTO,
    createdBy: string
  ): Promise<Group> {
    // Validate member types match group type
    if (data.members && data.members.length > 0 && data.type !== 'MIXED') {
      const invalidMembers = data.members.filter(m => m.type !== data.type);
      if (invalidMembers.length > 0) {
        throw new AppError(
          'INVALID_MEMBER_TYPE',
          `Group of type '${data.type}' cannot contain members of different types`,
          400
        );
      }
    }

    return this.groupRepository.create(tenantId, customerId, data, createdBy);
  }

  /**
   * Get a group by ID
   */
  async getGroup(tenantId: string, groupId: string): Promise<Group> {
    const group = await this.groupRepository.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }
    return group;
  }

  /**
   * Get a group by code
   */
  async getGroupByCode(tenantId: string, customerId: string, code: string): Promise<Group> {
    const group = await this.groupRepository.getByCode(tenantId, customerId, code);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', `Group with code '${code}' not found`, 404);
    }
    return group;
  }

  /**
   * Update a group
   */
  async updateGroup(
    tenantId: string,
    groupId: string,
    data: UpdateGroupDTO,
    updatedBy: string
  ): Promise<Group> {
    return this.groupRepository.update(tenantId, groupId, data, updatedBy);
  }

  /**
   * Delete a group (hard delete)
   */
  async deleteGroup(tenantId: string, groupId: string): Promise<void> {
    return this.groupRepository.delete(tenantId, groupId);
  }

  /**
   * Soft delete a group
   */
  async softDeleteGroup(tenantId: string, groupId: string, deletedBy: string): Promise<void> {
    return this.groupRepository.softDelete(tenantId, groupId, deletedBy);
  }

  /**
   * List groups with filters
   */
  async listGroups(tenantId: string, params: ListGroupsQuery): Promise<PaginatedResult<GroupSummary>> {
    return this.groupRepository.list(tenantId, params);
  }

  /**
   * List groups by customer
   */
  async listGroupsByCustomer(
    tenantId: string,
    customerId: string,
    params?: Omit<ListGroupsQuery, 'customerId'>
  ): Promise<PaginatedResult<GroupSummary>> {
    return this.groupRepository.listByCustomer(tenantId, customerId, params);
  }

  /**
   * Add members to a group
   */
  async addMembers(
    tenantId: string,
    groupId: string,
    data: AddMembersDTO,
    addedBy: string
  ): Promise<Group> {
    return this.groupRepository.addMembers(tenantId, groupId, data.members, addedBy);
  }

  /**
   * Remove members from a group
   */
  async removeMembers(
    tenantId: string,
    groupId: string,
    memberIds: string[],
    removedBy: string
  ): Promise<Group> {
    return this.groupRepository.removeMembers(tenantId, groupId, memberIds, removedBy);
  }

  /**
   * Get all groups that a member belongs to
   */
  async getGroupsByMember(
    tenantId: string,
    memberId: string,
    memberType: 'USER' | 'DEVICE' | 'ASSET'
  ): Promise<GroupSummary[]> {
    return this.groupRepository.getGroupsByMember(tenantId, memberId, memberType);
  }

  /**
   * Get child groups
   */
  async getChildGroups(tenantId: string, parentGroupId: string): Promise<GroupSummary[]> {
    return this.groupRepository.getChildren(tenantId, parentGroupId);
  }

  /**
   * Get all descendant groups
   */
  async getDescendantGroups(tenantId: string, parentGroupId: string): Promise<GroupSummary[]> {
    return this.groupRepository.getDescendants(tenantId, parentGroupId);
  }

  /**
   * Move a group to a new parent
   */
  async moveGroup(
    tenantId: string,
    groupId: string,
    newParentGroupId: string | null,
    movedBy: string
  ): Promise<Group> {
    return this.groupRepository.moveGroup(tenantId, groupId, newParentGroupId, movedBy);
  }

  /**
   * Get member IDs by type from a group
   */
  async getMemberIds(
    tenantId: string,
    groupId: string,
    memberType?: 'USER' | 'DEVICE' | 'ASSET'
  ): Promise<string[]> {
    const group = await this.getGroup(tenantId, groupId);

    if (memberType) {
      return group.members
        .filter(m => m.type === memberType)
        .map(m => m.id);
    }

    return group.members.map(m => m.id);
  }

  /**
   * Get all user IDs from a group (convenience method for notifications)
   */
  async getUserIds(tenantId: string, groupId: string): Promise<string[]> {
    return this.getMemberIds(tenantId, groupId, 'USER');
  }

  /**
   * Get all device IDs from a group (convenience method for rules)
   */
  async getDeviceIds(tenantId: string, groupId: string): Promise<string[]> {
    return this.getMemberIds(tenantId, groupId, 'DEVICE');
  }

  /**
   * Get all asset IDs from a group
   */
  async getAssetIds(tenantId: string, groupId: string): Promise<string[]> {
    return this.getMemberIds(tenantId, groupId, 'ASSET');
  }

  /**
   * Check if a member is in a group
   */
  async isMemberInGroup(
    tenantId: string,
    groupId: string,
    memberId: string,
    memberType: 'USER' | 'DEVICE' | 'ASSET'
  ): Promise<boolean> {
    const group = await this.getGroup(tenantId, groupId);
    return group.members.some(m => m.id === memberId && m.type === memberType);
  }

  /**
   * Get groups by IDs
   */
  async getGroupsByIds(tenantId: string, groupIds: string[]): Promise<Group[]> {
    return this.groupRepository.getByIds(tenantId, groupIds);
  }

  /**
   * Get all notification-enabled groups for a customer
   */
  async getNotificationGroups(tenantId: string, customerId: string): Promise<GroupSummary[]> {
    const result = await this.groupRepository.listByCustomer(tenantId, customerId, {
      purpose: 'NOTIFICATION',
      status: 'ACTIVE',
      limit: 100,
    });
    return result.items;
  }

  /**
   * Get all escalation groups for a customer
   */
  async getEscalationGroups(tenantId: string, customerId: string): Promise<GroupSummary[]> {
    const result = await this.groupRepository.listByCustomer(tenantId, customerId, {
      purpose: 'ESCALATION',
      status: 'ACTIVE',
      limit: 100,
    });
    return result.items;
  }
}

export const groupService = new GroupService();
