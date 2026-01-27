// =============================================================================
// Simulator Quota Service (RFC-0010)
// =============================================================================

import {
  SimulatorQuotas,
  DEFAULT_QUOTAS,
  PREMIUM_QUOTAS,
  SimulatorConfig,
} from '../domain/entities/Simulator';
import { SimulatorRepository } from '../repositories/SimulatorRepository';

/**
 * Quota validation result
 */
export interface QuotaValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: QuotaErrorCode;
  quota?: Partial<SimulatorQuotas>;
}

/**
 * Quota error codes for API responses
 */
export type QuotaErrorCode =
  | 'MAX_SESSIONS_EXCEEDED'
  | 'MIN_SCAN_INTERVAL_VIOLATION'
  | 'MIN_BUNDLE_REFRESH_VIOLATION'
  | 'MAX_DEVICES_EXCEEDED'
  | 'MAX_SCANS_EXCEEDED'
  | 'SESSION_EXPIRED';

/**
 * Service to enforce simulator quotas and rate limits
 */
export class SimulatorQuotaService {
  private repository: SimulatorRepository;

  constructor(repository: SimulatorRepository) {
    this.repository = repository;
  }

  /**
   * Get quotas for a tenant
   * In MVP, we use default quotas for all tenants
   * Premium upgrade can be implemented via feature flags or customer attributes
   */
  async getQuotasForTenant(tenantId: string): Promise<SimulatorQuotas> {
    // TODO: Check if tenant has premium feature enabled
    // For now, use isPremiumTenant method to determine quota tier
    const isPremium = await this.isPremiumTenant(tenantId);
    return isPremium ? PREMIUM_QUOTAS : DEFAULT_QUOTAS;
  }

  /**
   * Check if tenant has premium simulator access
   * Override this method to implement custom premium check logic
   */
  async isPremiumTenant(_tenantId: string): Promise<boolean> {
    // TODO: Implement premium check via:
    // - Customer subscription status
    // - Feature flags
    // - Partner settings
    // For MVP, all tenants use default quotas
    return false;
  }

  /**
   * Validate if a new session can be created
   */
  async validateNewSession(tenantId: string, config: SimulatorConfig): Promise<QuotaValidationResult> {
    const quotas = await this.getQuotasForTenant(tenantId);

    // Check concurrent sessions limit
    const activeSessionCount = await this.repository.countActiveSessionsByTenant(tenantId);
    if (activeSessionCount >= quotas.maxConcurrentSessions) {
      return {
        valid: false,
        error: `Maximum concurrent sessions (${quotas.maxConcurrentSessions}) exceeded. You have ${activeSessionCount} active sessions.`,
        errorCode: 'MAX_SESSIONS_EXCEEDED',
        quota: { maxConcurrentSessions: quotas.maxConcurrentSessions },
      };
    }

    // Check devices per session limit
    if (config.devices.length > quotas.maxDevicesPerSession) {
      return {
        valid: false,
        error: `Maximum devices per session (${quotas.maxDevicesPerSession}) exceeded. Requested: ${config.devices.length}`,
        errorCode: 'MAX_DEVICES_EXCEEDED',
        quota: { maxDevicesPerSession: quotas.maxDevicesPerSession },
      };
    }

    // Check minimum scan interval
    if (config.deviceScanIntervalMs < quotas.minScanIntervalMs) {
      return {
        valid: false,
        error: `Scan interval (${config.deviceScanIntervalMs}ms) is below minimum (${quotas.minScanIntervalMs}ms)`,
        errorCode: 'MIN_SCAN_INTERVAL_VIOLATION',
        quota: { minScanIntervalMs: quotas.minScanIntervalMs },
      };
    }

    // Check minimum bundle refresh interval
    if (config.bundleRefreshIntervalMs < quotas.minBundleRefreshIntervalMs) {
      return {
        valid: false,
        error: `Bundle refresh interval (${config.bundleRefreshIntervalMs}ms) is below minimum (${quotas.minBundleRefreshIntervalMs}ms)`,
        errorCode: 'MIN_BUNDLE_REFRESH_VIOLATION',
        quota: { minBundleRefreshIntervalMs: quotas.minBundleRefreshIntervalMs },
      };
    }

    return { valid: true };
  }

  /**
   * Check if a scan can be performed (hourly quota)
   */
  async canPerformScan(
    tenantId: string,
    sessionId: string,
    currentScansInHour: number
  ): Promise<QuotaValidationResult> {
    const quotas = await this.getQuotasForTenant(tenantId);

    if (currentScansInHour >= quotas.maxScansPerHour) {
      return {
        valid: false,
        error: `Maximum scans per hour (${quotas.maxScansPerHour}) exceeded`,
        errorCode: 'MAX_SCANS_EXCEEDED',
        quota: { maxScansPerHour: quotas.maxScansPerHour },
      };
    }

    // Check session expiration
    const session = await this.repository.getSessionById(tenantId, sessionId);
    if (!session) {
      return {
        valid: false,
        error: 'Session not found',
        errorCode: 'SESSION_EXPIRED',
      };
    }

    if (session.expiresAt < new Date()) {
      return {
        valid: false,
        error: 'Session has expired',
        errorCode: 'SESSION_EXPIRED',
      };
    }

    return { valid: true };
  }

  /**
   * Calculate session expiration based on quotas
   */
  async calculateSessionExpiration(tenantId: string): Promise<Date> {
    const quotas = await this.getQuotasForTenant(tenantId);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + quotas.sessionExpireHours);
    return expiresAt;
  }

  /**
   * Calculate maximum scans limit for a session
   */
  async calculateScansLimit(tenantId: string): Promise<number> {
    const quotas = await this.getQuotasForTenant(tenantId);
    // Session limit = hourly limit * session duration in hours
    return quotas.maxScansPerHour * quotas.sessionExpireHours;
  }

  /**
   * Get quota summary for display
   */
  async getQuotaSummary(tenantId: string): Promise<{
    quotas: SimulatorQuotas;
    isPremium: boolean;
    activeSessions: number;
    availableSessions: number;
  }> {
    const quotas = await this.getQuotasForTenant(tenantId);
    const isPremium = await this.isPremiumTenant(tenantId);
    const activeSessions = await this.repository.countActiveSessionsByTenant(tenantId);

    return {
      quotas,
      isPremium,
      activeSessions,
      availableSessions: Math.max(0, quotas.maxConcurrentSessions - activeSessions),
    };
  }

  /**
   * Normalize configuration to respect quotas
   * Adjusts intervals to meet minimum requirements
   */
  async normalizeConfig(tenantId: string, config: SimulatorConfig): Promise<SimulatorConfig> {
    const quotas = await this.getQuotasForTenant(tenantId);

    return {
      ...config,
      deviceScanIntervalMs: Math.max(config.deviceScanIntervalMs, quotas.minScanIntervalMs),
      bundleRefreshIntervalMs: Math.max(config.bundleRefreshIntervalMs, quotas.minBundleRefreshIntervalMs),
      devices: config.devices.slice(0, quotas.maxDevicesPerSession),
    };
  }
}

// Export singleton instance
import { simulatorRepository } from '../repositories/SimulatorRepository';
export const simulatorQuotaService = new SimulatorQuotaService(simulatorRepository);
