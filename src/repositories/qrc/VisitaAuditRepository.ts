import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { VisitaAudit } from '../../domain/entities/qrc/VisitaAudit';
import { IVisitaAuditRepository } from '../interfaces/qrc/IVisitaAuditRepository';

const { qrcVisitaAudit } = schema;

export class VisitaAuditRepository implements IVisitaAuditRepository {
  async append(
    tenantId: string,
    visitaId: string,
    data: {
      ambienteId:        string | null;
      changeType:        string;
      changeDescription: string | null;
      oldValue:          Record<string, unknown> | null;
      newValue:          Record<string, unknown> | null;
      changedBy:         string;
    },
  ): Promise<VisitaAudit> {
    const [maxRow] = await db
      .select({ m: sql<number | null>`max(${qrcVisitaAudit.revision})` })
      .from(qrcVisitaAudit)
      .where(eq(qrcVisitaAudit.visitaId, visitaId));

    const revision = ((maxRow?.m ?? 0) as number) + 1;

    const [row] = await db.insert(qrcVisitaAudit).values({
      tenantId,
      visitaId,
      ambienteId:        data.ambienteId,
      revision,
      changeType:        data.changeType,
      changeDescription: data.changeDescription,
      oldValue:          data.oldValue,
      newValue:          data.newValue,
      changedBy:         data.changedBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async listByVisita(tenantId: string, visitaId: string): Promise<VisitaAudit[]> {
    const rows = await db
      .select()
      .from(qrcVisitaAudit)
      .where(and(eq(qrcVisitaAudit.tenantId, tenantId), eq(qrcVisitaAudit.visitaId, visitaId)))
      .orderBy(qrcVisitaAudit.revision);
    return rows.map((r) => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof qrcVisitaAudit.$inferSelect): VisitaAudit {
    return {
      id:                row.id,
      tenantId:          row.tenantId,
      visitaId:          row.visitaId,
      ambienteId:        row.ambienteId,
      revision:          row.revision,
      changeType:        row.changeType,
      changeDescription: row.changeDescription,
      oldValue:          (row.oldValue ?? null) as Record<string, unknown> | null,
      newValue:          (row.newValue ?? null) as Record<string, unknown> | null,
      changedBy:         row.changedBy,
      changedAt:         row.changedAt.toISOString(),
    };
  }
}

export const visitaAuditRepository = new VisitaAuditRepository();
