import { RiskLevel } from '../../shared/types';

export interface DomainPermission {
  id: string;
  tenantId?: string;
  domain: string;
  equipment: string;
  location: string;
  action: string;
  displayName?: string;
  description?: string;
  riskLevel: RiskLevel;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DomainPermissionKey {
  domain: string;
  equipment: string;
  location: string;
  action: string;
}

export function formatDomainPermissionKey(perm: DomainPermissionKey): string {
  return `${perm.domain}.${perm.equipment}.${perm.location}:${perm.action}`;
}

export function parseDomainPermissionKey(key: string): DomainPermissionKey | null {
  const match = key.match(/^(\w+)\.(\w+)\.(\w+):(\w+)$/);
  if (!match) return null;

  return {
    domain: match[1],
    equipment: match[2],
    location: match[3],
    action: match[4],
  };
}
