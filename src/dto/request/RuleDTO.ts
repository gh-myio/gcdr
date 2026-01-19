import { z } from 'zod';

// Enums
const RuleTypeSchema = z.enum(['ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW']);
const RulePrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const ComparisonOperatorSchema = z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ', 'BETWEEN', 'OUTSIDE']);
const ScopTypeSchema = z.enum(['GLOBAL', 'CUSTOMER', 'ASSET', 'DEVICE']);
const NotificationTypeSchema = z.enum(['EMAIL', 'SMS', 'WEBHOOK', 'SLACK', 'TEAMS', 'PAGERDUTY', 'CUSTOM']);

// Alarm Threshold Config Schema
const AlarmThresholdConfigSchema = z.object({
  metric: z.string().min(1),
  operator: ComparisonOperatorSchema,
  value: z.number(),
  valueHigh: z.number().optional(),
  unit: z.string().optional(),
  hysteresis: z.number().min(0).optional(),
  hysteresisType: z.enum(['PERCENTAGE', 'ABSOLUTE']).optional(),
  duration: z.number().min(0).optional(),
  aggregation: z.enum(['AVG', 'MIN', 'MAX', 'SUM', 'COUNT', 'LAST']).optional(),
  aggregationWindow: z.number().min(1).optional(),
});

// SLA Config Schema
const SLAConfigSchema = z.object({
  metric: z.string().min(1),
  target: z.number(),
  unit: z.string().min(1),
  period: z.enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']),
  calculationMethod: z.enum(['AVAILABILITY', 'RESPONSE_TIME', 'ERROR_RATE', 'THROUGHPUT', 'CUSTOM']),
  excludeMaintenanceWindows: z.boolean().optional(),
  breachNotification: z.boolean().optional(),
  warningThreshold: z.number().min(0).max(100).optional(),
});

// Escalation Level Schema
const EscalationLevelSchema = z.object({
  level: z.number().min(1),
  delayMinutes: z.number().min(0),
  notifyChannels: z.array(z.string()).min(1),
  notifyUsers: z.array(z.string()).optional(),
  notifyGroups: z.array(z.string()).optional(),
  autoAcknowledge: z.boolean().optional(),
  repeatInterval: z.number().min(1).optional(),
  maxRepeats: z.number().min(0).optional(),
});

// Escalation Config Schema
const EscalationConfigSchema = z.object({
  levels: z.array(EscalationLevelSchema).min(1),
  autoResolveAfterMinutes: z.number().min(1).optional(),
  businessHoursOnly: z.boolean().optional(),
  businessHours: z.object({
    timezone: z.string(),
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    workdays: z.array(z.number().min(0).max(6)),
  }).optional(),
});

// Maintenance Window Config Schema
const MaintenanceWindowConfigSchema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().min(1).optional(),
  recurrence: z.enum(['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  recurrenceDays: z.array(z.number()).optional(),
  timezone: z.string(),
  suppressAlarms: z.boolean().optional(),
  suppressNotifications: z.boolean().optional(),
  affectedRules: z.array(z.string()).optional(),
});

// Notification Channel Schema
const NotificationChannelSchema = z.object({
  type: NotificationTypeSchema,
  config: z.record(z.string()),
  enabled: z.boolean().default(true),
});

// Rule Scope Schema
const RuleScopeSchema = z.object({
  type: ScopTypeSchema,
  entityId: z.string().optional(),
  inherited: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.type !== 'GLOBAL' && !data.entityId) {
      return false;
    }
    return true;
  },
  { message: 'entityId is required for non-GLOBAL scope types' }
);

// Create Rule DTO
export const CreateRuleSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  type: RuleTypeSchema,
  priority: RulePrioritySchema.default('MEDIUM'),
  scope: RuleScopeSchema,
  alarmConfig: AlarmThresholdConfigSchema.optional(),
  slaConfig: SLAConfigSchema.optional(),
  escalationConfig: EscalationConfigSchema.optional(),
  maintenanceConfig: MaintenanceWindowConfigSchema.optional(),
  notificationChannels: z.array(NotificationChannelSchema).optional(),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
}).refine(
  (data) => {
    // Ensure the correct config is provided based on type
    switch (data.type) {
      case 'ALARM_THRESHOLD':
        return !!data.alarmConfig;
      case 'SLA':
        return !!data.slaConfig;
      case 'ESCALATION':
        return !!data.escalationConfig;
      case 'MAINTENANCE_WINDOW':
        return !!data.maintenanceConfig;
      default:
        return false;
    }
  },
  { message: 'Configuration must match the rule type' }
);

export type CreateRuleDTO = z.infer<typeof CreateRuleSchema>;

// Update Rule DTO
export const UpdateRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  priority: RulePrioritySchema.optional(),
  scope: RuleScopeSchema.optional(),
  alarmConfig: AlarmThresholdConfigSchema.optional(),
  slaConfig: SLAConfigSchema.optional(),
  escalationConfig: EscalationConfigSchema.optional(),
  maintenanceConfig: MaintenanceWindowConfigSchema.optional(),
  notificationChannels: z.array(NotificationChannelSchema).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateRuleDTO = z.infer<typeof UpdateRuleSchema>;

// List Rules Params
export const ListRulesParamsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
  type: RuleTypeSchema.optional(),
  priority: RulePrioritySchema.optional(),
  customerId: z.string().optional(),
  enabled: z.coerce.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export type ListRulesParams = z.infer<typeof ListRulesParamsSchema>;

// Evaluate Rule DTO (for testing a rule against sample data)
export const EvaluateRuleSchema = z.object({
  ruleId: z.string().min(1),
  sampleData: z.record(z.unknown()),
});

export type EvaluateRuleDTO = z.infer<typeof EvaluateRuleSchema>;

// Activate/Deactivate Rule DTO
export const ToggleRuleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
});

export type ToggleRuleDTO = z.infer<typeof ToggleRuleSchema>;
