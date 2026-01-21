import { Group, GroupSummary } from '../../domain/entities/Group';
import { CreateGroupDTO, UpdateGroupDTO, AddMembersDTO } from '../../dto/request/GroupDTO';
import { PaginatedResult } from '../../shared/types';

export interface ListGroupsParams {
  customerId?: string;
  type?: 'USER' | 'DEVICE' | 'ASSET' | 'MIXED';
  purpose?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  parentGroupId?: string;
  tag?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface IGroupRepository {
  // CRUD
  create(tenantId: string, customerId: string, data: CreateGroupDTO, createdBy: string): Promise<Group>;
  getById(tenantId: string, id: string): Promise<Group | null>;
  getByCode(tenantId: string, customerId: string, code: string): Promise<Group | null>;
  update(tenantId: string, id: string, data: UpdateGroupDTO, updatedBy: string): Promise<Group>;
  delete(tenantId: string, id: string): Promise<void>;
  softDelete(tenantId: string, id: string, deletedBy: string): Promise<void>;

  // Listing
  list(tenantId: string, params?: ListGroupsParams): Promise<PaginatedResult<GroupSummary>>;
  listByCustomer(tenantId: string, customerId: string, params?: ListGroupsParams): Promise<PaginatedResult<GroupSummary>>;

  // Member Management
  addMembers(tenantId: string, groupId: string, members: AddMembersDTO['members'], addedBy: string): Promise<Group>;
  removeMembers(tenantId: string, groupId: string, memberIds: string[], removedBy: string): Promise<Group>;
  getGroupsByMember(tenantId: string, memberId: string, memberType: 'USER' | 'DEVICE' | 'ASSET'): Promise<GroupSummary[]>;

  // Hierarchy
  getChildren(tenantId: string, parentGroupId: string): Promise<GroupSummary[]>;
  getDescendants(tenantId: string, parentGroupId: string): Promise<GroupSummary[]>;
  moveGroup(tenantId: string, groupId: string, newParentGroupId: string | null, movedBy: string): Promise<Group>;

  // Bulk Operations
  getByIds(tenantId: string, ids: string[]): Promise<Group[]>;
  getMembersByType(tenantId: string, groupId: string, memberType: 'USER' | 'DEVICE' | 'ASSET'): Promise<string[]>;
}
