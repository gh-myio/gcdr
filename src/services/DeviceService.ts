import { Device, ConnectivityStatus } from '../domain/entities/Device';
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
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';

export class DeviceService {
  private repository: IDeviceRepository;
  private assetRepository: IAssetRepository;

  constructor(repository?: IDeviceRepository, assetRepository?: IAssetRepository) {
    this.repository = repository || new DeviceRepository();
    this.assetRepository = assetRepository || new AssetRepository();
  }

  async create(tenantId: string, data: CreateDeviceDTO, userId: string): Promise<Device> {
    // Validate asset exists
    const asset = await this.assetRepository.getById(tenantId, data.assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${data.assetId} not found`);
    }

    // Check for duplicate serial number
    const existingSerial = await this.repository.getBySerialNumber(tenantId, data.serialNumber);
    if (existingSerial) {
      throw new ConflictError(`Device with serial number ${data.serialNumber} already exists`);
    }

    // Check for duplicate external ID if provided
    if (data.externalId) {
      const existingExternal = await this.repository.getByExternalId(tenantId, data.externalId);
      if (existingExternal) {
        throw new ConflictError(`Device with external ID ${data.externalId} already exists`);
      }
    }

    const device = await this.repository.create(tenantId, data, asset.customerId, userId);

    // Publish event
    await eventService.publish(EventType.DEVICE_CREATED, {
      tenantId,
      entityType: 'device',
      entityId: device.id,
      action: 'created',
      data: {
        name: device.name,
        type: device.type,
        serialNumber: device.serialNumber,
        assetId: device.assetId,
        customerId: device.customerId,
      },
      actor: { userId, type: 'user' },
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

    // Publish event
    await eventService.publish(EventType.DEVICE_UPDATED, {
      tenantId,
      entityType: 'device',
      entityId: device.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return device;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const device = await this.getById(tenantId, id);

    await this.repository.delete(tenantId, id);

    // Publish event
    await eventService.publish(EventType.DEVICE_DELETED, {
      tenantId,
      entityType: 'device',
      entityId: id,
      action: 'deleted',
      data: {
        name: device.name,
        serialNumber: device.serialNumber,
        assetId: device.assetId,
      },
      actor: { userId, type: 'user' },
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
    const oldAssetId = device.assetId;

    // Validate new asset exists
    const newAsset = await this.assetRepository.getById(tenantId, data.newAssetId);
    if (!newAsset) {
      throw new NotFoundError(`New asset ${data.newAssetId} not found`);
    }

    // Can't move to same asset
    if (data.newAssetId === device.assetId) {
      throw new ValidationError('Device is already in this asset');
    }

    const movedDevice = await this.repository.move(
      tenantId,
      deviceId,
      data.newAssetId,
      newAsset.customerId,
      userId
    );

    // Publish event
    await eventService.publish(EventType.DEVICE_UPDATED, {
      tenantId,
      entityType: 'device',
      entityId: deviceId,
      action: 'moved',
      data: {
        oldAssetId,
        newAssetId: data.newAssetId,
        oldCustomerId: device.customerId,
        newCustomerId: newAsset.customerId,
      },
      actor: { userId, type: 'user' },
    });

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
