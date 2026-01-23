import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Rule, RuleType, RuleScope } from '../domain/entities/Rule';
import { CreateRuleDTO, UpdateRuleDTO } from '../dto/request/RuleDTO';
import { PaginatedResult } from '../shared/types';
import { IRuleRepository, ListRulesParams } from './interfaces/IRuleRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { rules } = schema;

export class RuleRepository implements IRuleRepository {

  async create(tenantId: string, data: CreateRuleDTO, createdBy: string): Promise<Rule> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(rules).values({
      id,
      tenantId,
      customerId: data.customerId,
      name: data.name,
      description: data.description,
      type: data.type,
      priority: data.priority || 'MEDIUM',
      scopeType: data.scope.type,
      scopeEntityId: data.scope.entityId || null,
      scopeInherited: data.scope.inherited ?? false,
      alarmConfig: data.alarmConfig || null,
      slaConfig: data.slaConfig || null,
      escalationConfig: data.escalationConfig || null,
      maintenanceConfig: data.maintenanceConfig || null,
      notificationChannels: data.notificationChannels || [],
      tags: data.tags || [],
      status: 'ACTIVE',
      enabled: data.enabled ?? true,
      triggerCount: 0,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
      version: 1,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Rule | null> {
    const [result] = await db
      .select()
      .from(rules)
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateRuleDTO, updatedBy: string): Promise<Rule> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('RULE_NOT_FOUND', 'Rule not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.notificationChannels !== undefined) updateData.notificationChannels = data.notificationChannels;

    // Handle scope updates
    if (data.scope !== undefined) {
      updateData.scopeType = data.scope.type;
      updateData.scopeEntityId = data.scope.entityId || null;
      updateData.scopeInherited = data.scope.inherited ?? false;
    }

    // Handle config updates
    if (data.alarmConfig !== undefined) updateData.alarmConfig = data.alarmConfig;
    if (data.slaConfig !== undefined) updateData.slaConfig = data.slaConfig;
    if (data.escalationConfig !== undefined) updateData.escalationConfig = data.escalationConfig;
    if (data.maintenanceConfig !== undefined) updateData.maintenanceConfig = data.maintenanceConfig;

    const [result] = await db
      .update(rules)
      .set(updateData)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.id, id),
        eq(rules.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Rule was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(rules)
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Rule>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(rules)
      .where(eq(rules.tenantId, tenantId))
      .orderBy(rules.createdAt)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listWithFilters(tenantId: string, params: ListRulesParams): Promise<PaginatedResult<Rule>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(rules.tenantId, tenantId)];

    if (params.type) {
      conditions.push(eq(rules.type, params.type));
    }

    if (params.priority) {
      conditions.push(eq(rules.priority, params.priority));
    }

    if (params.customerId) {
      conditions.push(eq(rules.customerId, params.customerId));
    }

    if (params.enabled !== undefined) {
      conditions.push(eq(rules.enabled, params.enabled));
    }

    if (params.status) {
      conditions.push(eq(rules.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const results = await db
      .select()
      .from(rules)
      .where(and(...conditions))
      .orderBy(rules.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<Rule[]> {
    const results = await db
      .select()
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.customerId, customerId)
      ))
      .orderBy(rules.name);

    return results.map(this.mapToEntity);
  }

  async getByType(tenantId: string, type: RuleType): Promise<Rule[]> {
    const results = await db
      .select()
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.type, type)
      ))
      .orderBy(rules.priority);

    return results.map(this.mapToEntity);
  }

  async getActiveMaintenanceWindows(tenantId: string): Promise<Rule[]> {
    const currentTime = now();
    const maintenanceRules = await this.getByType(tenantId, 'MAINTENANCE_WINDOW');

    return maintenanceRules.filter((rule) => {
      if (!rule.enabled || !rule.maintenanceConfig) return false;

      const config = rule.maintenanceConfig;

      // For one-time windows
      if (config.recurrence === 'ONCE' && config.endTime) {
        return config.startTime <= currentTime && currentTime <= config.endTime;
      }

      // For recurring windows, this is a simplified check
      // Full implementation would handle timezone and recurrence patterns
      return rule.enabled && rule.status === 'ACTIVE';
    });
  }

  async getEnabledRules(tenantId: string): Promise<Rule[]> {
    const results = await db
      .select()
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.enabled, true),
        eq(rules.status, 'ACTIVE')
      ))
      .orderBy(rules.priority);

    return results.map(this.mapToEntity);
  }

  async getByScope(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]> {
    const results = await db
      .select()
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.scopeType, scopeType as 'GLOBAL' | 'CUSTOMER' | 'ASSET' | 'DEVICE'),
        eq(rules.scopeEntityId, entityId)
      ))
      .orderBy(rules.priority);

    return results.map(this.mapToEntity);
  }

  async incrementTriggerCount(tenantId: string, ruleId: string): Promise<void> {
    await db
      .update(rules)
      .set({
        triggerCount: sql`${rules.triggerCount} + 1`,
        lastTriggeredAt: new Date(),
      })
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, ruleId)));
  }

  async updateLastTriggered(tenantId: string, ruleId: string): Promise<void> {
    await db
      .update(rules)
      .set({
        lastTriggeredAt: new Date(),
      })
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, ruleId)));
  }

  private mapToEntity(row: typeof rules.$inferSelect): Rule {
    // Reconstruct the scope object from flat fields
    const scope: RuleScope = {
      type: row.scopeType,
      entityId: row.scopeEntityId || undefined,
      inherited: row.scopeInherited,
    };

    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      name: row.name,
      description: row.description || undefined,
      type: row.type,
      priority: row.priority,
      scope,
      alarmConfig: row.alarmConfig as Rule['alarmConfig'],
      slaConfig: row.slaConfig as Rule['slaConfig'],
      escalationConfig: row.escalationConfig as Rule['escalationConfig'],
      maintenanceConfig: row.maintenanceConfig as Rule['maintenanceConfig'],
      notificationChannels: row.notificationChannels as Rule['notificationChannels'],
      tags: row.tags as string[],
      status: row.status,
      enabled: row.enabled,
      lastTriggeredAt: row.lastTriggeredAt?.toISOString(),
      triggerCount: row.triggerCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const ruleRepository = new RuleRepository();
