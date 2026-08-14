import { z } from 'zod';
import { CENTRAL_MQTT_INTEGRATION_IDS } from '../../domain/integrations/CentralMqttIntegrationId';

// Per-destination MQTT broker config (RFC-0035). N entries live under
// centrals.config.mqttIntegrations[], one per destination id. Passwords
// stay in customers.metadata.integrations.centrals.items[].mqttPasswords
// keyed by the same `id`.
export const CentralMqttIntegrationSchema = z.object({
  id:                   z.enum(CENTRAL_MQTT_INTEGRATION_IDS),
  enabled:              z.boolean().default(false),
  broker:               z.string().max(500).optional(),
  port:                 z.number().int().min(1).max(65535).optional(),
  clientId:             z.string().max(255).optional(),
  userName:             z.string().max(255).optional(),
  useTls:               z.boolean().default(true),
  qos:                  z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  keepAlive:            z.number().int().min(0).max(3600).optional(),
  topicPrefix:          z.string().max(500).optional(),
  topic:                z.string().max(500).optional(),
  destinationGatewayId: z.string().uuid().nullable().optional(),
});

export type CentralMqttIntegrationDTO = z.infer<typeof CentralMqttIntegrationSchema>;

// Central Config Schema
const CentralConfigSchema = z.object({
  ipAddress: z.string().ip().optional(),
  macAddress: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
    .optional(),
  // RFC-0035: intrinsic identity. Yggdrasil mesh address of the central.
  // Backfilled in Phase A from customers.metadata.integrations.centrals.items[].ipv6Yggdrasil;
  // legacy location remains writable during the dual-source window.
  ipv6Yggdrasil: z.string().max(64).optional(),
  hostname: z.string().max(255).optional(),
  port: z.number().min(1).max(65535).optional(),
  syncInterval: z.number().min(10).max(86400).default(60),
  offlineBufferSize: z.number().min(100).max(100000).default(10000),
  enableLocalProcessing: z.boolean().default(true),
  enableOfflineMode: z.boolean().default(true),
  enableAutoUpdate: z.boolean().default(false),
  maxDevices: z.number().min(1).max(10000).default(100),
  maxRules: z.number().min(1).max(1000).default(50),
  customSettings: z.record(z.unknown()).default({}),
  // RFC-0035: plural MQTT destinations. Additive in Phase 2 — legacy
  // mqttConfig (if present on the row) is NOT enforced here and is dropped
  // in Phase B. Up to 8 entries to cap row size; today only 4 ids exist.
  mqttIntegrations: z.array(CentralMqttIntegrationSchema).max(8).optional(),
});

// Location Schema
const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

// Create Central DTO
export const CreateCentralSchema = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  assetId: z.string().uuid(),
  name: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  serialNumber: z.string().min(1).max(100),
  type: z.enum(['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']),
  firmwareVersion: z.string().max(50).default('0.0.0'),
  softwareVersion: z.string().max(50).default('0.0.0'),
  // Radio channel of the central (integer 1..255, preferably above 90).
  frequency: z.number().int().min(1).max(255).default(60),
  config: CentralConfigSchema.optional(),
  location: LocationSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type CreateCentralDTO = z.infer<typeof CreateCentralSchema>;

// Update Central DTO
export const UpdateCentralSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().min(1).max(255).optional(),
  // serialNumber = logical Central ID (RFC-0005). Mutable for data
  // reconciliation (e.g. an ID mis-registered on import) — service enforces
  // per-tenant uniqueness. Physical hardware swaps still use POST /replace.
  serialNumber: z.string().min(1).max(100).optional(),
  type: z.enum(['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']).optional(),
  firmwareVersion: z.string().max(50).optional(),
  softwareVersion: z.string().max(50).optional(),
  frequency: z.number().int().min(1).max(255).optional(),
  config: CentralConfigSchema.partial().optional(),
  location: LocationSchema.optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateCentralDTO = z.infer<typeof UpdateCentralSchema>;

// Update Central Status DTO
export const UpdateCentralStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']),
  reason: z.string().max(500).optional(),
});

export type UpdateCentralStatusDTO = z.infer<typeof UpdateCentralStatusSchema>;

// Update Connection Status DTO (from heartbeat)
export const UpdateConnectionStatusSchema = z.object({
  connectionStatus: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']),
  stats: z
    .object({
      connectedDevices: z.number().min(0).optional(),
      activeRules: z.number().min(0).optional(),
      pendingSyncEvents: z.number().min(0).optional(),
      uptimeSeconds: z.number().min(0).optional(),
      cpuUsage: z.number().min(0).max(100).optional(),
      memoryUsage: z.number().min(0).max(100).optional(),
      diskUsage: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export type UpdateConnectionStatusDTO = z.infer<typeof UpdateConnectionStatusSchema>;

// List Centrals Filter
export const ListCentralsSchema = z.object({
  customerId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  type: z.enum(['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  connectionStatus: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']).optional(),
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListCentralsDTO = z.infer<typeof ListCentralsSchema>;
