import { BaseEntity, EntityStatus } from '../../shared/types';

export type DeviceType = 'SENSOR' | 'ACTUATOR' | 'GATEWAY' | 'CONTROLLER' | 'METER' | 'CAMERA' | 'OTHER';
export type DeviceProtocol = 'MQTT' | 'HTTP' | 'MODBUS' | 'BACNET' | 'LORAWAN' | 'ZIGBEE' | 'OTHER';
export type ConnectivityStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface DeviceCredentials {
  type: 'ACCESS_TOKEN' | 'X509_CERTIFICATE' | 'MQTT_BASIC';
  accessToken?: string;
  certificateFingerprint?: string;
  username?: string;
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
  label?: string;
  type: DeviceType;
  description?: string;

  // Identification
  serialNumber: string;
  externalId?: string;           // ThingsBoard ID or other external system ID

  // Specifications
  specs: DeviceSpecs;

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
