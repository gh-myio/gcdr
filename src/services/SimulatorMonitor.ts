// =============================================================================
// Simulator Monitor Service (RFC-0010)
// =============================================================================
//
// Provides real-time monitoring of simulation sessions using Server-Sent Events (SSE).
// SSE is simpler than WebSocket and works well for server-to-client streaming.
//
// Endpoints:
// - GET /simulator/:sessionId/monitor - SSE stream for session events
// =============================================================================

import { Response } from 'express';
import { simulatorEngine, SimulatorEngineEvents } from './SimulatorEngine';
import { SimulatorAlarmCandidate } from '../domain/entities/Simulator';

/**
 * Monitor event types sent to clients
 */
export type MonitorEventType =
  | 'connected'
  | 'session:started'
  | 'session:stopped'
  | 'session:expired'
  | 'session:error'
  | 'bundle:fetched'
  | 'device:scanned'
  | 'alarm:candidate'
  | 'heartbeat';

/**
 * Monitor event payload
 */
export interface MonitorEvent {
  type: MonitorEventType;
  timestamp: string;
  sessionId?: string;
  data?: unknown;
}

/**
 * Active SSE client connection
 */
interface SSEClient {
  id: string;
  sessionId: string;
  response: Response;
  connectedAt: Date;
}

/**
 * Simulator Monitor Service
 * Manages SSE connections and broadcasts events to clients
 */
export class SimulatorMonitorService {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor() {
    // Will be initialized when first client connects
  }

  /**
   * Initialize event listeners
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Listen to simulator engine events
    simulatorEngine.on('session:started', (sessionId: string) => {
      this.broadcast(sessionId, {
        type: 'session:started',
        timestamp: new Date().toISOString(),
        sessionId,
      });
    });

    simulatorEngine.on('session:stopped', (sessionId: string, reason: string) => {
      this.broadcast(sessionId, {
        type: 'session:stopped',
        timestamp: new Date().toISOString(),
        sessionId,
        data: { reason },
      });
    });

    simulatorEngine.on('session:expired', (sessionId: string) => {
      this.broadcast(sessionId, {
        type: 'session:expired',
        timestamp: new Date().toISOString(),
        sessionId,
      });
    });

    simulatorEngine.on('session:error', (sessionId: string, error: Error) => {
      this.broadcast(sessionId, {
        type: 'session:error',
        timestamp: new Date().toISOString(),
        sessionId,
        data: { error: error.message },
      });
    });

    simulatorEngine.on('bundle:fetched', (sessionId: string, version: string, isUpdated: boolean) => {
      this.broadcast(sessionId, {
        type: 'bundle:fetched',
        timestamp: new Date().toISOString(),
        sessionId,
        data: { version, isUpdated },
      });
    });

    simulatorEngine.on('device:scanned', (sessionId: string, deviceId: string, telemetry: Record<string, number>) => {
      this.broadcast(sessionId, {
        type: 'device:scanned',
        timestamp: new Date().toISOString(),
        sessionId,
        data: { deviceId, telemetry },
      });
    });

    simulatorEngine.on('alarm:candidate', (sessionId: string, candidate: SimulatorAlarmCandidate) => {
      this.broadcast(sessionId, {
        type: 'alarm:candidate',
        timestamp: new Date().toISOString(),
        sessionId,
        data: {
          fingerprint: candidate.fingerprint,
          deviceId: candidate.source.deviceId,
          ruleId: candidate.rule.id,
          ruleName: candidate.rule.name,
          severity: candidate.rule.severity,
          field: candidate.telemetry.field,
          value: candidate.telemetry.value,
          threshold: candidate.telemetry.threshold,
        },
      });
    });

    // Start heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000); // 30 seconds

    this.isInitialized = true;
    console.log('[SimulatorMonitor] Service initialized');
  }

  /**
   * Add a new SSE client
   */
  addClient(sessionId: string, response: Response): string {
    // Initialize if first client
    if (!this.isInitialized) {
      this.initialize();
    }

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Configure SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Store client
    const client: SSEClient = {
      id: clientId,
      sessionId,
      response,
      connectedAt: new Date(),
    };
    this.clients.set(clientId, client);

    // Send connected event
    this.sendToClient(client, {
      type: 'connected',
      timestamp: new Date().toISOString(),
      sessionId,
      data: { clientId },
    });

    // Handle client disconnect
    response.on('close', () => {
      this.removeClient(clientId);
    });

    console.log('[SimulatorMonitor] Client connected', { clientId, sessionId });

    return clientId;
  }

  /**
   * Remove a client
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      console.log('[SimulatorMonitor] Client disconnected', { clientId, sessionId: client.sessionId });
    }
  }

  /**
   * Broadcast event to all clients watching a session
   */
  private broadcast(sessionId: string, event: MonitorEvent): void {
    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId) {
        this.sendToClient(client, event);
      }
    }
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(client: SSEClient, event: MonitorEvent): void {
    try {
      const data = JSON.stringify(event);
      client.response.write(`event: ${event.type}\n`);
      client.response.write(`data: ${data}\n\n`);
    } catch (error) {
      console.error('[SimulatorMonitor] Failed to send to client', {
        clientId: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.removeClient(client.id);
    }
  }

  /**
   * Send heartbeat to all clients
   */
  private sendHeartbeat(): void {
    const event: MonitorEvent = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
    };

    for (const client of this.clients.values()) {
      this.sendToClient(client, event);
    }
  }

  /**
   * Get active client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get clients watching a specific session
   */
  getSessionClientCount(sessionId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Shutdown the monitor service
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      try {
        client.response.end();
      } catch {
        // Ignore errors during shutdown
      }
    }

    this.clients.clear();
    console.log('[SimulatorMonitor] Service shut down');
  }
}

// Export singleton instance
export const simulatorMonitorService = new SimulatorMonitorService();
