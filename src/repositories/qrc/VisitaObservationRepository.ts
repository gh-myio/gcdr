import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { VisitaObservation } from '../../domain/entities/qrc/VisitaObservation';
import { IVisitaObservationRepository } from '../interfaces/qrc/IVisitaObservationRepository';

const { qrcVisitaObservations } = schema;

export class VisitaObservationRepository implements IVisitaObservationRepository {
  async create(
    tenantId: string,
    visitaId: string,
    data: { observation: string; fileAssetId: string | null; createdBy: string },
  ): Promise<VisitaObservation> {
    const [row] = await db.insert(qrcVisitaObservations).values({
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
      .from(qrcVisitaObservations)
      .where(and(
        eq(qrcVisitaObservations.tenantId, tenantId),
        eq(qrcVisitaObservations.visitaId, visitaId),
      ))
      .orderBy(desc(qrcVisitaObservations.createdAt));
    return rows.map((r) => this.mapToEntity(r));
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(qrcVisitaObservations)
      .where(and(eq(qrcVisitaObservations.tenantId, tenantId), eq(qrcVisitaObservations.id, id)));
  }

  private mapToEntity(row: typeof qrcVisitaObservations.$inferSelect): VisitaObservation {
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
