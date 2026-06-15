import {
  WorkOrder,
  WorkOrderDevice,
  WorkOrderEvent,
  WorkOrderEventType,
  WorkOrderFile,
  ActorSnapshot,
} from '../../domain/entities/work-orders';
import {
  CreateWorkOrderDTO,
  UpdateWorkOrderDTO,
  ListWorkOrdersDTO,
  AppendWorkOrderEventDTO,
  AddWorkOrderFileDTO,
} from '../../dto/request/work-orders/WorkOrderDTO';
import {
  IWorkOrderRepository,
  AppendEventInput,
} from '../../repositories/interfaces/work-orders/IWorkOrderRepository';
import { workOrderRepository } from '../../repositories/work-orders/WorkOrderRepository';
import { ICustomerRepository } from '../../repositories/interfaces/ICustomerRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { IDeviceRepository } from '../../repositories/interfaces/IDeviceRepository';
import { DeviceRepository } from '../../repositories/DeviceRepository';
import { IAssetRepository } from '../../repositories/interfaces/IAssetRepository';
import { AssetRepository } from '../../repositories/AssetRepository';
import { PaginatedResult } from '../../shared/types';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors/AppError';
import { generateWorkOrderCode } from './woCode';
import {
  LIFECYCLE_CATEGORIES,
  isTerminal,
  lifecycleStateForCode,
  evaluateTransitions,
  evaluateTransitionsFromRules,
  evaluateEventTypeFromRules,
  TransitionEvaluation,
  LifecycleRule,
} from './workOrderRules';
import { workOrderLifecycleRepository } from '../../repositories/work-orders/WorkOrderLifecycleRepository';

export interface ActorContext {
  userId: string;
  actorType?: 'USER' | 'SYSTEM' | 'API_KEY';
  actor?: ActorSnapshot | null;
}

export interface WorkOrderDetail extends WorkOrder {
  devices: WorkOrderDevice[];
  events: WorkOrderEvent[];
}

// ---------------------------------------------------------------------------
// Status projection. The projected `work_orders.status` is derived from the
// latest lifecycle event of the WO's type. The state-machine rules (projection
// + transition guards) live in the Work Order Rules Engine (RFC-0041); this
// service delegates to it and stays focused on persistence/orchestration.
// ---------------------------------------------------------------------------

export interface TransitionsResult {
  status: string;
  transitions: TransitionEvaluation[];
}

export class WorkOrderService {
  constructor(
    private readonly repo: IWorkOrderRepository = workOrderRepository,
    private readonly customerRepo: ICustomerRepository = new CustomerRepository(),
    private readonly deviceRepo: IDeviceRepository = new DeviceRepository(),
    private readonly assetRepo: IAssetRepository = new AssetRepository(),
  ) {}

  // ===========================================================================
  // CRUD
  // ===========================================================================
  async create(tenantId: string, data: CreateWorkOrderDTO, ctx: ActorContext): Promise<WorkOrderDetail> {
    const customer = await this.customerRepo.getById(tenantId, data.customerId);
    if (!customer) throw new NotFoundError(`Customer ${data.customerId} not found`);

    if (data.rootAssetId) {
      const asset = await this.assetRepo.getById(tenantId, data.rootAssetId);
      if (!asset) throw new NotFoundError(`Asset ${data.rootAssetId} not found`);
    }

    const code = await this.resolveCode(tenantId, data.code);

    const wo = await this.repo.create(tenantId, {
      customerId:  data.customerId,
      type:        data.type,
      rootAssetId: data.rootAssetId ?? null,
      code,
      assignedTo:  data.assignedTo ?? null,
      scheduledAt: data.scheduledAt ?? null,
      status:      'PLANEJADA',
    }, ctx.userId);

    // Structural marker: WO_CRIADA.
    await this.repo.appendEvent(tenantId, wo.id, this.actorEvent(ctx, {
      eventType: 'WO_CRIADA',
      payload:   { type: wo.type, customerId: wo.customerId },
    }));

    // Optional initial device scope.
    if (data.devices && data.devices.length > 0) {
      for (const deviceId of data.devices) {
        await this.assertDeviceBelongs(tenantId, deviceId);
        await this.repo.addDevice(tenantId, wo.id, deviceId, ctx.userId);
      }
    }

    if (data.assignedTo) {
      await this.repo.appendEvent(tenantId, wo.id, this.actorEvent(ctx, {
        eventType: 'WO_ATRIBUIDA',
        payload:   { assignedTo: data.assignedTo },
      }));
    }

    return this.detail(tenantId, wo.id);
  }

