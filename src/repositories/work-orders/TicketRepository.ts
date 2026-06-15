// RFC-0044 — persistence for chamado-specific data (work_orders of type CHAMADO):
// the 1:1 meta, CC/watchers, the parent edge (work_orders.ticket_id), derived OS
// listing and the aggregated event feed. Plain Drizzle; read-mostly.
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const { workOrders, workOrdersTicketMeta, workOrdersWatchers, workOrdersEvents, users } = schema;

export interface TicketMetaInput {
  subject: string;
  priority?: string;
  reason?: string | null;
  source?: string;
  requesterEmail: string;
  requesterUserId?: string | null;
  requesterDomain?: string | null;
  externalId?: string | null;
}

export interface ViewerIdentity {
  id: string;
  email: string | null;
  customerId: string | null;
  profile: unknown;
}

export interface DerivedWorkOrder {
  id: string;
  code: string;
  type: string;
  status: string;
}

export interface TicketRow {
  id: string;
  code: string;
  status: string;
  customerId: string;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
  subject: string;
  priority: string;
  reason: string | null;
  source: string;
  requesterEmail: string;
  requesterDomain: string | null;
}

export class TicketRepository {
  async getViewer(tenantId: string, userId: string): Promise<ViewerIdentity | null> {
    const [u] = await db
      .select({ id: users.id, email: users.email, customerId: users.customerId, profile: users.profile })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .limit(1);
    return u ?? null;
  }

  async findUserIdByEmail(tenantId: string, email: string): Promise<string | null> {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
      .limit(1);
    return u?.id ?? null;
  }

  // ── meta (1:1) ───────────────────────────────────────────────────────────────
  async createMeta(tenantId: string, workOrderId: string, input: TicketMetaInput): Promise<void> {
    await db.insert(workOrdersTicketMeta).values({
      workOrderId,
      tenantId,
      subject: input.subject,
      priority: input.priority ?? 'MEDIA',
      reason: input.reason ?? null,
      source: input.source ?? 'PAINEL',
      requesterEmail: input.requesterEmail,
      requesterUserId: input.requesterUserId ?? null,
      requesterDomain: input.requesterDomain ?? null,
      externalId: input.externalId ?? null,
    });
  }

  async getMeta(tenantId: string, workOrderId: string) {
    const [row] = await db
      .select()
      .from(workOrdersTicketMeta)
      .where(and(eq(workOrdersTicketMeta.tenantId, tenantId), eq(workOrdersTicketMeta.workOrderId, workOrderId)))
      .limit(1);
    return row ?? null;
  }

  async updateMeta(
    tenantId: string,
    workOrderId: string,
    patch: Partial<TicketMetaInput> & { firstResponseAt?: Date; resolvedAt?: Date },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['subject', 'priority', 'reason', 'source', 'requesterEmail', 'requesterUserId', 'requesterDomain', 'externalId', 'firstResponseAt', 'resolvedAt'] as const) {
      if ((patch as Record<string, unknown>)[k] !== undefined) set[k] = (patch as Record<string, unknown>)[k];
    }
    await db
      .update(workOrdersTicketMeta)
      .set(set)
      .where(and(eq(workOrdersTicketMeta.tenantId, tenantId), eq(workOrdersTicketMeta.workOrderId, workOrderId)));
  }

  // ── watchers (CC) ────────────────────────────────────────────────────────────
  async addWatcher(tenantId: string, workOrderId: string, email: string, userId?: string | null): Promise<void> {
    await db
      .insert(workOrdersWatchers)
      .values({ tenantId, workOrderId, email, userId: userId ?? null })
      .onConflictDoNothing();
  }

  async listWatchers(tenantId: string, workOrderId: string) {
    return db
      .select({ email: workOrdersWatchers.email, userId: workOrdersWatchers.userId })
      .from(workOrdersWatchers)
      .where(and(eq(workOrdersWatchers.tenantId, tenantId), eq(workOrdersWatchers.workOrderId, workOrderId)));
  }

  // ── parent edge ──────────────────────────────────────────────────────────────
  async setTicketId(tenantId: string, workOrderId: string, ticketId: string | null): Promise<void> {
    await db
      .update(workOrders)
      .set({ ticketId, updatedAt: new Date() })
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, workOrderId)));
  }

  async getTicketIdOf(tenantId: string, workOrderId: string): Promise<string | null> {
    const [row] = await db
      .select({ ticketId: workOrders.ticketId })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, workOrderId)))
      .limit(1);
    return row?.ticketId ?? null;
  }

  async listDerived(tenantId: string, ticketId: string): Promise<DerivedWorkOrder[]> {
    return db
      .select({ id: workOrders.id, code: workOrders.code, type: workOrders.type, status: workOrders.status })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.ticketId, ticketId), isNull(workOrders.deletedAt)))
      .orderBy(desc(workOrders.createdAt));
  }

  // ── aggregated timeline ────────────────────────────────────────────────────────
  async listEventsForWorkOrders(tenantId: string, workOrderIds: string[]) {
    if (workOrderIds.length === 0) return [];
    return db
      .select({
        workOrderId: workOrdersEvents.workOrderId,
        code: workOrders.code,
        type: workOrders.type,
        eventType: workOrdersEvents.eventType,
        actor: workOrdersEvents.actor,
        payload: workOrdersEvents.payload,
        createdAt: workOrdersEvents.createdAt,
      })
      .from(workOrdersEvents)
      .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
      .where(and(eq(workOrdersEvents.tenantId, tenantId), inArray(workOrdersEvents.workOrderId, workOrderIds)))
      .orderBy(desc(workOrdersEvents.createdAt));
  }

  // ── listing / board ────────────────────────────────────────────────────────────
  private baseWhere(tenantId: string, scope?: SQL, status?: string): SQL {
    const conds: SQL[] = [
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.type, 'CHAMADO'),
      isNull(workOrders.deletedAt),
    ];
    if (status) conds.push(eq(workOrders.status, status));
    if (scope) conds.push(scope);
    return and(...conds) as SQL;
  }

  async listTickets(tenantId: string, opts: { status?: string; scope?: SQL; limit?: number }): Promise<TicketRow[]> {
    return db
      .select({
        id: workOrders.id,
        code: workOrders.code,
        status: workOrders.status,
        customerId: workOrders.customerId,
        assignedTo: workOrders.assignedTo,
        createdAt: workOrders.createdAt,
        updatedAt: workOrders.updatedAt,
        subject: workOrdersTicketMeta.subject,
        priority: workOrdersTicketMeta.priority,
        reason: workOrdersTicketMeta.reason,
        source: workOrdersTicketMeta.source,
        requesterEmail: workOrdersTicketMeta.requesterEmail,
        requesterDomain: workOrdersTicketMeta.requesterDomain,
      })
      .from(workOrders)
      .innerJoin(workOrdersTicketMeta, eq(workOrdersTicketMeta.workOrderId, workOrders.id))
      .where(this.baseWhere(tenantId, opts.scope, opts.status))
      .orderBy(desc(workOrders.updatedAt))
      .limit(opts.limit ?? 100);
  }

  async countByStatus(tenantId: string, scope?: SQL): Promise<Record<string, number>> {
    const rows = await db
      .select({ status: workOrders.status, count: sql<number>`count(*)::int` })
      .from(workOrders)
      .innerJoin(workOrdersTicketMeta, eq(workOrdersTicketMeta.workOrderId, workOrders.id))
      .where(this.baseWhere(tenantId, scope))
      .groupBy(workOrders.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.count ?? 0;
    return out;
  }
}

export const ticketRepository = new TicketRepository();
