import {
  WorkOrder,
  WorkOrderDevice,
  WorkOrderEvent,
  WorkOrderEventType,
  WorkOrderFile,
  ActorSnapshot,
} from '../../../domain/entities/work-orders';
import { ListWorkOrdersDTO } from '../../../dto/request/work-orders/WorkOrderDTO';
import { PaginatedResult } from '../../../shared/types';

export interface CreateWorkOrderInput {
  customerId: string;
  type: string;
  rootAssetId?: string | null;
  code: string;
  assignedTo?: string | null;
  scheduledAt?: string | null;
  status?: string;
}

export interface UpdateWorkOrderInput {
  rootAssetId?: string | null;
  code?: string;
  assignedTo?: string | null;
  scheduledAt?: string | null;
}

export interface AppendEventInput {
  eventType: string;
  actorType: string;
  actorUserId?: string | null;
  actor?: ActorSnapshot | null;
  assetId?: string | null;
  deviceId?: string | null;
  payload?: Record<string, unknown>;
}

export interface AddFileInput {
  fileAssetId: string;
  workOrderEventId?: string | null;
  imageOrder?: number;
  caption?: string | null;
}

export interface IWorkOrderRepository {
  // ---- Work orders CRUD ----------------------------------------------------
  create(tenantId: string, data: CreateWorkOrderInput, createdBy: string): Promise<WorkOrder>;
  getById(tenantId: string, id: string): Promise<WorkOrder | null>;
  update(tenantId: string, id: string, data: UpdateWorkOrderInput): Promise<WorkOrder>;
  updateStatus(tenantId: string, id: string, status: string): Promise<WorkOrder>;
  softDelete(tenantId: string, id: string): Promise<void>;
  list(tenantId: string, params: ListWorkOrdersDTO): Promise<PaginatedResult<WorkOrder>>;
  /** True when a non-deleted WO of the tenant already uses this code. */
  codeExists(tenantId: string, code: string, excludeId?: string): Promise<boolean>;

  // ---- Event types catalog -------------------------------------------------
  getEventType(code: string): Promise<WorkOrderEventType | null>;
  listEventTypes(): Promise<WorkOrderEventType[]>;

  // ---- Events --------------------------------------------------------------
  appendEvent(tenantId: string, workOrderId: string, data: AppendEventInput): Promise<WorkOrderEvent>;
  listEvents(tenantId: string, workOrderId: string): Promise<WorkOrderEvent[]>;

  // ---- Device scope --------------------------------------------------------
  addDevice(tenantId: string, workOrderId: string, deviceId: string, addedBy: string): Promise<WorkOrderDevice>;
  removeDevice(tenantId: string, workOrderId: string, deviceId: string): Promise<void>;
  listDevices(tenantId: string, workOrderId: string): Promise<WorkOrderDevice[]>;
  hasDevice(tenantId: string, workOrderId: string, deviceId: string): Promise<boolean>;

  // ---- Files ---------------------------------------------------------------
  addFile(tenantId: string, workOrderId: string, data: AddFileInput): Promise<WorkOrderFile>;
  listFiles(tenantId: string, workOrderId: string): Promise<WorkOrderFile[]>;
  getFile(tenantId: string, workOrderId: string, fileId: string): Promise<WorkOrderFile | null>;
  deleteFile(tenantId: string, workOrderId: string, fileId: string): Promise<void>;
}
