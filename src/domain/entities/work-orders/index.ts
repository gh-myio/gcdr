// RFC-0037 — Work Orders (event-log model).
//
// A Work Order has N events (each authored by a user/system/api-key, carrying
// an event_type + flexible payload), a derived device scope, attached files,
// and (via the generalized RFC-0036 annotation subsystem) observations.
// `status` is a service-maintained PROJECTION of the latest lifecycle event.

export type WorkOrderType = 'INSTALACAO' | 'MANUTENCAO' | 'VISITA_TECNICA';

// Projected lifecycle status (maintained by the service, not stored per-event).
export type WorkOrderStatus =
  | 'PLANEJADA'
  | 'EM_ANDAMENTO'
  | 'INTERROMPIDA'
  | 'AGUARDANDO'
  | 'REAGENDADA'
  | 'FINALIZADA'
  | 'CANCELADA';

export type ActorKind = 'USER' | 'SYSTEM' | 'API_KEY';

// Event-type catalog categories.
export type WorkOrderEventCategory =
  | 'VISITA_TECNICA'
  | 'INSTALACAO'
  | 'MANUTENCAO'
  | 'OBSERVACAO'
  | 'ANEXO'
  | 'ESTRUTURA';

/** Actor JSONB snapshot — survives user deletion without a join. */
export interface ActorSnapshot {
  id?: string;
  email?: string;
  name?: string;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  customerId: string;
  rootAssetId: string | null;
  type: WorkOrderType;
  status: WorkOrderStatus | string;
  code: string | null;
  assignedTo: string | null;
  scheduledAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkOrderDevice {
  workOrderId: string;
  deviceId: string;
  addedBy: string;
  addedAt: string;
}

export interface WorkOrderEventType {
  code: string;
  category: WorkOrderEventCategory | string;
  label: string;
  isTerminal: boolean;
  sortOrder: number;
  active: boolean;
}

export interface WorkOrderEvent {
  id: string;
  tenantId: string;
  workOrderId: string;
  eventType: string;
  actorType: ActorKind | string;
  actorUserId: string | null;
  actor: ActorSnapshot | null;
  assetId: string | null;
  deviceId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkOrderFile {
  id: string;
  tenantId: string;
  workOrderId: string;
  workOrderEventId: string | null;
  fileAssetId: string;
  imageOrder: number;
  caption: string | null;
  createdAt: string;
}

// RFC-0037 §6 — carried over from wo_customer_settings (renamed table,
// unchanged shape). Presence of a row marks a customer as WO-enabled.
export interface WorkOrdersCustomerSettings {
  customerId: string;
  tenantId: string;
  viewerPasswordHash: string | null;
  defaultCentralId: string | null;
  woMetadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
