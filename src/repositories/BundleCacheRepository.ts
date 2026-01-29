import { eq, and, gt, isNull, lt } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { UserAccessBundle, UserBundleCache } from '../domain/entities/UserAccessBundle';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';

const { userBundleCache } = schema;

export class BundleCacheRepository {

  async get(tenantId: string, userId: string, scope: string): Promise<UserBundleCache | null> {
    const [result] = await db
      .select()
      .from(userBundleCache)
      .where(and(
        eq(userBundleCache.tenantId, tenantId),
        eq(userBundleCache.userId, userId),
        eq(userBundleCache.scope, scope),
        isNull(userBundleCache.invalidatedAt),
        gt(userBundleCache.expiresAt, new Date())
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getBundle(tenantId: string, userId: string, scope: string): Promise<UserAccessBundle | null> {
    const cached = await this.get(tenantId, userId, scope);
    return cached?.bundle || null;
  }

  async upsert(
    tenantId: string,
    userId: string,
    scope: string,
    bundle: UserAccessBundle,
    checksum: string,
    expiresAt: Date
  ): Promise<UserBundleCache> {
    const timestamp = now();

    // Try to find existing cache entry
    const [existing] = await db
      .select()
      .from(userBundleCache)
      .where(and(
        eq(userBundleCache.tenantId, tenantId),
        eq(userBundleCache.userId, userId),
        eq(userBundleCache.scope, scope)
      ))
      .limit(1);

    if (existing) {
      // Update existing
      const [result] = await db
        .update(userBundleCache)
        .set({
          bundle,
          checksum,
          generatedAt: new Date(timestamp),
          expiresAt,
          invalidatedAt: null,
          invalidationReason: null,
          updatedAt: new Date(timestamp),
        })
        .where(eq(userBundleCache.id, existing.id))
        .returning();

      return this.mapToEntity(result);
    } else {
      // Insert new
      const id = generateId();

      const [result] = await db.insert(userBundleCache).values({
        id,
        tenantId,
        userId,
        scope,
        bundle,
        checksum,
        generatedAt: new Date(timestamp),
        expiresAt,
        createdAt: new Date(timestamp),
        updatedAt: new Date(timestamp),
      }).returning();

      return this.mapToEntity(result);
    }
  }

  async invalidate(tenantId: string, userId: string, reason?: string): Promise<number> {
    const timestamp = now();

    const result = await db
      .update(userBundleCache)
      .set({
        invalidatedAt: new Date(timestamp),
        invalidationReason: reason || 'Manual invalidation',
        updatedAt: new Date(timestamp),
      })
      .where(and(
        eq(userBundleCache.tenantId, tenantId),
        eq(userBundleCache.userId, userId),
        isNull(userBundleCache.invalidatedAt)
      ));

    return result.rowCount || 0;
  }

  async invalidateByScope(tenantId: string, userId: string, scope: string, reason?: string): Promise<boolean> {
    const timestamp = now();

    const result = await db
      .update(userBundleCache)
      .set({
        invalidatedAt: new Date(timestamp),
        invalidationReason: reason || 'Manual invalidation',
        updatedAt: new Date(timestamp),
      })
      .where(and(
        eq(userBundleCache.tenantId, tenantId),
        eq(userBundleCache.userId, userId),
        eq(userBundleCache.scope, scope),
        isNull(userBundleCache.invalidatedAt)
      ));

    return (result.rowCount || 0) > 0;
  }

  async invalidateAllForTenant(tenantId: string, reason?: string): Promise<number> {
    const timestamp = now();

    const result = await db
      .update(userBundleCache)
      .set({
        invalidatedAt: new Date(timestamp),
        invalidationReason: reason || 'Tenant-wide invalidation',
        updatedAt: new Date(timestamp),
      })
      .where(and(
        eq(userBundleCache.tenantId, tenantId),
        isNull(userBundleCache.invalidatedAt)
      ));

    return result.rowCount || 0;
  }

  async delete(tenantId: string, userId: string, scope?: string): Promise<number> {
    const conditions = [
      eq(userBundleCache.tenantId, tenantId),
      eq(userBundleCache.userId, userId),
    ];

    if (scope) {
      conditions.push(eq(userBundleCache.scope, scope));
    }

    const result = await db
      .delete(userBundleCache)
      .where(and(...conditions));

    return result.rowCount || 0;
  }

  async cleanupExpired(): Promise<number> {
    const result = await db
      .delete(userBundleCache)
      .where(lt(userBundleCache.expiresAt, new Date()));

    return result.rowCount || 0;
  }

  async cleanupInvalidated(olderThanDays = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(userBundleCache)
      .where(and(
        lt(userBundleCache.invalidatedAt, cutoffDate)
      ));

    return result.rowCount || 0;
  }

  private mapToEntity(row: typeof userBundleCache.$inferSelect): UserBundleCache {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      scope: row.scope,
      bundle: row.bundle as UserAccessBundle,
      checksum: row.checksum,
      generatedAt: row.generatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      invalidatedAt: row.invalidatedAt?.toISOString(),
      invalidationReason: row.invalidationReason || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// Export singleton instance
export const bundleCacheRepository = new BundleCacheRepository();
