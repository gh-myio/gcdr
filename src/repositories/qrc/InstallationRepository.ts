import { eq, and, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { Installation, InstallationStatus, TcType } from '../../domain/entities/qrc/Installation';
import { IInstallationRepository, InstallationCreateInput, InstallationUpdateInput } from '../interfaces/qrc/IInstallationRepository';
import { AppError } from '../../shared/errors/AppError';

const { qrcInstallations } = schema;

export class InstallationRepository implements IInstallationRepository {
  async create(tenantId: string, data: InstallationCreateInput): Promise<Installation> {
    const [row] = await db.insert(qrcInstallations).values({
      tenantId,
      deviceId:          data.deviceId,
      customerId:        data.customerId,
      position:          data.position,
      tcType:            data.tcType ?? null,
      impedimentoText:   data.status ?? 'instalado',
      obs:               data.obs ?? null,
      currentMultiplier: data.currentMultiplier !== null && data.currentMultiplier !== undefined ? String(data.currentMultiplier) : null,
      voltageMultiplier: data.voltageMultiplier !== null && data.voltageMultiplier !== undefined ? String(data.voltageMultiplier) : null,
      installedBy:       data.installedBy,
    }).returning();

    return this.mapToEntity(row);
  }

  async getById(tenantId: string, id: string): Promise<Installation | null> {
    const [row] = await db
      .select()
      .from(qrcInstallations)
      .where(and(
        eq(qrcInstallations.tenantId, tenantId),
        eq(qrcInstallations.id, id),
        isNull(qrcInstallations.deletedAt),
      ))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async getByDeviceId(tenantId: string, deviceId: string): Promise<Installation | null> {
    const [row] = await db
      .select()
      .from(qrcInstallations)
      .where(and(
        eq(qrcInstallations.tenantId, tenantId),
        eq(qrcInstallations.deviceId, deviceId),
        isNull(qrcInstallations.deletedAt),
      ))
      .limit(1);
    return row ? this.mapToEntity(row) : null;
  }

  async update(tenantId: string, id: string, patch: InstallationUpdateInput): Promise<Installation> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.position !== undefined)          updates.position = patch.position;
    if (patch.tcType !== undefined)            updates.tcType = patch.tcType;
    if (patch.status !== undefined)            updates.impedimentoText = patch.status;
    if (patch.obs !== undefined)               updates.obs = patch.obs;
    if (patch.currentMultiplier !== undefined) updates.currentMultiplier = patch.currentMultiplier === null ? null : String(patch.currentMultiplier);
    if (patch.voltageMultiplier !== undefined) updates.voltageMultiplier = patch.voltageMultiplier === null ? null : String(patch.voltageMultiplier);

    const [row] = await db.update(qrcInstallations)
      .set(updates)
      .where(and(
        eq(qrcInstallations.tenantId, tenantId),
        eq(qrcInstallations.id, id),
        isNull(qrcInstallations.deletedAt),
      ))
      .returning();

    if (!row) {
      throw new AppError('NOT_FOUND', 'Installation not found', 404);
    }
    return this.mapToEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await db.update(qrcInstallations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(qrcInstallations.tenantId, tenantId), eq(qrcInstallations.id, id)));
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Installation[]> {
    const rows = await db
      .select()
      .from(qrcInstallations)
      .where(and(
        eq(qrcInstallations.tenantId, tenantId),
        eq(qrcInstallations.customerId, customerId),
        isNull(qrcInstallations.deletedAt),
      ))
      .orderBy(qrcInstallations.installedAt);
    return rows.map((r) => this.mapToEntity(r));
  }

  async countByStatusForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<Record<InstallationStatus, number>> {
    const rows = await db
      .select({
        status: qrcInstallations.impedimentoText,
        count:  sql<number>`count(*)::int`,
      })
      .from(qrcInstallations)
      .where(and(
        eq(qrcInstallations.tenantId, tenantId),
        eq(qrcInstallations.customerId, customerId),
        isNull(qrcInstallations.deletedAt),
      ))
      .groupBy(qrcInstallations.impedimentoText);

    const counts: Record<InstallationStatus, number> = {
      instalado: 0, impedimento: 0, removido: 0, defeito: 0,
    };
    for (const r of rows) {
      counts[r.status as InstallationStatus] = r.count;
    }
    return counts;
  }

  private mapToEntity(row: typeof qrcInstallations.$inferSelect): Installation {
    return {
      id:               row.id,
      tenantId:         row.tenantId,
      deviceId:         row.deviceId,
      customerId:       row.customerId,
      position:         row.position,
      tcType:           row.tcType as TcType | null,
      status:           row.impedimentoText as InstallationStatus,
      obs:              row.obs,
      currentMultiplier: row.currentMultiplier !== null ? Number(row.currentMultiplier) : null,
      voltageMultiplier: row.voltageMultiplier !== null ? Number(row.voltageMultiplier) : null,
      installedBy:      row.installedBy,
      installedAt:      row.installedAt.toISOString(),
      updatedAt:        row.updatedAt.toISOString(),
      deletedAt:        row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

export const installationRepository = new InstallationRepository();
