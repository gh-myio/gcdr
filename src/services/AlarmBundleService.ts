import * as crypto from 'crypto';
import { Rule, isAlarmRule } from '../domain/entities/Rule';
import { Device } from '../domain/entities/Device';
import { Customer } from '../domain/entities/Customer';
import {
  AlarmRulesBundle,
  BundleAlarmRule,
  BundleMeta,
  DeviceTypeGroup,
  DeviceRuleMapping,
  GenerateBundleParams,
  SimpleAlarmRulesBundle,
  SimpleBundleAlarmRule,
  SimpleDeviceMapping,
  SimpleBundleMeta,
  RuleIdEntry,
} from '../domain/entities/AlarmBundle';
import { RuleRepository } from '../repositories/RuleRepository';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { AlarmBundleVersionRepository, alarmBundleVersionRepository } from '../repositories/AlarmBundleVersionRepository';
import { IRuleRepository } from '../repositories/interfaces/IRuleRepository';
import { IDeviceRepository } from '../repositories/interfaces/IDeviceRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { AlarmBundleVersion } from '../domain/entities/AlarmBundleVersion';
import { NotFoundError } from '../shared/errors/AppError';
import { GroupChannelRepository } from '../repositories/GroupChannelRepository';
import { GroupDispatchConfigRepository } from '../repositories/GroupDispatchConfigRepository';

// Default TTL for bundle cache (5 minutes)
const DEFAULT_TTL_SECONDS = 300;

// Secret key for HMAC (in production, use AWS Secrets Manager or parameter store)
const BUNDLE_SIGNING_SECRET = process.env.BUNDLE_SIGNING_SECRET || 'gcdr-alarm-bundle-secret-key';

export interface InvalidationMeta {
  reason: string;
  entityType: string;
  entityId?: string;
  userId?: string;
}

export class AlarmBundleService {
  private ruleRepository: IRuleRepository;
  private deviceRepository: IDeviceRepository;
  private customerRepository: ICustomerRepository;
  private versionRepository: AlarmBundleVersionRepository;
  private cache = new Map<string, { bundle: any; version: string; expiresAt: number }>();
  private pendingInvalidation: InvalidationMeta | null = null;

  constructor(
    ruleRepository?: IRuleRepository,
    deviceRepository?: IDeviceRepository,
    customerRepository?: ICustomerRepository
  ) {
    this.ruleRepository = ruleRepository || new RuleRepository();
    this.deviceRepository = deviceRepository || new DeviceRepository();
    this.customerRepository = customerRepository || new CustomerRepository();
    this.versionRepository = alarmBundleVersionRepository;
  }

  /**
   * Build a cache key from bundle params and type
   */
  private getCacheKey(params: GenerateBundleParams, type: 'full' | 'simple'): string {
    return [
      type,
      params.tenantId,
      params.customerId,
      params.centralId || '',
      params.domain || '',
      params.deviceType || '',
      String(params.includeDisabled || false),
    ].join(':');
  }