  async getById(tenantId: string, id: string): Promise<WorkOrder> {
    const wo = await this.repo.getById(tenantId, id);
    if (!wo) throw new NotFoundError(`Work order ${id} not found`);
    return wo;
  }

  async detail(tenantId: string, id: string): Promise<WorkOrderDetail> {
    const wo = await this.getById(tenantId, id);
    const [devices, events] = await Promise.all([
      this.repo.listDevices(tenantId, id),
      this.repo.listEvents(tenantId, id),
    ]);
    return { ...wo, devices, events };
  }

  /**
   * RFC-0041: evaluate which event-types can/can't be appended now (and why),
   * given the WO's current (already-projected) status. The composer renders
   * blocked ones struck-through with the reason.
   */
  async getTransitions(tenantId: string, id: string): Promise<TransitionsResult> {
    const wo = await this.getById(tenantId, id);
    const catalog = await this.listEventTypes();
    const rules = await this.loadLifecycleRules(tenantId);
    const woRef = { type: wo.type, status: wo.status };

    // Table-driven flow when the tenant defines one; else built-in default.
    const transitions = rules.length
      ? evaluateTransitionsFromRules(woRef, catalog, await this.occurredSet(tenantId, id), rules)
      : evaluateTransitions(woRef, catalog);

    return { status: wo.status, transitions };
  }

  /** Map the tenant's lifecycle rule rows to the engine's shape (empty = default). */
  private async loadLifecycleRules(tenantId: string): Promise<LifecycleRule[]> {
    const rows = await workOrderLifecycleRepository.listByTenant(tenantId);
    return rows.map((r) => ({
      woType: r.woType,
      eventType: r.eventType,
      predecessors: r.predecessors ?? [],
      predecessorRule: (r.predecessorRule as 'NONE' | 'ANY' | 'ALL') ?? 'NONE',
      activates: r.activates ?? [],
      projectsStatus: r.projectsStatus,
      isEntry: r.isEntry,
    }));
  }

  /** Set of event-type codes already on the WO (for predecessor checks). */
  private async occurredSet(tenantId: string, workOrderId: string): Promise<Set<string>> {
    const events = await this.repo.listEvents(tenantId, workOrderId);
    return new Set(events.map((e) => e.eventType));
  }

  async update(tenantId: string, id: string, data: UpdateWorkOrderDTO, ctx: ActorContext): Promise<WorkOrder> {
    const existing = await this.getById(tenantId, id);

    if (data.rootAssetId) {
      const asset = await this.assetRepo.getById(tenantId, data.rootAssetId);
      if (!asset) throw new NotFoundError(`Asset ${data.rootAssetId} not found`);
    }

    if (data.code !== undefined && data.code !== existing.code) {
      if (await this.repo.codeExists(tenantId, data.code, id)) {
        throw new ConflictError(`Work order code "${data.code}" is already in use`);
      }
    }

    const updated = await this.repo.update(tenantId, id, {
      rootAssetId: data.rootAssetId,
      code:        data.code,
      assignedTo:  data.assignedTo,
      scheduledAt: data.scheduledAt,
    });

    // Emit a marker when the assignee changes.
    if (data.assignedTo !== undefined && data.assignedTo !== existing.assignedTo) {
      await this.repo.appendEvent(tenantId, id, this.actorEvent(ctx, {
        eventType: 'WO_ATRIBUIDA',
        payload:   { assignedTo: data.assignedTo },
      }));
    }

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.getById(tenantId, id);
    await this.repo.softDelete(tenantId, id);
  }

