// =============================================================================
// Simulator Engine (RFC-0010)
// =============================================================================

import { EventEmitter } from 'events';
import {
  SimulatorSession,
  SimulatorConfig,
  SimulatedDeviceConfig,
  TelemetryProfile,
  SimulatorAlarmCandidate,
  DeviceScannedEventData,
  AlarmCandidateRaisedEventData,
  CreateSimulatorSessionInput,
} from '../domain/entities/Simulator';
import { SimpleAlarmRulesBundle, SimpleBundleAlarmRule } from '../domain/entities/AlarmBundle';
import { SimulatorRepository } from '../repositories/SimulatorRepository';
import { SimulatorBundleFetcher } from './SimulatorBundleFetcher';
import { SimulatorQuotaService } from './SimulatorQuotaService';

/**
 * Active simulation session with timers
 */
interface ActiveSession {
  session: SimulatorSession;
  config: SimulatorConfig;
  bundleRefreshTimer?: NodeJS.Timeout;
  deviceScanTimer?: NodeJS.Timeout;
  scansThisHour: number;
  hourStartTime: number;
}

/**
 * Simulation engine events
 */
export interface SimulatorEngineEvents {
  'session:started': (sessionId: string) => void;
  'session:stopped': (sessionId: string, reason: string) => void;
  'session:expired': (sessionId: string) => void;
  'session:error': (sessionId: string, error: Error) => void;
  'bundle:fetched': (sessionId: string, version: string, isUpdated: boolean) => void;
  'device:scanned': (sessionId: string, deviceId: string, telemetry: Record<string, number>) => void;
  'alarm:candidate': (sessionId: string, candidate: SimulatorAlarmCandidate) => void;
}

/**
 * Core simulation engine that manages all active simulations
 */
export class SimulatorEngine extends EventEmitter {
  private repository: SimulatorRepository;
  private bundleFetcher: SimulatorBundleFetcher;
  private quotaService: SimulatorQuotaService;

  // Active sessions keyed by session ID
  private activeSessions: Map<string, ActiveSession> = new Map();

  // Callback for alarm candidates (to be set by queue service)
  private alarmCandidateHandler?: (candidate: SimulatorAlarmCandidate) => Promise<void>;

  constructor(
    repository: SimulatorRepository,
    bundleFetcher: SimulatorBundleFetcher,
    quotaService: SimulatorQuotaService
  ) {
    super();
    this.repository = repository;
    this.bundleFetcher = bundleFetcher;
    this.quotaService = quotaService;
  }

  /**
   * Set the handler for alarm candidates
   * This should be called by the queue service to route candidates
   */
  setAlarmCandidateHandler(handler: (candidate: SimulatorAlarmCandidate) => Promise<void>): void {
    this.alarmCandidateHandler = handler;
  }

