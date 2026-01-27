// =============================================================================
// Simulator Metrics Service (RFC-0010)
// =============================================================================
//
// Provides observability metrics for the simulator subsystem:
// - Session counts (active, total)
// - Scan rates
// - Alarm candidate counts
// - Bundle fetch statistics
// - Queue statistics
//
// For MVP, metrics are collected in-memory. Later can be integrated with
// Prometheus, CloudWatch, or other metrics systems.
// =============================================================================

import { simulatorRepository } from '../repositories/SimulatorRepository';
import { simulatorEngine } from './SimulatorEngine';
import { simulatorQueueService } from './SimulatorQueueService';
import { simulatorMonitorService } from './SimulatorMonitor';

/**
 * Metrics snapshot
 */
export interface SimulatorMetrics {
  timestamp: string;

  // Session metrics
  sessions: {
    active: number;
    total: {
      pending: number;
      running: number;
      stopped: number;
      expired: number;
      error: number;
    };
  };

  // Processing metrics
  processing: {
    scansPerformed: number;
    alarmsTriggered: number;
  };

  // Queue metrics
  queue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };

  // Monitor metrics
  monitor: {
    connectedClients: number;
  };

  // System health
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
  };
}

/**
 * Counter for tracking cumulative metrics
 */
interface MetricsCounters {
  totalScans: number;
  totalAlarms: number;
  totalSessions: number;
  bundleFetches: number;
  bundleUnchanged: number;
  errors: number;
}

/**
 * Simulator Metrics Service
 */
export class SimulatorMetricsService {
  private counters: MetricsCounters = {
    totalScans: 0,
    totalAlarms: 0,
    totalSessions: 0,
    bundleFetches: 0,
    bundleUnchanged: 0,
    errors: 0,
  };

  private startTime: Date = new Date();

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for metrics collection
   */
  private setupEventListeners(): void {
    // Listen to simulator engine events
    simulatorEngine.on('session:started', () => {
      this.counters.totalSessions++;
    });

    simulatorEngine.on('device:scanned', () => {
      this.counters.totalScans++;
    });

    simulatorEngine.on('alarm:candidate', () => {
      this.counters.totalAlarms++;
    });

    simulatorEngine.on('bundle:fetched', (_sessionId: string, _version: string, isUpdated: boolean) => {
      if (isUpdated) {
        this.counters.bundleFetches++;
      } else {
        this.counters.bundleUnchanged++;
      }
    });

    simulatorEngine.on('session:error', () => {
      this.counters.errors++;
    });
  }

  /**
   * Get current metrics snapshot
   */
  async getMetrics(): Promise<SimulatorMetrics> {
    // Get session counts from database
    const [pendingCount, runningCount, stoppedCount, expiredCount, errorCount] = await Promise.all([
      this.countSessionsByStatus('PENDING'),
      this.countSessionsByStatus('RUNNING'),
      this.countSessionsByStatus('STOPPED'),
      this.countSessionsByStatus('EXPIRED'),
      this.countSessionsByStatus('ERROR'),
    ]);

    // Get queue stats
    const queueStats = simulatorQueueService.getAllQueueStats();
    const simulatedQueueStats = queueStats.find((q) => q.queueName === 'alarm-candidates:simulated') || {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    // Determine health status
    const health = this.calculateHealthStatus(runningCount, errorCount, simulatedQueueStats.failed);

    return {
      timestamp: new Date().toISOString(),
      sessions: {
        active: simulatorEngine.getActiveSessionIds().length,
        total: {
          pending: pendingCount,
          running: runningCount,
          stopped: stoppedCount,
          expired: expiredCount,
          error: errorCount,
        },
      },
      processing: {
        scansPerformed: this.counters.totalScans,
        alarmsTriggered: this.counters.totalAlarms,
      },
      queue: {
        pending: simulatedQueueStats.pending,
        processing: simulatedQueueStats.processing,
        completed: simulatedQueueStats.completed,
        failed: simulatedQueueStats.failed,
      },
      monitor: {
        connectedClients: simulatorMonitorService.getClientCount(),
      },
      health,
    };
  }

  /**
   * Get counters (cumulative metrics)
   */
  getCounters(): MetricsCounters & { uptimeSeconds: number } {
    return {
      ...this.counters,
      uptimeSeconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };
  }

  /**
   * Count sessions by status
   */
  private async countSessionsByStatus(
    status: 'PENDING' | 'RUNNING' | 'STOPPED' | 'EXPIRED' | 'ERROR'
  ): Promise<number> {
    // Note: This is a simplified implementation. In production,
    // consider adding specific count methods to the repository.
    try {
      // For active count, we can use the existing method
      if (status === 'RUNNING') {
        // Use internal method to count across all tenants (for admin metrics)
        const sessions = await simulatorRepository.findRunningSessions();
        return sessions.length;
      }
      // For other statuses, we'd need additional repository methods
      // For MVP, return 0 for non-running statuses
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate health status
   */
  private calculateHealthStatus(
    runningCount: number,
    errorCount: number,
    queueFailed: number
  ): SimulatorMetrics['health'] {
    const issues: string[] = [];

    // Check for high error rate
    if (errorCount > 0 && this.counters.totalSessions > 0) {
      const errorRate = errorCount / this.counters.totalSessions;
      if (errorRate > 0.1) {
        issues.push(`High error rate: ${Math.round(errorRate * 100)}%`);
      }
    }

    // Check for queue failures
    if (queueFailed > 10) {
      issues.push(`Queue has ${queueFailed} failed jobs`);
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (issues.length > 2) {
      status = 'unhealthy';
    } else if (issues.length > 0) {
      status = 'degraded';
    }

    return { status, issues };
  }

  /**
   * Reset counters (for testing)
   */
  resetCounters(): void {
    this.counters = {
      totalScans: 0,
      totalAlarms: 0,
      totalSessions: 0,
      bundleFetches: 0,
      bundleUnchanged: 0,
      errors: 0,
    };
    this.startTime = new Date();
  }
}

// Export singleton instance
export const simulatorMetricsService = new SimulatorMetricsService();
