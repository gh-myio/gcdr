import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { WorkOrdersCustomerSettings } from '../../domain/entities/work-orders';
import { IWorkOrdersCustomerSettingsRepository } from '../interfaces/work-orders/IWorkOrdersCustomerSettingsRepository';
import { AppError } from '../../shared/errors/AppError';

// RFC-0037 §6 — woCustomerSettings export now points at the renamed table
// "work_orders_customer_settings" (shape unchanged from the old QR-Checker
// wo_customer_settings).
const { woCustomerSettings } = schema;

export class WorkOrdersCustomerSettingsRepository implements IWorkOrdersCustomerSettingsRepository {
  async enable(
    tenantId: string,
    customerId: string,
    data: { viewerPasswordHash: string | null; defaultCentralId: string | null; woMetadata: Record<string, unknown> },
    createdBy: string,
  ): Promise<WorkOrdersCustomerSettings> {
    const existing = await this.getByCustomerId(tenantId, customerId);
    if (existing) {
      throw new AppError('ALREADY_ENABLED', 'Customer is already WO-enabled', 409);
    }

    const [row] = await db.insert(woCustomerSettings).values({
      customerId,
      tenantId,
      viewerPasswordHash: data.viewerPasswordHash,
      defaultCentralId:   data.defaultCentralId,
      woMetadata:         data.woMetadata,
      createdBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async getByCustomerId(tenantId: string, customerId: string): Promise<WorkOrdersCustomerSettings | null> {
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
  ): Promise<WorkOrdersCustomerSettings> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.viewerPasswordHash !== undefined) updates.viewerPasswordHash = patch.viewerPasswordHash;
    if (patch.defaultCentralId !== undefined)   updates.defaultCentralId = patch.defaultCentralId;
    if (patch.woMetadata !== undefined)         updates.woMetadata = patch.woMetadata;

    const [row] = await db.update(woCustomerSettings)
      .set(updates)
      .where(and(eq(woCustomerSettings.tenantId, tenantId), eq(woCustomerSettings.customerId, customerId)))
      .returning();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Customer is not WO-enabled', 404);
    }
    return this.mapToEntity(row);
  }

  async disable(tenantId: string, customerId: string): Promise<void> {
    await db.delete(woCustomerSettings)
      .where(and(eq(woCustomerSettings.tenantId, tenantId), eq(woCustomerSettings.customerId, customerId)));
  }

  async listEnabled(tenantId: string): Promise<WorkOrdersCustomerSettings[]> {
    const rows = await db
      .select()
      .from(woCustomerSettings)
      .where(eq(woCustomerSettings.tenantId, tenantId));
    return rows.map((r) => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof woCustomerSettings.$inferSelect): WorkOrdersCustomerSettings {
    return {
      customerId:         row.customerId,
      tenantId:           row.tenantId,
      viewerPasswordHash: row.viewerPasswordHash,
      defaultCentralId:   row.defaultCentralId,
      woMetadata:         (row.woMetadata ?? {}) as Record<string, unknown>,
      createdBy:          row.createdBy,
      createdAt:          row.createdAt.toISOString(),
      updatedAt:          row.updatedAt.toISOString(),
    };
  }
}

export const workOrdersCustomerSettingsRepository = new WorkOrdersCustomerSettingsRepository();
