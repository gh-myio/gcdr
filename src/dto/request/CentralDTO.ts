import { z } from 'zod';

// Central Config Schema
const CentralConfigSchema = z.object({
  ipAddress: z.string().ip().optional(),
  macAddress: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
    .optional(),
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
});

// Location Schema
const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

// Create Central DTO
export const CreateCentralSchema = z.object({
  customerId: z.string().uuid(),
  assetId: z.string().uuid(),
  name: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  serialNumber: z.string().min(1).max(100),
  type: z.enum(['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']),
  firmwareVersion: z.string().max(50).default('0.0.0'),
  softwareVersion: z.string().max(50).default('0.0.0'),
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
  type: z.enum(['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']).optional(),
  firmwareVersion: z.string().max(50).optional(),
  softwareVersion: z.string().max(50).optional(),
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
