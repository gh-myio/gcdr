import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Rule, RuleType, RuleScope, RuleValueOverride, RuleNotifications } from '../domain/entities/Rule';
import { CreateRuleDTO, UpdateRuleDTO } from '../dto/request/RuleDTO';
import { PaginatedResult } from '../shared/types';
import { IRuleRepository, ListRulesParams } from './interfaces/IRuleRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError, ValidationError } from '../shared/errors/AppError';
import { countWhere } from './helpers/countQuery';

const { rules } = schema;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// setDeviceOverride/removeDeviceOverride use deviceId as a jsonb object key
// (`{ [deviceId]: override }`, `scopeEntityOverrides - deviceId`) built from a
// caller-supplied value (ultimately req.params.deviceId) — reject anything
// that isn't a well-formed device UUID before it can become an arbitrary key
// in the stored document (CodeQL: remote property injection).
function assertValidDeviceId(deviceId: string): void {
  if (!UUID_RE.test(deviceId)) {
    throw new ValidationError('deviceId must be a valid UUID');
  }
}

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
      scopeEntityIds: data.scope.entityIds ?? (data.scope.entityId ? [data.scope.entityId] : []),
      scopeInherited: data.scope.inherited ?? false,
      scopeEntityOverrides: data.scopeEntityOverrides || null,
      alarmConfig: data.alarmConfig || null,
      slaConfig: data.slaConfig || null,
      escalationConfig: data.escalationConfig || null,
      maintenanceConfig: data.maintenanceConfig || null,
      noConsumptionConfig: data.noConsumptionConfig || null,
      notificationChannels: data.notificationChannels || [],
      notifications: data.notifications || null,
      scopeProfiles: data.scope.scopeProfiles ?? null,
      tags: data.tags || [],
      status: 'ACTIVE',
      enabled: data.enabled ?? true,
      internalRule: data.internalRule ?? false,
      isInternalSupportRule: data.isInternalSupportRule ?? false,
      lookbackDays: data.lookbackDays ?? 0,
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

  /**
   * Copies the scalar/simple-presence fields of an UpdateRuleDTO patch onto
   * updateData — split out of update() purely to keep its cognitive
   * complexity under the lint threshold; no behavior change.
   */
  private applyScalarUpdateFields(data: UpdateRuleDTO, updateData: Record<string, unknown>): void {
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.internalRule !== undefined) updateData.internalRule = data.internalRule;
    if (data.isInternalSupportRule !== undefined) updateData.isInternalSupportRule = data.isInternalSupportRule;
    if (data.lookbackDays !== undefined) updateData.lookbackDays = data.lookbackDays ?? null;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.notificationChannels !== undefined) updateData.notificationChannels = data.notificationChannels;
    if (data.notifications !== undefined) updateData.notifications = data.notifications ?? null;
    if (data.scope?.scopeProfiles !== undefined) updateData.scopeProfiles = data.scope.scopeProfiles ?? null;
    if (data.alarmConfig !== undefined) updateData.alarmConfig = data.alarmConfig;
    if (data.slaConfig !== undefined) updateData.slaConfig = data.slaConfig;
    if (data.escalationConfig !== undefined) updateData.escalationConfig = data.escalationConfig;
    if (data.maintenanceConfig !== undefined) updateData.maintenanceConfig = data.maintenanceConfig;
    if (data.noConsumptionConfig !== undefined) updateData.noConsumptionConfig = data.noConsumptionConfig;
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

    this.applyScalarUpdateFields(data, updateData);

    // Handle scope updates
    if (data.scope !== undefined) {
      updateData.scopeType = data.scope.type;
      updateData.scopeEntityIds = data.scope.entityIds ?? (data.scope.entityId ? [data.scope.entityId] : []);
      updateData.scopeInherited = data.scope.inherited ?? false;
    }

    // Handle scope entity overrides
    if (data.scopeEntityOverrides !== undefined) updateData.scopeEntityOverrides = data.scopeEntityOverrides ?? null;

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

    const conditions = [eq(rules.tenantId, tenantId)];

    const [results, total] = await Promise.all([
      db.select()
        .from(rules)
        .where(and(...conditions))
        .orderBy(rules.createdAt)
        .limit(limit + 1)
        .offset(offset),
      countWhere(rules, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
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

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      conditions.push(sql`(${rules.name} ILIKE ${searchPattern})`);
    }

    if (params.internalRule !== undefined) {
      conditions.push(eq(rules.internalRule, params.internalRule));
    }

    if (params.isInternalSupportRule !== undefined) {
      conditions.push(eq(rules.isInternalSupportRule, params.isInternalSupportRule));
    } else if (params.includeInternalSupportRule === false) {
      conditions.push(eq(rules.isInternalSupportRule, false));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(rules)
        .where(and(...conditions))
        .orderBy(rules.name)
        .limit(limit + 1)
        .offset(offset),
      countWhere(rules, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
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

  async getApplicableForDevice(
    tenantId: string,
    deviceId: string,
    customerId: string,
    assetId?: string
  ): Promise<Rule[]> {
    const assetCondition = assetId
      ? sql`(${rules.scopeType} = 'ASSET' AND ${rules.scopeEntityIds} @> ARRAY[${assetId}::uuid])`
      : sql`FALSE`;

    const results = await db
      .select()
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.customerId, customerId),
        eq(rules.enabled, true),
        sql`(
          ${rules.scopeType} = 'GLOBAL'
          OR (${rules.scopeType} = 'CUSTOMER' AND ${rules.scopeEntityIds} @> ARRAY[${customerId}::uuid])
          OR ${assetCondition}
          OR (${rules.scopeType} = 'DEVICE' AND ${rules.scopeEntityIds} @> ARRAY[${deviceId}::uuid])
        )`
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
        sql`${rules.scopeEntityIds} @> ARRAY[${entityId}::uuid]`
      ))
      .orderBy(rules.priority);

    return results.map(this.mapToEntity);
  }

  async incrementTriggerCount(tenantId: string, ruleId: string, count: number = 1, triggeredAt: Date = new Date()): Promise<void> {
    await db
      .update(rules)
      .set({
        triggerCount: sql`${rules.triggerCount} + ${count}`,
        lastTriggeredAt: triggeredAt,
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

  async setDeviceOverride(tenantId: string, ruleId: string, deviceId: string, override: RuleValueOverride): Promise<Rule> {
    assertValidDeviceId(deviceId);
    const existing = await this.getById(tenantId, ruleId);
    if (!existing) {
      throw new AppError('RULE_NOT_FOUND', 'Rule not found', 404);
    }

    const [result] = await db
      .update(rules)
      .set({
        scopeEntityOverrides: sql`COALESCE(${rules.scopeEntityOverrides}, '{}'::jsonb) || ${JSON.stringify({ [deviceId]: override })}::jsonb`,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, ruleId)))
      .returning();

    return this.mapToEntity(result);
  }

  async removeDeviceOverride(tenantId: string, ruleId: string, deviceId: string): Promise<Rule> {
    assertValidDeviceId(deviceId);
    const existing = await this.getById(tenantId, ruleId);
    if (!existing) {
      throw new AppError('RULE_NOT_FOUND', 'Rule not found', 404);
    }

    const [result] = await db
      .update(rules)
      .set({
        scopeEntityOverrides: sql`${rules.scopeEntityOverrides} - ${deviceId}`,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(and(eq(rules.tenantId, tenantId), eq(rules.id, ruleId)))
      .returning();

    return this.mapToEntity(result);
  }

  private mapToEntity(row: typeof rules.$inferSelect): Rule {
    // Reconstruct the scope object from flat fields
    const entityIds = (row.scopeEntityIds?.length ?? 0) > 0 ? row.scopeEntityIds as string[] : undefined;
    const scope: RuleScope = {
      type: row.scopeType,
      entityId: entityIds?.[0],
      entityIds,
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
      scopeEntityOverrides: row.scopeEntityOverrides as Rule['scopeEntityOverrides'] ?? undefined,
      alarmConfig: row.alarmConfig as Rule['alarmConfig'],
      slaConfig: row.slaConfig as Rule['slaConfig'],
      escalationConfig: row.escalationConfig as Rule['escalationConfig'],
      maintenanceConfig: row.maintenanceConfig as Rule['maintenanceConfig'],
      noConsumptionConfig: row.noConsumptionConfig as Rule['noConsumptionConfig'],
      notificationChannels: row.notificationChannels as Rule['notificationChannels'],
      notifications: row.notifications as RuleNotifications ?? undefined,
      scopeProfiles: (row.scopeProfiles && row.scopeProfiles.length > 0) ? row.scopeProfiles as string[] : undefined,
      tags: row.tags as string[],
      status: row.status,
      enabled: row.enabled,
      internalRule: row.internalRule,
      isInternalSupportRule: row.isInternalSupportRule,
      lookbackDays: row.lookbackDays ?? 0,
      lastTriggeredAt: row.lastTriggeredAt?.toISOString(),
      triggerCount: row.triggerCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }

  async clearDevicesFromCustomerRules(tenantId: string, customerId: string, updatedBy: string): Promise<{ affected: number }> {
    const result = await db
      .update(rules)
      .set({
        scopeType: 'GLOBAL',
        scopeEntityIds: [],
        enabled: false,
        updatedAt: new Date(),
        updatedBy,
        version: sql`${rules.version} + 1`,
      })
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.customerId, customerId),
        eq(rules.scopeType, 'DEVICE'),
      ))
      .returning({ id: rules.id });

    return { affected: result.length };
  }
}

// Export singleton instance
export const ruleRepository = new RuleRepository();
