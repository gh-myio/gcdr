import { Central, ConnectionStatus } from '../domain/entities/Central';
import {
  CreateCentralDTO,
  UpdateCentralDTO,
  ListCentralsDTO,
  UpdateConnectionStatusDTO,
} from '../dto/request/CentralDTO';
import { CentralRepository } from '../repositories/CentralRepository';
import { ICentralRepository } from '../repositories/interfaces/ICentralRepository';
import { AssetRepository } from '../repositories/AssetRepository';
import { IAssetRepository } from '../repositories/interfaces/IAssetRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult, EntityStatus } from '../shared/types';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';

export class CentralService {
  private repository: ICentralRepository;
  private assetRepository: IAssetRepository;

  constructor(repository?: ICentralRepository, assetRepository?: IAssetRepository) {
    this.repository = repository || new CentralRepository();
    this.assetRepository = assetRepository || new AssetRepository();
  }

  async create(tenantId: string, data: CreateCentralDTO, userId: string): Promise<Central> {
    // Validate asset exists
    const asset = await this.assetRepository.getById(tenantId, data.assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${data.assetId} not found`);
    }

    // Validate customer matches asset's customer
    if (data.customerId !== asset.customerId) {
      throw new ConflictError('Customer ID must match the asset\'s customer');
    }

    // Check for duplicate serial number
    const existingSerial = await this.repository.getBySerialNumber(tenantId, data.serialNumber);
    if (existingSerial) {
      throw new ConflictError(`Central with serial number ${data.serialNumber} already exists`);
    }

    const central = await this.repository.create(tenantId, data, userId);

    // Publish event
    await eventService.publish(EventType.CENTRAL_CREATED, {
      tenantId,
      entityType: 'central',
      entityId: central.id,
      action: 'created',
      data: {
        name: central.name,
        type: central.type,
        serialNumber: central.serialNumber,
        assetId: central.assetId,
        customerId: central.customerId,
      },
      actor: { userId, type: 'user' },
    });

    return central;
  }

  async getById(tenantId: string, id: string): Promise<Central> {
    const central = await this.repository.getById(tenantId, id);
    if (!central) {
      throw new NotFoundError(`Central ${id} not found`);
    }
    return central;
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central> {
    const central = await this.repository.getBySerialNumber(tenantId, serialNumber);
    if (!central) {
      throw new NotFoundError(`Central with serial number ${serialNumber} not found`);
    }
    return central;
  }

  async update(tenantId: string, id: string, data: UpdateCentralDTO, userId: string): Promise<Central> {
    await this.getById(tenantId, id);

    const central = await this.repository.update(tenantId, id, data, userId);

    // Publish event
    await eventService.publish(EventType.CENTRAL_UPDATED, {
      tenantId,
      entityType: 'central',
      entityId: central.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return central;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const central = await this.getById(tenantId, id);

    await this.repository.delete(tenantId, id);

    // Publish event
    await eventService.publish(EventType.CENTRAL_DELETED, {
      tenantId,
      entityType: 'central',
      entityId: id,
      action: 'deleted',
      data: {
        name: central.name,
        serialNumber: central.serialNumber,
        assetId: central.assetId,
      },
      actor: { userId, type: 'user' },
    });
  }

  async list(tenantId: string, params: ListCentralsDTO): Promise<PaginatedResult<Central>> {
    if (params.assetId) {
      const asset = await this.assetRepository.getById(tenantId, params.assetId);
      if (!asset) {
        throw new NotFoundError(`Asset ${params.assetId} not found`);
      }
    }
    return this.repository.list(tenantId, params);
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Central[]> {
    return this.repository.listByCustomer(tenantId, customerId);
  }

  async listByAsset(tenantId: string, assetId: string): Promise<Central[]> {
    const asset = await this.assetRepository.getById(tenantId, assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${assetId} not found`);
    }
    return this.repository.listByAsset(tenantId, assetId);
  }

  async updateStatus(tenantId: string, id: string, status: EntityStatus, userId: string): Promise<Central> {
    await this.getById(tenantId, id);

    const central = await this.repository.updateStatus(tenantId, id, status, userId);

    // Publish event
    await eventService.publish(EventType.CENTRAL_UPDATED, {
      tenantId,
      entityType: 'central',
      entityId: id,
      action: 'status_updated',
      data: { status },
      actor: { userId, type: 'user' },
    });

    return central;
  }

  async updateConnectionStatus(
    tenantId: string,
    id: string,
    data: UpdateConnectionStatusDTO
  ): Promise<Central> {
    const existing = await this.getById(tenantId, id);
    const previousStatus = existing.connectionStatus;

    const central = await this.repository.updateConnectionStatus(
      tenantId,
      id,
      data.connectionStatus,
      data.stats
    );

    // Publish connection event if status changed
    if (previousStatus !== data.connectionStatus) {
      const eventType =
        data.connectionStatus === 'ONLINE'
          ? EventType.CENTRAL_CONNECTED
          : EventType.CENTRAL_DISCONNECTED;

      await eventService.publish(eventType, {
        tenantId,
        entityType: 'central',
        entityId: id,
        action: data.connectionStatus === 'ONLINE' ? 'connected' : 'disconnected',
        data: {
          previousStatus,
          newStatus: data.connectionStatus,
          serialNumber: central.serialNumber,
        },
        actor: { type: 'system' },
      });
    }

    return central;
  }

  async recordHeartbeat(
    tenantId: string,
    id: string,
    stats: Partial<Central['stats']>
  ): Promise<void> {
    const central = await this.getById(tenantId, id);

    await this.repository.recordHeartbeat(tenantId, id, stats);

    // Publish heartbeat event
    await eventService.publish(EventType.CENTRAL_HEARTBEAT, {
      tenantId,
      entityType: 'central',
      entityId: id,
      action: 'heartbeat',
      data: {
        serialNumber: central.serialNumber,
        stats,
      },
      actor: { type: 'system' },
    });
  }
}

export const centralService = new CentralService();
