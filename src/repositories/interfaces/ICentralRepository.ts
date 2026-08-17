import { Central, ConnectionStatus } from '../../domain/entities/Central';
import { CreateCentralDTO, UpdateCentralDTO, ListCentralsDTO } from '../../dto/request/CentralDTO';
import { PaginatedResult, EntityStatus } from '../../shared/types';

export interface ICentralRepository {
  create(tenantId: string, data: CreateCentralDTO, createdBy: string): Promise<Central>;
  getById(tenantId: string, id: string): Promise<Central | null>;
  // Cross-tenant lookup by the central's own UUID (its `id`) — RFC-0056 bootstrap,
  // central-agent auth, and zero-touch enrollment all key off this.
  getByUuid(uuid: string): Promise<{ id: string; tenantId: string; config: unknown } | null>;
  // RFC-0056 — shallow-merge a partial `config` jsonb patch onto the central row.
  // Both bootstrap and the operator reset flow already hold the resolved
  // `tenantId` by the time they call this. Returns the updated config, or null
  // if no such central in the tenant.
  patchConfig(
    tenantId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<Record<string, unknown> | null>;
  getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central | null>;
  // Global (cross-tenant) existence check — used by the public central_id generator.
  existsBySerialNumberGlobal(serialNumber: string): Promise<boolean>;
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
