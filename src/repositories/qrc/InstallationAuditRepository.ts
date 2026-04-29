import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { InstallationAudit, InstallationChangeType } from '../../domain/entities/qrc/InstallationAudit';
import { IInstallationAuditRepository } from '../interfaces/qrc/IInstallationAuditRepository';

const { qrcInstallationAudit } = schema;

export class InstallationAuditRepository implements IInstallationAuditRepository {
  async append(
    tenantId: string,
    installationId: string,
    data: {
      changeType:        InstallationChangeType;
      changeDescription: string | null;
      oldValue:          Record<string, unknown> | null;
      newValue:          Record<string, unknown> | null;
      changedBy:         string;
    },
  ): Promise<InstallationAudit> {
    // Compute next revision atomically — the DB-level UNIQUE on
    // (installation_id, revision) protects us against the race window.
    const [maxRow] = await db
      .select({ m: sql<number | null>`max(${qrcInstallationAudit.revision})` })
      .from(qrcInstallationAudit)
      .where(eq(qrcInstallationAudit.installationId, installationId));

    const revision = ((maxRow?.m ?? 0) as number) + 1;

    const [row] = await db.insert(qrcInstallationAudit).values({
      tenantId,
      installationId,
      revision,
      changeType:        data.changeType,
      changeDescription: data.changeDescription,
      oldValue:          data.oldValue,
      newValue:          data.newValue,
      changedBy:         data.changedBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async listByInstallation(tenantId: string, installationId: string): Promise<InstallationAudit[]> {
    const rows = await db
      .select()
      .from(qrcInstallationAudit)
      .where(and(
        eq(qrcInstallationAudit.tenantId, tenantId),
        eq(qrcInstallationAudit.installationId, installationId),
      ))
      .orderBy(qrcInstallationAudit.revision);
    return rows.map((r) => this.mapToEntity(r));
  }

  async listByUser(
    tenantId: string,
    userId: string,
    params?: { limit?: number; offset?: number },
  ): Promise<{ items: InstallationAudit[]; total: number }> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(qrcInstallationAudit)
      .where(and(
        eq(qrcInstallationAudit.tenantId, tenantId),
        eq(qrcInstallationAudit.changedBy, userId),
      ));

    const rows = await db
      .select()
      .from(qrcInstallationAudit)
      .where(and(
        eq(qrcInstallationAudit.tenantId, tenantId),
        eq(qrcInstallationAudit.changedBy, userId),
      ))
      .orderBy(desc(qrcInstallationAudit.changedAt))
      .limit(limit)
      .offset(offset);

    return { items: rows.map((r) => this.mapToEntity(r)), total: total ?? 0 };
  }

  private mapToEntity(row: typeof qrcInstallationAudit.$inferSelect): InstallationAudit {
    return {
      id:                row.id,
      tenantId:          row.tenantId,
      installationId:    row.installationId,
      revision:          row.revision,
      changeType:        row.changeType as InstallationChangeType,
      changeDescription: row.changeDescription,
      oldValue:          (row.oldValue ?? null) as Record<string, unknown> | null,
      newValue:          (row.newValue ?? null) as Record<string, unknown> | null,
      changedBy:         row.changedBy,
      changedAt:         row.changedAt.toISOString(),
    };
  }
}

export const installationAuditRepository = new InstallationAuditRepository();
