// =============================================================================
// Simulator Queue Service (RFC-0010)
// =============================================================================
//
// This service provides queue isolation for simulator alarm candidates.
// In MVP, it uses an in-memory event-based approach.
// Later, this can be replaced with BullMQ for production use.
//
// Queue naming convention:
// - Production: alarm-candidates
// - Simulation: alarm-candidates:simulated
// =============================================================================

import { EventEmitter } from 'events';
import { SimulatorAlarmCandidate } from '../domain/entities/Simulator';

/**
 * Queue names for isolation
 */
export const QUEUE_NAMES = {
  PRODUCTION: 'alarm-candidates',
  SIMULATED: 'alarm-candidates:simulated',
} as const;

/**
 * Queue job status
 */
export type QueueJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Queue job wrapper
 */
export interface QueueJob<T> {
  id: string;
  data: T;
  status: QueueJobStatus;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
  attempts: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  queueName: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
}

/**
 * Job processor function type
 */
export type JobProcessor<T> = (job: QueueJob<T>) => Promise<void>;

/**
 * In-memory queue implementation for simulator alarm candidates
 * Provides isolation between simulated and production queues
 */
export class SimulatorQueueService extends EventEmitter {
  // In-memory queues
  private queues: Map<string, QueueJob<SimulatorAlarmCandidate>[]> = new Map();

  // Job processors
  private processors: Map<string, JobProcessor<SimulatorAlarmCandidate>> = new Map();

  // Statistics
  private stats: Map<string, { completed: number; failed: number }> = new Map();

  // Processing flag
  private isProcessing: Map<string, boolean> = new Map();

  constructor() {
    super();
    // Initialize queues
    this.queues.set(QUEUE_NAMES.SIMULATED, []);
    this.stats.set(QUEUE_NAMES.SIMULATED, { completed: 0, failed: 0 });
    this.isProcessing.set(QUEUE_NAMES.SIMULATED, false);
  }

  /**
   * Add a job to the simulated queue
   */
  async addSimulatedAlarmCandidate(candidate: SimulatorAlarmCandidate): Promise<string> {
    const job: QueueJob<SimulatorAlarmCandidate> = {
      id: `sim_job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      data: candidate,
      status: 'pending',
      createdAt: new Date(),
      attempts: 0,
    };

    const queue = this.queues.get(QUEUE_NAMES.SIMULATED)!;
    queue.push(job);

    this.emit('job:added', QUEUE_NAMES.SIMULATED, job.id);
    console.log('[SimulatorQueue] Job added to simulated queue', {
      jobId: job.id,
      sessionId: candidate.source.simulationId,
    });

    // Trigger processing if not already running
    this.processQueue(QUEUE_NAMES.SIMULATED);

    return job.id;
  }

  /**
   * Register a processor for the simulated queue
   */
  registerProcessor(processor: JobProcessor<SimulatorAlarmCandidate>): void {
    this.processors.set(QUEUE_NAMES.SIMULATED, processor);
    console.log('[SimulatorQueue] Processor registered for simulated queue');

    // Start processing if there are pending jobs
    this.processQueue(QUEUE_NAMES.SIMULATED);
  }

  /**
   * Process jobs in a queue
   */
  private async processQueue(queueName: string): Promise<void> {
    if (this.isProcessing.get(queueName)) {
      return;
    }

    const processor = this.processors.get(queueName);
    if (!processor) {
      return;
    }

    const queue = this.queues.get(queueName);
    if (!queue || queue.length === 0) {
      return;
    }

    this.isProcessing.set(queueName, true);

    try {
      while (queue.length > 0) {
        const job = queue[0];

        if (job.status !== 'pending') {
          queue.shift();
          continue;
        }

        job.status = 'processing';
        job.processedAt = new Date();
        job.attempts++;

        this.emit('job:processing', queueName, job.id);

        try {
          await processor(job);
          job.status = 'completed';
          job.completedAt = new Date();

          const stats = this.stats.get(queueName)!;
          stats.completed++;

          this.emit('job:completed', queueName, job.id);
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);

          const stats = this.stats.get(queueName)!;
          stats.failed++;

          this.emit('job:failed', queueName, job.id, error);
          console.error('[SimulatorQueue] Job processing failed', {
            jobId: job.id,
            error: job.error,
          });
        }

        // Remove processed job from queue
        queue.shift();
      }
    } finally {
      this.isProcessing.set(queueName, false);
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(queueName: string = QUEUE_NAMES.SIMULATED): QueueStats {
    const queue = this.queues.get(queueName) || [];
    const stats = this.stats.get(queueName) || { completed: 0, failed: 0 };

    const pending = queue.filter((j) => j.status === 'pending').length;
    const processing = queue.filter((j) => j.status === 'processing').length;

    return {
      queueName,
      pending,
      processing,
      completed: stats.completed,
      failed: stats.failed,
      totalProcessed: stats.completed + stats.failed,
    };
  }

  /**
   * Get all queue statistics
   */
  getAllQueueStats(): QueueStats[] {
    return Array.from(this.queues.keys()).map((name) => this.getQueueStats(name));
  }

  /**
   * Get recent jobs from a queue
   */
  getRecentJobs(
    queueName: string = QUEUE_NAMES.SIMULATED,
    limit: number = 10
  ): QueueJob<SimulatorAlarmCandidate>[] {
    const queue = this.queues.get(queueName) || [];
    return queue.slice(-limit);
  }

  /**
   * Clear completed/failed jobs from queue
   */
  clearProcessedJobs(queueName: string = QUEUE_NAMES.SIMULATED): number {
    const queue = this.queues.get(queueName);
    if (!queue) return 0;

    const before = queue.length;
    const pending = queue.filter((j) => j.status === 'pending' || j.status === 'processing');
    this.queues.set(queueName, pending);

    return before - pending.length;
  }

  /**
   * Clear all jobs from queue
   */
  clearQueue(queueName: string = QUEUE_NAMES.SIMULATED): number {
    const queue = this.queues.get(queueName);
    if (!queue) return 0;

    const count = queue.length;
    this.queues.set(queueName, []);
    return count;
  }

  /**
   * Check if queue is empty
   */
  isQueueEmpty(queueName: string = QUEUE_NAMES.SIMULATED): boolean {
    const queue = this.queues.get(queueName);
    return !queue || queue.length === 0;
  }

  /**
   * Get pending job count
   */
  getPendingCount(queueName: string = QUEUE_NAMES.SIMULATED): number {
    const queue = this.queues.get(queueName) || [];
    return queue.filter((j) => j.status === 'pending').length;
  }
}

// Export singleton instance
export const simulatorQueueService = new SimulatorQueueService();

/**
 * Default processor that logs alarm candidates
 * In production, this would send to an external system
 */
export function createDefaultProcessor(): JobProcessor<SimulatorAlarmCandidate> {
  return async (job) => {
    const candidate = job.data;
    console.log('[SimulatorQueue] Processing alarm candidate', {
      jobId: job.id,
      fingerprint: candidate.fingerprint,
      sessionId: candidate.source.simulationId,
      deviceId: candidate.source.deviceId,
      ruleId: candidate.rule.id,
      severity: candidate.rule.severity,
    });

    // In MVP, just log the candidate
    // In production, this would:
    // 1. Validate the candidate
    // 2. Check deduplication
    // 3. Create alarm in database or send to external system
  };
}
