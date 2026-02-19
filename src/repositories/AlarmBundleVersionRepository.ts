import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { AlarmBundleVersion } from '../domain/entities/AlarmBundleVersion';

const { alarmBundleVersions } = schema;

export class AlarmBundleVersionRepository {

  async record(data: {
    tenantId: string;
    customerId: string;
    version: string;
    previousVersion?: string;
    bundleType: string;
    reason: string;
    entityType: string;
    entityId?: string;
    rulesCount: number;
    devicesCount: number;
    createdBy?: string;
  }): Promise<AlarmBundleVersion> {
    const [result] = await db.insert(alarmBundleVersions).values({
      tenantId: data.tenantId,
      customerId: data.customerId,
      version: data.version,
      previousVersion: data.previousVersion,
      bundleType: data.bundleType,
      reason: data.reason,
      entityType: data.entityType,
      entityId: data.entityId,
      rulesCount: data.rulesCount,
      devicesCount: data.devicesCount,
      createdBy: data.createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getLatest(
    tenantId: string,
    customerId: string,
    bundleType: string
  ): Promise<AlarmBundleVersion | null> {
    const [result] = await db
      .select()
      .from(alarmBundleVersions)
      .where(and(
        eq(alarmBundleVersions.tenantId, tenantId),
        eq(alarmBundleVersions.customerId, customerId),
        eq(alarmBundleVersions.bundleType, bundleType)
      ))
      .orderBy(desc(alarmBundleVersions.createdAt))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getHistory(
    tenantId: string,
    customerId: string,
    limit = 20
  ): Promise<AlarmBundleVersion[]> {
    const results = await db
      .select()
      .from(alarmBundleVersions)
      .where(and(
        eq(alarmBundleVersions.tenantId, tenantId),
        eq(alarmBundleVersions.customerId, customerId)
      ))
      .orderBy(desc(alarmBundleVersions.createdAt))
      .limit(limit);

    return results.map(r => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof alarmBundleVersions.$inferSelect): AlarmBundleVersion {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      version: row.version,
      previousVersion: row.previousVersion || undefined,
      bundleType: row.bundleType,
      reason: row.reason,
      entityType: row.entityType,
      entityId: row.entityId || undefined,
      rulesCount: row.rulesCount,
      devicesCount: row.devicesCount,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy || undefined,
    };
  }
}

export const alarmBundleVersionRepository = new AlarmBundleVersionRepository();
