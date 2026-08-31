import { randomInt } from 'crypto';
import { Central, CentralMqttPasswordsSet } from '../domain/entities/Central';
import {
  CreateCentralDTO,
  UpdateCentralDTO,
  ListCentralsDTO,
  UpdateConnectionStatusDTO,
} from '../dto/request/CentralDTO';
import { CentralRepository } from '../repositories/CentralRepository';
import { ICentralRepository } from '../repositories/interfaces/ICentralRepository';
import { deviceRepository } from '../repositories/DeviceRepository';
import { AssetRepository } from '../repositories/AssetRepository';
import { IAssetRepository } from '../repositories/interfaces/IAssetRepository';
import { customerRepository } from '../repositories/CustomerRepository';
import { PaginatedResult, EntityStatus } from '../shared/types';
import { NotFoundError, ConflictError } from '../shared/errors/AppError';
import { alarmBundleService } from './AlarmBundleService';
import { customerIntegrationService } from './CustomerIntegrationService';
import { CentralsIntegrationState, CentralEntry } from '../dto/request/CustomerIntegrationDTO';
import { CENTRAL_MQTT_INTEGRATION_IDS } from '../domain/integrations/CentralMqttIntegrationId';

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
    return this.enrichWithMqttPasswordsSet(tenantId, central);
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central> {
    const central = await this.repository.getBySerialNumber(tenantId, serialNumber);
    if (!central) {
      throw new NotFoundError(`Central with serial number ${serialNumber} not found`);
    }
    return this.enrichWithMqttPasswordsSet(tenantId, central);
  }

  // ===========================================================================
  // Central ID (serial number) generation — public, collision-free.
  // Format: S1.S2.S3.S4 with each Sn a random integer 1..254 (~254^4 ≈ 4.1B).
  // Uniqueness is checked GLOBALLY (across all tenants).
  // ===========================================================================

  /** A slot is 1..254 (IP-octet-like, but excludes 0 and 255). */
  private static readonly SERIAL_REGEX =
    /^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])(?:\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])){3}$/;

  isValidSerial(value: string): boolean {
    return typeof value === 'string' && CentralService.SERIAL_REGEX.test(value);
  }

  generateSerial(): string {
    // randomInt(1, 255) yields 1..254 (upper bound exclusive).
    return Array.from({ length: 4 }, () => randomInt(1, 255)).join('.');
  }

  /** True if the serial is well-formed AND not already used by any central. */
  async isSerialAvailable(value: string): Promise<boolean> {
    if (!this.isValidSerial(value)) return false;
    return !(await this.repository.existsBySerialNumberGlobal(value));
  }

  /** Draw a collision-free central_id, retrying on the (rare) clash. */
  async findAvailableSerial(maxTries = 20): Promise<string> {
    for (let i = 0; i < maxTries; i++) {
      const candidate = this.generateSerial();
      if (!(await this.repository.existsBySerialNumberGlobal(candidate))) {
        return candidate;
      }
    }
    throw new ConflictError('Could not allocate a free central_id after several attempts');
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateCentralDTO,
    userId: string,
  ): Promise<Central> {
    const existing = await this.repository.getById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Central ${id} not found`);
    }

    // serialNumber is mutable (data reconciliation) but unique per tenant.
    // Guard here for a clean 409 before hitting the DB unique constraint.
    if (data.serialNumber && data.serialNumber !== existing.serialNumber) {
      const clash = await this.repository.getBySerialNumber(tenantId, data.serialNumber);
      if (clash && clash.id !== id) {
        throw new ConflictError(`Central with serial number ${data.serialNumber} already exists`);
      }
    }

    const updated = await this.repository.update(tenantId, id, data, userId);
    alarmBundleService.invalidateCache(tenantId, existing.customerId, {
      reason: 'central_updated', entityType: 'central', entityId: id, userId,
    });

    return this.enrichWithMqttPasswordsSet(tenantId, updated);
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
    result.items = await this.enrichManyWithMqttPasswordsSet(tenantId, result.items);
    result.items = await this.enrichManyWithCustomerAndDevices(tenantId, result.items);
    return result;
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Central[]> {
    const centrals = await this.repository.listByCustomer(tenantId, customerId);
    const withMqtt = await this.enrichManyWithMqttPasswordsSet(tenantId, centrals);
    return this.enrichManyWithCustomerAndDevices(tenantId, withMqtt);
  }

  async listByAsset(tenantId: string, assetId: string): Promise<Central[]> {
    const asset = await this.assetRepository.getById(tenantId, assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${assetId} not found`);
    }
    const centrals = await this.repository.listByAsset(tenantId, assetId);
    const withMqtt = await this.enrichManyWithMqttPasswordsSet(tenantId, centrals);
    return this.enrichManyWithCustomerAndDevices(tenantId, withMqtt);
  }

  /**
   * Enrich centrals with the owning customer's display name and a device-count
   * summary (total + online) for the list "connected / total" column. Batched
   * (one customer lookup, one grouped device count) and best-effort — any
   * failure returns the centrals unchanged rather than failing the list.
   */
  private async enrichManyWithCustomerAndDevices(
    tenantId: string,
    centrals: Central[],
  ): Promise<Central[]> {
    if (centrals.length === 0) return centrals;
    try {
      const customerIds = [...new Set(centrals.map((c) => c.customerId).filter(Boolean))];
      const centralIds = centrals.map((c) => c.id);
      const [customers, deviceCounts] = await Promise.all([
        customerRepository.findByIds(tenantId, customerIds),
        deviceRepository.countByCentralIds(tenantId, centralIds),
      ]);
      const nameById = new Map(customers.map((c) => [c.id, c.displayName || c.name]));
      return centrals.map((c) => {
        const dc = deviceCounts.get(c.id);
        return {
          ...c,
          customerName: nameById.get(c.customerId) ?? c.customerName,
          statistics: {
            devicesTotal: dc?.total ?? 0,
            devicesConnected: dc?.connected ?? 0,
          },
        };
      });
    } catch {
      return centrals;
    }
  }

  // ---------------------------------------------------------------------------
  // MQTT password-set enrichment (RFC-0035 lookup)
  //
  // Per-integration password presence lives in
  // customers.metadata.integrations.centrals.items[i].mqttPasswords.
  // We enrich Central reads with a boolean indicator map so consumers see
  // a single payload. Plaintext passwords are only accessible via the
  // dedicated reveal endpoint. Writes go through the new mqtt-passwords
  // routes — body.connection on PUT /centrals/:id is removed.
  // ---------------------------------------------------------------------------

  async enrichWithMqttPasswordsSet(tenantId: string, central: Central): Promise<Central> {
    try {
      const state = await customerIntegrationService.get(tenantId, central.customerId, 'centrals');
      if (!state) return central;
      const items = (state as CentralsIntegrationState).items ?? [];
      const item = items.find((e) => e.uuid === central.id);
      if (!item) return central;
      return { ...central, mqttPasswordsSet: this.toMqttPasswordsSet(item) };
    } catch {
      // Enrichment is best-effort — missing customer / integrations returns
      // the bare central.
      return central;
    }
  }

  async enrichManyWithMqttPasswordsSet(tenantId: string, centrals: Central[]): Promise<Central[]> {
    if (centrals.length === 0) return centrals;

    // Group by customerId — one customer read per group, no N+1.
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
      return item ? { ...c, mqttPasswordsSet: this.toMqttPasswordsSet(item) } : c;
    });
  }

  private toMqttPasswordsSet(entry: CentralEntry): CentralMqttPasswordsSet {
    const set: CentralMqttPasswordsSet = {};
    for (const id of CENTRAL_MQTT_INTEGRATION_IDS) {
      const v = entry.mqttPasswords?.[id];
      if (typeof v === 'string' && v.length > 0) {
        set[id] = true;
      }
    }
    return set;
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
