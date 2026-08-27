// =============================================================================
// RFC-0061 M7 — Field repository (data access only).
//
// Owns `inv_unit_products`, `inv_technician_moves` and `inv_damaged_items`,
// plus the M7 read views over the M2 ledger (technician dispatches = SAIDA
// movements with a responsible). All mutating methods accept an optional
// executor so the service composes them inside ONE transaction with the M2
// stock repository (same seam pattern as M4 — "every mutating method accepts
// an optional executor"); `withTransaction` exposes the boundary.
// =============================================================================

import { and, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const {
  invItems,
  invProjects,
  invStockMovements,
  invMovementQrs,
  invUnitProducts,
  invTechnicianMoves,
  invDamagedItems,
} = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as InventoryStockRepository)
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type FieldTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type FieldDbClient = typeof db | FieldTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvUnitProductRow = typeof invUnitProducts.$inferSelect;
export type InvTechnicianMoveRow = typeof invTechnicianMoves.$inferSelect;
export type InvDamagedItemRow = typeof invDamagedItems.$inferSelect;
export type InvStockMovementRow = typeof invStockMovements.$inferSelect;
export type InvMovementQrRow = typeof invMovementQrs.$inferSelect;
export type InvProjectRow = typeof invProjects.$inferSelect;

/** Unit-product listing row (joined names for the client screen). */
export interface UnitProductListRow {
  unit: InvUnitProductRow;
  itemName: string | null;
  projectName: string | null;
}

export interface UnitProductListFilters {
  page: number;
  pageSize: number;
  /** Default listing shows only ACTIVE units (moved_to IS NULL). */
  includeMoved?: boolean;
  projectId?: string;
  status?: string;
}

