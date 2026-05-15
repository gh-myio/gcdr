import { BaseEntity, EntityStatus } from '../../shared/types';

export type CentralType = 'NODEHUB' | 'GATEWAY' | 'EDGE_CONTROLLER' | 'VIRTUAL';
export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE';

export interface CentralConfig {
  // Network
  ipAddress?: string;
  macAddress?: string;
  hostname?: string;
  port?: number;

  // Sync
  syncInterval: number; // seconds
  offlineBufferSize: number; // max events to buffer when offline
  lastSyncAt?: string;

  // Features
  enableLocalProcessing: boolean;
  enableOfflineMode: boolean;
  enableAutoUpdate: boolean;

  // Thresholds
  maxDevices: number;
  maxRules: number;

  // Custom config
  customSettings: Record<string, unknown>;
}

export interface CentralStats {
  connectedDevices: number;
  activeRules: number;
  pendingSyncEvents: number;
  uptimeSeconds: number;
  lastHeartbeatAt?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
}

/**
 * Connection params for a central, sourced from
 * customers.metadata.integrations.centrals.items[] (RFC-0033).
 * Loaded on demand by CentralService.enrichWithConnection() — never
 * persisted on the centrals row. mqttPassword is omitted by default;
 * mqttPasswordSet exposes whether a password is configured.
 */
export interface CentralConnection {
  mqttUserName?: string;
  mqttClientId?: string;
  ipv6Yggdrasil?: string;
  ingestionGatewayId?: string | null;
  mqttPasswordSet?: boolean;
}

export interface Central extends BaseEntity {
  // Relationships
  customerId: string;
  assetId: string;

  // Basic Info
  name: string;
  displayName: string;
  serialNumber: string;
  type: CentralType;

  // Status
  status: EntityStatus;
  connectionStatus: ConnectionStatus;

  // Version
  firmwareVersion: string;
  softwareVersion: string;
  lastUpdateAt?: string;

  // Configuration
  config: CentralConfig;

  // Stats (updated periodically)
  stats: CentralStats;

  // Connection params (enriched on read from customer integrations — RFC-0033)
  connection?: CentralConnection;

  // Location (can differ from asset location)
  location?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };

  // Tags for filtering
  tags: string[];

  // Metadata
  metadata: Record<string, unknown>;
}

export function createDefaultCentralConfig(): CentralConfig {
  return {
    syncInterval: 60,
    offlineBufferSize: 10000,
    enableLocalProcessing: true,
    enableOfflineMode: true,
    enableAutoUpdate: false,
    maxDevices: 100,
    maxRules: 50,
    customSettings: {},
  };
}

export function createDefaultCentralStats(): CentralStats {
  return {
    connectedDevices: 0,
    activeRules: 0,
    pendingSyncEvents: 0,
    uptimeSeconds: 0,
  };
}
