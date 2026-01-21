import { z } from 'zod';

// Group Types
export const GroupTypeEnum = z.enum(['USER', 'DEVICE', 'ASSET', 'MIXED']);
export const GroupPurposeEnum = z.enum([
  'NOTIFICATION',
  'ESCALATION',
  'ACCESS_CONTROL',
  'REPORTING',
  'MAINTENANCE',
  'MONITORING',
  'CUSTOM',
]);

// Notification Channel Schema
const NotificationChannelSchema = z.object({
  type: z.enum(['EMAIL', 'SMS', 'WEBHOOK', 'SLACK', 'TEAMS', 'TELEGRAM', 'PUSH']),
  enabled: z.boolean(),
  config: z.record(z.string()).optional(),
});

// Schedule Schema
const ScheduleSchema = z.object({
  timezone: z.string().default('America/Sao_Paulo'),
  quietHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().min(0).max(6)),
  }).optional(),
  businessHoursOnly: z.boolean().optional(),
  businessHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().min(0).max(6)),
  }).optional(),
});

// Notification Settings Schema
const NotificationSettingsSchema = z.object({
  channels: z.array(NotificationChannelSchema),
  schedule: ScheduleSchema.optional(),
  escalationDelayMinutes: z.number().min(0).optional(),
  digestEnabled: z.boolean().optional(),
  digestIntervalMinutes: z.number().min(5).optional(),
});

// Member Schema
const MemberSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['USER', 'DEVICE', 'ASSET']),
  metadata: z.record(z.unknown()).optional(),
});

// Create Group DTO
export const CreateGroupSchema = z.object({
  name: z.string().min(2).max(100),
  displayName: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional(),
  code: z.string().min(2).max(50).regex(/^[A-Z0-9_-]+$/).optional(),
  type: GroupTypeEnum,
  purposes: z.array(GroupPurposeEnum).min(1),
  members: z.array(MemberSchema).optional().default([]),
  parentGroupId: z.string().uuid().optional(),
  notificationSettings: NotificationSettingsSchema.optional(),
  tags: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
  visibleToChildCustomers: z.boolean().optional().default(false),
  editableByChildCustomers: z.boolean().optional().default(false),
});

export type CreateGroupDTO = z.infer<typeof CreateGroupSchema>;

// Update Group DTO
export const UpdateGroupSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  displayName: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional(),
  code: z.string().min(2).max(50).regex(/^[A-Z0-9_-]+$/).optional(),
  purposes: z.array(GroupPurposeEnum).min(1).optional(),
  notificationSettings: NotificationSettingsSchema.optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  visibleToChildCustomers: z.boolean().optional(),
  editableByChildCustomers: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type UpdateGroupDTO = z.infer<typeof UpdateGroupSchema>;

// Add Members DTO
export const AddMembersSchema = z.object({
  members: z.array(MemberSchema).min(1).max(100),
});

export type AddMembersDTO = z.infer<typeof AddMembersSchema>;

// Remove Members DTO
export const RemoveMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(100),
});

export type RemoveMembersDTO = z.infer<typeof RemoveMembersSchema>;

// List Groups Query Params
export const ListGroupsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  type: GroupTypeEnum.optional(),
  purpose: GroupPurposeEnum.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  parentGroupId: z.string().uuid().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export type ListGroupsQuery = z.infer<typeof ListGroupsQuerySchema>;

// Get Groups by Member DTO
export const GetGroupsByMemberSchema = z.object({
  memberId: z.string().uuid(),
  memberType: z.enum(['USER', 'DEVICE', 'ASSET']),
});

export type GetGroupsByMemberDTO = z.infer<typeof GetGroupsByMemberSchema>;
