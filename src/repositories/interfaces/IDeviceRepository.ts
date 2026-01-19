import { Device, ConnectivityStatus } from '../../domain/entities/Device';
import { CreateDeviceDTO, UpdateDeviceDTO, ListDevicesParams } from '../../dto/request/DeviceDTO';
import { PaginatedResult } from '../../shared/types';

export interface IDeviceRepository {
  // CRUD
  create(tenantId: string, data: CreateDeviceDTO, customerId: string, createdBy: string): Promise<Device>;
  getById(tenantId: string, id: string): Promise<Device | null>;
  getBySerialNumber(tenantId: string, serialNumber: string): Promise<Device | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<Device | null>;
  update(tenantId: string, id: string, data: UpdateDeviceDTO, updatedBy: string): Promise<Device>;
  delete(tenantId: string, id: string): Promise<void>;

  // List
  list(tenantId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
  listByAsset(tenantId: string, assetId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;
  listByCustomer(tenantId: string, customerId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>>;

  // Connectivity
  updateConnectivityStatus(tenantId: string, id: string, status: ConnectivityStatus): Promise<Device>;

  // Move
  move(tenantId: string, deviceId: string, newAssetId: string, newCustomerId: string, updatedBy: string): Promise<Device>;

  // Count
  countByAsset(tenantId: string, assetId: string): Promise<number>;
  countByCustomer(tenantId: string, customerId: string): Promise<number>;
}
