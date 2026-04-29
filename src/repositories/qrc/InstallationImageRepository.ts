import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { InstallationImage } from '../../domain/entities/qrc/InstallationImage';
import { IInstallationImageRepository } from '../interfaces/qrc/IInstallationImageRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcInstallationImages } = schema;

export class InstallationImageRepository implements IInstallationImageRepository {
  async create(
    tenantId: string,
    installationId: string,
    data: { fileAssetId: string; imageOrder: number; caption: string | null },
  ): Promise<InstallationImage> {
    const [row] = await db.insert(qrcInstallationImages).values({
      tenantId,
      installationId,
      fileAssetId: data.fileAssetId,
      imageOrder:  data.imageOrder,
      caption:     data.caption,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<InstallationImage | null> {
    const [row] = await db
      .select()
      .from(qrcInstallationImages)
      .where(and(eq(qrcInstallationImages.tenantId, tenantId), eq(qrcInstallationImages.id, id)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async listByInstallation(tenantId: string, installationId: string): Promise<InstallationImage[]> {
    const rows = await db
      .select()
      .from(qrcInstallationImages)
      .where(and(
        eq(qrcInstallationImages.tenantId, tenantId),
        eq(qrcInstallationImages.installationId, installationId),
      ))
      .orderBy(qrcInstallationImages.imageOrder);
    return rows.map((r) => this.mapToEntity(r));
  }

  async countByInstallation(tenantId: string, installationId: string): Promise<number> {
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(qrcInstallationImages)
      .where(and(
        eq(qrcInstallationImages.tenantId, tenantId),
        eq(qrcInstallationImages.installationId, installationId),
      ));
    return r?.c ?? 0;
  }

  async update(
    tenantId: string,
    id: string,
    patch: { imageOrder?: number; caption?: string | null },
  ): Promise<InstallationImage> {
    const updates: Record<string, unknown> = {};
    if (patch.imageOrder !== undefined) updates.imageOrder = patch.imageOrder;
    if (patch.caption !== undefined)    updates.caption = patch.caption;

    const [row] = await db.update(qrcInstallationImages)
      .set(updates)
      .where(and(eq(qrcInstallationImages.tenantId, tenantId), eq(qrcInstallationImages.id, id)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Installation image not found', 404);
    return this.mapToEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(qrcInstallationImages)
      .where(and(eq(qrcInstallationImages.tenantId, tenantId), eq(qrcInstallationImages.id, id)));
  }

  async nextImageOrder(tenantId: string, installationId: string): Promise<number> {
    const [r] = await db
      .select({ m: sql<number | null>`max(${qrcInstallationImages.imageOrder})` })
      .from(qrcInstallationImages)
      .where(and(
        eq(qrcInstallationImages.tenantId, tenantId),
        eq(qrcInstallationImages.installationId, installationId),
      ));
    return ((r?.m ?? -1) as number) + 1;
  }

  private mapToEntity(row: typeof qrcInstallationImages.$inferSelect): InstallationImage {
    return {
      id:             row.id,
      tenantId:       row.tenantId,
      installationId: row.installationId,
      fileAssetId:    row.fileAssetId,
      imageOrder:     row.imageOrder,
      caption:        row.caption,
      createdAt:      row.createdAt.toISOString(),
    };
  }
}

export const installationImageRepository = new InstallationImageRepository();
