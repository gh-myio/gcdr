// =============================================================================
// Simulator Repository (RFC-0010)
// =============================================================================

import { eq, and, lt, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../infrastructure/database/drizzle/db';
import { simulatorSessions, simulatorEvents } from '../infrastructure/database/drizzle/schema';
import {
  SimulatorSession,
  SimulatorSessionStatus,
  SimulatorEvent,
  CreateSimulatorSessionInput,
  SimulatorConfig,
} from '../domain/entities/Simulator';

/**
 * Repository for simulator sessions and events
 */
export class SimulatorRepository {
  // ===========================================================================
  // Sessions
  // ===========================================================================

  /**
   * Create a new simulator session
   */
  async createSession(input: CreateSimulatorSessionInput): Promise<SimulatorSession> {
    const values = {
      tenantId: input.tenantId,
      customerId: input.customerId,
      createdBy: input.createdBy,
      name: input.name,
      config: input.config,
      scansLimit: input.scansLimit,
      expiresAt: input.expiresAt,
      status: 'PENDING' as const,
    };

    console.log('[SimulatorRepository] Inserting session with values:', JSON.stringify(values, null, 2));

    try {
      const [session] = await db
        .insert(simulatorSessions)
        .values(values)
        .returning();

      console.log('[SimulatorRepository] Session created successfully:', session.id);
      return this.mapSession(session);
    } catch (error) {
      console.error('[SimulatorRepository] Failed to create session:', error);
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  async getSessionById(tenantId: string, sessionId: string): Promise<SimulatorSession | null> {
    const [session] = await db
      .select()
      .from(simulatorSessions)
      .where(and(eq(simulatorSessions.tenantId, tenantId), eq(simulatorSessions.id, sessionId)))
      .limit(1);

    return session ? this.mapSession(session) : null;
  }

  /**
   * Get session by ID (without tenant check - for internal use)
   */
  async getSessionByIdInternal(sessionId: string): Promise<SimulatorSession | null> {
    const [session] = await db
      .select()
      .from(simulatorSessions)
      .where(eq(simulatorSessions.id, sessionId))
      .limit(1);

    return session ? this.mapSession(session) : null;
  }

  /**
   * List sessions by tenant
   */
  async listSessionsByTenant(
    tenantId: string,
    options?: { status?: SimulatorSessionStatus; limit?: number; offset?: number }
  ): Promise<SimulatorSession[]> {
    const conditions: SQL[] = [eq(simulatorSessions.tenantId, tenantId)];

    if (options?.status) {
      conditions.push(eq(simulatorSessions.status, options.status));
    }

    const sessions = await db
      .select()
      .from(simulatorSessions)
      .where(and(...conditions))
      .orderBy(desc(simulatorSessions.createdAt))
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0);

    return sessions.map((s) => this.mapSession(s));
  }

  /**
   * Count active sessions by tenant
   */
  async countActiveSessionsByTenant(tenantId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(simulatorSessions)
      .where(and(eq(simulatorSessions.tenantId, tenantId), eq(simulatorSessions.status, 'RUNNING')));

    return result?.count || 0;
  }

  /**
   * Find all running sessions (for recovery)
   */
  async findRunningSessions(): Promise<SimulatorSession[]> {
    const sessions = await db
      .select()
      .from(simulatorSessions)
      .where(eq(simulatorSessions.status, 'RUNNING'));

    return sessions.map((s) => this.mapSession(s));
  }

  /**
   * Find expired sessions that are still running
   */
  async findExpiredRunningSessions(): Promise<SimulatorSession[]> {
    const now = new Date();
    const sessions = await db
      .select()
      .from(simulatorSessions)
      .where(and(eq(simulatorSessions.status, 'RUNNING'), lt(simulatorSessions.expiresAt, now)));

    return sessions.map((s) => this.mapSession(s));
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    sessionId: string,
    status: SimulatorSessionStatus,
    additionalFields?: Partial<{
      startedAt: Date;
      stoppedAt: Date;
      bundleVersion: string;
      bundleSignature: string;
      bundleFetchedAt: Date;
      lastScanAt: Date;
    }>
  ): Promise<void> {
    await db
      .update(simulatorSessions)
      .set({
        status,
        updatedAt: new Date(),
        ...additionalFields,
      })
      .where(eq(simulatorSessions.id, sessionId));
  }

  /**
   * Increment scans count
   */
  async incrementScansCount(sessionId: string): Promise<number> {
    const [result] = await db
      .update(simulatorSessions)
      .set({
        scansCount: sql`${simulatorSessions.scansCount} + 1`,
        lastScanAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(simulatorSessions.id, sessionId))
      .returning({ scansCount: simulatorSessions.scansCount });

    return result?.scansCount || 0;
  }

  /**
   * Increment alarms triggered count
   */
  async incrementAlarmsCount(sessionId: string): Promise<void> {
    await db
      .update(simulatorSessions)
      .set({
        alarmsTriggeredCount: sql`${simulatorSessions.alarmsTriggeredCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(simulatorSessions.id, sessionId));
  }

  /**
   * Update bundle info
   */
  async updateBundleInfo(
    sessionId: string,
    bundleVersion: string,
    bundleSignature: string
  ): Promise<void> {
    await db
      .update(simulatorSessions)
      .set({
        bundleVersion,
        bundleSignature,
        bundleFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(simulatorSessions.id, sessionId));
  }

  /**
   * Mark expired sessions
   */
  async markExpiredSessions(): Promise<number> {
    const now = new Date();
    const result = await db
      .update(simulatorSessions)
      .set({
        status: 'EXPIRED',
        stoppedAt: now,
        updatedAt: now,
      })
      .where(and(eq(simulatorSessions.status, 'RUNNING'), lt(simulatorSessions.expiresAt, now)))
      .returning({ id: simulatorSessions.id });

    return result.length;
  }

  /**
   * Delete old sessions
   */
  async deleteOldSessions(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await db
      .delete(simulatorSessions)
      .where(lt(simulatorSessions.createdAt, cutoff))
      .returning({ id: simulatorSessions.id });

    return result.length;
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Create a simulator event
   */
  async createEvent(
    sessionId: string,
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<SimulatorEvent> {
    const [event] = await db
      .insert(simulatorEvents)
      .values({
        sessionId,
        eventType,
        eventData,
      })
      .returning();

    return this.mapEvent(event);
  }

  /**
   * List events by session
   */
  async listEventsBySession(
    sessionId: string,
    options?: { eventType?: string; limit?: number; offset?: number }
  ): Promise<SimulatorEvent[]> {
    const conditions: SQL[] = [eq(simulatorEvents.sessionId, sessionId)];

    if (options?.eventType) {
      conditions.push(eq(simulatorEvents.eventType, options.eventType));
    }

    const events = await db
      .select()
      .from(simulatorEvents)
      .where(and(...conditions))
      .orderBy(desc(simulatorEvents.createdAt))
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0);

    return events.map((e) => this.mapEvent(e));
  }

  /**
   * Delete old events
   */
  async deleteOldEvents(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await db
      .delete(simulatorEvents)
      .where(lt(simulatorEvents.createdAt, cutoff))
      .returning({ id: simulatorEvents.id });

    return result.length;
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapSession(row: typeof simulatorSessions.$inferSelect): SimulatorSession {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      createdBy: row.createdBy,
      name: row.name,
      status: row.status,
      config: row.config as SimulatorConfig,
      scansCount: row.scansCount,
      scansLimit: row.scansLimit,
      bundleVersion: row.bundleVersion || undefined,
      bundleSignature: row.bundleSignature || undefined,
      bundleFetchedAt: row.bundleFetchedAt || undefined,
      alarmsTriggeredCount: row.alarmsTriggeredCount,
      lastScanAt: row.lastScanAt || undefined,
      startedAt: row.startedAt || undefined,
      expiresAt: row.expiresAt,
      stoppedAt: row.stoppedAt || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapEvent(row: typeof simulatorEvents.$inferSelect): SimulatorEvent {
    return {
      id: row.id,
      sessionId: row.sessionId,
      eventType: row.eventType as SimulatorEvent['eventType'],
      eventData: row.eventData as Record<string, unknown>,
      createdAt: row.createdAt,
    };
  }
}

export const simulatorRepository = new SimulatorRepository();
