import { Device, ConnectivityStatus } from '../domain/entities/Device';
import { Asset } from '../domain/entities/Asset';
import { Customer } from '../domain/entities/Customer';
import { Rule } from '../domain/entities/Rule';
import {
  CreateDeviceDTO,
  UpdateDeviceDTO,
  MoveDeviceDTO,
  ListDevicesParams,
} from '../dto/request/DeviceDTO';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { IDeviceRepository } from '../repositories/interfaces/IDeviceRepository';
import { AssetRepository } from '../repositories/AssetRepository';
import { IAssetRepository } from '../repositories/interfaces/IAssetRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { RuleRepository } from '../repositories/RuleRepository';
import { IRuleRepository } from '../repositories/interfaces/IRuleRepository';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';
import { alarmBundleService } from './AlarmBundleService';

export interface EnrichedDevice {
  device: Device;
  asset: Asset | null;
  customer: Customer | null;
  rules: Rule[];
}

export class DeviceService {
  private repository: IDeviceRepository;
  private assetRepository: IAssetRepository;
  private customerRepository: ICustomerRepository;
  private ruleRepository: IRuleRepository;

  constructor(
    repository?: IDeviceRepository,
    assetRepository?: IAssetRepository,
    customerRepository?: ICustomerRepository,
    ruleRepository?: IRuleRepository,
  ) {
    this.repository = repository || new DeviceRepository();
    this.assetRepository = assetRepository || new AssetRepository();
    this.customerRepository = customerRepository || new CustomerRepository();
    this.ruleRepository = ruleRepository || new RuleRepository();
  }

