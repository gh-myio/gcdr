import { z } from 'zod';

// Evaluate Permission DTO
export const EvaluatePermissionSchema = z.object({
  userId: z.string().min(1),
  permission: z.string().regex(/^[a-z]+\.[a-z]+\.[a-z]+$/),
  resourceScope: z.string().min(1),
});

export type EvaluatePermissionDTO = z.infer<typeof EvaluatePermissionSchema>;

// Batch Evaluate DTO
export const EvaluateBatchSchema = z.object({
  userId: z.string().min(1),
  resourceScope: z.string().min(1),
  permissions: z.array(z.string().regex(/^[a-z]+\.[a-z]+\.[a-z]+$/)).min(1).max(100),
});

export type EvaluateBatchDTO = z.infer<typeof EvaluateBatchSchema>;

// Create Role DTO
export const CreateRoleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  policies: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
});

export type CreateRoleDTO = z.infer<typeof CreateRoleSchema>;

// Update Role DTO
export const UpdateRoleSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  policies: z.array(z.string()).min(1).optional(),
  tags: z.array(z.string()).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export type UpdateRoleDTO = z.infer<typeof UpdateRoleSchema>;

// Create Policy DTO
export const CreatePolicySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  conditions: z
    .object({
      requiresMFA: z.boolean().optional(),
      onlyBusinessHours: z.boolean().optional(),
      allowedDeviceTypes: z.array(z.string()).optional(),
      ipAllowlist: z.array(z.string()).optional(),
      maxSessionDuration: z.number().optional(),
    })
    .optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
});

export type CreatePolicyDTO = z.infer<typeof CreatePolicySchema>;

// Assign Role DTO
export const AssignRoleSchema = z.object({
  userId: z.string().min(1),
  roleKey: z.string().min(1),
  scope: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

export type AssignRoleDTO = z.infer<typeof AssignRoleSchema>;
