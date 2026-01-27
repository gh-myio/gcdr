import { Rule, RuleType } from '../domain/entities/Rule';
import { CreateRuleDTO, UpdateRuleDTO, ListRulesParams } from '../dto/request/RuleDTO';
import { RuleRepository } from '../repositories/RuleRepository';
import { IRuleRepository } from '../repositories/interfaces/IRuleRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors/AppError';

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  triggered: boolean;
  reason: string;
  evaluatedAt: string;
  details?: Record<string, unknown>;
}

export interface RuleStatistics {
  totalRules: number;
  byType: Record<RuleType, number>;
  byPriority: Record<string, number>;
  enabledCount: number;
  disabledCount: number;
  recentlyTriggered: number;
}

export class RuleService {
  private repository: IRuleRepository;
  private customerRepository: ICustomerRepository;

  constructor(repository?: IRuleRepository, customerRepository?: ICustomerRepository) {
    this.repository = repository || new RuleRepository();
    this.customerRepository = customerRepository || new CustomerRepository();
  }

  async create(tenantId: string, data: CreateRuleDTO, userId: string): Promise<Rule> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, data.customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${data.customerId} not found`);
    }

    // Validate scope entity exists if not GLOBAL
    await this.validateScope(tenantId, data.scope);

    // Validate config matches rule type (dual validation with PostgreSQL CHECK constraints)
    this.validateRuleConfig(data);

    const rule = await this.repository.create(tenantId, data, userId);

    await eventService.publish(EventType.RULE_CREATED, {
      tenantId,
      entityType: 'rule',
      entityId: rule.id,
      action: 'created',
      data: {
        name: rule.name,
        type: rule.type,
        priority: rule.priority,
        customerId: rule.customerId,
      },
      actor: { userId, type: 'user' },
    });

    return rule;
  }

  async getById(tenantId: string, id: string): Promise<Rule> {
    const rule = await this.repository.getById(tenantId, id);
    if (!rule) {
      throw new NotFoundError(`Rule ${id} not found`);
    }
    return rule;
  }

  async update(tenantId: string, id: string, data: UpdateRuleDTO, userId: string): Promise<Rule> {
    // Check if rule exists
    await this.getById(tenantId, id);

    // Validate scope if being updated
    if (data.scope) {
      await this.validateScope(tenantId, data.scope);
    }

    const rule = await this.repository.update(tenantId, id, data, userId);

    await eventService.publish(EventType.RULE_UPDATED, {
      tenantId,
      entityType: 'rule',
      entityId: rule.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return rule;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const rule = await this.getById(tenantId, id);

    await this.repository.delete(tenantId, id);

    await eventService.publish(EventType.RULE_DELETED, {
      tenantId,
      entityType: 'rule',
      entityId: id,
      action: 'deleted',
      data: { name: rule.name, type: rule.type },
      actor: { userId, type: 'user' },
    });
  }

  async list(tenantId: string, params: ListRulesParams): Promise<PaginatedResult<Rule>> {
    return this.repository.listWithFilters(tenantId, params);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<Rule[]> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }

    return this.repository.getByCustomerId(tenantId, customerId);
  }

  async toggle(tenantId: string, id: string, enabled: boolean, userId: string, reason?: string): Promise<Rule> {
    const rule = await this.getById(tenantId, id);

    if (rule.enabled === enabled) {
      return rule; // No change needed
    }

    const updatedRule = await this.repository.update(tenantId, id, { enabled }, userId);

    const eventType = enabled ? EventType.RULE_ACTIVATED : EventType.RULE_DEACTIVATED;
    await eventService.publish(eventType, {
      tenantId,
      entityType: 'rule',
      entityId: id,
      action: enabled ? 'activated' : 'deactivated',
      data: { name: rule.name, reason },
      actor: { userId, type: 'user' },
    });

    return updatedRule;
  }

  async evaluate(tenantId: string, ruleId: string, sampleData: Record<string, unknown>): Promise<RuleEvaluationResult> {
    const rule = await this.getById(tenantId, ruleId);
    const evaluatedAt = new Date().toISOString();

    if (!rule.enabled) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: 'Rule is disabled',
        evaluatedAt,
      };
    }

    switch (rule.type) {
      case 'ALARM_THRESHOLD':
        return this.evaluateAlarmRule(rule, sampleData, evaluatedAt);
      case 'SLA':
        return this.evaluateSLARule(rule, sampleData, evaluatedAt);
      case 'ESCALATION':
        return this.evaluateEscalationRule(rule, sampleData, evaluatedAt);
      case 'MAINTENANCE_WINDOW':
        return this.evaluateMaintenanceRule(rule, sampleData, evaluatedAt);
      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.type,
          triggered: false,
          reason: 'Unknown rule type',
          evaluatedAt,
        };
    }
  }

  async getActiveMaintenanceWindows(tenantId: string): Promise<Rule[]> {
    return this.repository.getActiveMaintenanceWindows(tenantId);
  }

  async getStatistics(tenantId: string): Promise<RuleStatistics> {
    const rules = await this.repository.getEnabledRules(tenantId);
    const allRules = (await this.repository.list(tenantId, { limit: 1000 })).items;

    const byType: Record<RuleType, number> = {
      ALARM_THRESHOLD: 0,
      SLA: 0,
      ESCALATION: 0,
      MAINTENANCE_WINDOW: 0,
    };

    const byPriority: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };

    let enabledCount = 0;
    let recentlyTriggered = 0;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    for (const rule of allRules) {
      byType[rule.type]++;
      byPriority[rule.priority]++;

      if (rule.enabled) {
        enabledCount++;
      }

      if (rule.lastTriggeredAt && rule.lastTriggeredAt > oneDayAgo) {
        recentlyTriggered++;
      }
    }

    return {
      totalRules: allRules.length,
      byType,
      byPriority,
      enabledCount,
      disabledCount: allRules.length - enabledCount,
      recentlyTriggered,
    };
  }

  async getRulesForEntity(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]> {
    // Get rules directly assigned to entity
    const directRules = await this.repository.getByScope(tenantId, scopeType, entityId);

    // Get inherited rules (rules with inherited=true from parent entities)
    // This is simplified - full implementation would traverse the hierarchy
    const inheritedRules = await this.getInheritedRules(tenantId, scopeType, entityId);

    // Combine and deduplicate
    const allRulesMap = new Map<string, Rule>();
    [...directRules, ...inheritedRules].forEach((rule) => {
      allRulesMap.set(rule.id, rule);
    });

    return Array.from(allRulesMap.values());
  }

  // Private helper methods

  private async validateScope(tenantId: string, scope: { type: string; entityId?: string }): Promise<void> {
    if (scope.type === 'GLOBAL') {
      return; // No validation needed for global scope
    }

    if (!scope.entityId) {
      throw new ValidationError('entityId is required for non-GLOBAL scope');
    }

    // Validate the entity exists based on scope type
    // This is simplified - full implementation would check the appropriate repository
    // For now, we just validate that an entityId is provided
  }

  /**
   * Validates that the correct config is provided based on rule type.
   * This provides TypeScript-level validation that complements the PostgreSQL CHECK constraints.
   * Together they form a dual-validation layer for data integrity.
   */
  private validateRuleConfig(data: CreateRuleDTO): void {
    const configErrors: string[] = [];

    switch (data.type) {
      case 'ALARM_THRESHOLD':
        if (!data.alarmConfig) {
          configErrors.push('alarmConfig is required for ALARM_THRESHOLD rules');
        }
        break;

      case 'SLA':
        if (!data.slaConfig) {
          configErrors.push('slaConfig is required for SLA rules');
        }
        break;

      case 'ESCALATION':
        if (!data.escalationConfig) {
          configErrors.push('escalationConfig is required for ESCALATION rules');
        }
        break;

      case 'MAINTENANCE_WINDOW':
        if (!data.maintenanceConfig) {
          configErrors.push('maintenanceConfig is required for MAINTENANCE_WINDOW rules');
        }
        break;

      default:
        configErrors.push(`Unknown rule type: ${data.type}`);
    }

    if (configErrors.length > 0) {
      throw new ValidationError(configErrors.join('; '));
    }
  }

  private async getInheritedRules(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]> {
    // Simplified implementation - returns empty array
    // Full implementation would:
    // 1. Get parent entity based on scopeType (e.g., for DEVICE, get its ASSET parent)
    // 2. Get rules with inherited=true from parent
    // 3. Recursively get inherited rules from grandparents
    return [];
  }

  private evaluateAlarmRule(rule: Rule, sampleData: Record<string, unknown>, evaluatedAt: string): RuleEvaluationResult {
    const config = rule.alarmConfig;
    if (!config) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: 'Missing alarm configuration',
        evaluatedAt,
      };
    }

    const metricValue = sampleData[config.metric] as number | undefined;
    if (metricValue === undefined) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: `Metric '${config.metric}' not found in sample data`,
        evaluatedAt,
      };
    }

    let triggered = false;
    switch (config.operator) {
      case 'GT':
        triggered = metricValue > config.value;
        break;
      case 'GTE':
        triggered = metricValue >= config.value;
        break;
      case 'LT':
        triggered = metricValue < config.value;
        break;
      case 'LTE':
        triggered = metricValue <= config.value;
        break;
      case 'EQ':
        triggered = metricValue === config.value;
        break;
      case 'NEQ':
        triggered = metricValue !== config.value;
        break;
      case 'BETWEEN':
        triggered = config.valueHigh !== undefined && metricValue >= config.value && metricValue <= config.valueHigh;
        break;
      case 'OUTSIDE':
        triggered = config.valueHigh !== undefined && (metricValue < config.value || metricValue > config.valueHigh);
        break;
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      triggered,
      reason: triggered ? 'Threshold exceeded' : 'Threshold not exceeded',
      evaluatedAt,
      details: {
        metric: config.metric,
        currentValue: metricValue,
        threshold: config.value,
        operator: config.operator,
      },
    };
  }

  private evaluateSLARule(rule: Rule, sampleData: Record<string, unknown>, evaluatedAt: string): RuleEvaluationResult {
    const config = rule.slaConfig;
    if (!config) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: 'Missing SLA configuration',
        evaluatedAt,
      };
    }

    const metricValue = sampleData[config.metric] as number | undefined;
    if (metricValue === undefined) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: `Metric '${config.metric}' not found in sample data`,
        evaluatedAt,
      };
    }

    // Check if SLA is breached (below target for availability, above for response time/errors)
    let triggered = false;
    if (config.calculationMethod === 'AVAILABILITY' || config.calculationMethod === 'THROUGHPUT') {
      triggered = metricValue < config.target;
    } else {
      triggered = metricValue > config.target;
    }

    // Check warning threshold
    let isWarning = false;
    if (config.warningThreshold && !triggered) {
      const warningValue = config.target * (config.warningThreshold / 100);
      if (config.calculationMethod === 'AVAILABILITY' || config.calculationMethod === 'THROUGHPUT') {
        isWarning = metricValue < (config.target + warningValue);
      } else {
        isWarning = metricValue > (config.target - warningValue);
      }
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      triggered,
      reason: triggered ? 'SLA breached' : isWarning ? 'SLA warning' : 'SLA met',
      evaluatedAt,
      details: {
        metric: config.metric,
        currentValue: metricValue,
        target: config.target,
        isWarning,
      },
    };
  }

  private evaluateEscalationRule(rule: Rule, sampleData: Record<string, unknown>, evaluatedAt: string): RuleEvaluationResult {
    // Escalation rules are typically evaluated in response to alarm events, not sample data
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      triggered: false,
      reason: 'Escalation rules are triggered by alarm events',
      evaluatedAt,
    };
  }

  private evaluateMaintenanceRule(rule: Rule, sampleData: Record<string, unknown>, evaluatedAt: string): RuleEvaluationResult {
    const config = rule.maintenanceConfig;
    if (!config) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        triggered: false,
        reason: 'Missing maintenance configuration',
        evaluatedAt,
      };
    }

    // Check if we're currently in the maintenance window
    const now = new Date().toISOString();
    let inWindow = false;

    if (config.recurrence === 'ONCE' && config.endTime) {
      inWindow = config.startTime <= now && now <= config.endTime;
    } else {
      // Simplified check for recurring windows
      inWindow = rule.enabled && rule.status === 'ACTIVE';
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      triggered: inWindow,
      reason: inWindow ? 'Currently in maintenance window' : 'Not in maintenance window',
      evaluatedAt,
      details: {
        startTime: config.startTime,
        endTime: config.endTime,
        recurrence: config.recurrence,
      },
    };
  }
}

export const ruleService = new RuleService();
