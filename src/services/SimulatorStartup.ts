// =============================================================================
// Simulator Startup Service (RFC-0010)
// =============================================================================
//
// This service handles simulator initialization on server startup:
// 1. Recovers running sessions from database
// 2. Marks expired sessions
// 3. Registers queue processors
// 4. Sets up graceful shutdown
// =============================================================================

import { simulatorEngine } from './SimulatorEngine';
import { simulatorRepository } from '../repositories/SimulatorRepository';
import { simulatorQueueService, createDefaultProcessor } from './SimulatorQueueService';

/**
 * Startup result
 */
export interface SimulatorStartupResult {
  sessionsRecovered: number;
  sessionsExpired: number;
  queueProcessorRegistered: boolean;
}

/**
 * Initialize the simulator subsystem on server startup
 */
export async function initializeSimulator(): Promise<SimulatorStartupResult> {
  console.log('[Simulator] Initializing simulator subsystem...');

  try {
    // 1. Mark any expired sessions in database
    const sessionsExpired = await simulatorRepository.markExpiredSessions();
    if (sessionsExpired > 0) {
      console.log(`[Simulator] Marked ${sessionsExpired} expired sessions`);
    }

    // 2. Register queue processor
    const processor = createDefaultProcessor();
    simulatorQueueService.registerProcessor(processor);

    // 3. Wire up simulator engine to queue service
    simulatorEngine.setAlarmCandidateHandler(async (candidate) => {
      await simulatorQueueService.addSimulatedAlarmCandidate(candidate);
    });

    // 4. Recover running sessions from database
    const sessionsRecovered = await simulatorEngine.recoverSessions();
    if (sessionsRecovered > 0) {
      console.log(`[Simulator] Recovered ${sessionsRecovered} running sessions`);
    }

    console.log('[Simulator] Simulator subsystem initialized successfully');

    return {
      sessionsRecovered,
      sessionsExpired,
      queueProcessorRegistered: true,
    };
  } catch (error) {
    console.error('[Simulator] Failed to initialize simulator subsystem', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Graceful shutdown handler for simulator
 */
export async function shutdownSimulator(): Promise<void> {
  console.log('[Simulator] Shutting down simulator subsystem...');

  try {
    // Stop all active sessions
    await simulatorEngine.stopAllSessions('SERVER_SHUTDOWN');
    console.log('[Simulator] All sessions stopped');

    // Clear queue caches
    simulatorQueueService.clearQueue();
    console.log('[Simulator] Queue cleared');

    console.log('[Simulator] Simulator subsystem shut down successfully');
  } catch (error) {
    console.error('[Simulator] Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Register shutdown handlers
 */
export function registerShutdownHandlers(): void {
  const handleShutdown = async (signal: string) => {
    console.log(`[Simulator] Received ${signal}, initiating graceful shutdown...`);
    try {
      await shutdownSimulator();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

/**
 * Periodic cleanup of old sessions and events
 * Call this from a scheduled job (e.g., cron)
 */
export async function cleanupOldSimulatorData(
  sessionRetentionDays: number = 30,
  eventRetentionDays: number = 7
): Promise<{ sessionsDeleted: number; eventsDeleted: number }> {
  console.log('[Simulator] Running cleanup job...');

  // First, mark any newly expired sessions
  await simulatorRepository.markExpiredSessions();

  // Delete old events
  const eventsDeleted = await simulatorRepository.deleteOldEvents(eventRetentionDays);

  // Delete old sessions (which cascades to remaining events)
  const sessionsDeleted = await simulatorRepository.deleteOldSessions(sessionRetentionDays);

  console.log(`[Simulator] Cleanup complete: ${sessionsDeleted} sessions, ${eventsDeleted} events deleted`);

  return { sessionsDeleted, eventsDeleted };
}
