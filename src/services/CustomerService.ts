import { Customer, generateCustomerCode } from '../domain/entities/Customer';
import { Asset } from '../domain/entities/Asset';
import { Device } from '../domain/entities/Device';
import { Rule } from '../domain/entities/Rule';
import { Central } from '../domain/entities/Central';
import {
  CreateCustomerDTO,
  UpdateCustomerDTO,
  MoveCustomerDTO,
  ListCustomersParams,
  GetDescendantsParams,
} from '../dto/request/CustomerDTO';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { CustomerTreeNode, ForceDeleteResult, ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { AssetRepository } from '../repositories/AssetRepository';
import { IAssetRepository } from '../repositories/interfaces/IAssetRepository';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { IDeviceRepository } from '../repositories/interfaces/IDeviceRepository';
import { RuleRepository } from '../repositories/RuleRepository';
import { IRuleRepository } from '../repositories/interfaces/IRuleRepository';
import { CentralRepository } from '../repositories/CentralRepository';
import { ICentralRepository } from '../repositories/interfaces/ICentralRepository';
import { CustomerApiKeyRepository } from '../repositories/CustomerApiKeyRepository';
import { ICustomerApiKeyRepository } from '../repositories/interfaces/ICustomerApiKeyRepository';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';
import { alarmBundleService } from './AlarmBundleService';
import { userService } from './UserService';

export interface RuleMeta {
  id: string;
  parentRuleId?: string; // set when id is a synthesized override key (ruleId_deviceId)
  name: string;
  description?: string;
  scope: { type: string; entityId?: string };
  metric: string;
  operator: string;
  value: number;
  valueHigh?: number;
  duration?: number;
  hysteresis?: number;
  aggregation?: string;
  startAt?: string;
  endAt?: string;
  daysOfWeek?: Record<string, boolean>;
  channelId?: number;
  keyMulti?: number;
}

/** API key metadata exposed on the enriched tree — never key_hash/key_plain. */
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt?: string | null;
  lastUsedAt?: string;
  createdAt: string;
}

export interface EnrichedCustomer {
  customer: Customer;
  assets: Asset[];
  devices: (Device & { ruleIds?: string[] })[];
  centrals?: Central[];
  rules?: Record<string, RuleMeta>;
  apiKeys?: ApiKeySummary[];
  apiKeyCount?: number;
  children?: EnrichedCustomer[];
}

export class CustomerService {
  private repository: ICustomerRepository;
  private assetRepository: IAssetRepository;
  private deviceRepository: IDeviceRepository;
  private ruleRepository: IRuleRepository;
  private centralRepository: ICentralRepository;
  private apiKeyRepository: ICustomerApiKeyRepository;

  constructor(
    repository?: ICustomerRepository,
    assetRepository?: IAssetRepository,
    deviceRepository?: IDeviceRepository,
    ruleRepository?: IRuleRepository,
    centralRepository?: ICentralRepository,
    apiKeyRepository?: ICustomerApiKeyRepository,
  ) {
    this.repository = repository || new CustomerRepository();
    this.assetRepository = assetRepository || new AssetRepository();
    this.deviceRepository = deviceRepository || new DeviceRepository();
    this.ruleRepository = ruleRepository || new RuleRepository();
    this.centralRepository = centralRepository || new CentralRepository();
    this.apiKeyRepository = apiKeyRepository || new CustomerApiKeyRepository();
  }

  private buildRuleMeta(rule: Rule): RuleMeta {
    const cfg = rule.alarmConfig;
    if (!cfg) {
      return {
        id: rule.id,
        name: rule.name,
        ...(rule.description && { description: rule.description }),
        scope: rule.scope,
        metric: '',
        operator: '',
        value: 0,
      };
    }

    // Convert daysOfWeek array [0,1,2...] → { "0": true, "1": false, ... }
    const daysOfWeek: Record<string, boolean> = {};
    for (let d = 0; d <= 6; d++) {
      daysOfWeek[String(d)] = cfg.daysOfWeek ? cfg.daysOfWeek.includes(d) : true;
    }

    return {
      id: rule.id,
      name: rule.name,
      ...(rule.description && { description: rule.description }),
      scope: rule.scope,
      metric: cfg.metric,
      operator: cfg.operator,
      value: cfg.value,
      ...(cfg.valueHigh !== undefined && { valueHigh: cfg.valueHigh }),
      ...(cfg.duration !== undefined && { duration: cfg.duration }),
      ...(cfg.hysteresis !== undefined && { hysteresis: cfg.hysteresis }),
      ...(cfg.aggregation !== undefined && { aggregation: cfg.aggregation }),
      ...(cfg.startAt !== undefined && { startAt: cfg.startAt }),
      ...(cfg.endAt !== undefined && { endAt: cfg.endAt }),
      daysOfWeek,
      ...(cfg.channelId !== undefined && { channelId: cfg.channelId }),
      keyMulti: cfg.keyMulti ?? 1,
    };
  }

