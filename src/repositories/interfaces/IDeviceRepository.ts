import { Device, ConnectivityStatus } from '../../domain/entities/Device';
import { CreateDeviceDTO, UpdateDeviceDTO, ListDevicesParams } from '../../dto/request/DeviceDTO';
import { PaginatedResult } from '../../shared/types';

export interface IDeviceRepository {
  // CRUD
  create(tenantId: string, data: CreateDeviceDTO, customerId: string, createdBy: string): Promise<Device>;
  getById(tenantId: string, id: string): Promise<Device | null>;
  getBySerialNumber(tenantId: string, serialNumber: string): Promise<Device | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<Device | null>;
  findByIdentifier(tenantId: string, identifier: string): Promise<Device | null>;
  update(tenantId: string, id: string, data: UpdateDeviceDTO, updatedBy: string): Promise<Device>;
  delete(tenantId: string, id: string): Promise<void>;

  // List
  list(tenantId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
  listByAsset(tenantId: string, assetId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
  listByCustomer(tenantId: string, customerId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;

  // Lookup
  findBySlaveId(
    tenantId: string,
    centralId: string,
    slaveId: number,
    channel?: number | null,
    deviceChannelType?: string | null,
  ): Promise<Device | null>;
  // RFC-0032: lookup by QR Checker (addr_low, addr_high) inside a customer
  findByWoAddress(tenantId: string, customerId: string, addrLow: number, addrHigh: number): Promise<Device | null>;

  // Name uniqueness check across the whole tenant (NOT scoped to a customer).
  // Used by the FE before submitting a create/edit form to surface an inline
  // warning even when the unique constraint is per (tenant_id, customer_id, name).
  // `caseSensitive` defaults to true (matches the unique-index behavior).
  countByName(
    tenantId: string,
    name: string,
    opts?: { customerIds?: string[]; caseSensitive?: boolean },
  ): Promise<number>;

  // Connectivity
  updateConnectivityStatus(tenantId: string, id: string, status: ConnectivityStatus): Promise<Device>;

  // Move
  move(tenantId: string, deviceId: string, newAssetId: string, newCustomerId: string, updatedBy: string): Promise<Device>;

  // Count
  countByAsset(tenantId: string, assetId: string): Promise<number>;
  countByCustomer(tenantId: string, customerId: string): Promise<number>;

  // RFC-0058: BOX contents summary — member counts grouped by device_profile,
  // shaped as `{ <profile>: count, ..., total }`.
  getContentsSummary(tenantId: string, boxId: string): Promise<Record<string, number>>;
}
