import { z } from 'zod';

// =============================================================================
// Maintenance Group DTOs (RFC-0013)
// =============================================================================

// Create Maintenance Group DTO
export const CreateMaintenanceGroupSchema = z.object({
  key: z.string().min(3).max(100).regex(/^[a-z][a-z0-9_:-]*$/, {
    message: 'Key must start with a letter and contain only lowercase letters, numbers, underscores, colons, and hyphens',
  }),
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  customerId: z.string().uuid().optional(),
});

export type CreateMaintenanceGroupDTO = z.infer<typeof CreateMaintenanceGroupSchema>;

// Update Maintenance Group DTO
export const UpdateMaintenanceGroupSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateMaintenanceGroupDTO = z.infer<typeof UpdateMaintenanceGroupSchema>;

// Add Member to Group DTO
export const AddGroupMemberSchema = z.object({
  userId: z.string().uuid(),
  expiresAt: z.string().datetime().optional(),
});

export type AddGroupMemberDTO = z.infer<typeof AddGroupMemberSchema>;

// Add Multiple Members DTO
export const AddGroupMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

export type AddGroupMembersDTO = z.infer<typeof AddGroupMembersSchema>;

// Remove Members DTO
export const RemoveGroupMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});

export type RemoveGroupMembersDTO = z.infer<typeof RemoveGroupMembersSchema>;

// List Maintenance Groups Query
export const ListMaintenanceGroupsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
});

export type ListMaintenanceGroupsQuery = z.infer<typeof ListMaintenanceGroupsQuerySchema>;

// Get User's Groups Query
export const GetUserGroupsQuerySchema = z.object({
  includeExpired: z.coerce.boolean().optional().default(false),
});

export type GetUserGroupsQuery = z.infer<typeof GetUserGroupsQuerySchema>;
