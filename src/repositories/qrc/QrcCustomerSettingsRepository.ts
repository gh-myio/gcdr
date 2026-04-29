import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { QrcCustomerSettings } from '../../domain/entities/qrc/CustomerSettings';
import { IQrcCustomerSettingsRepository } from '../interfaces/qrc/IQrcCustomerSettingsRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcCustomerSettings } = schema;

export class QrcCustomerSettingsRepository implements IQrcCustomerSettingsRepository {
  async enable(
    tenantId: string,
    customerId: string,
    data: { viewerPasswordHash: string | null; defaultCentralId: string | null; qrcMetadata: Record<string, unknown> },
    createdBy: string,
  ): Promise<QrcCustomerSettings> {
    const existing = await this.getByCustomerId(tenantId, customerId);
    if (existing) {
      throw new AppError('ALREADY_ENABLED', 'Customer is already QR-enabled', 409);
    }

    const [row] = await db.insert(qrcCustomerSettings).values({
      customerId,
      tenantId,
      viewerPasswordHash: data.viewerPasswordHash,
      defaultCentralId:   data.defaultCentralId,
      qrcMetadata:        data.qrcMetadata,
      createdBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<QrcCustomerSettings | null> {
    const [row] = await db
      .select()
      .from(qrcCustomerSettings)
      .where(and(eq(qrcCustomerSettings.tenantId, tenantId), eq(qrcCustomerSettings.customerId, customerId)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async update(
    tenantId: string,
    customerId: string,
    patch: Partial<{ viewerPasswordHash: string | null; defaultCentralId: string | null; qrcMetadata: Record<string, unknown> }>,
  ): Promise<QrcCustomerSettings> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.viewerPasswordHash !== undefined) updates.viewerPasswordHash = patch.viewerPasswordHash;
    if (patch.defaultCentralId !== undefined)   updates.defaultCentralId = patch.defaultCentralId;
    if (patch.qrcMetadata !== undefined)        updates.qrcMetadata = patch.qrcMetadata;

    const [row] = await db.update(qrcCustomerSettings)
      .set(updates)
      .where(and(eq(qrcCustomerSettings.tenantId, tenantId), eq(qrcCustomerSettings.customerId, customerId)))
      .returning();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Customer is not QR-enabled', 404);
    }
    return this.mapToEntity(row);
  }

  async disable(tenantId: string, customerId: string): Promise<void> {
    await db.delete(qrcCustomerSettings)
      .where(and(eq(qrcCustomerSettings.tenantId, tenantId), eq(qrcCustomerSettings.customerId, customerId)));
  }

  async listEnabled(tenantId: string): Promise<QrcCustomerSettings[]> {
    const rows = await db
      .select()
      .from(qrcCustomerSettings)
      .where(eq(qrcCustomerSettings.tenantId, tenantId));
    return rows.map((r) => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof qrcCustomerSettings.$inferSelect): QrcCustomerSettings {
    return {
      customerId:         row.customerId,
      tenantId:           row.tenantId,
      viewerPasswordHash: row.viewerPasswordHash,
      defaultCentralId:   row.defaultCentralId,
      qrcMetadata:        (row.qrcMetadata ?? {}) as Record<string, unknown>,
      createdBy:          row.createdBy,
      createdAt:          row.createdAt.toISOString(),
      updatedAt:          row.updatedAt.toISOString(),
    };
  }
}

export const qrcCustomerSettingsRepository = new QrcCustomerSettingsRepository();
