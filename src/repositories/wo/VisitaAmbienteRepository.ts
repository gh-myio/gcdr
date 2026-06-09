import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { VisitaAmbiente } from '../../domain/entities/wo/VisitaAmbiente';
import { VisitaAmbienteImage } from '../../domain/entities/wo/VisitaAmbienteImage';
import {
  IVisitaAmbienteRepository,
  IVisitaAmbienteImageRepository,
} from '../interfaces/wo/IVisitaAmbienteRepository';
import { AppError } from '../../shared/errors/AppError';

const { woVisitaAmbientes, woVisitaAmbienteImages } = schema;

export class VisitaAmbienteRepository implements IVisitaAmbienteRepository {
  async create(
    tenantId: string,
    visitaId: string,
    data: {
      name: string;
      observation: string | null;
      acQuantity: number | null;
      productQuantity: number | null;
      productType: string | null;
      createdBy: string;
    },
  ): Promise<VisitaAmbiente> {
    const [row] = await db.insert(woVisitaAmbientes).values({
      tenantId,
      visitaId,
      name:            data.name,
      observation:     data.observation,
      acQuantity:      data.acQuantity,
      productQuantity: data.productQuantity,
      productType:     data.productType,
      createdBy:       data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<VisitaAmbiente | null> {
    const [row] = await db
      .select()
      .from(woVisitaAmbientes)
      .where(and(eq(woVisitaAmbientes.tenantId, tenantId), eq(woVisitaAmbientes.id, id)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async listByVisita(tenantId: string, visitaId: string): Promise<VisitaAmbiente[]> {
    const rows = await db
      .select()
      .from(woVisitaAmbientes)
      .where(and(
        eq(woVisitaAmbientes.tenantId, tenantId),
        eq(woVisitaAmbientes.visitaId, visitaId),
      ))
      .orderBy(woVisitaAmbientes.createdAt);
    return rows.map((r) => this.mapToEntity(r));
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<{
      name: string;
      observation: string | null;
      acQuantity: number | null;
      productQuantity: number | null;
      productType: string | null;
    }>,
  ): Promise<VisitaAmbiente> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined)             updates.name = patch.name;
    if (patch.observation !== undefined)      updates.observation = patch.observation;
    if (patch.acQuantity !== undefined)       updates.acQuantity = patch.acQuantity;
    if (patch.productQuantity !== undefined)  updates.productQuantity = patch.productQuantity;
    if (patch.productType !== undefined)      updates.productType = patch.productType;

    const [row] = await db.update(woVisitaAmbientes)
      .set(updates)
      .where(and(eq(woVisitaAmbientes.tenantId, tenantId), eq(woVisitaAmbientes.id, id)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Ambiente not found', 404);
    return this.mapToEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(woVisitaAmbientes)
      .where(and(eq(woVisitaAmbientes.tenantId, tenantId), eq(woVisitaAmbientes.id, id)));
  }

  private mapToEntity(row: typeof woVisitaAmbientes.$inferSelect): VisitaAmbiente {
    return {
      id:               row.id,
      tenantId:         row.tenantId,
      visitaId:         row.visitaId,
      name:             row.name,
      observation:      row.observation,
      acQuantity:       row.acQuantity,
      productQuantity:  row.productQuantity,
      productType:      row.productType,
      createdBy:        row.createdBy,
      createdAt:        row.createdAt.toISOString(),
      updatedAt:        row.updatedAt.toISOString(),
    };
  }
}

export class VisitaAmbienteImageRepository implements IVisitaAmbienteImageRepository {
  async create(
    tenantId: string,
    ambienteId: string,
    data: { fileAssetId: string; imageOrder: number; caption: string | null },
  ): Promise<VisitaAmbienteImage> {
    const [row] = await db.insert(woVisitaAmbienteImages).values({
      tenantId,
      ambienteId,
      fileAssetId: data.fileAssetId,
      imageOrder:  data.imageOrder,
      caption:     data.caption,
    }).returning();
    return this.mapToEntity(row);
  }

  async listByAmbiente(tenantId: string, ambienteId: string): Promise<VisitaAmbienteImage[]> {
    const rows = await db
      .select()
      .from(woVisitaAmbienteImages)
      .where(and(
        eq(woVisitaAmbienteImages.tenantId, tenantId),
        eq(woVisitaAmbienteImages.ambienteId, ambienteId),
      ))
      .orderBy(woVisitaAmbienteImages.imageOrder);
    return rows.map((r) => this.mapToEntity(r));
  }

  async countByAmbiente(tenantId: string, ambienteId: string): Promise<number> {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(woVisitaAmbienteImages)
      .where(and(
        eq(woVisitaAmbienteImages.tenantId, tenantId),
        eq(woVisitaAmbienteImages.ambienteId, ambienteId),
      ));
    return r?.c ?? 0;
  }

  async nextImageOrder(tenantId: string, ambienteId: string): Promise<number> {
    const [r] = await db
      .select({ m: sql<number | null>`max(${woVisitaAmbienteImages.imageOrder})` })
      .from(woVisitaAmbienteImages)
      .where(and(
        eq(woVisitaAmbienteImages.tenantId, tenantId),
        eq(woVisitaAmbienteImages.ambienteId, ambienteId),
      ));
    return ((r?.m ?? -1) as number) + 1;
  }

  async update(
    tenantId: string,
    id: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<VisitaAmbienteImage> {
    const updates: Record<string, unknown> = {};
    if (patch.imageOrder !== undefined) updates.imageOrder = patch.imageOrder;
    if (patch.caption !== undefined)    updates.caption = patch.caption;

    const [row] = await db.update(woVisitaAmbienteImages)
      .set(updates)
      .where(and(eq(woVisitaAmbienteImages.tenantId, tenantId), eq(woVisitaAmbienteImages.id, id)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Ambiente image not found', 404);
    return this.mapToEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(woVisitaAmbienteImages)
      .where(and(eq(woVisitaAmbienteImages.tenantId, tenantId), eq(woVisitaAmbienteImages.id, id)));
  }

  private mapToEntity(row: typeof woVisitaAmbienteImages.$inferSelect): VisitaAmbienteImage {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      ambienteId:   row.ambienteId,
      fileAssetId:  row.fileAssetId,
      imageOrder:   row.imageOrder,
      caption:      row.caption,
      createdAt:    row.createdAt.toISOString(),
    };
  }
}

export const visitaAmbienteRepository = new VisitaAmbienteRepository();
export const visitaAmbienteImageRepository = new VisitaAmbienteImageRepository();
