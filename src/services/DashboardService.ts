import { auditLogRepository } from '../repositories/AuditLogRepository';
import { deviceRepository } from '../repositories/DeviceRepository';
import { ruleService } from './RuleService';

export interface AuditPeriodSummary {
  total: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
}

export interface DashboardSummary {
  rules: {
    total: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    enabled: number;
    disabled: number;
    recentlyTriggered24h: number;
  };
  audit: {
    last24h: AuditPeriodSummary;
    last72h: AuditPeriodSummary;
    lastWeek: AuditPeriodSummary;
    lastMonth: AuditPeriodSummary;
  };
  devices: {
    total: number;
    byConnectivity: Record<string, number>;
    health: {
      _note: string;
      healthy: number;
      degraded: number;
      critical: number;
      unknown: number;
    };
  };
  generatedAt: string;
}

class DashboardService {
  // A dashboard summary tolerates slight staleness, so cache it briefly per
  // tenant to spare the DB the full aggregation on every poll/refresh.
  private readonly cache = new Map<string, { at: number; data: DashboardSummary }>();
  private readonly cacheTtlMs = 30_000;

  async getSummary(tenantId: string): Promise<DashboardSummary> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.data;
    }

    const now = new Date();

    const [ruleStats, audit, deviceCounts] = await Promise.all([
      ruleService.getStatistics(tenantId),
      // All four windows (24h/72h/week/month) in one scan per metric.
      auditLogRepository.getDashboardAuditSummary(tenantId, now),
      deviceRepository.countByConnectivityStatus(tenantId),
    ]);

    const { last24h, last72h, lastWeek, lastMonth } = audit;

    const summary: DashboardSummary = {
      rules: {
        total: ruleStats.totalRules,
        byType: ruleStats.byType as unknown as Record<string, number>,
        byPriority: ruleStats.byPriority as unknown as Record<string, number>,
        enabled: ruleStats.enabledCount,
        disabled: ruleStats.disabledCount,
        recentlyTriggered24h: ruleStats.recentlyTriggered,
      },
      audit: {
        last24h,
        last72h,
        lastWeek,
        lastMonth,
      },
      devices: {
        total: deviceCounts.total,
        byConnectivity: deviceCounts.byConnectivity,
        // mock — health status not yet tracked; see suggestion below
        health: {
          _note:
            'mock data — device health not yet tracked. ' +
            'Suggested: add healthStatus (HEALTHY|DEGRADED|CRITICAL) column to devices table, ' +
            'written by the alarm-orchestrator or a periodic health-check service.',
          healthy: 0,
          degraded: 0,
          critical: 0,
          unknown: deviceCounts.total,
        },
      },
      generatedAt: now.toISOString(),
    };

    this.cache.set(tenantId, { at: Date.now(), data: summary });
    return summary;
  }
}

export const dashboardService = new DashboardService();
