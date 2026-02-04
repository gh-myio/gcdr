import { BaseEntity, EntityStatus } from '../../shared/types';

export type RuleType = 'ALARM_THRESHOLD' | 'SLA' | 'ESCALATION' | 'MAINTENANCE_WINDOW';
export type RulePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ' | 'BETWEEN' | 'OUTSIDE';
export type AggregationType = 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'LAST';

/**
 * Metric domains for alarm rules
 *
 * Continuous metrics:
 * - energy_consumption: Wh (watt-hour) - always uses SUM aggregation
 * - instantaneous_power: W (watts)
 * - water_flow: l (liters)
 * - humidity: % (percentage)
 * - temperature: °C (Celsius)
 * - water_level_continuous: % (percentage) - future use
 * - water_level_discreet: % (percentage) - future use
 *
 * Discrete/binary metrics (require device metadata: { channelId, value }):
 * - sensor: generic sensor (value: 0|1)
 * - presence_sensor: presence detection (1=detected, 0=not_detected)
 * - door_sensor: door state (1=open, 0=closed)
 * - lamp: lamp output control (1=off, 0=on)
 */
export type MetricDomain =
  // Continuous metrics
  | 'energy_consumption'
  | 'instantaneous_power'
  | 'water_flow'
  | 'humidity'
  | 'temperature'
  | 'water_level_continuous'
  | 'water_level_discreet'
  // Discrete/binary metrics
  | 'sensor'
  | 'presence_sensor'
  | 'door_sensor'
  | 'lamp';

// Alarm Threshold Configuration
export interface AlarmThresholdConfig {
  metric: MetricDomain;
  operator: ComparisonOperator;
  value: number;
  valueHigh?: number; // For BETWEEN/OUTSIDE operators
  unit?: string;
  hysteresis?: number; // Percentage or absolute value to prevent flapping
  hysteresisType?: 'PERCENTAGE' | 'ABSOLUTE';
  duration?: number; // Time in seconds the condition must persist
  aggregation?: AggregationType;
  aggregationWindow?: number; // Window in seconds for aggregation

  // Calibration offset per metric (for temperature, humidity, power sensors, etc.)
  offset?: Record<string, number>; // e.g., { temperature: -0.5, humidity: 0 }

  // Schedule configuration (when the rule is active)
  startAt?: string; // HH:mm format (e.g., "08:00")
  endAt?: string;   // HH:mm format (e.g., "18:00")
  daysOfWeek?: number[]; // 0-6, where 0 is Sunday (e.g., [1,2,3,4,5] for weekdays)
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
