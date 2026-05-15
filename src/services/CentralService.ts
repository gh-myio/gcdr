import { Central, CentralConnection, ConnectionStatus } from '../domain/entities/Central';
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
import { PaginatedResult, EntityStatus } from '../shared/types';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';
import { alarmBundleService } from './AlarmBundleService';
import { customerIntegrationService, CustomerIntegrationActor } from './CustomerIntegrationService';
import { CentralsIntegrationState, CentralEntry } from '../dto/request/CustomerIntegrationDTO';

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

    alarmBundleService.invalidateCache(tenantId, data.customerId, {
      reason: 'central_created', entityType: 'central', entityId: central.id, userId,
    });

    return central;
  }

  async getById(tenantId: string, id: string): Promise<Central> {
    const central = await this.repository.getById(tenantId, id);
    if (!central) {
      throw new NotFoundError(`Central ${id} not found`);
    }
    return this.enrichWithConnection(tenantId, central);
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central> {
    const central = await this.repository.getBySerialNumber(tenantId, serialNumber);
    if (!central) {
      throw new NotFoundError(`Central with serial number ${serialNumber} not found`);
    }
    return this.enrichWithConnection(tenantId, central);
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateCentralDTO,
    userId: string,
    actor?: CustomerIntegrationActor & { actorLabel: string },
  ): Promise<Central> {
    const existingRaw = await this.repository.getById(tenantId, id);
    if (!existingRaw) {
      throw new NotFoundError(`Central ${id} not found`);
    }

    // Split connection (proxy to customer integrations) from central row fields
    const { connection, ...centralData } = data;

    let updated = existingRaw;
    if (Object.keys(centralData).length > 0) {
      updated = await this.repository.update(tenantId, id, centralData, userId);
      alarmBundleService.invalidateCache(tenantId, existingRaw.customerId, {
        reason: 'central_updated', entityType: 'central', entityId: id, userId,
      });
    }

    if (connection && Object.keys(connection).length > 0) {
      await customerIntegrationService.upsertCentralEntry(
        tenantId,
        existingRaw.customerId,
        id,
        connection,
        actor ?? { userId, actorLabel: userId },
      );
    }

    return this.enrichWithConnection(tenantId, updated);
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const central = await this.getById(tenantId, id);
    await this.repository.delete(tenantId, id);

    alarmBundleService.invalidateCache(tenantId, central.customerId, {
      reason: 'central_deleted', entityType: 'central', entityId: id, userId,
    });
  }

  async list(tenantId: string, params: ListCentralsDTO): Promise<PaginatedResult<Central>> {
    if (params.assetId) {
      const asset = await this.assetRepository.getById(tenantId, params.assetId);
      if (!asset) {
        throw new NotFoundError(`Asset ${params.assetId} not found`);
      }
    }
    const result = await this.repository.list(tenantId, params);
    result.items = await this.enrichManyWithConnection(tenantId, result.items);
    return result;
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Central[]> {
    const centrals = await this.repository.listByCustomer(tenantId, customerId);
    return this.enrichManyWithConnection(tenantId, centrals);
  }

  async listByAsset(tenantId: string, assetId: string): Promise<Central[]> {
    const asset = await this.assetRepository.getById(tenantId, assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${assetId} not found`);
    }
    const centrals = await this.repository.listByAsset(tenantId, assetId);
    return this.enrichManyWithConnection(tenantId, centrals);
  }

  // ---------------------------------------------------------------------------
  // Connection enrichment (RFC-0033 lookup, not migration)
  //
  // Connection params live in customers.metadata.integrations.centrals.items[].
  // We enrich Central reads with that data so consumers see a single payload.
  // Writes via PUT /centrals/:id (body.connection) proxy back to the same
  // JSONB through customerIntegrationService.upsertCentralEntry().
  // ---------------------------------------------------------------------------

  async enrichWithConnection(tenantId: string, central: Central): Promise<Central> {
    try {
      const state = await customerIntegrationService.get(tenantId, central.customerId, 'centrals');
      if (!state) return central;
      const items = (state as CentralsIntegrationState).items ?? [];
      const item = items.find((e) => e.uuid === central.id);
      if (!item) return central;
      return { ...central, connection: this.toConnection(item) };
    } catch {
      // If the customer doesn't exist or integrations are missing we still
      // return the bare central — enrichment is best-effort.
      return central;
    }
  }

  async enrichManyWithConnection(tenantId: string, centrals: Central[]): Promise<Central[]> {
    if (centrals.length === 0) return centrals;

    // Group by customerId — one customer read per group, regardless of how
    // many centrals share that customer (no N+1).
    const byCustomer = new Map<string, Central[]>();
    for (const c of centrals) {
      const arr = byCustomer.get(c.customerId);
      if (arr) {
        arr.push(c);
      } else {
        byCustomer.set(c.customerId, [c]);
      }
    }

    const itemsByCustomer = new Map<string, CentralEntry[]>();
    await Promise.all(
      Array.from(byCustomer.keys()).map(async (customerId) => {
        try {
          const state = await customerIntegrationService.get(tenantId, customerId, 'centrals');
          const items = (state as CentralsIntegrationState | null)?.items ?? [];
          itemsByCustomer.set(customerId, items);
        } catch {
          itemsByCustomer.set(customerId, []);
        }
      }),
    );

    return centrals.map((c) => {
      const items = itemsByCustomer.get(c.customerId) ?? [];
      const item = items.find((e) => e.uuid === c.id);
      return item ? { ...c, connection: this.toConnection(item) } : c;
    });
  }

  private toConnection(entry: CentralEntry): CentralConnection {
    return {
      mqttUserName:       entry.mqttUserName,
      mqttClientId:       entry.mqttClientId,
      ipv6Yggdrasil:      entry.ipv6Yggdrasil,
      ingestionGatewayId: entry.ingestionGatewayId,
      mqttPasswordSet:    typeof entry.mqttPassword === 'string' && entry.mqttPassword.length > 0,
    };
  }

  async updateStatus(tenantId: string, id: string, status: EntityStatus, userId: string): Promise<Central> {
    await this.getById(tenantId, id);
    const central = await this.repository.updateStatus(tenantId, id, status, userId);
    return central;
  }

  async updateConnectionStatus(
    tenantId: string,
    id: string,
    data: UpdateConnectionStatusDTO
  ): Promise<Central> {
    await this.getById(tenantId, id);

    const central = await this.repository.updateConnectionStatus(
      tenantId,
      id,
      data.connectionStatus,
      data.stats
    );

    return central;
  }

  async recordHeartbeat(
    tenantId: string,
    id: string,
    stats: Partial<Central['stats']>
  ): Promise<void> {
    await this.getById(tenantId, id);
    await this.repository.recordHeartbeat(tenantId, id, stats);
  }
}

export const centralService = new CentralService();
