import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { WoCustomerSettings } from '../../domain/entities/wo/CustomerSettings';
import { IWoCustomerSettingsRepository } from '../interfaces/wo/IWoCustomerSettingsRepository';
import { AppError } from '../../shared/errors/AppError';

const { woCustomerSettings } = schema;

export class WoCustomerSettingsRepository implements IWoCustomerSettingsRepository {
  async enable(
    tenantId: string,
    customerId: string,
    data: { viewerPasswordHash: string | null; defaultCentralId: string | null; woMetadata: Record<string, unknown> },
    createdBy: string,
  ): Promise<WoCustomerSettings> {
    const existing = await this.getByCustomerId(tenantId, customerId);
    if (existing) {
      throw new AppError('ALREADY_ENABLED', 'Customer is already QR-enabled', 409);
    }

    const [row] = await db.insert(woCustomerSettings).values({
      customerId,
      tenantId,
      viewerPasswordHash: data.viewerPasswordHash,
      defaultCentralId:   data.defaultCentralId,
      woMetadata:        data.woMetadata,
      createdBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<WoCustomerSettings | null> {
    const [row] = await db
      .select()
      .from(woCustomerSettings)
      .where(and(eq(woCustomerSettings.tenantId, tenantId), eq(woCustomerSettings.customerId, customerId)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async update(
    tenantId: string,
    customerId: string,
    patch: Partial<{ viewerPasswordHash: string | null; defaultCentralId: string | null; woMetadata: Record<string, unknown> }>,
  ): Promise<WoCustomerSettings> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.viewerPasswordHash !== undefined) updates.viewerPasswordHash = patch.viewerPasswordHash;
    if (patch.defaultCentralId !== undefined)   updates.defaultCentralId = patch.defaultCentralId;
    if (patch.woMetadata !== undefined)        updates.woMetadata = patch.woMetadata;

    const [row] = await db.update(woCustomerSettings)
      .set(updates)
      .where(and(eq(woCustomerSettings.tenantId, tenantId), eq(woCustomerSettings.customerId, customerId)))
      .returning();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Customer is not QR-enabled', 404);
    }
    return this.mapToEntity(row);
  }

  async disable(tenantId: string, customerId: string): Promise<void> {
    await db.delete(woCustomerSettings)
      .where(and(eq(woCustomerSettings.tenantId, tenantId), eq(woCustomerSettings.customerId, customerId)));
  }

  async listEnabled(tenantId: string): Promise<WoCustomerSettings[]> {
    const rows = await db
      .select()
      .from(woCustomerSettings)
      .where(eq(woCustomerSettings.tenantId, tenantId));
    return rows.map((r) => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof woCustomerSettings.$inferSelect): WoCustomerSettings {
    return {
      customerId:         row.customerId,
      tenantId:           row.tenantId,
      viewerPasswordHash: row.viewerPasswordHash,
      defaultCentralId:   row.defaultCentralId,
      woMetadata:        (row.woMetadata ?? {}) as Record<string, unknown>,
      createdBy:          row.createdBy,
      createdAt:          row.createdAt.toISOString(),
      updatedAt:          row.updatedAt.toISOString(),
    };
  }
}

export const woCustomerSettingsRepository = new WoCustomerSettingsRepository();
