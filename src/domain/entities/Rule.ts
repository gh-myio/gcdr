import { BaseEntity, EntityStatus } from '../../shared/types';

export type RuleType = 'ALARM_THRESHOLD' | 'SLA' | 'ESCALATION' | 'MAINTENANCE_WINDOW';
export type RulePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ' | 'BETWEEN' | 'OUTSIDE' | 'UNCHANGED';
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

// Guard configurations for Decision Engine (alarms-backend)
export interface DedupGuardConfig {
  enabled: boolean;
  ttlSeconds: number; // Time window to consider duplicates (default: 300)
}

export interface CooldownGuardConfig {
  enabled: boolean;
  seconds: number; // Minimum time between notifications (default: 60)
  perChannel: boolean; // If true, cooldown is per dispatch channel
}

export interface HysteresisGuardConfig {
  enabled: boolean;
  windowSeconds: number; // Time window to count transitions (default: 120)
  maxTransitions: number; // Max state changes before suppression (default: 3)
}

export interface DigestGuardConfig {
  enabled: boolean;
  windowSeconds: number; // Digest aggregation window (default: 600)
  threshold: number; // Min alarms in window to trigger digest (default: 5)
}

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

  // Calibration offset per metric (temp, hum, pot, water_level)
  offset?: Record<string, number>; // e.g., { temp: -0.5, hum: 0, pot: 0, water_level: 5 }

  // Schedule configuration (when the rule is active)
  startAt?: string; // HH:mm format (e.g., "08:00")
  endAt?: string;   // HH:mm format (e.g., "18:00")
  daysOfWeek?: number[]; // 0-6, where 0 is Sunday (e.g., [1,2,3,4,5] for weekdays)

  // Channel targeting for OUTLET devices with discrete metrics
  channelId?: number; // Channel index (0, 1, 2...) for multi-channel devices

  // Energy unit multiplier: 1 for W (default), 0.25 for Wh
  keyMulti?: number;

  // Decision Engine guard configs (alarms-backend)
  dedup?: DedupGuardConfig;
  cooldown?: CooldownGuardConfig;
  hysteresisGuard?: HysteresisGuardConfig; // Named differently from `hysteresis` (threshold tolerance)
  digest?: DigestGuardConfig;
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

// Alarm lifecycle actions (RFC-0024)
export type AlarmAction = 'OPEN' | 'ACK' | 'ESCALATE' | 'SNOOZE' | 'CLOSE' | 'STATE_HISTORY';

// Notification Channel Configuration (delivery mechanism — webhook, SMS config, etc.)
export interface NotificationChannel {
  type: 'EMAIL' | 'SMS' | 'WEBHOOK' | 'SLACK' | 'TEAMS' | 'PAGERDUTY' | 'CUSTOM';
  config: Record<string, string>;
  enabled: boolean;
}

// SMTP relay config for outbound notification emails
export interface NotificationEmailRelay {
  host: string;      // SMTP host (e.g. smtp.sendgrid.net)
  port: number;      // SMTP port (465 or 587)
  secure: boolean;   // true = TLS/SSL, false = STARTTLS
  user?: string;     // SMTP authentication user
  from: string;      // From address (e.g. "Alertas MYIO <noreply@empresa.com.br>")
}

// RFC-0024 notification recipient — discriminated union by sourceType
export type NotificationRecipient =
  | {
      sourceType: 'USER';
      userId: string;
      name: string;
      email?: string;
      telegramHandle?: string;
      whatsappNumber?: string;
    }
  | {
      sourceType: 'GROUP';
      groupId: string;
      name: string;
    }
  | {
      sourceType: 'MANUAL';
      name: string;
      channel: string;
      email?: string;
      telegramHandle?: string;
      whatsappNumber?: string;
    };

// Notification config for a single alarm action
export interface RuleActionNotification {
  enabled: boolean;
  recipients: NotificationRecipient[];
  emailRelay?: NotificationEmailRelay;
}

// Per-action notification settings for a rule (RFC-0024)
// Keyed by AlarmAction — each action can have independent recipient lists
export type RuleNotifications = Partial<Record<AlarmAction, RuleActionNotification>>;

// Legacy per-category notification channel (kept for backward compat during migration)
export interface RuleNotificationChannel {
  enabled: boolean;
  recipients: Array<{
    name: string;
    email: string;
    sourceType: 'USER' | 'GROUP_MEMBER' | 'MANUAL';
    userId?: string;
    groupId?: string;
  }>;
  emailRelay?: NotificationEmailRelay;
}

// @deprecated — use RuleNotifications (RFC-0024)
export interface LegacyRuleNotifications {
  alarmNotify?: RuleNotificationChannel;
  alarmReport?: RuleNotificationChannel;
  alarmInsight?: RuleNotificationChannel;
}

// Per-device value override for rules with scope_entity_ids
export interface RuleValueOverride {
  value?: number;
  valueHigh?: number;
}

// Rule Scope - determines where the rule applies
export interface RuleScope {
  type: 'GLOBAL' | 'CUSTOMER' | 'ASSET' | 'DEVICE';
  entityId?: string;   // Single entity (CUSTOMER, ASSET, or single DEVICE)
  entityIds?: string[]; // Multiple devices — used when scope_type = DEVICE
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

  // Notification settings — delivery channels (webhook/SMS config)
  notificationChannels?: NotificationChannel[];

  // Notification recipients — who receives which notification category
  notifications?: RuleNotifications;

  // Per-device value overrides (RFC-0018) — keyed by device UUID
  scopeEntityOverrides?: Record<string, RuleValueOverride>;

  // Device profile filter — when set, rule only applies to devices matching one of these profiles
  scopeProfiles?: string[];

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
