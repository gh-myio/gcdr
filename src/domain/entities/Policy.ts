import { BaseEntity, RiskLevel } from '../../shared/types';

export interface PolicyConditions {
  requiresMFA?: boolean;
  onlyBusinessHours?: boolean;
  allowedDeviceTypes?: string[];
  ipAllowlist?: string[];
  maxSessionDuration?: number;
}

export interface Policy extends BaseEntity {
  key: string;
  displayName: string;
  description: string;
  allow: string[];
  deny: string[];
  conditions?: PolicyConditions;
  riskLevel: RiskLevel;
  isSystem: boolean;
}
