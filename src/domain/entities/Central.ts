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
