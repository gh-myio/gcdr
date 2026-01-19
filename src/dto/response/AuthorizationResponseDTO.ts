export interface AuthzDecision {
  allowed: boolean;
  reason: string;
  policyVersion?: number;
  scopeMatched?: string;
  deniedPermission?: string;
  evaluatedAt: string;
}

export interface BatchAuthzResult {
  results: Record<string, { allowed: boolean; reason?: string }>;
  evaluatedAt: string;
}

export interface EffectivePermissionsDTO {
  userId: string;
  scope: string;
  effectivePermissions: string[];
  deniedPatterns: string[];
  roles: {
    roleKey: string;
    scope: string;
    grantedAt: string;
  }[];
}

export interface RoleResponseDTO {
  id: string;
  key: string;
  displayName: string;
  description: string;
  policies: string[];
  tags: string[];
  riskLevel: string;
  isSystem: boolean;
  tenantId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyResponseDTO {
  id: string;
  key: string;
  displayName: string;
  description: string;
  allow: string[];
  deny: string[];
  conditions?: {
    requiresMFA?: boolean;
    onlyBusinessHours?: boolean;
    allowedDeviceTypes?: string[];
    ipAllowlist?: string[];
    maxSessionDuration?: number;
  };
  riskLevel: string;
  isSystem: boolean;
  tenantId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleAssignmentResponseDTO {
  id: string;
  userId: string;
  roleKey: string;
  scope: string;
  status: string;
  expiresAt?: string;
  grantedBy: string;
  grantedAt: string;
  reason?: string;
  tenantId: string;
  createdAt: string;
}