  /**
   * Get cached version string without generating the bundle.
   * Returns null if cache is missing or expired.
   */
  getVersion(params: GenerateBundleParams, type: 'full' | 'simple'): string | null {
    const key = this.getCacheKey(params, type);
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.version;
    }
    return null;
  }

  /**
   * Invalidate cached entries for a tenant, optionally scoped to a customer.
   * Stores invalidation metadata so the next bundle generation records the reason.
   */
  invalidateCache(tenantId: string, customerId?: string, meta?: InvalidationMeta): void {
    for (const key of this.cache.keys()) {
      const parts = key.split(':');
      // parts: [type, tenantId, customerId, ...]
      if (parts[1] === tenantId && (!customerId || parts[2] === customerId)) {
        this.cache.delete(key);
      }
    }
    if (meta) {
      this.pendingInvalidation = meta;
    }
  }

  /**
   * Generate a complete alarm rules bundle for a customer
   */
  async generateBundle(params: GenerateBundleParams): Promise<AlarmRulesBundle> {
    const cacheKey = this.getCacheKey(params, 'full');
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.bundle;
    }

    const { tenantId, customerId, domain, deviceType, includeDisabled = false } = params;

    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }

    // Get all devices for this customer
    const devices = await this.getDevicesByCustomer(tenantId, customerId, domain, deviceType);

    // Get all alarm rules for this customer
    const allRules = await this.ruleRepository.getByCustomerId(tenantId, customerId);

    // Filter to only ALARM_THRESHOLD rules
    let alarmRules = allRules.filter(isAlarmRule);

    // Optionally filter disabled rules
    if (!includeDisabled) {
      alarmRules = alarmRules.filter(r => r.enabled);
    }

    // Build the bundle structure
    const bundle = this.buildBundle(customer, devices, alarmRules, tenantId);

    // Sign the bundle
    bundle.meta.signature = this.signBundle(bundle);

    // Record version in database
    await this.recordVersion(params.tenantId, params.customerId, bundle.meta.version, 'full', bundle.meta.rulesCount, bundle.meta.devicesCount);

    // Store in cache
    this.cache.set(cacheKey, {
      bundle,
      version: bundle.meta.version,
      expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
    });

    return bundle;
  }

  /**
   * Generate a simplified alarm rules bundle for Node-RED
   * - No rulesByDeviceType
   * - Includes centralId and slaveId in deviceIndex
   * - Rules without enabled/tags fields
   */
  async generateSimplifiedBundle(params: GenerateBundleParams): Promise<SimpleAlarmRulesBundle> {
    const cacheKey = this.getCacheKey(params, 'simple');
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.bundle;
    }

    const { tenantId, customerId, centralId, domain, deviceType, includeDisabled = false } = params;

    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }

    // Get all devices for this customer (optionally filtered by centralId)
    const devices = await this.getDevicesByCustomer(tenantId, customerId, centralId, domain, deviceType);

    // Get all alarm rules for this customer
    const allRules = await this.ruleRepository.getByCustomerId(tenantId, customerId);

    // Filter to only ALARM_THRESHOLD rules
    let alarmRules = allRules.filter(isAlarmRule);

    // Optionally filter disabled rules
    if (!includeDisabled) {
      alarmRules = alarmRules.filter(r => r.enabled);
    }

    // Build simplified bundle
    const bundle = this.buildSimplifiedBundle(customer, devices, alarmRules, tenantId);

    // Sign the bundle
    bundle.meta.signature = this.signSimplifiedBundle(bundle);

    // Record version in database
    await this.recordVersion(tenantId, customerId, bundle.meta.version, 'simple', bundle.meta.rulesCount, bundle.meta.devicesCount);

    // Store in cache
    this.cache.set(cacheKey, {
      bundle,
      version: bundle.meta.version,
      expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
    });

    return bundle;
  }

  /**
   * Get version history for a customer's alarm bundles.
   */
  async getVersionHistory(tenantId: string, customerId: string, limit?: number): Promise<AlarmBundleVersion[]> {
    return this.versionRepository.getHistory(tenantId, customerId, limit);
  }

  /**
   * Generate a bundle for the verify service (bundle/to-verify-service).
   * Same as /bundle/simple but enriched with:
   *   - rules[id].notifications — per-action recipients
   *   - GROUP recipients include resolvedChannels (group_channels × group_dispatch_configs)
   *     so the verify service receives flat dispatch targets without extra API calls.
   */
  async verifyBundle(params: GenerateBundleParams): Promise<SimpleAlarmRulesBundle & {
    rules: Record<string, SimpleBundleAlarmRule & { notifications?: Record<string, unknown> }>;
  }> {
    const { tenantId, customerId } = params;

    // Base simplified bundle (uses cache)
    const base = await this.generateSimplifiedBundle(params);

    // Full rules to access notifications JSONB
    const allRules = await this.ruleRepository.getByCustomerId(tenantId, customerId);
    const notificationsMap = new Map(allRules.map(r => [r.id, r.notifications]));

    // Collect all unique groupIds referenced across all rules/actions
    const groupIds = new Set<string>();
    for (const rule of allRules) {
      if (!rule.notifications) continue;
      for (const actionNotif of Object.values(rule.notifications)) {
        for (const recipient of actionNotif?.recipients ?? []) {
          if (recipient.sourceType === 'GROUP') groupIds.add(recipient.groupId);
        }
      }
    }

    // Batch-fetch group_channels and group_dispatch_configs for all referenced groups
    const groupChannelRepo   = new GroupChannelRepository();
    const groupDispatchRepo  = new GroupDispatchConfigRepository();

    const groupChannelMap  = new Map<string, Awaited<ReturnType<GroupChannelRepository['findByGroup']>>>();
    const groupDispatchMap = new Map<string, Awaited<ReturnType<GroupDispatchConfigRepository['findByGroup']>>>();

    await Promise.all([...groupIds].map(async (groupId) => {
      const [channels, dispatch] = await Promise.all([
        groupChannelRepo.findByGroup(tenantId, groupId),
        groupDispatchRepo.findByGroup(tenantId, groupId),
      ]);
      groupChannelMap.set(groupId, channels.filter(c => c.active));
      groupDispatchMap.set(groupId, dispatch.filter(d => d.active));
    }));

    // For a GROUP recipient, resolve active channels that match the given alarm action
    const resolveGroupChannels = (groupId: string, action: string) => {
      const channels      = groupChannelMap.get(groupId) ?? [];
      const dispatchItems = (groupDispatchMap.get(groupId) ?? []).filter(d => d.action === action);
      return dispatchItems
        .map(d => {
          const ch = channels.find(c => c.channel === d.channel);
          if (!ch) return null;
          return {
            channel:           ch.channel,
            target:            ch.target,
            config:            ch.config,
            escalationDelayMs: d.escalationDelayMs,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    };

    // Enrich each rule with notifications + resolvedChannels on GROUP recipients
    const enrichedRules: Record<string, SimpleBundleAlarmRule & { notifications?: Record<string, unknown> }> = {};

    for (const [ruleId, rule] of Object.entries(base.rules)) {
      const notifications = notificationsMap.get(ruleId);
      if (!notifications) {
        enrichedRules[ruleId] = rule;
        continue;
      }

      const enrichedNotifications: Record<string, unknown> = {};
      for (const [action, actionNotif] of Object.entries(notifications)) {
        if (!actionNotif) continue;
        enrichedNotifications[action] = {
          ...actionNotif,
          recipients: actionNotif.recipients.map(r => {
            if (r.sourceType !== 'GROUP') return r;
            return {
              ...r,
              resolvedChannels: resolveGroupChannels(r.groupId, action),
            };
          }),
        };
      }

      enrichedRules[ruleId] = { ...rule, notifications: enrichedNotifications };
    }

    return { ...base, rules: enrichedRules };
  }

  /**
   * Record a new bundle version in the database.
   * Consumes pendingInvalidation metadata if present.
   */
  private async recordVersion(
    tenantId: string,
    customerId: string,
    version: string,
    bundleType: 'full' | 'simple',
    rulesCount: number,
    devicesCount: number
  ): Promise<void> {
    const meta = this.pendingInvalidation;
    this.pendingInvalidation = null;

    const latest = await this.versionRepository.getLatest(tenantId, customerId, bundleType);

    try {
      await this.versionRepository.record({
        tenantId,
        customerId,
        version,
        previousVersion: latest?.version,
        bundleType,
        reason: meta?.reason || 'cache_expired',
        entityType: meta?.entityType || 'system',
        entityId: meta?.entityId,
        rulesCount,
        devicesCount,
        createdBy: meta?.userId,
      });
    } catch {
      // Non-critical: don't break bundle generation if version recording fails
    }
  }

  /**
   * Build simplified bundle structure
   */
  private buildSimplifiedBundle(
    customer: Customer,
    devices: Device[],
    rules: Rule[],
    tenantId: string
  ): SimpleAlarmRulesBundle {
    const generatedAt = new Date().toISOString();

    // Create simplified rules catalog (minimal fields + schedule)
    const rulesCatalog: Record<string, SimpleBundleAlarmRule> = {};
    for (const rule of rules) {
      if (rule.alarmConfig) {
        // Convert daysOfWeek array to object format {0: true, 1: false, ...}
        const daysArray = rule.alarmConfig.daysOfWeek || [0, 1, 2, 3, 4, 5, 6];
        const daysOfWeekObj: Record<number, boolean> = {
          0: daysArray.includes(0),
          1: daysArray.includes(1),
          2: daysArray.includes(2),
          3: daysArray.includes(3),
          4: daysArray.includes(4),
          5: daysArray.includes(5),
          6: daysArray.includes(6),
        };

        // Determine aggregation: energy_consumption always uses SUM
        const aggregation = rule.alarmConfig.metric === 'energy_consumption'
          ? 'SUM'
          : (rule.alarmConfig.aggregation ?? 'LAST');

        // Duration is stored in milliseconds in DB
        // Rule: when aggregation is LAST, duration must be 0
        const durationMs = aggregation === 'LAST' ? 0 : (rule.alarmConfig.duration ?? 0);

        const simplifiedRule: SimpleBundleAlarmRule = {
          id: rule.id,
          name: rule.name,
          metric: rule.alarmConfig.metric,
          operator: rule.alarmConfig.operator,
          value: rule.alarmConfig.value,
          valueHigh: rule.alarmConfig.valueHigh,
          duration: durationMs,
          hysteresis: rule.alarmConfig.hysteresis ?? 0,
          aggregation,
          // Schedule fields (always present with defaults)
          startAt: rule.alarmConfig.startAt || '00:00',
          endAt: rule.alarmConfig.endAt || '23:59',
          daysOfWeek: daysOfWeekObj,
          // Channel targeting (only for OUTLET devices with discrete metrics)
          channelId: rule.alarmConfig.channelId,
          // Energy unit multiplier: 1 for W (default), 0.25 for Wh
          keyMulti: rule.alarmConfig.keyMulti ?? 1,
        };

        rulesCatalog[rule.id] = simplifiedRule;
      }
    }

    // Build device index (minimal fields: name, centralId, slaveId, offset, ruleIds)
    const deviceIndex: Record<string, SimpleDeviceMapping> = {};
    const variantRules: Record<string, SimpleBundleAlarmRule> = {};

    for (const device of devices) {
      // Get applicable rules with channel info for discrete metrics
      const applicableRuleIds = this.getApplicableRulesWithChannel(device, rules);

      // Get offset from device metadata or attributes (default 0)
      const offset = this.getDeviceOffset(device);

      // Note: centralId is now passed via X-Central-Id header (filters devices)
      // Note: channels are included in rule entries with channelId when applicable
      // Only include devices that have at least one applicable rule
      if (applicableRuleIds.length === 0) continue;

      // RFC-0018: resolve per-device value overrides
      const resolvedRuleIds: RuleIdEntry[] = [];
      for (const entry of applicableRuleIds) {
        const ruleId = typeof entry === 'string' ? entry : entry.id;
        const rule = rules.find(r => r.id === ruleId);
        const override = rule?.scopeEntityOverrides?.[device.id];

        if (override && rulesCatalog[ruleId]) {
          const variantKey = `${ruleId}_${device.id}`;
          if (!variantRules[variantKey]) {
            variantRules[variantKey] = {
              ...rulesCatalog[ruleId],
              id: variantKey,
              parentRuleId: ruleId,
              ...(override.value !== undefined && { value: override.value }),
              ...(override.valueHigh !== undefined && { valueHigh: override.valueHigh }),
            };
          }
          resolvedRuleIds.push(typeof entry === 'string' ? variantKey : { id: variantKey, channel: entry.channel });
        } else {
          resolvedRuleIds.push(entry);
        }
      }

      const mapping: SimpleDeviceMapping = {
        deviceName: device.name,
        slaveId: device.slaveId,
        offset,
        ruleIds: resolvedRuleIds,
      };

      deviceIndex[device.id] = mapping;
    }

    // Merge variant rules (overridden) into the catalog
    Object.assign(rulesCatalog, variantRules);

    // Calculate version hash from content
    const bundleContent = { deviceIndex, rules: rulesCatalog };
    const version = this.calculateVersionHash(bundleContent);

    const meta: SimpleBundleMeta = {
      version,
      generatedAt,
      customerId: customer.id,
      customerName: customer.name,
      tenantId,
      signature: '', // Will be filled after
      algorithm: 'HMAC-SHA256',
      ttlSeconds: DEFAULT_TTL_SECONDS,
      rulesCount: Object.keys(rulesCatalog).length,
      devicesCount: devices.length,
      skipVersionCheck: customer.config?.bundle?.checkVersion === false,
    };

    return {
      meta,
      deviceIndex,
      rules: rulesCatalog,
    };
  }

  /**
   * Sign the simplified bundle using HMAC-SHA256
   */
  private signSimplifiedBundle(bundle: SimpleAlarmRulesBundle): string {
    const contentToSign = {
      meta: {
        version: bundle.meta.version,
        generatedAt: bundle.meta.generatedAt,
        customerId: bundle.meta.customerId,
        tenantId: bundle.meta.tenantId,
      },
      rulesCount: bundle.meta.rulesCount,
      devicesCount: bundle.meta.devicesCount,
    };

    const serialized = JSON.stringify(contentToSign);
    return crypto
      .createHmac('sha256', BUNDLE_SIGNING_SECRET)
      .update(serialized)
      .digest('hex');
  }

  /**
   * Verify bundle signature
   */
  verifySignature(bundle: AlarmRulesBundle): boolean {
    const expectedSignature = this.signBundle(bundle);
    return crypto.timingSafeEqual(
      Buffer.from(bundle.meta.signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Get bundle version (hash) for ETag comparison
   */
  async getBundleVersion(params: GenerateBundleParams): Promise<string> {
    const bundle = await this.generateBundle(params);
    return bundle.meta.version;
  }

  /**
   * Get devices for a customer, with optional filtering
   */
  private async getDevicesByCustomer(
    tenantId: string,
    customerId: string,
    centralId?: string,
    domain?: string,
    deviceType?: string
  ): Promise<Device[]> {
    // Get all devices for the customer
    const result = await this.deviceRepository.listByCustomer(tenantId, customerId, {
      limit: 10000, // Get all devices
    });

    let devices = result.items;

    // Filter by centralId if specified (via X-Central-Id header)
    if (centralId) {
      devices = devices.filter(d => d.centralId === centralId);
    }

    // Filter by domain if specified (domain is stored in metadata or attributes)
    if (domain) {
      devices = devices.filter(d =>
        d.metadata?.domain === domain ||
        d.attributes?.domain === domain ||
        (d.tags && d.tags.includes(`domain:${domain}`))
      );
    }

    // Filter by deviceType if specified
    if (deviceType) {
      devices = devices.filter(d =>
        d.type === deviceType ||
        d.metadata?.deviceType === deviceType ||
        (d.tags && d.tags.includes(`deviceType:${deviceType}`))
      );
    }

    return devices;
  }

  /**
   * Build the bundle structure from rules and devices
   */
  private buildBundle(
    customer: Customer,
    devices: Device[],
    rules: Rule[],
    tenantId: string
  ): AlarmRulesBundle {
    const generatedAt = new Date().toISOString();

    // Create rules catalog
    const rulesCatalog: Record<string, BundleAlarmRule> = {};
    for (const rule of rules) {
      if (rule.alarmConfig) {
        rulesCatalog[rule.id] = {
          id: rule.id,
          name: rule.name,
          priority: rule.priority,
          metric: rule.alarmConfig.metric,
          operator: rule.alarmConfig.operator,
          value: rule.alarmConfig.value,
          valueHigh: rule.alarmConfig.valueHigh,
          unit: rule.alarmConfig.unit,
          duration: rule.alarmConfig.duration,
          hysteresis: rule.alarmConfig.hysteresis,
          hysteresisType: rule.alarmConfig.hysteresisType,
          aggregation: rule.alarmConfig.aggregation,
          aggregationWindow: rule.alarmConfig.aggregationWindow,
          enabled: rule.enabled,
          tags: rule.tags,
        };
      }
    }

    // Group devices by type and map rules
    const rulesByDeviceType: Record<string, DeviceTypeGroup> = {};
    const deviceIndex: Record<string, DeviceRuleMapping> = {};

    for (const device of devices) {
      const deviceTypeKey = this.getDeviceTypeKey(device);
      const domain = this.getDeviceDomain(device);
      const applicableRuleIds = this.getApplicableRules(device, rules);

      // Build device type group
      if (!rulesByDeviceType[deviceTypeKey]) {
        rulesByDeviceType[deviceTypeKey] = {
          deviceType: deviceTypeKey,
          domain,
          deviceCount: 0,
          devices: [],
          ruleIds: [],
        };
      }

      const group = rulesByDeviceType[deviceTypeKey];
      group.deviceCount++;
      group.devices.push({
        id: device.id,
        name: device.name,
        serialNumber: device.serialNumber,
        externalId: device.externalId,
      });

      // Merge rule IDs (deduplicated)
      for (const ruleId of applicableRuleIds) {
        if (!group.ruleIds.includes(ruleId)) {
          group.ruleIds.push(ruleId);
        }
      }

      // Build device index
      deviceIndex[device.id] = {
        deviceId: device.id,
        deviceName: device.name,
        deviceType: deviceTypeKey,
        domain,
        serialNumber: device.serialNumber,
        externalId: device.externalId,
        ruleIds: applicableRuleIds,
      };
    }

    // Create bundle without signature (will be added after)
    const bundleContent = {
      rulesByDeviceType,
      deviceIndex,
      rules: rulesCatalog,
    };

    // Calculate version hash from content
    const version = this.calculateVersionHash(bundleContent);

    const meta: BundleMeta = {
      version,
      generatedAt,
      customerId: customer.id,
      customerName: customer.name,
      tenantId,
      signature: '', // Will be filled after
      algorithm: 'HMAC-SHA256',
      ttlSeconds: DEFAULT_TTL_SECONDS,
      rulesCount: Object.keys(rulesCatalog).length,
      devicesCount: devices.length,
    };

    return {
      meta,
      ...bundleContent,
    };
  }

  /**
   * Get the device type key (combining type and custom deviceType if present)
   */
  private getDeviceTypeKey(device: Device): string {
    // Check for custom deviceType in metadata
    const customType = device.metadata?.deviceType as string | undefined;
    if (customType) {
      return customType;
    }
    return device.type;
  }

  /**
   * Get device domain from metadata/tags
   */
  private getDeviceDomain(device: Device): string {
    // Check metadata
    if (device.metadata?.domain) {
      return device.metadata.domain as string;
    }
    // Check attributes
    if (device.attributes?.domain) {
      return device.attributes.domain as string;
    }
    // Check tags
    const domainTag = device.tags?.find(t => t.startsWith('domain:'));
    if (domainTag) {
      return domainTag.split(':')[1];
    }
    return 'default';
  }

  /** All offset keys - always present, 0 when not applicable */
  private static readonly OFFSET_KEYS = ['temp', 'hum', 'pot', 'water_level'] as const;

  /**
   * Get device calibration offset from metadata/attributes
   * Always returns all keys (temp, hum, pot, water_level) - 0 when not applicable
   */
  private getDeviceOffset(device: Device): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key of AlarmBundleService.OFFSET_KEYS) {
      result[key] = 0;
    }

    const raw = device.metadata?.offset ?? device.attributes?.offset;

    if (raw !== undefined && typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
        if (key in result) {
          const num = Number(val);
          if (!isNaN(num)) {
            result[key] = num;
          }
        }
      }
    }

    return result;
  }

  /**
   * Get rules applicable to a device based on scope
   */
  private getApplicableRules(device: Device, rules: Rule[]): string[] {
    const applicableRuleIds: string[] = [];

    for (const rule of rules) {
      if (!rule.alarmConfig) continue;

      const scope = rule.scope;
      let isApplicable = false;

      switch (scope.type) {
        case 'GLOBAL':
          // Global rules apply to all devices
          isApplicable = true;
          break;
        case 'CUSTOMER':
          // Customer-scoped rules apply if customer matches or is inherited
          isApplicable =
            scope.entityId === device.customerId ||
            (scope.inherited === true);
          break;
        case 'ASSET':
          // Asset-scoped rules apply if device belongs to the asset
          isApplicable =
            scope.entityId === device.assetId ||
            (scope.inherited === true && device.assetId !== undefined);
          break;
        case 'DEVICE':
          // Device-scoped rules apply to the specific device (single or array)
          isApplicable =
            scope.entityId === device.id ||
            (scope.entityIds?.includes(device.id) ?? false);
          break;
      }

      if (isApplicable) {
        applicableRuleIds.push(rule.id);
      }
    }

    return applicableRuleIds;
  }

  /**
   * Get rules applicable to a device with channel info for discrete metrics
   * Returns RuleIdEntry[] - string for simple rules, object with channel for channel-specific rules
   */
  private getApplicableRulesWithChannel(device: Device, rules: Rule[]): RuleIdEntry[] {
    const applicableRules: RuleIdEntry[] = [];

    for (const rule of rules) {
      if (!rule.alarmConfig) continue;

      const scope = rule.scope;
      let isApplicable = false;

      switch (scope.type) {
        case 'GLOBAL':
          isApplicable = true;
          break;
        case 'CUSTOMER':
          isApplicable =
            scope.entityId === device.customerId ||
            (scope.inherited === true);
          break;
        case 'ASSET':
          isApplicable =
            scope.entityId === device.assetId ||
            (scope.inherited === true && device.assetId !== undefined);
          break;
        case 'DEVICE':
          // Device-scoped rules apply to the specific device (single or array)
          isApplicable =
            scope.entityId === device.id ||
            (scope.entityIds?.includes(device.id) ?? false);
          break;
      }

      if (isApplicable) {
        // Check if rule has channelId (for discrete metrics on OUTLET devices)
        if (rule.alarmConfig.channelId !== undefined) {
          applicableRules.push({
            id: rule.id,
            channel: rule.alarmConfig.channelId,
          });
        } else {
          applicableRules.push(rule.id);
        }
      }
    }

    return applicableRules;
  }

  /**
   * Generate a deterministic version ID from bundle content using SHA-256.
   * Same content always produces the same hash, enabling proper 304 caching.
   * Format: v1-<12-char hex hash> (e.g., v1-a1b2c3d4e5f6)
   */
  private calculateVersionHash(content: object): string {
    const serialized = JSON.stringify(content, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort())
        : value
    );
    const hash = crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 12);
    return `v1-${hash}`;
  }

  /**
   * Sign the bundle using HMAC-SHA256
   */
  private signBundle(bundle: AlarmRulesBundle): string {
    // Create a copy without the signature for signing
    const contentToSign = {
      meta: {
        version: bundle.meta.version,
        generatedAt: bundle.meta.generatedAt,
        customerId: bundle.meta.customerId,
        tenantId: bundle.meta.tenantId,
      },
      rulesCount: bundle.meta.rulesCount,
      devicesCount: bundle.meta.devicesCount,
    };

    const serialized = JSON.stringify(contentToSign);
    return crypto
      .createHmac('sha256', BUNDLE_SIGNING_SECRET)
      .update(serialized)
      .digest('hex');
  }
}

export const alarmBundleService = new AlarmBundleService();
