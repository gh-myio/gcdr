import {
  RuleType,
  RulePriority,
  RuleScope,
  AlarmThresholdConfig,
  SLAConfig,
  EscalationConfig,
  MaintenanceWindowConfig,
  NotificationChannel,
} from '../../domain/entities/Rule';
import { EntityStatus } from '../../shared/types';

export interface RuleResponseDTO {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  description?: string;
  type: RuleType;
  priority: RulePriority;
  scope: RuleScope;
  alarmConfig?: AlarmThresholdConfig;
  slaConfig?: SLAConfig;
  escalationConfig?: EscalationConfig;
  maintenanceConfig?: MaintenanceWindowConfig;
  notificationChannels?: NotificationChannel[];
  tags: string[];
  status: EntityStatus;
  enabled: boolean;
  lastTriggeredAt?: string;
  triggerCount?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface RuleListResponseDTO {
  items: RuleResponseDTO[];
  pagination: {
    hasMore: boolean;
    nextCursor?: string;
  };
}

export interface RuleEvaluationResponseDTO {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  triggered: boolean;
  reason: string;
  evaluatedAt: string;
  sampleData: Record<string, unknown>;
  details?: {
    metric?: string;
    currentValue?: number;
    threshold?: number;
    operator?: string;
  };
}

export interface ActiveMaintenanceWindowDTO {
  ruleId: string;
  ruleName: string;
  startTime: string;
  endTime: string;
  suppressAlarms: boolean;
  suppressNotifications: boolean;
  affectedRules: string[];
}

export interface RuleStatisticsDTO {
  totalRules: number;
  byType: Record<RuleType, number>;
  byPriority: Record<RulePriority, number>;
  enabledCount: number;
  disabledCount: number;
  recentlyTriggered: number;
}
