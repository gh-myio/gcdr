import { RulePriority, ComparisonOperator, AggregationType, MetricDomain } from './Rule';
import { DeviceChannel } from './Device';

/**
 * Alarm Rule in compact format for the bundle
 */
export interface BundleAlarmRule {
  id: string;
  name: string;
  priority: RulePriority;
  metric: MetricDomain;
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

// =============================================================================
// Simplified Bundle Types (for Node-RED consumption)
// =============================================================================

/**
 * Simplified alarm rule - minimal fields for Node-RED processing
 */
export interface SimpleBundleAlarmRule {
  id: string;
  name: string;
  metric: MetricDomain;              // e.g., "temperature", "humidity", "energy"
  operator: ComparisonOperator;      // e.g., "GT", "LT", "BETWEEN"
  value: number;
  valueHigh?: number;                // For BETWEEN/OUTSIDE operators
  duration: number;                  // In milliseconds (converted from minutes in DB)
  hysteresis: number;                // Always present (default 0)
  aggregation: AggregationType;      // Always present (default 'LAST')
  // Schedule fields (always present)
  startAt: string;                   // HH:mm format (default "00:00")
  endAt: string;                     // HH:mm format (default "23:59")
  daysOfWeek: Record<number, boolean>; // 0-6, where 0 is Sunday (e.g., {0: true, 1: true, ...})
}

/**
 * Simplified device mapping - minimal fields for Node-RED processing
 */
export interface SimpleDeviceMapping {
  deviceName: string;
  deviceType?: string;
  centralId?: string;
  slaveId?: number;
  channels?: DeviceChannel[];
  offset: Record<string, number>;  // Calibration offset per metric (e.g., { temp: -0.5, hum: 0, pot: 0, water_level: 5 })
  ruleIds: string[];
}

/**
 * Simplified bundle metadata
 */
export interface SimpleBundleMeta {
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
 * Simplified Alarm Rules Bundle for Node-RED
 * - No rulesByDeviceType (redundant)
 * - Device index includes centralId and slaveId
 * - Rules without enabled/tags fields
 */
export interface SimpleAlarmRulesBundle {
  meta: SimpleBundleMeta;
  deviceIndex: Record<string, SimpleDeviceMapping>;
  rules: Record<string, SimpleBundleAlarmRule>;
}
