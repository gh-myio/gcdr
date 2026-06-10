import { eq, and, isNull, sql, desc, asc } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import {
  WorkOrder,
  WorkOrderDevice,
  WorkOrderEvent,
  WorkOrderEventType,
  WorkOrderFile,
  ActorSnapshot,
} from '../../domain/entities/work-orders';
import { ListWorkOrdersDTO } from '../../dto/request/work-orders/WorkOrderDTO';
import {
  IWorkOrderRepository,
  CreateWorkOrderInput,
  UpdateWorkOrderInput,
  AppendEventInput,
  AddFileInput,
} from '../interfaces/work-orders/IWorkOrderRepository';
import { PaginatedResult } from '../../shared/types';
import { AppError } from '../../shared/errors/AppError';
import { countWhere } from '../helpers/countQuery';

const {
  workOrders,
  workOrdersDevices,
  workOrdersEventTypes,
  workOrdersEvents,
  workOrderFiles,
} = schema;

export class WorkOrderRepository implements IWorkOrderRepository {
  // ===========================================================================
  // Work orders CRUD
  // ===========================================================================
  async create(tenantId: string, data: CreateWorkOrderInput, createdBy: string): Promise<WorkOrder> {
    const [row] = await db.insert(workOrders).values({
      tenantId,
      customerId:  data.customerId,
      rootAssetId: data.rootAssetId ?? null,
      type:        data.type,
      status:      data.status ?? 'PLANEJADA',
      code:        data.code ?? null,
      assignedTo:  data.assignedTo ?? null,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdBy,
    }).returning();

    return this.mapWorkOrder(row);
  }