  async create(tenantId: string, data: CreateDeviceDTO, userId: string): Promise<Device> {
    // Validate asset exists
    const asset = await this.assetRepository.getById(tenantId, data.assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${data.assetId} not found`);
    }

    // Upsert by identifier: if device with same identifier already exists, update it
    if (data.identifier) {
      const existingByIdentifier = await this.repository.findByIdentifier(tenantId, data.identifier);
      if (existingByIdentifier) {
        const updated = await this.repository.update(tenantId, existingByIdentifier.id, data, userId);
        alarmBundleService.invalidateCache(tenantId, asset.customerId, {
          reason: 'device_updated', entityType: 'device', entityId: updated.id, userId,
        });
        return updated;
      }
    }

    // Check for duplicate serial number (if provided)
    if (data.serialNumber) {
      const existingSerial = await this.repository.getBySerialNumber(tenantId, data.serialNumber);
      if (existingSerial) {
        throw new ConflictError(`Device with serial number ${data.serialNumber} already exists`);
      }
    }

    // Check for duplicate external ID if provided
    if (data.externalId) {
      const existingExternal = await this.repository.getByExternalId(tenantId, data.externalId);
      if (existingExternal) {
        throw new ConflictError(`Device with external ID ${data.externalId} already exists`);
      }
    }

    // Check for duplicate (central_id, slave_id) — constraint devices_tenant_central_slave_unique
    if (data.centralId && data.slaveId !== undefined) {
      const existingByCentralSlave = await this.repository.findBySlaveId(tenantId, data.centralId, data.slaveId);
      if (existingByCentralSlave) {
        throw new ConflictError(
          `Device with central ${data.centralId} and slave ID ${data.slaveId} already exists (id: ${existingByCentralSlave.id})`
        );
      }
    }

    const device = await this.repository.create(tenantId, data, asset.customerId, userId);

    alarmBundleService.invalidateCache(tenantId, asset.customerId, {
      reason: 'device_created', entityType: 'device', entityId: device.id, userId,
    });

    return device;
  }

  async getById(tenantId: string, id: string): Promise<Device> {
    const device = await this.repository.getById(tenantId, id);
    if (!device) {
      throw new NotFoundError(`Device ${id} not found`);
    }
    return device;
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Device> {
    const device = await this.repository.getBySerialNumber(tenantId, serialNumber);
    if (!device) {
      throw new NotFoundError(`Device with serial number ${serialNumber} not found`);
    }
    return device;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<Device> {
    const device = await this.repository.getByExternalId(tenantId, externalId);
    if (!device) {
      throw new NotFoundError(`Device with external ID ${externalId} not found`);
    }
    return device;
  }

  async getEnrichedByExternalId(tenantId: string, externalId: string): Promise<EnrichedDevice> {
    const device = await this.getByExternalId(tenantId, externalId);

    const [asset, customer, rules] = await Promise.all([
      device.assetId ? this.assetRepository.getById(tenantId, device.assetId) : Promise.resolve(null),
      device.customerId ? this.customerRepository.getById(tenantId, device.customerId) : Promise.resolve(null),
      this.ruleRepository.getByScope(tenantId, 'DEVICE', device.id),
    ]);

    return { device, asset, customer, rules };
  }

  async update(tenantId: string, id: string, data: UpdateDeviceDTO, userId: string): Promise<Device> {
    const existing = await this.getById(tenantId, id);

    // Check for duplicate external ID if updating
    if (data.externalId && data.externalId !== existing.externalId) {
      const duplicateExternal = await this.repository.getByExternalId(tenantId, data.externalId);
      if (duplicateExternal && duplicateExternal.id !== id) {
        throw new ConflictError(`Device with external ID ${data.externalId} already exists`);
      }
    }

    const device = await this.repository.update(tenantId, id, data, userId);

    alarmBundleService.invalidateCache(tenantId, existing.customerId, {
      reason: 'device_updated', entityType: 'device', entityId: id, userId,
    });

    return device;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const device = await this.getById(tenantId, id);
    await this.repository.delete(tenantId, id);

    alarmBundleService.invalidateCache(tenantId, device.customerId, {
      reason: 'device_deleted', entityType: 'device', entityId: id, userId,
    });
  }

  async list(tenantId: string, params: ListDevicesParams): Promise<PaginatedResult<Device>> {
    if (params.assetId) {
      const asset = await this.assetRepository.getById(tenantId, params.assetId);
      if (!asset) {
        throw new NotFoundError(`Asset ${params.assetId} not found`);
      }
      return this.repository.listByAsset(tenantId, params.assetId, params);
    }
    return this.repository.list(tenantId, params);
  }

  async listByAsset(tenantId: string, assetId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const asset = await this.assetRepository.getById(tenantId, assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${assetId} not found`);
    }
    return this.repository.listByAsset(tenantId, assetId, params);
  }

  async listByCustomer(tenantId: string, customerId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    return this.repository.listByCustomer(tenantId, customerId, params);
  }

  async updateConnectivityStatus(tenantId: string, id: string, status: ConnectivityStatus): Promise<Device> {
    await this.getById(tenantId, id);
    return this.repository.updateConnectivityStatus(tenantId, id, status);
  }

  async move(tenantId: string, deviceId: string, data: MoveDeviceDTO, userId: string): Promise<Device> {
    const device = await this.getById(tenantId, deviceId);

    // Validate new asset exists
    const newAsset = await this.assetRepository.getById(tenantId, data.newAssetId);
    if (!newAsset) {
      throw new NotFoundError(`New asset ${data.newAssetId} not found`);
    }

    // Can't move to same asset
    if (data.newAssetId === device.assetId) {
      throw new ValidationError('Device is already in this asset');
    }

    const resolvedCustomerId = data.newCustomerId ?? newAsset.customerId;

    const movedDevice = await this.repository.move(
      tenantId,
      deviceId,
      data.newAssetId,
      resolvedCustomerId,
      userId
    );

    return movedDevice;
  }

  async countByAsset(tenantId: string, assetId: string): Promise<number> {
    return this.repository.countByAsset(tenantId, assetId);
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    return this.repository.countByCustomer(tenantId, customerId);
  }
}

export const deviceService = new DeviceService();
