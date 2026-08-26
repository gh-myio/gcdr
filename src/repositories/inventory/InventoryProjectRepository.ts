import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { countWhere } from '../helpers/countQuery';
import { CreateProjectDTO, UpdateProjectDTO } from '../../dto/request/InventoryDTO';
import { InvProjectResponse } from '../../dto/response/InventoryResponseDTO';

const { invProjects } = schema;

// =============================================================================
// RFC-0061 M9 — inv_projects data access (tenant-scoped CRUD, offset paging).
// Rows map straight onto the InvProjectResponse read model — the table has no
// derived fields, so repository and response shapes coincide.
// =============================================================================

export interface InventoryProjectListParams {
  page: number;
  pageSize: number;
}

export interface IInventoryProjectRepository {
  list(
    tenantId: string,
    params: InventoryProjectListParams,
  ): Promise<{ items: InvProjectResponse[]; total: number }>;
  getById(tenantId: string, id: string): Promise<InvProjectResponse | null>;
  create(tenantId: string, data: CreateProjectDTO, createdBy?: string): Promise<InvProjectResponse>;
  update(
    tenantId: string,
    id: string,
    data: UpdateProjectDTO,
    updatedBy?: string,
  ): Promise<InvProjectResponse | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

type InvProjectRow = typeof invProjects.$inferSelect;

export class InventoryProjectRepository implements IInventoryProjectRepository {

  async list(
    tenantId: string,
    params: InventoryProjectListParams,
  ): Promise<{ items: InvProjectResponse[]; total: number }> {
    const { page, pageSize } = params;
    const where = eq(invProjects.tenantId, tenantId);

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(invProjects)
        .where(where)
        .orderBy(desc(invProjects.createdAt), desc(invProjects.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      countWhere(invProjects, [where]),
    ]);

    return { items: rows.map(this.mapRow), total };
  }

  async getById(tenantId: string, id: string): Promise<InvProjectResponse | null> {
    const [row] = await db
      .select()
      .from(invProjects)
      .where(and(eq(invProjects.tenantId, tenantId), eq(invProjects.id, id)))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async create(
    tenantId: string,
    data: CreateProjectDTO,
    createdBy?: string,
  ): Promise<InvProjectResponse> {
    const [row] = await db
      .insert(invProjects)
      .values({
        tenantId,
        name: data.name,
        description: data.description ?? null,
        customerId: data.customerId ?? null,
        legacyClientName: data.legacyClientName ?? null,
        legacyClientCnpj: data.legacyClientCnpj ?? null,
        createdBy: createdBy ?? null,
        updatedBy: createdBy ?? null,
      })
      .returning();

    return this.mapRow(row);
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateProjectDTO,
    updatedBy?: string,
  ): Promise<InvProjectResponse | null> {
    const patch: Partial<typeof invProjects.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: updatedBy ?? null,
    };
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.customerId !== undefined) patch.customerId = data.customerId;
    if (data.legacyClientName !== undefined) patch.legacyClientName = data.legacyClientName;
    if (data.legacyClientCnpj !== undefined) patch.legacyClientCnpj = data.legacyClientCnpj;

    const [row] = await db
      .update(invProjects)
      .set(patch)
      .where(and(eq(invProjects.tenantId, tenantId), eq(invProjects.id, id)))
      .returning();

    return row ? this.mapRow(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await db
      .delete(invProjects)
      .where(and(eq(invProjects.tenantId, tenantId), eq(invProjects.id, id)))
      .returning({ id: invProjects.id });

    return rows.length > 0;
  }

  private mapRow(row: InvProjectRow): InvProjectResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      customerId: row.customerId,
      legacyClientName: row.legacyClientName,
      legacyClientCnpj: row.legacyClientCnpj,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const inventoryProjectRepository = new InventoryProjectRepository();
