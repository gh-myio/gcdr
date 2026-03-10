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
  async getSummary(tenantId: string): Promise<DashboardSummary> {
    const now = new Date();

    const periodFrom = (hours: number) =>
      new Date(now.getTime() - hours * 60 * 60 * 1000);

    const [ruleStats, auditPeriods, deviceCounts] = await Promise.all([
      ruleService.getStatistics(tenantId),
      Promise.all([
        auditLogRepository.getAuditPeriodSummary(tenantId, periodFrom(24), now),
        auditLogRepository.getAuditPeriodSummary(tenantId, periodFrom(72), now),
        auditLogRepository.getAuditPeriodSummary(tenantId, periodFrom(168), now),
        auditLogRepository.getAuditPeriodSummary(tenantId, periodFrom(720), now),
      ]),
      deviceRepository.countByConnectivityStatus(tenantId),
    ]);

    const [last24h, last72h, lastWeek, lastMonth] = auditPeriods;

    return {
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
  }
}

export const dashboardService = new DashboardService();