export interface NewUnitProductInput {
  tenantId: string;
  itemId?: string | null;
  label?: string | null;
  status?: string;
  projectId?: string | null;
  customerId?: string | null;
  clientNameSnapshot?: string | null;
  expeditionOrderId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface UnitMoveFields {
  movedTo: string;
  movedTechnician?: string | null;
  movePhotoFileId?: string | null;
  movedAt: Date;
  moveNotes?: string | null;
}

/** One technician dispatch = SAIDA movement with a responsible (§M7). */
export interface DispatchRow {
  movementId: string;
  itemId: string;
  itemName: string | null;
  technician: string;
  location: string;
  quantity: string;
  /** Σ inv_technician_moves.quantity already consumed from this dispatch. */
  movedQuantity: number;
  reason: string | null;
  createdAt: Date;
}

export interface NewTechnicianMoveInput {
  tenantId: string;
  movementId: string;
  itemId?: string | null;
  technician?: string | null;
  destination: string;
  projectId?: string | null;
  quantity: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface NewDamagedItemInput {
  tenantId: string;
  itemId?: string | null;
  productNameSnapshot?: string | null;
  quantity: number;
  source?: string | null;
  sourceDetail?: string | null;
  reason?: string | null;
  photoFileId?: string | null;
  createdBy?: string | null;
}

export interface DamagedListFilters {
  page: number;
  pageSize: number;
  status?: string;
}

export interface DamagedRecoveryFields {
  recoveredTo: string;
  recoveryNotes?: string | null;
  recoveredBy?: string | null;
  recoveredAt: Date;
}

export class InventoryFieldRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  /** Runs `fn` inside one DB transaction (M7 composition seam — M4 pattern). */
  async withTransaction<T>(fn: (tx: FieldTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Unit products (Cliente)
  // ---------------------------------------------------------------------------

  async listUnitProducts(
    tenantId: string,
    filters: UnitProductListFilters,
    client: FieldDbClient = db,
  ): Promise<{ rows: UnitProductListRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [eq(invUnitProducts.tenantId, tenantId)];
    if (!filters.includeMoved) conditions.push(isNull(invUnitProducts.movedTo));
    if (filters.projectId) conditions.push(eq(invUnitProducts.projectId, filters.projectId));
    if (filters.status) conditions.push(eq(invUnitProducts.status, filters.status));
    const where = and(...conditions);

    const rows = await client
      .select({
        unit: invUnitProducts,
        itemName: invItems.name,
        projectName: invProjects.name,
      })
      .from(invUnitProducts)
      .leftJoin(invItems, eq(invItems.id, invUnitProducts.itemId))
      .leftJoin(invProjects, eq(invProjects.id, invUnitProducts.projectId))
      .where(where)
      .orderBy(desc(invUnitProducts.createdAt), desc(invUnitProducts.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invUnitProducts)
      .where(where);

    return { rows, total: count?.total ?? 0 };
  }

  async getUnitProduct(
    tenantId: string,
    id: string,
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow | null> {
    const [row] = await client
      .select()
      .from(invUnitProducts)
      .where(and(eq(invUnitProducts.tenantId, tenantId), eq(invUnitProducts.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** Lock the unit row for the move/toggle transaction (`FOR UPDATE`). */
  async getUnitProductForUpdate(
    tenantId: string,
    id: string,
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow | null> {
    const [row] = await client
      .select()
      .from(invUnitProducts)
      .where(and(eq(invUnitProducts.tenantId, tenantId), eq(invUnitProducts.id, id)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  /**
   * Find a unit product holding `label`. `activeOnly` restricts to units still
   * at the client (moved_to IS NULL) — the M5-label validation rule; the DB
   * unique index however spans ALL rows, so callers that insert should check
   * without the flag (a moved unit keeps its label for history).
   */
  async findUnitByLabel(
    tenantId: string,
    label: string,
    activeOnly: boolean,
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow | null> {
    const conditions: (SQL | undefined)[] = [
      eq(invUnitProducts.tenantId, tenantId),
      eq(invUnitProducts.label, label),
    ];
    if (activeOnly) conditions.push(isNull(invUnitProducts.movedTo));
    const [row] = await client
      .select()
      .from(invUnitProducts)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }

  async insertUnitProducts(
    inputs: NewUnitProductInput[],
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow[]> {
    if (inputs.length === 0) return [];
    return client
      .insert(invUnitProducts)
      .values(
        inputs.map((input) => ({
          tenantId: input.tenantId,
          itemId: input.itemId ?? null,
          label: input.label ?? null,
          status: input.status ?? 'PARADO',
          projectId: input.projectId ?? null,
          customerId: input.customerId ?? null,
          clientNameSnapshot: input.clientNameSnapshot ?? null,
          expeditionOrderId: input.expeditionOrderId ?? null,
          notes: input.notes ?? null,
          createdBy: input.createdBy ?? null,
        })),
      )
      .returning();
  }

  /** INSTALADO/PARADO toggle — installed_at set/cleared with the status. */
  async updateUnitStatus(
    tenantId: string,
    id: string,
    status: string,
    installedAt: Date | null,
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow | null> {
    const [row] = await client
      .update(invUnitProducts)
      .set({ status, installedAt, updatedAt: new Date() })
      .where(and(eq(invUnitProducts.tenantId, tenantId), eq(invUnitProducts.id, id)))
      .returning();
    return row ?? null;
  }

  async markUnitMoved(
    tenantId: string,
    id: string,
    fields: UnitMoveFields,
    client: FieldDbClient = db,
  ): Promise<InvUnitProductRow | null> {
    const [row] = await client
      .update(invUnitProducts)
      .set({
        movedTo: fields.movedTo,
        movedTechnician: fields.movedTechnician ?? null,
        movePhotoFileId: fields.movePhotoFileId ?? null,
        movedAt: fields.movedAt,
        moveNotes: fields.moveNotes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(invUnitProducts.tenantId, tenantId), eq(invUnitProducts.id, id)))
      .returning();
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Technician custody (Técnico)
  // ---------------------------------------------------------------------------

  /**
   * Technician dispatches: SAIDA movements with a responsible (§M7), each with
   * the Σ of its inv_technician_moves (correlated subquery — the per-dispatch
   * remaining is quantity − movedQuantity, computed by the service).
   */
  async listDispatches(tenantId: string, client: FieldDbClient = db): Promise<DispatchRow[]> {
    const movedQuantityExpr = sql<number>`coalesce((
      select sum(tm.quantity)::int
      from inv_technician_moves tm
      where tm.movement_id = ${invStockMovements.id}
    ), 0)`;

    const rows = await client
      .select({
        movementId: invStockMovements.id,
        itemId: invStockMovements.itemId,
        itemName: invItems.name,
        technician: invStockMovements.responsible,
        location: invStockMovements.location,
        quantity: invStockMovements.quantity,
        movedQuantity: movedQuantityExpr,
        reason: invStockMovements.reason,
        createdAt: invStockMovements.createdAt,
      })
      .from(invStockMovements)
      .leftJoin(invItems, eq(invItems.id, invStockMovements.itemId))
      .where(
        and(
          eq(invStockMovements.tenantId, tenantId),
          eq(invStockMovements.type, 'SAIDA'),
          sql`${invStockMovements.responsible} IS NOT NULL AND btrim(${invStockMovements.responsible}) <> ''`,
        ),
      )
      .orderBy(invStockMovements.responsible, desc(invStockMovements.createdAt), desc(invStockMovements.id));

    return rows.map((r) => ({ ...r, technician: r.technician as string }));
  }

  /** Lock one dispatch row so concurrent technician-moves serialize (§M7). */
  async lockDispatch(
    tenantId: string,
    movementId: string,
    client: FieldDbClient = db,
  ): Promise<InvStockMovementRow | null> {
    const [row] = await client
      .select()
      .from(invStockMovements)
      .where(and(eq(invStockMovements.tenantId, tenantId), eq(invStockMovements.id, movementId)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  /** Σ quantity already consumed from a dispatch (under the dispatch lock). */
  async sumTechnicianMoves(
    tenantId: string,
    movementId: string,
    client: FieldDbClient = db,
  ): Promise<number> {
    const [row] = await client
      .select({ total: sql<number>`coalesce(sum(${invTechnicianMoves.quantity}), 0)::int` })
      .from(invTechnicianMoves)
      .where(and(eq(invTechnicianMoves.tenantId, tenantId), eq(invTechnicianMoves.movementId, movementId)));
    return row?.total ?? 0;
  }

  async insertTechnicianMove(
    input: NewTechnicianMoveInput,
    client: FieldDbClient = db,
  ): Promise<InvTechnicianMoveRow> {
    const [row] = await client
      .insert(invTechnicianMoves)
      .values({
        tenantId: input.tenantId,
        movementId: input.movementId,
        itemId: input.itemId ?? null,
        technician: input.technician ?? null,
        destination: input.destination,
        projectId: input.projectId ?? null,
        quantity: input.quantity,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  /** QR links of the given movements (dispatch attachments for the UI). */
  async listMovementQrs(
    tenantId: string,
    movementIds: string[],
    client: FieldDbClient = db,
  ): Promise<InvMovementQrRow[]> {
    if (movementIds.length === 0) return [];
    return client
      .select()
      .from(invMovementQrs)
      .where(and(eq(invMovementQrs.tenantId, tenantId), inArray(invMovementQrs.movementId, movementIds)));
  }

  // ---------------------------------------------------------------------------
  // Damaged items (Avarias)
  // ---------------------------------------------------------------------------

  /** AVARIADO first (…then RECUPERADO), newest first inside each status. */
  async listDamagedItems(
    tenantId: string,
    filters: DamagedListFilters,
    client: FieldDbClient = db,
  ): Promise<{ rows: InvDamagedItemRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [eq(invDamagedItems.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(invDamagedItems.status, filters.status));
    const where = and(...conditions);

    const rows = await client
      .select()
      .from(invDamagedItems)
      .where(where)
      // 'AVARIADO' < 'RECUPERADO' lexicographically — asc puts open damage first.
      .orderBy(invDamagedItems.status, desc(invDamagedItems.createdAt), desc(invDamagedItems.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invDamagedItems)
      .where(where);

    return { rows, total: count?.total ?? 0 };
  }

  /** Lock the damaged row for the recovery transaction (`FOR UPDATE`). */
  async getDamagedItemForUpdate(
    tenantId: string,
    id: string,
    client: FieldDbClient = db,
  ): Promise<InvDamagedItemRow | null> {
    const [row] = await client
      .select()
      .from(invDamagedItems)
      .where(and(eq(invDamagedItems.tenantId, tenantId), eq(invDamagedItems.id, id)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async insertDamagedItem(
    input: NewDamagedItemInput,
    client: FieldDbClient = db,
  ): Promise<InvDamagedItemRow> {
    const [row] = await client
      .insert(invDamagedItems)
      .values({
        tenantId: input.tenantId,
        itemId: input.itemId ?? null,
        productNameSnapshot: input.productNameSnapshot ?? null,
        quantity: input.quantity,
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        reason: input.reason ?? null,
        photoFileId: input.photoFileId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async markDamagedRecovered(
    tenantId: string,
    id: string,
    fields: DamagedRecoveryFields,
    client: FieldDbClient = db,
  ): Promise<InvDamagedItemRow | null> {
    const [row] = await client
      .update(invDamagedItems)
      .set({
        status: 'RECUPERADO',
        recoveredTo: fields.recoveredTo,
        recoveryNotes: fields.recoveryNotes ?? null,
        recoveredBy: fields.recoveredBy ?? null,
        recoveredAt: fields.recoveredAt,
      })
      .where(and(eq(invDamagedItems.tenantId, tenantId), eq(invDamagedItems.id, id)))
      .returning();
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Shared lookups
  // ---------------------------------------------------------------------------

  /** Project lookup with the composing transaction's executor (M9 stays as-is). */
  async getProject(
    tenantId: string,
    id: string,
    client: FieldDbClient = db,
  ): Promise<InvProjectRow | null> {
    const [row] = await client
      .select()
      .from(invProjects)
      .where(and(eq(invProjects.tenantId, tenantId), eq(invProjects.id, id)))
      .limit(1);
    return row ?? null;
  }
}

export const inventoryFieldRepository = new InventoryFieldRepository();
