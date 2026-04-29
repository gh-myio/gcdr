import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { VisitaProduct } from '../../domain/entities/qrc/VisitaProduct';
import { VisitaProductImage } from '../../domain/entities/qrc/VisitaProductImage';
import {
  IVisitaProductRepository,
  IVisitaProductImageRepository,
} from '../interfaces/qrc/IVisitaProductRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcVisitaProducts, qrcVisitaProductImages } = schema;

export class VisitaProductRepository implements IVisitaProductRepository {
  async create(
    tenantId: string,
    ambienteId: string,
    data: { productType: string; description: string | null; quantity: number; createdBy: string },
  ): Promise<VisitaProduct> {
    const [row] = await db.insert(qrcVisitaProducts).values({
      tenantId,
      ambienteId,
      productType: data.productType,
      description: data.description,
      quantity:    data.quantity,
      createdBy:   data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<VisitaProduct | null> {
    const [row] = await db
      .select()
      .from(qrcVisitaProducts)
      .where(and(eq(qrcVisitaProducts.tenantId, tenantId), eq(qrcVisitaProducts.id, id)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async listByAmbiente(tenantId: string, ambienteId: string): Promise<VisitaProduct[]> {
    const rows = await db
      .select()
      .from(qrcVisitaProducts)
      .where(and(
        eq(qrcVisitaProducts.tenantId, tenantId),
        eq(qrcVisitaProducts.ambienteId, ambienteId),
      ))
      .orderBy(qrcVisitaProducts.createdAt);
    return rows.map((r) => this.mapToEntity(r));
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<{ productType: string; description: string | null; quantity: number }>,
  ): Promise<VisitaProduct> {
    const updates: Record<string, unknown> = {};
    if (patch.productType !== undefined) updates.productType = patch.productType;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.quantity !== undefined)    updates.quantity = patch.quantity;

    const [row] = await db.update(qrcVisitaProducts)
      .set(updates)
      .where(and(eq(qrcVisitaProducts.tenantId, tenantId), eq(qrcVisitaProducts.id, id)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Product not found', 404);
    return this.mapToEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(qrcVisitaProducts)
      .where(and(eq(qrcVisitaProducts.tenantId, tenantId), eq(qrcVisitaProducts.id, id)));
  }

  private mapToEntity(row: typeof qrcVisitaProducts.$inferSelect): VisitaProduct {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      ambienteId:   row.ambienteId,
      productType:  row.productType,
      description:  row.description,
      quantity:     row.quantity,
      createdBy:    row.createdBy,
      createdAt:    row.createdAt.toISOString(),
    };
  }
}

export class VisitaProductImageRepository implements IVisitaProductImageRepository {
  async create(
    tenantId: string,
    productId: string,
    data: { fileAssetId: string; imageOrder: number },
  ): Promise<VisitaProductImage> {
    const [row] = await db.insert(qrcVisitaProductImages).values({
      tenantId,
      productId,
      fileAssetId: data.fileAssetId,
      imageOrder:  data.imageOrder,
    }).returning();
    return this.mapToEntity(row);
  }

  async listByProduct(tenantId: string, productId: string): Promise<VisitaProductImage[]> {
    const rows = await db
      .select()
      .from(qrcVisitaProductImages)
      .where(and(
        eq(qrcVisitaProductImages.tenantId, tenantId),
        eq(qrcVisitaProductImages.productId, productId),
      ))
      .orderBy(qrcVisitaProductImages.imageOrder);
    return rows.map((r) => this.mapToEntity(r));
  }

  async countByProduct(tenantId: string, productId: string): Promise<number> {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(qrcVisitaProductImages)
      .where(and(
        eq(qrcVisitaProductImages.tenantId, tenantId),
        eq(qrcVisitaProductImages.productId, productId),
      ));
    return r?.c ?? 0;
  }

  async nextImageOrder(tenantId: string, productId: string): Promise<number> {
    const [r] = await db
      .select({ m: sql<number | null>`max(${qrcVisitaProductImages.imageOrder})` })
      .from(qrcVisitaProductImages)
      .where(and(
        eq(qrcVisitaProductImages.tenantId, tenantId),
        eq(qrcVisitaProductImages.productId, productId),
      ));
    return ((r?.m ?? -1) as number) + 1;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(qrcVisitaProductImages)
      .where(and(eq(qrcVisitaProductImages.tenantId, tenantId), eq(qrcVisitaProductImages.id, id)));
  }

  private mapToEntity(row: typeof qrcVisitaProductImages.$inferSelect): VisitaProductImage {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      productId:    row.productId,
      fileAssetId:  row.fileAssetId,
      imageOrder:   row.imageOrder,
      createdAt:    row.createdAt.toISOString(),
    };
  }
}

export const visitaProductRepository = new VisitaProductRepository();
export const visitaProductImageRepository = new VisitaProductImageRepository();
