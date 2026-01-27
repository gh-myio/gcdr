import { z } from 'zod';

// =============================================================================
// Simulator DTOs (RFC-0010)
// =============================================================================

/**
 * Telemetry profile for simulated device
 */
const TelemetryProfileSchema = z.object({
  min: z.number(),
  max: z.number(),
  unit: z.string(),
});

/**
 * Simulated device configuration
 */
const SimulatedDeviceConfigSchema = z.object({
  deviceId: z.string().uuid('Device ID must be a valid UUID'),
  telemetryProfile: z.record(TelemetryProfileSchema),
});

/**
 * Start simulation request
 */
export const StartSimulationSchema = z.object({
  name: z.string().min(1).max(100, 'Name must be at most 100 characters'),
  bundleRefreshIntervalMs: z
    .number()
    .int()
    .min(30000, 'Bundle refresh interval must be at least 30 seconds')
    .default(300000), // 5 minutes default
  deviceScanIntervalMs: z
    .number()
    .int()
    .min(10000, 'Device scan interval must be at least 10 seconds')
    .default(60000), // 1 minute default
  devices: z
    .array(SimulatedDeviceConfigSchema)
    .min(1, 'At least one device is required')
    .max(200, 'Maximum 200 devices per session'),
  customerId: z.string().uuid('Customer ID must be a valid UUID'),
});

export type StartSimulationInput = z.infer<typeof StartSimulationSchema>;

/**
 * Stop simulation request
 */
export const StopSimulationSchema = z.object({
  reason: z.string().max(255).optional(),
});

export type StopSimulationInput = z.infer<typeof StopSimulationSchema>;

/**
 * List sessions query parameters
 */
export const ListSessionsQuerySchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'STOPPED', 'EXPIRED', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;

/**
 * List events query parameters
 */
export const ListEventsQuerySchema = z.object({
  eventType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

/**
 * Session ID parameter
 */
export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});

export type SessionIdParam = z.infer<typeof SessionIdParamSchema>;
