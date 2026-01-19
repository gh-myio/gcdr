import { z } from 'zod';
import { PaginationParams } from '../../shared/types';

// Device Specs Schema
const DeviceSpecsSchema = z.object({
  manufacturer: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  firmwareVersion: z.string().max(50).optional(),
  hardwareVersion: z.string().max(50).optional(),
  serialNumber: z.string().min(1).max(100),
  macAddress: z.string().max(20).optional(),
  ipAddress: z.string().max(50).optional(),
  protocol: z.enum(['MQTT', 'HTTP', 'MODBUS', 'BACNET', 'LORAWAN', 'ZIGBEE', 'OTHER']).optional(),
  dataSheet: z.string().url().optional(),
  installationDate: z.string().datetime().optional(),
  warrantyExpiration: z.string().datetime().optional(),
});

// Telemetry Config Schema
const TelemetryConfigSchema = z.object({
  reportingInterval: z.number().int().positive().optional(),
  telemetryKeys: z.array(z.string().max(100)).max(50).optional(),
  attributeKeys: z.array(z.string().max(100)).max(50).optional(),
}).optional();

// Credentials Schema
const CredentialsSchema = z.object({
  type: z.enum(['ACCESS_TOKEN', 'X509_CERTIFICATE', 'MQTT_BASIC']),
  accessToken: z.string().max(255).optional(),
  certificateFingerprint: z.string().max(255).optional(),
  username: z.string().max(100).optional(),
}).optional();

// Create Device Schema
export const CreateDeviceSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
  label: z.string().max(100).optional(),
  type: z.enum(['SENSOR', 'ACTUATOR', 'GATEWAY', 'CONTROLLER', 'METER', 'CAMERA', 'OTHER']),
  description: z.string().max(1000).optional(),
  serialNumber: z.string().min(1).max(100),
  externalId: z.string().max(100).optional(),
  specs: DeviceSpecsSchema.optional(),
  credentials: CredentialsSchema,
  telemetryConfig: TelemetryConfigSchema,
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  attributes: z.record(z.unknown()).optional(),
});

export type CreateDeviceDTO = z.infer<typeof CreateDeviceSchema>;

// Update Device Schema
export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().max(255).optional(),
  label: z.string().max(100).optional(),
  type: z.enum(['SENSOR', 'ACTUATOR', 'GATEWAY', 'CONTROLLER', 'METER', 'CAMERA', 'OTHER']).optional(),
  description: z.string().max(1000).optional(),
  externalId: z.string().max(100).optional(),
  specs: DeviceSpecsSchema.optional(),
  credentials: CredentialsSchema,
  telemetryConfig: TelemetryConfigSchema,
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  attributes: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type UpdateDeviceDTO = z.infer<typeof UpdateDeviceSchema>;

// Update Connectivity Status Schema
export const UpdateConnectivitySchema = z.object({
  connectivityStatus: z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN']),
});

export type UpdateConnectivityDTO = z.infer<typeof UpdateConnectivitySchema>;

// Move Device Schema
export const MoveDeviceSchema = z.object({
  newAssetId: z.string().uuid(),
});

export type MoveDeviceDTO = z.infer<typeof MoveDeviceSchema>;

// List Devices Params
export interface ListDevicesParams extends PaginationParams {
  assetId?: string;
  customerId?: string;
  type?: string;
  status?: string;
  connectivityStatus?: string;
  serialNumber?: string;
}
