import { Central, ConnectionStatus } from '../../domain/entities/Central';
import { CreateCentralDTO, UpdateCentralDTO, ListCentralsDTO } from '../../dto/request/CentralDTO';
import { PaginatedResult, EntityStatus } from '../../shared/types';

export interface ICentralRepository {
  create(tenantId: string, data: CreateCentralDTO, createdBy: string): Promise<Central>;
  getById(tenantId: string, id: string): Promise<Central | null>;
  getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central | null>;
  update(tenantId: string, id: string, data: UpdateCentralDTO, updatedBy: string): Promise<Central>;
  delete(tenantId: string, id: string): Promise<void>;

  // List and filter
  list(tenantId: string, params: ListCentralsDTO): Promise<PaginatedResult<Central>>;
  listByCustomer(tenantId: string, customerId: string): Promise<Central[]>;
  listByAsset(tenantId: string, assetId: string): Promise<Central[]>;

  // Status updates
  updateStatus(tenantId: string, id: string, status: EntityStatus, updatedBy: string): Promise<Central>;
  updateConnectionStatus(
    tenantId: string,
    id: string,
    connectionStatus: ConnectionStatus,
    stats?: Partial<Central['stats']>
  ): Promise<Central>;

  // Heartbeat
  recordHeartbeat(tenantId: string, id: string, stats: Partial<Central['stats']>): Promise<void>;
}