  /**
   * Create and start a new simulation session
   */
  async startSession(
    tenantId: string,
    customerId: string,
    createdBy: string,
    name: string,
    config: SimulatorConfig
  ): Promise<SimulatorSession> {
    // Validate quotas before creating
    const validation = await this.quotaService.validateNewSession(tenantId, config);
    if (!validation.valid) {
      throw new Error(validation.error || 'Quota validation failed');
    }

    // Normalize config to respect quotas
    const normalizedConfig = await this.quotaService.normalizeConfig(tenantId, config);

    // Calculate expiration and scans limit
    const expiresAt = await this.quotaService.calculateSessionExpiration(tenantId);
    const scansLimit = await this.quotaService.calculateScansLimit(tenantId);

    // Create session input
    const input: CreateSimulatorSessionInput = {
      tenantId,
      customerId,
      createdBy,
      name,
      config: normalizedConfig,
      scansLimit,
      expiresAt,
    };

    console.log('[SimulatorEngine] Creating session with input:', JSON.stringify(input, null, 2));

    // Create session in database
    const session = await this.repository.createSession(input);

    try {
      // Initialize the session
      await this.initializeSession(session);

      // Log session started event
      await this.repository.createEvent(session.id, 'SESSION_STARTED', {
        name: session.name,
        config: normalizedConfig,
        expiresAt: expiresAt.toISOString(),
        scansLimit,
      });

      // Update status to RUNNING
      await this.repository.updateSessionStatus(session.id, 'RUNNING', {
        startedAt: new Date(),
      });

      // Update local session object
      session.status = 'RUNNING';
      session.startedAt = new Date();

      this.emit('session:started', session.id);
      console.log('[SimulatorEngine] Session started', { sessionId: session.id, name: session.name });

      return session;
    } catch (error) {
      // Cleanup on failure
      await this.repository.updateSessionStatus(session.id, 'ERROR');
      await this.repository.createEvent(session.id, 'SESSION_ERROR', {
        error: 'INITIALIZATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop a running simulation session
   */
  async stopSession(sessionId: string, reason: string = 'USER_REQUESTED'): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      console.warn('[SimulatorEngine] Session not active', { sessionId });
      return;
    }

    // Clear timers
    this.clearSessionTimers(active);

    // Update database
    await this.repository.updateSessionStatus(sessionId, 'STOPPED', {
      stoppedAt: new Date(),
    });

    // Log event
    await this.repository.createEvent(sessionId, 'SESSION_STOPPED', {
      reason,
      scansPerformed: active.session.scansCount,
      alarmsTriggered: active.session.alarmsTriggeredCount,
    });

    // Clear bundle cache
    this.bundleFetcher.clearCache(sessionId);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    this.emit('session:stopped', sessionId, reason);
    console.log('[SimulatorEngine] Session stopped', { sessionId, reason });
  }

  /**
   * Get active session info
   */
  getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Stop all active sessions (for shutdown)
   */
  async stopAllSessions(reason: string = 'SERVER_SHUTDOWN'): Promise<void> {
    const sessionIds = Array.from(this.activeSessions.keys());
    await Promise.all(sessionIds.map((id) => this.stopSession(id, reason)));
  }

  /**
   * Initialize a session with timers
   */
  private async initializeSession(session: SimulatorSession): Promise<void> {
    const config = session.config;

    // Create active session entry
    const active: ActiveSession = {
      session,
      config,
      scansThisHour: 0,
      hourStartTime: Date.now(),
    };

    this.activeSessions.set(session.id, active);

    // Fetch initial bundle
    await this.bundleFetcher.fetchBundle(session);

    // Start bundle refresh timer
    active.bundleRefreshTimer = setInterval(
      () => this.refreshBundle(session.id),
      config.bundleRefreshIntervalMs
    );

    // Start device scan timer
    active.deviceScanTimer = setInterval(
      () => this.scanDevices(session.id),
      config.deviceScanIntervalMs
    );
  }

  /**
   * Clear all timers for a session
   */
  private clearSessionTimers(active: ActiveSession): void {
    if (active.bundleRefreshTimer) {
      clearInterval(active.bundleRefreshTimer);
      active.bundleRefreshTimer = undefined;
    }
    if (active.deviceScanTimer) {
      clearInterval(active.deviceScanTimer);
      active.deviceScanTimer = undefined;
    }
  }

  /**
   * Refresh bundle for a session
   */
  private async refreshBundle(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    try {
      // Reload session from database to get latest state
      const session = await this.repository.getSessionByIdInternal(sessionId);
      if (!session || session.status !== 'RUNNING') {
        await this.stopSession(sessionId, 'SESSION_INVALID');
        return;
      }

      // Check expiration
      if (session.expiresAt < new Date()) {
        await this.expireSession(sessionId);
        return;
      }

      // Fetch bundle
      const result = await this.bundleFetcher.fetchBundle(session);
      this.emit('bundle:fetched', sessionId, result.meta.version, result.isUpdated);
    } catch (error) {
      console.error('[SimulatorEngine] Bundle refresh failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit('session:error', sessionId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Scan devices and evaluate rules
   */
  private async scanDevices(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    try {
      // Reset hourly counter if needed
      const now = Date.now();
      if (now - active.hourStartTime >= 3600000) {
        active.scansThisHour = 0;
        active.hourStartTime = now;
      }

      // Check quota
      const quotaCheck = await this.quotaService.canPerformScan(
        active.session.tenantId,
        sessionId,
        active.scansThisHour
      );

      if (!quotaCheck.valid) {
        if (quotaCheck.errorCode === 'SESSION_EXPIRED') {
          await this.expireSession(sessionId);
        } else {
          // Log quota warning
          await this.repository.createEvent(sessionId, 'QUOTA_WARNING', {
            errorCode: quotaCheck.errorCode,
            message: quotaCheck.error,
          });
        }
        return;
      }

      // Get cached bundle
      const bundle = this.bundleFetcher.getCachedBundle(sessionId);
      if (!bundle) {
        console.warn('[SimulatorEngine] No bundle cached, skipping scan', { sessionId });
        return;
      }

      // Scan each configured device
      for (const device of active.config.devices) {
        await this.scanDevice(sessionId, active, device, bundle);
      }

      // Increment scan count
      active.scansThisHour++;
      await this.repository.incrementScansCount(sessionId);
    } catch (error) {
      console.error('[SimulatorEngine] Device scan failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit('session:error', sessionId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Scan a single device and evaluate rules
   */
  private async scanDevice(
    sessionId: string,
    active: ActiveSession,
    device: SimulatedDeviceConfig,
    bundle: SimpleAlarmRulesBundle
  ): Promise<void> {
    // Generate telemetry
    const telemetry = this.generateTelemetry(device.telemetryProfile);

    // Log device scanned event
    const deviceMapping = bundle.deviceIndex[device.deviceId];
    const deviceIdentifier = deviceMapping?.deviceName || device.deviceId;

    await this.repository.createEvent(sessionId, 'DEVICE_SCANNED', {
      deviceId: device.deviceId,
      deviceIdentifier,
      telemetry,
    } satisfies DeviceScannedEventData);

    this.emit('device:scanned', sessionId, device.deviceId, telemetry);

    // Evaluate rules for this device (filter by scenario ruleIds if configured)
    if (deviceMapping) {
      const scenarioRuleIds = active.config.ruleIds;
      for (const ruleId of deviceMapping.ruleIds) {
        if (scenarioRuleIds && !scenarioRuleIds.includes(ruleId)) continue;
        const rule = bundle.rules[ruleId];
        if (rule) {
          await this.evaluateRule(sessionId, active, device, deviceIdentifier, rule, telemetry, bundle);
        }
      }
    }
  }

  /**
   * Generate simulated telemetry based on profile
   */
  private generateTelemetry(profile: Record<string, TelemetryProfile>): Record<string, number> {
    const telemetry: Record<string, number> = {};

    for (const [field, spec] of Object.entries(profile)) {
      // Generate random value within range
      const value = spec.min + Math.random() * (spec.max - spec.min);
      telemetry[field] = Math.round(value * 100) / 100; // Round to 2 decimal places
    }

    return telemetry;
  }

  /**
   * Evaluate a rule against telemetry
   */
  private async evaluateRule(
    sessionId: string,
    active: ActiveSession,
    device: SimulatedDeviceConfig,
    deviceIdentifier: string,
    rule: SimpleBundleAlarmRule,
    telemetry: Record<string, number>,
    bundle: SimpleAlarmRulesBundle
  ): Promise<void> {
    // Get the telemetry field that this rule monitors
    // The rule ID format is typically: {metric}_{deviceType}_{customerId}
    // But we need to extract the metric from the rule name or ID
    // For simplicity, we'll check all telemetry fields against the rule

    for (const [field, value] of Object.entries(telemetry)) {
      const triggered = this.checkThreshold(value, rule.value, rule.valueHigh);

      if (triggered) {
        // Generate alarm candidate
        const candidate: SimulatorAlarmCandidate = {
          fingerprint: `sim_${sessionId}_${device.deviceId}_${rule.id}_${Date.now()}`,
          tenantId: active.session.tenantId,
          customerId: active.session.customerId,
          source: {
            type: 'SIMULATOR',
            simulationId: sessionId,
            deviceId: device.deviceId,
            deviceIdentifier,
          },
          rule: {
            id: rule.id,
            name: rule.name,
            severity: 'WARNING', // Default severity for simulation
          },
          telemetry: {
            field,
            value,
            threshold: rule.value,
            operator: rule.valueHigh ? 'BETWEEN' : 'GT',
            timestamp: new Date().toISOString(),
          },
          metadata: {
            simulated: true,
            simulatedAt: new Date().toISOString(),
            bundleVersion: bundle.meta.version,
            sessionName: active.session.name,
          },
        };

        // Log alarm candidate event
        await this.repository.createEvent(sessionId, 'ALARM_CANDIDATE_RAISED', {
          fingerprint: candidate.fingerprint,
          deviceId: device.deviceId,
          deviceIdentifier,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'WARNING',
          field,
          value,
          threshold: rule.value,
          operator: rule.valueHigh ? 'BETWEEN' : 'GT',
        } satisfies AlarmCandidateRaisedEventData);

        // Increment alarms count
        await this.repository.incrementAlarmsCount(sessionId);

        // Emit event
        this.emit('alarm:candidate', sessionId, candidate);

        // Send to handler if available
        if (this.alarmCandidateHandler) {
          await this.alarmCandidateHandler(candidate);
        }

        console.log('[SimulatorEngine] Alarm candidate raised', {
          sessionId,
          deviceId: device.deviceId,
          ruleId: rule.id,
          field,
          value,
          threshold: rule.value,
        });

        // Only trigger one alarm per device per scan
        break;
      }
    }
  }

  /**
   * Check if a value triggers a threshold
   */
  private checkThreshold(value: number, threshold: number, thresholdHigh?: number): boolean {
    if (thresholdHigh !== undefined) {
      // Range check - outside the range triggers alarm
      return value < threshold || value > thresholdHigh;
    }
    // Simple threshold - above triggers alarm
    return value > threshold;
  }

  /**
   * Expire a session
   */
  private async expireSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    // Clear timers
    this.clearSessionTimers(active);

    // Update database
    await this.repository.updateSessionStatus(sessionId, 'EXPIRED', {
      stoppedAt: new Date(),
    });

    // Log event
    await this.repository.createEvent(sessionId, 'SESSION_EXPIRED', {
      scansPerformed: active.session.scansCount,
      alarmsTriggered: active.session.alarmsTriggeredCount,
    });

    // Clear bundle cache
    this.bundleFetcher.clearCache(sessionId);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    this.emit('session:expired', sessionId);
    console.log('[SimulatorEngine] Session expired', { sessionId });
  }

  /**
   * Recover sessions from database (after restart)
   */
  async recoverSessions(): Promise<number> {
    const runningSessions = await this.repository.findRunningSessions();
    let recovered = 0;

    for (const session of runningSessions) {
      try {
        // Check if session should be expired
        if (session.expiresAt < new Date()) {
          await this.repository.updateSessionStatus(session.id, 'EXPIRED', {
            stoppedAt: new Date(),
          });
          continue;
        }

        // Re-initialize the session
        await this.initializeSession(session);
        session.status = 'RUNNING';

        console.log('[SimulatorEngine] Session recovered', { sessionId: session.id });
        recovered++;
      } catch (error) {
        console.error('[SimulatorEngine] Failed to recover session', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.repository.updateSessionStatus(session.id, 'ERROR');
      }
    }

    return recovered;
  }
}

// Export singleton instance
import { simulatorRepository } from '../repositories/SimulatorRepository';
import { simulatorBundleFetcher } from './SimulatorBundleFetcher';
import { simulatorQuotaService } from './SimulatorQuotaService';
export const simulatorEngine = new SimulatorEngine(
  simulatorRepository,
  simulatorBundleFetcher,
  simulatorQuotaService
);