  async list(tenantId: string, params: ListWorkOrdersDTO): Promise<PaginatedResult<WorkOrder>> {
    return this.repo.list(tenantId, params);
  }

  // ===========================================================================
  // Events (with status projection)
  // ===========================================================================
  async appendEvent(
    tenantId: string,
    workOrderId: string,
    data: AppendWorkOrderEventDTO,
    ctx: ActorContext,
  ): Promise<WorkOrderEvent> {
    const wo = await this.getById(tenantId, workOrderId);

    const eventType = await this.repo.getEventType(data.eventType);
    if (!eventType || !eventType.active) {
      throw new ValidationError(`Unknown or inactive event_type "${data.eventType}"`);
    }

    // Status this event projects + validity, via the Rules Engine. When the
    // tenant has a lifecycle table it's authoritative; otherwise the built-in
    // default flow (suffix matrix) applies.
    const rules = await this.loadLifecycleRules(tenantId);
    let projected: string | null;
    if (rules.length) {
      const occurred = await this.occurredSet(tenantId, workOrderId);
      const evaluation = evaluateEventTypeFromRules(
        eventType,
        { type: wo.type, status: wo.status },
        occurred,
        rules,
      );
      if (!evaluation.allowed) {
        throw new ConflictError(
          `Event "${eventType.code}" cannot be appended now (${evaluation.reasonCode})`,
        );
      }
      projected = evaluation.targetStatus;
    } else {
      projected = lifecycleStateForCode(eventType.code, eventType.category);
      // Terminal WOs are locked for further LIFECYCLE events.
      if (projected && isTerminal(wo.status)) {
        throw new ConflictError(
          `Work order ${workOrderId} is ${wo.status} and cannot accept further lifecycle events`,
        );
      }
      // A lifecycle event must belong to the WO's own type.
      if (LIFECYCLE_CATEGORIES.has(eventType.category) && eventType.category !== wo.type) {
        throw new ValidationError(
          `Event "${eventType.code}" (${eventType.category}) does not match work order type ${wo.type}`,
        );
      }
    }

    // Reference integrity for asset/device.
    if (data.deviceId) await this.assertDeviceBelongs(tenantId, data.deviceId);
    if (data.assetId) {
      const asset = await this.assetRepo.getById(tenantId, data.assetId);
      if (!asset) throw new NotFoundError(`Asset ${data.assetId} not found`);
    }

    const event = await this.repo.appendEvent(tenantId, workOrderId, this.actorEvent(ctx, {
      eventType: eventType.code,
      assetId:   data.assetId ?? null,
      deviceId:  data.deviceId ?? null,
      payload:   data.payload ?? {},
    }));

    // STATUS PROJECTION: a lifecycle event of the WO's type moves status.
    if (projected && projected !== wo.status) {
      await this.repo.updateStatus(tenantId, workOrderId, projected);
    }

    return event;
  }

  async listEvents(tenantId: string, workOrderId: string): Promise<WorkOrderEvent[]> {
    await this.getById(tenantId, workOrderId);
    return this.repo.listEvents(tenantId, workOrderId);
  }

  /** Active event-type catalog (codes, labels, categories) for the UI timeline. */
  async listEventTypes(): Promise<WorkOrderEventType[]> {
    return this.repo.listEventTypes();
  }

  // ===========================================================================
  // Observation / Attachment markers (annotation ids stored in payload).
  // The annotation itself lives in the annotations domain — we only record the
  // marker event referencing annotation_id.
  // ===========================================================================
  async appendObservationMarker(
    tenantId: string,
    workOrderId: string,
    eventType: 'OBSERVACAO_INSERIDA' | 'OBSERVACAO_EDITADA' | 'OBSERVACAO_DELETADA' | 'OBSERVACAO_ARQUIVADA',
    annotationId: string,
    ctx: ActorContext,
    extra?: Record<string, unknown>,
  ): Promise<WorkOrderEvent> {
    await this.getById(tenantId, workOrderId);
    return this.repo.appendEvent(tenantId, workOrderId, this.actorEvent(ctx, {
      eventType,
      payload: { annotationId, ...(extra ?? {}) },
    }));
  }

