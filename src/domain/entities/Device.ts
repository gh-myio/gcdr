import { BaseEntity, EntityStatus } from '../../shared/types';

export type DeviceType = 'SENSOR' | 'ACTUATOR' | 'GATEWAY' | 'CONTROLLER' | 'METER' | 'CAMERA' | 'OUTLET' | 'INFRARED' | 'OTHER';
export type DeviceProtocol = 'MQTT' | 'HTTP' | 'MODBUS' | 'BACNET' | 'LORAWAN' | 'ZIGBEE' | 'OTHER';

// RFC-0046 Addendum A (DEC-11): explicit meter purpose for goal allocation.
export type MeterRole = 'ENTRY' | 'SUBMETER';
export type MeterDomain = 'ENERGY' | 'WATER';
export type ConnectivityStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface DeviceCredentials {
  type: 'ACCESS_TOKEN' | 'X509_CERTIFICATE' | 'MQTT_BASIC';
  accessToken?: string;
  certificateFingerprint?: string;
  username?: string;
}

// =============================================================================
// RFC-0008: Device Attributes Extension - Types
// =============================================================================

export interface PowerLimitValue {
  baseValue: number;
  topValue: number;
}

export interface DeviceStatusLimit {
  deviceStatusName: string;
  limitsValues: PowerLimitValue;
}

export interface DeviceTypeItem {
  deviceType: string;
  name: string;
  description: string;
  limitsByDeviceStatus: DeviceStatusLimit[];
}

export interface InstantaneousPowerType {
  telemetryType: string;
  itemsByDeviceType: DeviceTypeItem[];
}

export interface MapInstantaneousPower {
  version: string;
  limitsByInstantaneousPowerType: InstantaneousPowerType[];
}

export interface LogAnnotationEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export interface LogAnnotations {
  entries?: LogAnnotationEntry[];
  metadata?: Record<string, unknown>;
}

// =============================================================================

export interface DeviceChannel {
  name: string;
  channel: number;
  type: string;
}

export interface DeviceSpecs {
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  hardwareVersion?: string;
  serialNumber: string;
  macAddress?: string;
  ipAddress?: string;
  protocol?: DeviceProtocol;
  dataSheet?: string;
  installationDate?: string;
  warrantyExpiration?: string;

  // RFC-0008: Modbus configuration
  addrLow?: number;      // 0-65535 (Modbus register address)
  addrHigh?: number;     // 0-65535 (Modbus register address)
  frequency?: number;    // 1-3600 (polling frequency in seconds)

  // RFC-0008: Complex configuration
  mapInstantaneousPower?: MapInstantaneousPower;
  logAnnotations?: LogAnnotations;

  // OUTLET: channel definitions
  channels?: DeviceChannel[];

  // Allow additional properties
  [key: string]: unknown;
}

export interface DeviceTelemetryConfig {
  reportingInterval?: number;    // seconds
  telemetryKeys?: string[];      // Expected telemetry keys
  attributeKeys?: string[];      // Expected attribute keys
}

export interface Device extends BaseEntity {
  assetId: string;
  customerId: string;            // Denormalized for efficient queries

  // Basic Info
  name: string;
  displayName: string;
  code?: string;
  label?: string;
  type: DeviceType;
  description?: string;

  // Identification
  serialNumber: string;
  externalId?: string;           // ThingsBoard ID or other external system ID

  // Specifications
  specs: DeviceSpecs;

  // Top-level convenience aliases (read from specs)
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;

  // Connectivity
  connectivityStatus: ConnectivityStatus;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;

  // Credentials (for provisioning)
  credentials?: DeviceCredentials;

  // Telemetry Configuration
  telemetryConfig?: DeviceTelemetryConfig;

  // Configuration
  tags: string[];
  metadata: Record<string, unknown>;
  attributes: Record<string, unknown>;  // Server-side attributes

  // Status
  status: EntityStatus;
  deletedAt?: string;

  // ==========================================================================
  // RFC-0008: Device Attributes Extension
  // ==========================================================================

  // Modbus Configuration
  slaveId?: number;              // Modbus slave ID (1-247)
  centralId?: string;            // UUID of associated central

  // Extended Identification
  identifier?: string;           // Human-readable unique identifier (e.g., "ENTRADA_SHOPPING_GARAGEM_L2")
  deviceProfile?: string;        // Device profile (e.g., "HIDROMETRO_AREA_COMUM")
  deviceType?: string;           // Specific device type (e.g., "3F_MEDIDOR") - complements 'type' enum

  // RFC-0008 follow-up: channel-centric identity (a board at (central, slave)
  // can expose multiple channels). Both optional; part of the central/slave
  // uniqueness key when present.
  channel?: number;              // channel index on the board (e.g., 0, 1)
  deviceChannelType?: string;    // channel sub-type (e.g., "lamp", "presence_sensor")

  // RFC-0046 Addendum A (DEC-11): explicit meter purpose — ENTRY meters
  // participate in the goals residual allocation for their domain. Set and
  // cleared together (DB CHECK enforces both-or-neither).
  meterRole?: MeterRole;         // 'ENTRY' | 'SUBMETER'
  meterDomain?: MeterDomain;     // 'ENERGY' | 'WATER'

  // Ingestion Integration
  ingestionId?: string;          // UUID in ingestion system
  ingestionGatewayId?: string;   // UUID of ingestion gateway

  // Activity Monitoring
  lastActivityTime?: string;     // Last telemetry received (ISO timestamp)
  lastAlarmTime?: string;        // Last alarm triggered (ISO timestamp)
}

export function createDefaultDeviceSpecs(serialNumber: string): DeviceSpecs {
  return {
    serialNumber,
  };
}

export function createDefaultTelemetryConfig(): DeviceTelemetryConfig {
  return {
    reportingInterval: 60,
    telemetryKeys: [],
    attributeKeys: [],
  };
}
