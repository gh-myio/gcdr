import { Rule, RuleType, RulePriority, RuleValueOverride } from '../../domain/entities/Rule';
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
  search?: string;
  internalRule?: boolean;
  /** When false, excludes rules where isInternalSupportRule=true. Default: include all */
  includeInternalSupportRule?: boolean;
}

export interface IRuleRepository extends IRepository<Rule, CreateRuleDTO, UpdateRuleDTO> {
  getByCustomerId(tenantId: string, customerId: string): Promise<Rule[]>;
  listWithFilters(tenantId: string, params: ListRulesParams): Promise<PaginatedResult<Rule>>;
  getByType(tenantId: string, type: RuleType): Promise<Rule[]>;
  getActiveMaintenanceWindows(tenantId: string): Promise<Rule[]>;
  getEnabledRules(tenantId: string): Promise<Rule[]>;
  getByScope(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]>;
  getApplicableForDevice(tenantId: string, deviceId: string, customerId: string, assetId?: string): Promise<Rule[]>;
  incrementTriggerCount(tenantId: string, ruleId: string, count?: number, triggeredAt?: Date): Promise<void>;
  updateLastTriggered(tenantId: string, ruleId: string): Promise<void>;
  setDeviceOverride(tenantId: string, ruleId: string, deviceId: string, override: RuleValueOverride): Promise<Rule>;
  removeDeviceOverride(tenantId: string, ruleId: string, deviceId: string): Promise<Rule>;
  clearDevicesFromCustomerRules(tenantId: string, customerId: string, updatedBy: string): Promise<{ affected: number }>;
}
