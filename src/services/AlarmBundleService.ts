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
} from '../domain/entities/AlarmBundle';
import { RuleRepository } from '../repositories/RuleRepository';
import { DeviceRepository } from '../repositories/DeviceRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { IRuleRepository } from '../repositories/interfaces/IRuleRepository';
import { IDeviceRepository } from '../repositories/interfaces/IDeviceRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { NotFoundError } from '../shared/errors/AppError';

// Default TTL for bundle cache (5 minutes)
const DEFAULT_TTL_SECONDS = 300;

// Secret key for HMAC (in production, use AWS Secrets Manager or parameter store)
const BUNDLE_SIGNING_SECRET = process.env.BUNDLE_SIGNING_SECRET || 'gcdr-alarm-bundle-secret-key';

export class AlarmBundleService {
  private ruleRepository: IRuleRepository;
  private deviceRepository: IDeviceRepository;
  private customerRepository: ICustomerRepository;

  constructor(
    ruleRepository?: IRuleRepository,
    deviceRepository?: IDeviceRepository,
    customerRepository?: ICustomerRepository
  ) {
    this.ruleRepository = ruleRepository || new RuleRepository();
    this.deviceRepository = deviceRepository || new DeviceRepository();
    this.customerRepository = customerRepository || new CustomerRepository();
  }

  /**
   * Generate a complete alarm rules bundle for a customer
   */
  async generateBundle(params: GenerateBundleParams): Promise<AlarmRulesBundle> {
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

    return bundle;
  }

  /**
   * Generate a simplified alarm rules bundle for Node-RED
   * - No rulesByDeviceType
   * - Includes centralId and slaveId in deviceIndex
   * - Rules without enabled/tags fields
   */
  async generateSimplifiedBundle(params: GenerateBundleParams): Promise<SimpleAlarmRulesBundle> {
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

    // Build simplified bundle
    const bundle = this.buildSimplifiedBundle(customer, devices, alarmRules, tenantId);

    // Sign the bundle
    bundle.meta.signature = this.signSimplifiedBundle(bundle);

    return bundle;
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

        const simplifiedRule: SimpleBundleAlarmRule = {
          id: rule.id,
          name: rule.name,
          value: rule.alarmConfig.value,
          valueHigh: rule.alarmConfig.valueHigh,
          duration: rule.alarmConfig.duration,
          hysteresis: rule.alarmConfig.hysteresis,
          aggregation: rule.alarmConfig.aggregation,
          // Schedule fields (always present with defaults)
          startAt: rule.alarmConfig.startAt || '00:00',
          endAt: rule.alarmConfig.endAt || '23:59',
          daysOfWeek: daysOfWeekObj,
        };

        // Include offset for temperature metrics (default 0 if not set)
        if (rule.alarmConfig.metric === 'temperature') {
          simplifiedRule.offset = rule.alarmConfig.offset ?? 0;
        }

        rulesCatalog[rule.id] = simplifiedRule;
      }
    }

    // Build device index (minimal fields: name, centralId, slaveId, ruleIds)
    const deviceIndex: Record<string, SimpleDeviceMapping> = {};

    for (const device of devices) {
      const applicableRuleIds = this.getApplicableRules(device, rules);

      deviceIndex[device.id] = {
        deviceName: device.name,
        centralId: device.centralId,
        slaveId: device.slaveId,
        ruleIds: applicableRuleIds,
      };
    }

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
    domain?: string,
    deviceType?: string
  ): Promise<Device[]> {
    // Get all devices for the customer
    const result = await this.deviceRepository.listByCustomer(tenantId, customerId, {
      limit: 10000, // Get all devices
    });

    let devices = result.items;

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
          // Device-scoped rules apply only to the specific device
          isApplicable = scope.entityId === device.id;
          break;
      }

      if (isApplicable) {
        applicableRuleIds.push(rule.id);
      }
    }

    return applicableRuleIds;
  }

  /**
   * Generate a friendly version ID with timestamp and short hash
   * Format: v1-YYYYMMDD-HHmmss (e.g., v1-20260127-214530)
   */
  private calculateVersionHash(content: object): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `v1-${year}${month}${day}-${hours}${minutes}${seconds}`;
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
