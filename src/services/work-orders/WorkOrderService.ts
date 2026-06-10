import {
  WorkOrder,
  WorkOrderDevice,
  WorkOrderEvent,
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
// latest lifecycle event of the WO's type. We map the lifecycle SUFFIX of a
// `<CATEGORY>_<STATE>` event code to one of the projected states. Non-lifecycle
// categories (OBSERVACAO/ANEXO/ESTRUTURA) never move status.
// ---------------------------------------------------------------------------
const LIFECYCLE_CATEGORIES = new Set(['VISITA_TECNICA', 'INSTALACAO', 'MANUTENCAO']);

function lifecycleStateForCode(code: string, category: string): string | null {
  if (!LIFECYCLE_CATEGORIES.has(category)) return null;
  // suffix = code minus the "<CATEGORY>_" prefix
  const suffix = code.startsWith(`${category}_`) ? code.slice(category.length + 1) : code;

  switch (suffix) {
    case 'PLANEJADA':
      return 'PLANEJADA';
    case 'INICIADA':
    case 'REINICIADA':
    case 'EXECUTADA_PARCIAL':
      return 'EM_ANDAMENTO';
    case 'INTERROMPIDA':
      return 'INTERROMPIDA';
    case 'REAGENDADA':
      return 'REAGENDADA';
    case 'AGUARDANDO_AGENDA_CLIENTE':
    case 'AGUARDANDO_AGENDA_TECNICO':
    case 'AGUARDANDO_OUTROS_MOTIVOS':
      return 'AGUARDANDO';
    case 'FINALIZADA':
      return 'FINALIZADA';
    case 'CANCELADA':
      return 'CANCELADA';
    default:
      return null;
  }
}

const TERMINAL_STATUSES = new Set(['FINALIZADA', 'CANCELADA']);

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

    const wo = await this.repo.create(tenantId, {
      customerId:  data.customerId,
      type:        data.type,
      rootAssetId: data.rootAssetId ?? null,
      code:        data.code ?? null,
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

  async update(tenantId: string, id: string, data: UpdateWorkOrderDTO, ctx: ActorContext): Promise<WorkOrder> {
    const existing = await this.getById(tenantId, id);

    if (data.rootAssetId) {
      const asset = await this.assetRepo.getById(tenantId, data.rootAssetId);
      if (!asset) throw new NotFoundError(`Asset ${data.rootAssetId} not found`);
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

    // Terminal WOs are locked for further LIFECYCLE events.
    const projected = lifecycleStateForCode(eventType.code, eventType.category);
    if (projected && TERMINAL_STATUSES.has(wo.status)) {
      throw new ConflictError(`Work order ${workOrderId} is ${wo.status} and cannot accept further lifecycle events`);
    }

    // A lifecycle event must belong to the WO's own type.
    if (LIFECYCLE_CATEGORIES.has(eventType.category) && eventType.category !== wo.type) {
      throw new ValidationError(
        `Event "${eventType.code}" (${eventType.category}) does not match work order type ${wo.type}`,
      );
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
