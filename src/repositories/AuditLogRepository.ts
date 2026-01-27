// =============================================================================
// RFC-0009: Audit Log Repository
// =============================================================================

import { eq, and, gte, lte, desc, asc, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  AuditLogEntry,
  CreateAuditLogInput,
  AuditLogFilters,
  EventType,
  EventCategory,
  ActorType,
  ActionType,
  AuditLevel,
} from '../shared/types/audit.types';
import { generateId } from '../shared/utils/idGenerator';
import { AUDIT_QUERY_LIMITS } from '../shared/config/audit.config';

const { auditLogs } = schema;

export interface IAuditLogRepository {
  create(data: CreateAuditLogInput): Promise<AuditLogEntry>;
  findById(tenantId: string, id: string): Promise<AuditLogEntry | null>;
  findMany(filters: AuditLogFilters): Promise<{ data: AuditLogEntry[]; hasMore: boolean; nextCursor?: string }>;
  countByFilters(filters: Omit<AuditLogFilters, 'limit' | 'cursor' | 'orderBy'>): Promise<number>;
  deleteExpired(level: AuditLevel, beforeDate: Date): Promise<number>;
}

export class AuditLogRepository implements IAuditLogRepository {

  async create(data: CreateAuditLogInput): Promise<AuditLogEntry> {
    const id = generateId();

    const [result] = await db.insert(auditLogs).values({
      id,
      tenantId: data.tenantId,
      eventType: data.eventType,
      eventCategory: data.eventCategory,
      auditLevel: data.auditLevel,
      description: data.description,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      customerId: data.customerId,
      userId: data.userId,
      userEmail: data.userEmail,
      actorType: data.actorType,
      oldValues: data.oldValues,
      newValues: data.newValues,
      requestId: data.requestId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      httpMethod: data.httpMethod,
      httpPath: data.httpPath,
      statusCode: data.statusCode,
      errorMessage: data.errorMessage,
      durationMs: data.durationMs,
      metadata: data.metadata ?? {},
      externalLink: data.externalLink,
    }).returning();

    return this.mapToEntity(result);
  }

  async findById(tenantId: string, id: string): Promise<AuditLogEntry | null> {
    const [result] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async findMany(filters: AuditLogFilters): Promise<{
    data: AuditLogEntry[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const limit = Math.min(filters.limit ?? AUDIT_QUERY_LIMITS.defaultLimit, AUDIT_QUERY_LIMITS.maxLimit);
    const orderDirection = filters.orderBy === 'createdAt:asc' ? asc : desc;

    // Build conditions
    const conditions = [eq(auditLogs.tenantId, filters.tenantId)];

    if (filters.customerId) {
      conditions.push(eq(auditLogs.customerId, filters.customerId));
    }

    if (filters.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }

    if (filters.eventType) {
      conditions.push(eq(auditLogs.eventType, filters.eventType));
    }

    if (filters.eventCategory) {
      conditions.push(eq(auditLogs.eventCategory, filters.eventCategory));
    }

    if (filters.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }

    if (filters.entityId) {
      conditions.push(eq(auditLogs.entityId, filters.entityId));
    }

    if (filters.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }

    if (filters.from) {
      conditions.push(gte(auditLogs.createdAt, filters.from));
    }

    if (filters.to) {
      conditions.push(lte(auditLogs.createdAt, filters.to));
    }

    // Cursor-based pagination
    if (filters.cursor) {
      const cursorDate = new Date(filters.cursor);
      if (filters.orderBy === 'createdAt:asc') {
        conditions.push(sql`${auditLogs.createdAt} > ${cursorDate}`);
      } else {
        conditions.push(sql`${auditLogs.createdAt} < ${cursorDate}`);
      }
    }

    // Execute query with limit + 1 to check for more
    const results = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(orderDirection(auditLogs.createdAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const data = results.slice(0, limit).map(r => this.mapToEntity(r));

    return {
      data,
      hasMore,
      nextCursor: hasMore && data.length > 0 ? data[data.length - 1].createdAt.toISOString() : undefined,
    };
  }

  async countByFilters(filters: Omit<AuditLogFilters, 'limit' | 'cursor' | 'orderBy'>): Promise<number> {
    const conditions = [eq(auditLogs.tenantId, filters.tenantId)];

    if (filters.customerId) {
      conditions.push(eq(auditLogs.customerId, filters.customerId));
    }

    if (filters.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }

    if (filters.eventType) {
      conditions.push(eq(auditLogs.eventType, filters.eventType));
    }

    if (filters.eventCategory) {
      conditions.push(eq(auditLogs.eventCategory, filters.eventCategory));
    }

    if (filters.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }

    if (filters.entityId) {
      conditions.push(eq(auditLogs.entityId, filters.entityId));
    }

    if (filters.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }

    if (filters.from) {
      conditions.push(gte(auditLogs.createdAt, filters.from));
    }

    if (filters.to) {
      conditions.push(lte(auditLogs.createdAt, filters.to));
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(...conditions));

    return result?.count ?? 0;
  }

  async deleteExpired(level: AuditLevel, beforeDate: Date): Promise<number> {
    const result = await db
      .delete(auditLogs)
      .where(and(
        eq(auditLogs.auditLevel, level),
        lte(auditLogs.createdAt, beforeDate)
      ))
      .returning({ id: auditLogs.id });

    return result.length;
  }

  private mapToEntity(row: typeof auditLogs.$inferSelect): AuditLogEntry {
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType as EventType,
      eventCategory: row.eventCategory as EventCategory,
      auditLevel: row.auditLevel as AuditLevel,
      description: row.description ?? undefined,
      action: row.action as ActionType,
      entityType: row.entityType,
      entityId: row.entityId ?? undefined,
      customerId: row.customerId ?? undefined,
      userId: row.userId ?? undefined,
      userEmail: row.userEmail ?? undefined,
      actorType: row.actorType as ActorType,
      oldValues: row.oldValues as Record<string, unknown> | undefined,
      newValues: row.newValues as Record<string, unknown> | undefined,
      requestId: row.requestId ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      httpMethod: row.httpMethod ?? undefined,
      httpPath: row.httpPath ?? undefined,
      statusCode: row.statusCode ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      durationMs: row.durationMs ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      externalLink: row.externalLink ?? undefined,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const auditLogRepository = new AuditLogRepository();
