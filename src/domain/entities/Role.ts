import { BaseEntity, RiskLevel } from '../../shared/types';

export interface Role extends BaseEntity {
  key: string;
  displayName: string;
  description: string;
  policies: string[];
  tags: string[];
  riskLevel: RiskLevel;
  isSystem: boolean;
}
