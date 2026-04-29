import { eq, and, isNull, desc, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { Visita, VisitaStatus } from '../../domain/entities/qrc/Visita';
import { IVisitaRepository } from '../interfaces/qrc/IVisitaRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcVisitasTecnicas } = schema;

export class VisitaRepository implements IVisitaRepository {
  async create(
    tenantId: string,
    data: { customerId: string | null; name: string; observation: string | null; createdBy: string },
  ): Promise<Visita> {
    const [row] = await db.insert(qrcVisitasTecnicas).values({
      tenantId,
      customerId:  data.customerId,
      name:        data.name,
      observation: data.observation,
      createdBy:   data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<Visita | null> {
    const [row] = await db
      .select()
      .from(qrcVisitasTecnicas)
      .where(and(
        eq(qrcVisitasTecnicas.tenantId, tenantId),
        eq(qrcVisitasTecnicas.id, id),
        isNull(qrcVisitasTecnicas.deletedAt),
      ))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async list(
    tenantId: string,
    params?: { customerId?: string; status?: VisitaStatus; limit?: number; offset?: number },
  ): Promise<{ items: Visita[]; total: number }> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const conds: SQL[] = [
      eq(qrcVisitasTecnicas.tenantId, tenantId),
      isNull(qrcVisitasTecnicas.deletedAt),
    ];
    if (params?.customerId) conds.push(eq(qrcVisitasTecnicas.customerId, params.customerId));
    if (params?.status)     conds.push(eq(qrcVisitasTecnicas.status, params.status));

    const whereClause = and(...conds);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(qrcVisitasTecnicas)
      .where(whereClause);

    const rows = await db
      .select()
      .from(qrcVisitasTecnicas)
      .where(whereClause)
      .orderBy(desc(qrcVisitasTecnicas.createdAt))
      .limit(limit)
      .offset(offset);

    return { items: rows.map((r) => this.mapToEntity(r)), total: total ?? 0 };
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<{ customerId: string | null; name: string; observation: string | null; status: VisitaStatus }>,
  ): Promise<Visita> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.customerId !== undefined)  updates.customerId = patch.customerId;
    if (patch.name !== undefined)        updates.name = patch.name;
    if (patch.observation !== undefined) updates.observation = patch.observation;
    if (patch.status !== undefined)      updates.status = patch.status;

    const [row] = await db.update(qrcVisitasTecnicas)
      .set(updates)
      .where(and(
        eq(qrcVisitasTecnicas.tenantId, tenantId),
        eq(qrcVisitasTecnicas.id, id),
        isNull(qrcVisitasTecnicas.deletedAt),
      ))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Visita not found', 404);
    return this.mapToEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await db.update(qrcVisitasTecnicas)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(qrcVisitasTecnicas.tenantId, tenantId), eq(qrcVisitasTecnicas.id, id)));
  }

  private mapToEntity(row: typeof qrcVisitasTecnicas.$inferSelect): Visita {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      customerId:   row.customerId,
      name:         row.name,
      observation:  row.observation,
      status:       row.status as VisitaStatus,
      createdBy:    row.createdBy,
      createdAt:    row.createdAt.toISOString(),
      updatedAt:    row.updatedAt.toISOString(),
      deletedAt:    row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

export const visitaRepository = new VisitaRepository();