  async create(tenantId: string, data: CreateCustomerDTO, userId: string): Promise<Customer> {
    // Check for duplicate code (explicit or auto-generated from name).
    // The resolved code is passed to the repository so the inserted value is
    // exactly the one checked here.
    const code = data.code || generateCustomerCode(data.name);
    const existing = await this.repository.getByCode(tenantId, code);
    if (existing) {
      throw new ConflictError(`Customer with code ${code} already exists`);
    }

    if (data.externalId) {
      const existingExternal = await this.repository.getByExternalId(tenantId, data.externalId);
      if (existingExternal) {
        throw new ConflictError(`Customer with external ID ${data.externalId} already exists`);
      }
    }

    const customer = await this.repository.create(tenantId, { ...data, code }, userId);
    return customer;
  }

  async getById(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.repository.getById(tenantId, id);
    if (!customer) {
      throw new NotFoundError(`Customer ${id} not found`);
    }
    return customer;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<Customer> {
    const customer = await this.repository.getByExternalId(tenantId, externalId);
    if (!customer) {
      throw new NotFoundError(`Customer with external ID ${externalId} not found`);
    }
    return customer;
  }

  async getEnrichedByExternalId(
    tenantId: string,
    externalId: string,
    deep: boolean,
    allRules: boolean,
    filterOnlyDevicesWithRules: boolean,
    includeInternalSupportRule: boolean = true,
  ): Promise<EnrichedCustomer> {
    const customer = await this.getByExternalId(tenantId, externalId);

    if (!deep) {
      return { customer, assets: [], devices: [] };
    }

    // Check if this customer has children — if so, return parent + enriched children list
    const children = await this.repository.getChildren(tenantId, customer.id);
    if (children.length > 0) {
      const enrichedChildren = await Promise.all(
        children.map((child) =>
          this.enrichCustomer(tenantId, child, allRules, filterOnlyDevicesWithRules, includeInternalSupportRule),
        ),
      );
      return { customer, assets: [], devices: [], children: enrichedChildren };
    }

    return this.enrichCustomer(tenantId, customer, allRules, filterOnlyDevicesWithRules, includeInternalSupportRule);
  }

  private async enrichCustomer(
    tenantId: string,
    customer: Customer,
    allRules: boolean,
    filterOnlyDevicesWithRules: boolean,
    includeInternalSupportRule: boolean = true,
  ): Promise<EnrichedCustomer> {
    const [assetsResult, devicesResult] = await Promise.all([
      this.assetRepository.listByCustomer(tenantId, customer.id, { limit: 1000 }),
      this.deviceRepository.listByCustomer(tenantId, customer.id, { limit: 1000 }),
    ]);

    const assets = assetsResult.items;
    let devices: (Device & { ruleIds?: string[] })[] = devicesResult.items;

    if (!allRules) {
      const deviceAssetIds = new Set(devices.map((d) => d.assetId).filter(Boolean));
      return { customer, assets: assets.filter((a) => deviceAssetIds.has(a.id)), devices };
    }

    // Fetch rules at all 3 scopes in parallel
    const [customerRules, ...assetRulesArrays] = await Promise.all([
      this.ruleRepository.getByScope(tenantId, 'CUSTOMER', customer.id),
      ...assets.map((a) => this.ruleRepository.getByScope(tenantId, 'ASSET', a.id)),
    ]);

    // Build assetId → Rule[] map
    const assetRulesMap = new Map<string, Rule[]>();
    assets.forEach((a, i) => assetRulesMap.set(a.id, assetRulesArrays[i] ?? []));

    // Fetch DEVICE-scoped rules for every device in parallel
    const deviceRulesArrays = await Promise.all(
      devices.map((d) => this.ruleRepository.getByScope(tenantId, 'DEVICE', d.id)),
    );

    // Build unified rules dictionary (deduped by id)
    const rulesDict: Record<string, RuleMeta> = {};
    const addRules = (ruleList: Rule[]) => {
      ruleList.forEach((r) => {
        if (!includeInternalSupportRule && r.isInternalSupportRule) return;
        if (!rulesDict[r.id]) rulesDict[r.id] = this.buildRuleMeta(r);
      });
    };

    addRules(customerRules);
    assetRulesArrays.forEach(addRules);
    deviceRulesArrays.forEach(addRules);

    // Attach ruleIds to each device.
    // When a rule has scopeEntityOverrides[device.id], use the synthesized key
    // `${ruleId}_${deviceId}` — matching the bundle format consumed by Node-RED.
    // Also build override variant entries in rulesDict for those keys.
    devices = devices.map((device, i) => {
      const allRulesForDevice = [
        ...deviceRulesArrays[i],
        ...(assetRulesMap.get(device.assetId) ?? []),
        ...customerRules,
      ];

      const seen = new Set<string>();
      const ruleIds: string[] = [];

      for (const rule of allRulesForDevice) {
        if (!includeInternalSupportRule && rule.isInternalSupportRule) continue;
        const override = rule.scopeEntityOverrides?.[device.id];
        const effectiveId = override ? `${rule.id}_${device.id}` : rule.id;
        if (seen.has(effectiveId)) continue;
        seen.add(effectiveId);
        ruleIds.push(effectiveId);

        // Register the override variant in rulesDict if not already present
        if (override && !rulesDict[effectiveId]) {
          const base = rulesDict[rule.id];
          if (base) {
            rulesDict[effectiveId] = {
              ...base,
              id: effectiveId,
              parentRuleId: rule.id,
              value: override.value ?? base.value,
              ...(override.valueHigh !== undefined && { valueHigh: override.valueHigh }),
            };
          }
        }
      }

      return { ...device, ruleIds };
    });

    if (filterOnlyDevicesWithRules) {
      devices = devices.filter((d) => (d.ruleIds?.length ?? 0) > 0);
    }

    // Only return assets that have at least one device in the result
    const deviceAssetIds = new Set(devices.map((d) => d.assetId).filter(Boolean));
    const filteredAssets = assets.filter((a) => deviceAssetIds.has(a.id));

    return { customer, assets: filteredAssets, devices, rules: rulesDict };
  }

  async update(tenantId: string, id: string, data: UpdateCustomerDTO, userId: string): Promise<Customer> {
    // Check if customer exists
    const existingCustomer = await this.getById(tenantId, id);

    // Check for duplicate code if updating
    if (data.code) {
      const existing = await this.repository.getByCode(tenantId, data.code);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Customer with code ${data.code} already exists`);
      }
    }

    // Check for duplicate externalId if updating
    if (data.externalId && data.externalId !== existingCustomer.externalId) {
      const duplicateExternal = await this.repository.getByExternalId(tenantId, data.externalId);
      if (duplicateExternal && duplicateExternal.id !== id) {
        throw new ConflictError(`Customer with external ID ${data.externalId} already exists`);
      }
    }

    const customer = await this.repository.update(tenantId, id, data, userId);

    alarmBundleService.invalidateCache(tenantId, id, {
      reason: 'customer_updated', entityType: 'customer', entityId: id, userId,
    });

    return customer;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const customer = await this.getById(tenantId, id);

    // Check for children
    const children = await this.repository.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new ValidationError('Cannot delete customer with children. Move or delete children first.');
    }

    await this.repository.delete(tenantId, id);

    // Clear any user.preferences.defaultCustomerId still pointing here.
    await userService.clearDefaultCustomerForAll(tenantId, id, userId);

    alarmBundleService.invalidateCache(tenantId, id, {
      reason: 'customer_deleted', entityType: 'customer', entityId: id, userId,
    });
  }

  async forceDelete(tenantId: string, id: string, userId: string, options: import('../repositories/interfaces/ICustomerRepository').ForceDeleteOptions = {}): Promise<ForceDeleteResult> {
    await this.getById(tenantId, id); // validates existence

    const result = await this.repository.forceDelete(tenantId, id, options);

    alarmBundleService.invalidateCache(tenantId, id, {
      reason: 'customer_force_deleted', entityType: 'customer', entityId: id, userId,
    });

    return result;
  }

  async list(tenantId: string, params: ListCustomersParams): Promise<PaginatedResult<Customer>> {
    return this.repository.listWithFilters(tenantId, params);
  }

  async getChildren(tenantId: string, customerId: string): Promise<Customer[]> {
    // Validate customer exists
    await this.getById(tenantId, customerId);
    return this.repository.getChildren(tenantId, customerId);
  }

  async getDescendants(
    tenantId: string,
    customerId: string,
    params?: GetDescendantsParams
  ): Promise<Customer[]> {
    // Validate customer exists
    await this.getById(tenantId, customerId);
    return this.repository.getDescendants(tenantId, customerId, params?.maxDepth);
  }

  async getAncestors(tenantId: string, customerId: string): Promise<Customer[]> {
    return this.repository.getAncestors(tenantId, customerId);
  }

  async getTree(tenantId: string, rootCustomerId?: string): Promise<CustomerTreeNode[]> {
    if (rootCustomerId) {
      await this.getById(tenantId, rootCustomerId);
    }
    return this.repository.getTree(tenantId, rootCustomerId);
  }

  async getEnrichedTree(tenantId: string, rootCustomerId: string): Promise<EnrichedCustomer> {
    const root = await this.getById(tenantId, rootCustomerId);
    return this.enrichRecursive(tenantId, root);
  }

  private async enrichRecursive(tenantId: string, customer: Customer): Promise<EnrichedCustomer> {
    const [assetsResult, centrals, devicesResult, apiKeysResult, children] = await Promise.all([
      this.assetRepository.listByCustomer(tenantId, customer.id, { limit: 1000 }),
      this.centralRepository.listByCustomer(tenantId, customer.id),
      this.deviceRepository.listByCustomer(tenantId, customer.id, { limit: 1000 }),
      this.apiKeyRepository.listByCustomer(tenantId, customer.id, { limit: 100 }),
      this.repository.getChildren(tenantId, customer.id),
    ]);

    const enrichedChildren = await Promise.all(
      children.map((child) => this.enrichRecursive(tenantId, child)),
    );

    // Metadata only — key_hash/key_plain never leave through the tree.
    const apiKeys: ApiKeySummary[] = apiKeysResult.items.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      isActive: k.isActive,
      expiresAt: k.expiresAt ?? null,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));

    return {
      customer,
      assets: assetsResult.items,
      centrals,
      devices: devicesResult.items,
      apiKeys,
      apiKeyCount: apiKeysResult.pagination.total ?? apiKeys.length,
      ...(enrichedChildren.length > 0 && { children: enrichedChildren }),
    };
  }

  async move(tenantId: string, customerId: string, data: MoveCustomerDTO, userId: string): Promise<Customer> {
    await this.getById(tenantId, customerId);

    // Validate new parent if provided
    if (data.newParentCustomerId) {
      const newParent = await this.repository.getById(tenantId, data.newParentCustomerId);
      if (!newParent) {
        throw new NotFoundError(`New parent customer ${data.newParentCustomerId} not found`);
      }

      // Check for circular reference - can't move to self or descendant
      if (data.newParentCustomerId === customerId) {
        throw new ValidationError('Cannot move customer to itself');
      }

      const descendants = await this.repository.getDescendants(tenantId, customerId);
      const descendantIds = new Set(descendants.map((d) => d.id));
      if (descendantIds.has(data.newParentCustomerId)) {
        throw new ValidationError('Cannot move customer under its own descendant');
      }
    }

    const movedCustomer = await this.repository.move(tenantId, customerId, data.newParentCustomerId, userId);
    return movedCustomer;
  }

  async getRootCustomers(tenantId: string): Promise<Customer[]> {
    return this.repository.getChildren(tenantId, null);
  }
}

export const customerService = new CustomerService();
