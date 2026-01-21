import { RulePriority, ComparisonOperator } from './Rule';

/**
 * Alarm Rule in compact format for the bundle
 */
export interface BundleAlarmRule {
  id: string;
  name: string;
  priority: RulePriority;
  metric: string;
  operator: ComparisonOperator;
  value: number;
  valueHigh?: number;
  unit?: string;
  duration?: number;
  hysteresis?: number;
  hysteresisType?: 'PERCENTAGE' | 'ABSOLUTE';
  aggregation?: 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'LAST';
  aggregationWindow?: number;
  enabled: boolean;
  tags: string[];
}

/**
 * Device type group containing devices and applicable rules
 */
export interface DeviceTypeGroup {
  deviceType: string;
  domain: string;
  deviceCount: number;
  devices: Array<{
    id: string;
    name: string;
    serialNumber: string;
    externalId?: string;
  }>;
  ruleIds: string[];
}

/**
 * Device to rules mapping for quick lookup
 */
export interface DeviceRuleMapping {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  domain: string;
  serialNumber: string;
  externalId?: string;
  ruleIds: string[];
}

/**
 * Bundle metadata with versioning and signature
 */
export interface BundleMeta {
  version: string;
  generatedAt: string;
  customerId: string;
  customerName: string;
  tenantId: string;
  signature: string;
  algorithm: 'HMAC-SHA256';
  ttlSeconds: number;
  rulesCount: number;
  devicesCount: number;
}

/**
 * Complete Alarm Rules Bundle for Node-RED consumption
 */
export interface AlarmRulesBundle {
  meta: BundleMeta;

  /**
   * Rules organized by device type for bulk configuration
   */
  rulesByDeviceType: Record<string, DeviceTypeGroup>;

  /**
   * Device to rules index for quick per-device lookup
   */
  deviceIndex: Record<string, DeviceRuleMapping>;

  /**
   * Catalog of all rules (referenced by ID to avoid duplication)
   */
  rules: Record<string, BundleAlarmRule>;
}

/**
 * Parameters for generating the bundle
 */
export interface GenerateBundleParams {
  tenantId: string;
  customerId: string;
  domain?: string;
  deviceType?: string;
  includeDisabled?: boolean;
}
