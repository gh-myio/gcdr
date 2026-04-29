import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { MaintenanceTask, MaintenanceTaskStatus } from '../../domain/entities/qrc/MaintenanceTask';
import { IMaintenanceTaskRepository } from '../interfaces/qrc/IMaintenanceTaskRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcMaintenanceTasks } = schema;

export class MaintenanceTaskRepository implements IMaintenanceTaskRepository {
  async create(
    tenantId: string,
    installationId: string,
    data: { description: string; createdBy: string },
  ): Promise<MaintenanceTask> {
    const [row] = await db.insert(qrcMaintenanceTasks).values({
      tenantId,
      installationId,
      description: data.description,
      createdBy:   data.createdBy,
    }).returning();
    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<MaintenanceTask | null> {
    const [row] = await db
      .select()
      .from(qrcMaintenanceTasks)
      .where(and(eq(qrcMaintenanceTasks.tenantId, tenantId), eq(qrcMaintenanceTasks.id, id)))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async listByInstallation(tenantId: string, installationId: string): Promise<MaintenanceTask[]> {
    const rows = await db
      .select()
      .from(qrcMaintenanceTasks)
      .where(and(
        eq(qrcMaintenanceTasks.tenantId, tenantId),
        eq(qrcMaintenanceTasks.installationId, installationId),
      ))
      .orderBy(qrcMaintenanceTasks.createdAt);
    return rows.map((r) => this.mapToEntity(r));
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      description?:    string;
      status?:         MaintenanceTaskStatus;
      completedNotes?: string | null;
      completedBy?:    string;
      reviewedBy?:     string;
    },
  ): Promise<MaintenanceTask> {
    const updates: Record<string, unknown> = {};
    if (patch.description !== undefined)    updates.description = patch.description;
    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.status === 'pending_review' || patch.status === 'resolved') {
        if (patch.completedBy) {
          updates.completedBy = patch.completedBy;
          updates.completedAt = new Date();
        }
      }
      if (patch.status === 'resolved' && patch.reviewedBy) {
        updates.reviewedBy = patch.reviewedBy;
        updates.reviewedAt = new Date();
      }
    }
    if (patch.completedNotes !== undefined) updates.completedNotes = patch.completedNotes;

    const [row] = await db.update(qrcMaintenanceTasks)
      .set(updates)
      .where(and(eq(qrcMaintenanceTasks.tenantId, tenantId), eq(qrcMaintenanceTasks.id, id)))
      .returning();

    if (!row) throw new AppError('NOT_FOUND', 'Maintenance task not found', 404);
    return this.mapToEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db.delete(qrcMaintenanceTasks)
      .where(and(eq(qrcMaintenanceTasks.tenantId, tenantId), eq(qrcMaintenanceTasks.id, id)));
  }

  private mapToEntity(row: typeof qrcMaintenanceTasks.$inferSelect): MaintenanceTask {
    return {
      id:              row.id,
      tenantId:        row.tenantId,
      installationId:  row.installationId,
      description:     row.description,
      status:          row.status as MaintenanceTaskStatus,
      createdBy:       row.createdBy,
      createdAt:       row.createdAt.toISOString(),
      completedBy:     row.completedBy,
      completedAt:     row.completedAt ? row.completedAt.toISOString() : null,
      completedNotes:  row.completedNotes,
      reviewedBy:      row.reviewedBy,
      reviewedAt:      row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }
}

export const maintenanceTaskRepository = new MaintenanceTaskRepository();
