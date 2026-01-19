import { Central, CentralConfig, CentralStats } from '../../domain/entities/Central';

export interface CentralSummaryDTO {
  id: string;
  customerId: string;
  assetId: string;
  name: string;
  displayName: string;
  serialNumber: string;
  type: string;
  status: string;
  connectionStatus: string;
  firmwareVersion: string;
  softwareVersion: string;
  connectedDevices: number;
  lastHeartbeatAt?: string;
  updatedAt: string;
}

export interface CentralDetailDTO {
  id: string;
  tenantId: string;
  customerId: string;
  assetId: string;
  name: string;
  displayName: string;
  serialNumber: string;
  type: string;
  status: string;
  connectionStatus: string;
  firmwareVersion: string;
  softwareVersion: string;
  lastUpdateAt?: string;
  config: CentralConfig;
  stats: CentralStats;
  location?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toCentralSummaryDTO(central: Central): CentralSummaryDTO {
  return {
    id: central.id,
    customerId: central.customerId,
    assetId: central.assetId,
    name: central.name,
    displayName: central.displayName,
    serialNumber: central.serialNumber,
    type: central.type,
    status: central.status,
    connectionStatus: central.connectionStatus,
    firmwareVersion: central.firmwareVersion,
    softwareVersion: central.softwareVersion,
    connectedDevices: central.stats.connectedDevices,
    lastHeartbeatAt: central.stats.lastHeartbeatAt,
    updatedAt: central.updatedAt,
  };
}

export function toCentralDetailDTO(central: Central): CentralDetailDTO {
  return {
    id: central.id,
    tenantId: central.tenantId,
    customerId: central.customerId,
    assetId: central.assetId,
    name: central.name,
    displayName: central.displayName,
    serialNumber: central.serialNumber,
    type: central.type,
    status: central.status,
    connectionStatus: central.connectionStatus,
    firmwareVersion: central.firmwareVersion,
    softwareVersion: central.softwareVersion,
    lastUpdateAt: central.lastUpdateAt,
    config: central.config,
    stats: central.stats,
    location: central.location,
    tags: central.tags,
    metadata: central.metadata,
    createdAt: central.createdAt,
    updatedAt: central.updatedAt,
  };
}