  async getById(tenantId: string, id: string): Promise<WorkOrder | null> {
    const [row] = await db
      .select()
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, id),
        isNull(workOrders.deletedAt),
      ))
      .limit(1);
    return row ? this.mapWorkOrder(row) : null;
  }

  async update(tenantId: string, id: string, data: UpdateWorkOrderInput): Promise<WorkOrder> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.rootAssetId !== undefined) updates.rootAssetId = data.rootAssetId;
    if (data.code !== undefined)        updates.code = data.code;
    if (data.assignedTo !== undefined)  updates.assignedTo = data.assignedTo;
    if (data.scheduledAt !== undefined) {
      updates.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    }

    const [row] = await db.update(workOrders)
      .set(updates)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, id),
        isNull(workOrders.deletedAt),
      ))
      .returning();

    if (!row) throw new AppError('WORK_ORDER_NOT_FOUND', 'Work order not found', 404);
    return this.mapWorkOrder(row);
  }

  async updateStatus(tenantId: string, id: string, status: string): Promise<WorkOrder> {
    const [row] = await db.update(workOrders)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, id),
        isNull(workOrders.deletedAt),
      ))
      .returning();

    if (!row) throw new AppError('WORK_ORDER_NOT_FOUND', 'Work order not found', 404);
    return this.mapWorkOrder(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await db.update(workOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id)));
  }

  async list(tenantId: string, params: ListWorkOrdersDTO): Promise<PaginatedResult<WorkOrder>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions = [eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)];
    if (params.customerId) conditions.push(eq(workOrders.customerId, params.customerId));
    if (params.status)     conditions.push(eq(workOrders.status, params.status));
    if (params.type)       conditions.push(eq(workOrders.type, params.type));
    if (params.assignedTo) conditions.push(eq(workOrders.assignedTo, params.assignedTo));

    // device filter: restrict to work orders whose scope contains the device.
    if (params.deviceId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${workOrdersDevices} wod
        WHERE wod.work_order_id = ${workOrders.id}
          AND wod.device_id = ${params.deviceId}
      )`);
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(workOrders)
        .where(and(...conditions))
        .orderBy(desc(workOrders.createdAt))
        .limit(limit + 1)
        .offset(offset),
      countWhere(workOrders, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map((r) => this.mapWorkOrder(r)),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  // ===========================================================================
  // Event types catalog
  // ===========================================================================
  async getEventType(code: string): Promise<WorkOrderEventType | null> {
    const [row] = await db
      .select()
      .from(workOrdersEventTypes)
      .where(eq(workOrdersEventTypes.code, code))
      .limit(1);
    return row ? this.mapEventType(row) : null;
  }

  async listEventTypes(): Promise<WorkOrderEventType[]> {
    const rows = await db
      .select()
      .from(workOrdersEventTypes)
      .where(eq(workOrdersEventTypes.active, true))
      .orderBy(asc(workOrdersEventTypes.sortOrder), asc(workOrdersEventTypes.code));
    return rows.map((r) => this.mapEventType(r));
  }

  // ===========================================================================
  // Events
  // ===========================================================================
  async appendEvent(tenantId: string, workOrderId: string, data: AppendEventInput): Promise<WorkOrderEvent> {
    const [row] = await db.insert(workOrdersEvents).values({
      tenantId,
      workOrderId,
      eventType:   data.eventType,
      actorType:   data.actorType,
      actorUserId: data.actorUserId ?? null,
      actor:       data.actor ?? null,
      assetId:     data.assetId ?? null,
      deviceId:    data.deviceId ?? null,
      payload:     data.payload ?? {},
    }).returning();
    return this.mapEvent(row);
  }

  async listEvents(tenantId: string, workOrderId: string): Promise<WorkOrderEvent[]> {
    const rows = await db
      .select()
      .from(workOrdersEvents)
      .where(and(
        eq(workOrdersEvents.tenantId, tenantId),
        eq(workOrdersEvents.workOrderId, workOrderId),
      ))
      .orderBy(workOrdersEvents.createdAt);
    return rows.map((r) => this.mapEvent(r));
  }

  // ===========================================================================
  // Device scope
  // ===========================================================================
  async addDevice(tenantId: string, workOrderId: string, deviceId: string, addedBy: string): Promise<WorkOrderDevice> {
    const [row] = await db.insert(workOrdersDevices).values({
      workOrderId,
      deviceId,
      addedBy,
    }).onConflictDoNothing().returning();

    if (!row) {
      // Already present — return the existing row.
      const [existing] = await db
        .select()
        .from(workOrdersDevices)
        .where(and(
          eq(workOrdersDevices.workOrderId, workOrderId),
          eq(workOrdersDevices.deviceId, deviceId),
        ))
        .limit(1);
      return this.mapDevice(existing);
    }
    return this.mapDevice(row);
  }

  async removeDevice(tenantId: string, workOrderId: string, deviceId: string): Promise<void> {
    await db.delete(workOrdersDevices)
      .where(and(
        eq(workOrdersDevices.workOrderId, workOrderId),
        eq(workOrdersDevices.deviceId, deviceId),
      ));
  }

  async listDevices(tenantId: string, workOrderId: string): Promise<WorkOrderDevice[]> {
    const rows = await db
      .select()
      .from(workOrdersDevices)
      .where(eq(workOrdersDevices.workOrderId, workOrderId))
      .orderBy(workOrdersDevices.addedAt);
    return rows.map((r) => this.mapDevice(r));
  }

  async hasDevice(tenantId: string, workOrderId: string, deviceId: string): Promise<boolean> {
    const [row] = await db
      .select({ deviceId: workOrdersDevices.deviceId })
      .from(workOrdersDevices)
      .where(and(
        eq(workOrdersDevices.workOrderId, workOrderId),
        eq(workOrdersDevices.deviceId, deviceId),
      ))
      .limit(1);
    return !!row;
  }

  // ===========================================================================
  // Files
  // ===========================================================================
  async addFile(tenantId: string, workOrderId: string, data: AddFileInput): Promise<WorkOrderFile> {
    const [row] = await db.insert(workOrderFiles).values({
      tenantId,
      workOrderId,
      workOrderEventId: data.workOrderEventId ?? null,
      fileAssetId:      data.fileAssetId,
      imageOrder:       data.imageOrder ?? 0,
      caption:          data.caption ?? null,
    }).returning();
    return this.mapFile(row);
  }

  async listFiles(tenantId: string, workOrderId: string): Promise<WorkOrderFile[]> {
    const rows = await db
      .select()
      .from(workOrderFiles)
      .where(and(
        eq(workOrderFiles.tenantId, tenantId),
        eq(workOrderFiles.workOrderId, workOrderId),
      ))
      .orderBy(workOrderFiles.imageOrder);
    return rows.map((r) => this.mapFile(r));
  }

  async getFile(tenantId: string, workOrderId: string, fileId: string): Promise<WorkOrderFile | null> {
    const [row] = await db
      .select()
      .from(workOrderFiles)
      .where(and(
        eq(workOrderFiles.tenantId, tenantId),
        eq(workOrderFiles.workOrderId, workOrderId),
        eq(workOrderFiles.id, fileId),
      ))
      .limit(1);
    return row ? this.mapFile(row) : null;
  }

  async deleteFile(tenantId: string, workOrderId: string, fileId: string): Promise<void> {
    await db.delete(workOrderFiles)
      .where(and(
        eq(workOrderFiles.tenantId, tenantId),
        eq(workOrderFiles.workOrderId, workOrderId),
        eq(workOrderFiles.id, fileId),
      ));
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================
  private mapWorkOrder(row: typeof workOrders.$inferSelect): WorkOrder {
    return {
      id:          row.id,
      tenantId:    row.tenantId,
      customerId:  row.customerId,
      rootAssetId: row.rootAssetId ?? null,
      type:        row.type as WorkOrder['type'],
      status:      row.status,
      code:        row.code ?? null,
      assignedTo:  row.assignedTo ?? null,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      createdBy:   row.createdBy,
      createdAt:   row.createdAt.toISOString(),
      updatedAt:   row.updatedAt.toISOString(),
      deletedAt:   row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }

  private mapEventType(row: typeof workOrdersEventTypes.$inferSelect): WorkOrderEventType {
    return {
      code:       row.code,
      category:   row.category,
      label:      row.label,
      isTerminal: row.isTerminal,
      sortOrder:  row.sortOrder,
      active:     row.active,
    };
  }

  private mapEvent(row: typeof workOrdersEvents.$inferSelect): WorkOrderEvent {
    return {
      id:          row.id,
      tenantId:    row.tenantId,
      workOrderId: row.workOrderId,
      eventType:   row.eventType,
      actorType:   row.actorType,
      actorUserId: row.actorUserId ?? null,
      actor:       (row.actor as ActorSnapshot | null) ?? null,
      assetId:     row.assetId ?? null,
      deviceId:    row.deviceId ?? null,
      payload:     (row.payload ?? {}) as Record<string, unknown>,
      createdAt:   row.createdAt.toISOString(),
    };
  }

  private mapDevice(row: typeof workOrdersDevices.$inferSelect): WorkOrderDevice {
    return {
      workOrderId: row.workOrderId,
      deviceId:    row.deviceId,
      addedBy:     row.addedBy,
      addedAt:     row.addedAt.toISOString(),
    };
  }

  private mapFile(row: typeof workOrderFiles.$inferSelect): WorkOrderFile {
    return {
      id:               row.id,
      tenantId:         row.tenantId,
      workOrderId:      row.workOrderId,
      workOrderEventId: row.workOrderEventId ?? null,
      fileAssetId:      row.fileAssetId,
      imageOrder:       row.imageOrder,
      caption:          row.caption ?? null,
      createdAt:        row.createdAt.toISOString(),
    };
  }
}

export const workOrderRepository = new WorkOrderRepository();
