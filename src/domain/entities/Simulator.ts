// =============================================================================
// Simulator Entities (RFC-0010)
// =============================================================================

/**
 * Simulator session status
 */
export type SimulatorSessionStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'EXPIRED' | 'ERROR';

/**
 * Telemetry profile for a simulated device
 */
export interface TelemetryProfile {
  min: number;
  max: number;
  unit: string;
}

/**
 * Simulated device configuration
 */
export interface SimulatedDeviceConfig {
  deviceId: string;
  telemetryProfile: Record<string, TelemetryProfile>;
}

/**
 * Simulator session configuration
 */
export interface SimulatorConfig {
  bundleRefreshIntervalMs: number;
  deviceScanIntervalMs: number;
  devices: SimulatedDeviceConfig[];
  customerId: string;

  // Scenario Builder fields (RFC-0014)
  centralIds?: string[];
  ruleIds?: string[];
  sessionDurationHours?: number;
  description?: string;
}

/**
 * Simulator quotas configuration
 */
export interface SimulatorQuotas {
  maxConcurrentSessions: number;
  minScanIntervalMs: number;
  minBundleRefreshIntervalMs: number;
  maxDevicesPerSession: number;
  maxScansPerHour: number;
  sessionExpireHours: number;
}

/**
 * Default quotas for standard users
 */
export const DEFAULT_QUOTAS: SimulatorQuotas = {
  maxConcurrentSessions: 3,
  minScanIntervalMs: 30_000,
  minBundleRefreshIntervalMs: 60_000,
  maxDevicesPerSession: 50,
  maxScansPerHour: 1_000,
  sessionExpireHours: 24,
};

/**
 * Premium quotas for premium users
 */
export const PREMIUM_QUOTAS: SimulatorQuotas = {
  maxConcurrentSessions: 10,
  minScanIntervalMs: 10_000,
  minBundleRefreshIntervalMs: 30_000,
  maxDevicesPerSession: 200,
  maxScansPerHour: 10_000,
  sessionExpireHours: 72,
};

/**
 * Simulator session entity
 */
export interface SimulatorSession {
  id: string;
  tenantId: string;
  customerId: string;
  createdBy: string;

  name: string;
  status: SimulatorSessionStatus;

  config: SimulatorConfig;

  // Quotas tracking
  scansCount: number;
  scansLimit: number;

  // Bundle state
  bundleVersion?: string;
  bundleSignature?: string;
  bundleFetchedAt?: Date;

  // Statistics
  alarmsTriggeredCount: number;
  lastScanAt?: Date;

  // Lifecycle
  startedAt?: Date;
  expiresAt: Date;
  stoppedAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Simulator event types
 */
export type SimulatorEventType =
  | 'BUNDLE_FETCHED'
  | 'BUNDLE_UNCHANGED'
  | 'DEVICE_SCANNED'
  | 'RULE_EVALUATED'
  | 'ALARM_CANDIDATE_RAISED'
  | 'ALARM_CREATED'
  | 'QUOTA_WARNING'
  | 'SESSION_STARTED'
  | 'SESSION_STOPPED'
  | 'SESSION_EXPIRED'
  | 'SESSION_ERROR';

/**
 * Simulator event entity
 */
export interface SimulatorEvent {
  id: string;
  sessionId: string;
  eventType: SimulatorEventType;
  eventData: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Bundle fetched event data
 */
export interface BundleFetchedEventData {
  version: string;
  signature: string;
  rulesCount: number;
  devicesCount: number;
}

/**
 * Device scanned event data
 */
export interface DeviceScannedEventData {
  deviceId: string;
  deviceIdentifier: string;
  telemetry: Record<string, number>;
}

/**
 * Alarm candidate raised event data
 */
export interface AlarmCandidateRaisedEventData {
  fingerprint: string;
  deviceId: string;
  deviceIdentifier: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  field: string;
  value: number;
  threshold: number;
  operator: string;
}

/**
 * Create simulator session input
 */
export interface CreateSimulatorSessionInput {
  tenantId: string;
  customerId: string;
  createdBy: string;
  name: string;
  config: SimulatorConfig;
  scansLimit: number;
  expiresAt: Date;
}

/**
 * Simulator session with computed fields
 */
export interface SimulatorSessionWithStats extends SimulatorSession {
  scansRemaining: number;
  sessionExpiresIn: number; // seconds
  isExpired: boolean;
}

/**
 * Compute stats for a session
 */
export function computeSessionStats(session: SimulatorSession): SimulatorSessionWithStats {
  const now = new Date();
  const expiresIn = Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));

  return {
    ...session,
    scansRemaining: Math.max(0, session.scansLimit - session.scansCount),
    sessionExpiresIn: expiresIn,
    isExpired: session.expiresAt < now,
  };
}

/**
 * Alarm candidate event for the queue
 */
export interface SimulatorAlarmCandidate {
  // Identification
  fingerprint: string;
  tenantId: string;
  customerId: string;

  // Source - identifies as simulator
  source: {
    type: 'SIMULATOR';
    simulationId: string;
    deviceId: string;
    deviceIdentifier: string;
    centralId?: string;
  };

  // Rule that triggered
  rule: {
    id: string;
    name: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
  };

  // Telemetry snapshot
  telemetry: {
    field: string;
    value: number;
    threshold: number;
    operator: string;
    timestamp: string;
  };

  // Metadata
  metadata: {
    simulated: true;
    simulatedAt: string;
    bundleVersion: string;
    sessionName: string;
  };
}