  async appendAttachmentMarker(
    tenantId: string,
    workOrderId: string,
    eventType: 'ANEXO_INSERIDO' | 'ANEXO_EDITADO' | 'ANEXO_DELETADO' | 'ANEXO_ARQUIVADO',
    ctx: ActorContext,
    payload: Record<string, unknown>,
  ): Promise<WorkOrderEvent> {
    await this.getById(tenantId, workOrderId);
    return this.repo.appendEvent(tenantId, workOrderId, this.actorEvent(ctx, { eventType, payload }));
  }

  // ===========================================================================
  // Device scope mutation
  // ===========================================================================
  async addDevice(tenantId: string, workOrderId: string, deviceId: string, ctx: ActorContext): Promise<WorkOrderDevice> {
    await this.getById(tenantId, workOrderId);
    await this.assertDeviceBelongs(tenantId, deviceId);
    return this.repo.addDevice(tenantId, workOrderId, deviceId, ctx.userId);
  }

  async removeDevice(tenantId: string, workOrderId: string, deviceId: string): Promise<void> {
    await this.getById(tenantId, workOrderId);
    const present = await this.repo.hasDevice(tenantId, workOrderId, deviceId);
    if (!present) throw new NotFoundError(`Device ${deviceId} is not in work order ${workOrderId} scope`);
    await this.repo.removeDevice(tenantId, workOrderId, deviceId);
  }

  async listDevices(tenantId: string, workOrderId: string): Promise<WorkOrderDevice[]> {
    await this.getById(tenantId, workOrderId);
    return this.repo.listDevices(tenantId, workOrderId);
  }

  // ===========================================================================
  // Files
  // ===========================================================================
  async addFile(tenantId: string, workOrderId: string, data: AddWorkOrderFileDTO): Promise<WorkOrderFile> {
    await this.getById(tenantId, workOrderId);
    return this.repo.addFile(tenantId, workOrderId, {
      fileAssetId:      data.fileAssetId,
      workOrderEventId: data.workOrderEventId ?? null,
      imageOrder:       data.imageOrder,
      caption:          data.caption ?? null,
    });
  }

  async listFiles(tenantId: string, workOrderId: string): Promise<WorkOrderFile[]> {
    await this.getById(tenantId, workOrderId);
    return this.repo.listFiles(tenantId, workOrderId);
  }

  async deleteFile(tenantId: string, workOrderId: string, fileId: string): Promise<void> {
    await this.getById(tenantId, workOrderId);
    const file = await this.repo.getFile(tenantId, workOrderId, fileId);
    if (!file) throw new NotFoundError(`File ${fileId} not found on work order ${workOrderId}`);
    await this.repo.deleteFile(tenantId, workOrderId, fileId);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  /** Explicit codes must be free; absent codes are generated (OS-<Mercosul plate>). */
  private async resolveCode(tenantId: string, requested?: string): Promise<string> {
    if (requested) {
      if (await this.repo.codeExists(tenantId, requested)) {
        throw new ConflictError(`Work order code "${requested}" is already in use`);
      }
      return requested;
    }
    // 24^4 * 8^3 ≈ 170M combinations — collisions are effectively impossible,
    // the retry cap is just a guard against a pathological tenant.
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateWorkOrderCode();
      if (!(await this.repo.codeExists(tenantId, candidate))) return candidate;
    }
    throw new ConflictError('Could not allocate a unique work order code');
  }

  private actorEvent(ctx: ActorContext, base: Omit<AppendEventInput, 'actorType' | 'actorUserId' | 'actor'>): AppendEventInput {
    const actorType = ctx.actorType ?? 'USER';
    return {
      ...base,
      actorType,
      actorUserId: actorType === 'USER' ? ctx.userId : null,
      actor:       ctx.actor ?? null,
    };
  }

  private async assertDeviceBelongs(tenantId: string, deviceId: string): Promise<void> {
    const device = await this.deviceRepo.getById(tenantId, deviceId);
    if (!device) throw new NotFoundError(`Device ${deviceId} not found`);
  }
}

export const workOrderService = new WorkOrderService();
