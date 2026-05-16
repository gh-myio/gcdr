import { BaseEntity, EntityStatus } from '../../shared/types';
import type { CentralMqttIntegrationId } from '../integrations/CentralMqttIntegrationId';

export type CentralType = 'NODEHUB' | 'GATEWAY' | 'EDGE_CONTROLLER' | 'VIRTUAL';
export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE';

/**
 * Per-destination MQTT broker config (RFC-0035). One entry per upstream
 * destination a central can publish to. Lives under
 * centrals.config.mqttIntegrations[]. Credentials (password) are stored
 * separately under customers.metadata.integrations.centrals.items[].mqttPasswords
 * keyed by the same `id`.
 */
export interface CentralMqttIntegration {
  id:                    CentralMqttIntegrationId;
  enabled:               boolean;
  broker?:               string;
  port?:                 number;
  clientId?:             string;
  userName?:             string;
  useTls:                boolean;
  qos:                   0 | 1 | 2;
  keepAlive?:            number;
  topicPrefix?:          string;
  topic?:                string;
  destinationGatewayId?: string | null;
}

export interface CentralConfig {
  // Network
  ipAddress?: string;
  macAddress?: string;
  /**
   * Yggdrasil mesh IPv6 address (RFC-0035 — intrinsic identity).
   * Backfilled in Phase A from customers.metadata.integrations.centrals.items[].ipv6Yggdrasil.
   * Read-prefer this over the legacy customer-scope location.
   */
  ipv6Yggdrasil?: string;
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

  /**
   * RFC-0035 — plural MQTT destinations. Additive in Phase 2: present
   * after backfill, optional during the dual-source window. Legacy
   * mqttConfig on this column (if present) is read-only and dropped in
   * Phase B once the frontend reshape ships.
   */
  mqttIntegrations?: CentralMqttIntegration[];
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
