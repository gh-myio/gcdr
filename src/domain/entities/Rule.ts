import { BaseEntity, EntityStatus } from '../../shared/types';

export type RuleType = 'ALARM_THRESHOLD' | 'SLA' | 'ESCALATION' | 'MAINTENANCE_WINDOW';
export type RulePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ' | 'BETWEEN' | 'OUTSIDE';

// Alarm Threshold Configuration
export interface AlarmThresholdConfig {
  metric: string;
  operator: ComparisonOperator;
  value: number;
  valueHigh?: number; // For BETWEEN/OUTSIDE operators
  unit?: string;
  hysteresis?: number; // Percentage or absolute value to prevent flapping
  hysteresisType?: 'PERCENTAGE' | 'ABSOLUTE';
  duration?: number; // Time in seconds the condition must persist
  aggregation?: 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'LAST';
  aggregationWindow?: number; // Window in seconds for aggregation
}

// SLA Configuration
export interface SLAConfig {
  metric: string;
  target: number;
  unit: string; // e.g., 'percent', 'ms', 'count'
  period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  calculationMethod: 'AVAILABILITY' | 'RESPONSE_TIME' | 'ERROR_RATE' | 'THROUGHPUT' | 'CUSTOM';
  excludeMaintenanceWindows?: boolean;
  breachNotification?: boolean;
  warningThreshold?: number; // Percentage of target to trigger warning
}

// Escalation Configuration
export interface EscalationLevel {
  level: number;
  delayMinutes: number;
  notifyChannels: string[];
  notifyUsers?: string[];
  notifyGroups?: string[];
  autoAcknowledge?: boolean;
  repeatInterval?: number; // Minutes between repeat notifications
  maxRepeats?: number;
}

export interface EscalationConfig {
  levels: EscalationLevel[];
  autoResolveAfterMinutes?: number;
  businessHoursOnly?: boolean;
  businessHours?: {
    timezone: string;
    start: string; // HH:mm format
    end: string;
    workdays: number[]; // 0-6, where 0 is Sunday
  };
}

// Maintenance Window Configuration
export interface MaintenanceWindowConfig {
  startTime: string; // ISO 8601 datetime or cron expression
  endTime?: string; // ISO 8601 datetime (for one-time windows)
  duration?: number; // Duration in minutes (for recurring windows)
  recurrence?: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  recurrenceDays?: number[]; // Days of week (0-6) or days of month (1-31)
  timezone: string;
  suppressAlarms?: boolean;
  suppressNotifications?: boolean;
  affectedRules?: string[]; // Rule IDs to suppress, empty means all
}

// Notification Channel Configuration
export interface NotificationChannel {
  type: 'EMAIL' | 'SMS' | 'WEBHOOK' | 'SLACK' | 'TEAMS' | 'PAGERDUTY' | 'CUSTOM';
  config: Record<string, string>;
  enabled: boolean;
}

// Rule Scope - determines where the rule applies
export interface RuleScope {
  type: 'GLOBAL' | 'CUSTOMER' | 'ASSET' | 'DEVICE';
  entityId?: string; // Required for CUSTOMER, ASSET, DEVICE
  inherited?: boolean; // If true, applies to all children
}

// Main Rule Entity
export interface Rule extends BaseEntity {
  customerId: string;
  name: string;
  description?: string;
  type: RuleType;
  priority: RulePriority;
  scope: RuleScope;

  // Type-specific configuration (only one will be populated based on type)
  alarmConfig?: AlarmThresholdConfig;
  slaConfig?: SLAConfig;
  escalationConfig?: EscalationConfig;
  maintenanceConfig?: MaintenanceWindowConfig;

  // Notification settings
  notificationChannels?: NotificationChannel[];

  // Tags for organization
  tags: string[];

  // Status
  status: EntityStatus;
  enabled: boolean;

  // Metadata
  lastTriggeredAt?: string;
  triggerCount?: number;
}

// Helper type guards
export function isAlarmRule(rule: Rule): rule is Rule & { alarmConfig: AlarmThresholdConfig } {
  return rule.type === 'ALARM_THRESHOLD' && !!rule.alarmConfig;
}

export function isSLARule(rule: Rule): rule is Rule & { slaConfig: SLAConfig } {
  return rule.type === 'SLA' && !!rule.slaConfig;
}

export function isEscalationRule(rule: Rule): rule is Rule & { escalationConfig: EscalationConfig } {
  return rule.type === 'ESCALATION' && !!rule.escalationConfig;
}

export function isMaintenanceRule(rule: Rule): rule is Rule & { maintenanceConfig: MaintenanceWindowConfig } {
  return rule.type === 'MAINTENANCE_WINDOW' && !!rule.maintenanceConfig;
}
