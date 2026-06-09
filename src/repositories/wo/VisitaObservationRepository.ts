import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { VisitaObservation } from '../../domain/entities/wo/VisitaObservation';
import { IVisitaObservationRepository } from '../interfaces/wo/IVisitaObservationRepository';

const { woVisitaObservations } = schema;

export class VisitaObservationRepository implements IVisitaObservationRepository {
  async create(
    tenantId: string,
    visitaId: string,
    data: { observation: string; fileAssetId: string | null; createdBy: string },
  ): Promise<VisitaObservation> {
    const [row] = await db.insert(woVisitaObservations).values({
      tenantId,
      visitaId,
      observation: data.observation,
      fileAssetId: data.fileAssetId,
      createdBy:   data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async listByVisita(tenantId: string, visitaId: string): Promise<VisitaObservation[]> {
    const rows = await db
      .select()
      .from(woVisitaObservations)
      .where(and(
        eq(woVisitaObservations.tenantId, tenantId),
        eq(woVisitaObservations.visitaId, visitaId),
      ))
      .orderBy(desc(woVisitaObservations.createdAt));
    return rows.map((r) => this.mapToEntity(r));
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(woVisitaObservations)
      .where(and(eq(woVisitaObservations.tenantId, tenantId), eq(woVisitaObservations.id, id)));
  }

  private mapToEntity(row: typeof woVisitaObservations.$inferSelect): VisitaObservation {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      visitaId:     row.visitaId,
      observation:  row.observation,
      fileAssetId:  row.fileAssetId,
      createdBy:    row.createdBy,
      createdAt:    row.createdAt.toISOString(),
    };
  }
}

export const visitaObservationRepository = new VisitaObservationRepository();
