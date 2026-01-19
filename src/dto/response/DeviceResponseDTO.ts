import { Device } from '../../domain/entities/Device';

export interface DeviceResponseDTO {
  id: string;
  tenantId: string;
  assetId: string;
  customerId: string;
  name: string;
  displayName: string;
  label?: string;
  type: string;
  description?: string;
  serialNumber: string;
  externalId?: string;
  specs: {
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    hardwareVersion?: string;
    serialNumber: string;
    macAddress?: string;
    ipAddress?: string;
    protocol?: string;
    dataSheet?: string;
    installationDate?: string;
    warrantyExpiration?: string;
  };
  connectivityStatus: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  telemetryConfig?: {
    reportingInterval?: number;
    telemetryKeys?: string[];
    attributeKeys?: string[];
  };
  tags: string[];
  metadata: Record<string, unknown>;
  attributes: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export function toDeviceResponse(device: Device): DeviceResponseDTO {
  return {
    id: device.id,
    tenantId: device.tenantId,
    assetId: device.assetId,
    customerId: device.customerId,
    name: device.name,
    displayName: device.displayName,
    label: device.label,
    type: device.type,
    description: device.description,
    serialNumber: device.serialNumber,
    externalId: device.externalId,
    specs: device.specs,
    connectivityStatus: device.connectivityStatus,
    lastConnectedAt: device.lastConnectedAt,
    lastDisconnectedAt: device.lastDisconnectedAt,
    telemetryConfig: device.telemetryConfig,
    tags: device.tags,
    metadata: device.metadata,
    attributes: device.attributes,
    status: device.status,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    createdBy: device.createdBy,
  };
}
