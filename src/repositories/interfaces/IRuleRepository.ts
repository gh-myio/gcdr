import { Rule, RuleType, RulePriority } from '../../domain/entities/Rule';
import { CreateRuleDTO, UpdateRuleDTO } from '../../dto/request/RuleDTO';
import { PaginatedResult } from '../../shared/types';
import { IRepository } from './IRepository';

export interface ListRulesParams {
  limit?: number;
  cursor?: string;
  type?: RuleType;
  priority?: RulePriority;
  customerId?: string;
  enabled?: boolean;
  status?: string;
}

export interface IRuleRepository extends IRepository<Rule, CreateRuleDTO, UpdateRuleDTO> {
  getByCustomerId(tenantId: string, customerId: string): Promise<Rule[]>;
  listWithFilters(tenantId: string, params: ListRulesParams): Promise<PaginatedResult<Rule>>;
  getByType(tenantId: string, type: RuleType): Promise<Rule[]>;
  getActiveMaintenanceWindows(tenantId: string): Promise<Rule[]>;
  getEnabledRules(tenantId: string): Promise<Rule[]>;
  getByScope(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]>;
  incrementTriggerCount(tenantId: string, ruleId: string): Promise<void>;
  updateLastTriggered(tenantId: string, ruleId: string): Promise<void>;
}
