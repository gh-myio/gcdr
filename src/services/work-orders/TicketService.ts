// RFC-0044 — Chamados (Work Order type CHAMADO), Phase 2.
// Orchestrates the existing WorkOrderService (create/detail/appendEvent, rules
// engine) plus TicketRepository (meta, watchers, parent edge, derived OS,
// aggregated timeline). Read/write, tenant-scoped.
import { eq, or, type SQL } from 'drizzle-orm';
import { schema } from '../../infrastructure/database/drizzle/db';
import { workOrderService, ActorContext } from './WorkOrderService';
import { ticketRepository } from '../../repositories/work-orders/TicketRepository';
import { NotFoundError, ConflictError, ValidationError } from '../../shared/errors/AppError';

const EXEC_TERMINAL = new Set(['FINALIZADA', 'CANCELADA']);
const TICKET_TERMINAL = new Set(['FECHADO', 'CANCELADO']);

const ACTION_EVENT: Record<string, string> = {
  pending: 'CHAMADO_PENDENTE',
  awaiting: 'CHAMADO_AGUARDANDO_SOLICITANTE',
  resolve: 'CHAMADO_RESOLVIDO',
  close: 'CHAMADO_FECHADO',
  reopen: 'CHAMADO_REABERTO',
  cancel: 'CHAMADO_CANCELADO',
};

export type TicketView = 'TECNICO' | 'SUPERVISOR' | 'HOLDING' | 'ALL';

export interface OpenTicketInput {
  customerId: string;
  subject: string;
  reason?: string;
  priority?: string;
  source?: string;
  requesterEmail: string;
  assignedTo?: string | null;
  devices?: string[];
  rootAssetId?: string | null;
  cc?: string[];
  externalId?: string | null;
}

export interface DeriveWorkOrderInput {
  type: 'INSTALACAO' | 'MANUTENCAO' | 'VISITA_TECNICA';
  assignedTo?: string | null;
  devices?: string[];
  scheduledAt?: string | null;
  rootAssetId?: string | null;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

export class TicketService {
  // ── open ──────────────────────────────────────────────────────────────────────
  async open(tenantId: string, input: OpenTicketInput, ctx: ActorContext) {
    const wo = await workOrderService.create(
      tenantId,
      {
        customerId: input.customerId,
        type: 'CHAMADO',
        assignedTo: input.assignedTo ?? null,
        rootAssetId: input.rootAssetId ?? null,
        devices: input.devices,
      },
      ctx,
    );

    const requesterUserId = await ticketRepository.findUserIdByEmail(tenantId, input.requesterEmail);
    await ticketRepository.createMeta(tenantId, wo.id, {
      subject: input.subject,
      priority: input.priority,
      reason: input.reason ?? null,
      source: input.source,
      requesterEmail: input.requesterEmail,
      requesterUserId,
      requesterDomain: domainOf(input.requesterEmail),
      externalId: input.externalId ?? null,
    });

    for (const email of input.cc ?? []) {
      const uid = await ticketRepository.findUserIdByEmail(tenantId, email);
      await ticketRepository.addWatcher(tenantId, wo.id, email, uid);
    }

    // Entry event -> projects ABERTO (table-driven flow).
    await workOrderService.appendEvent(
      tenantId,
      wo.id,
      { eventType: 'CHAMADO_ABERTO', payload: { subject: input.subject } },
      ctx,
    );

    return this.get(tenantId, wo.id);
  }

  /** The chamados team (deduped) — candidate pool for assigning a chamado. */
  async team(tenantId: string) {
    return ticketRepository.ticketTeam(tenantId);
  }

  // ── detail ─────────────────────────────────────────────────────────────────────
  async get(tenantId: string, id: string) {
    const wo = await workOrderService.getById(tenantId, id);
    if (wo.type !== 'CHAMADO') throw new NotFoundError(`Ticket ${id} not found`);
    const [meta, watchers, derived] = await Promise.all([
      ticketRepository.getMeta(tenantId, id),
      ticketRepository.listWatchers(tenantId, id),
      ticketRepository.listDerived(tenantId, id),
    ]);
    const progress = {
      total: derived.length,
      finalized: derived.filter((d) => d.status === 'FINALIZADA').length,
      cancelled: derived.filter((d) => d.status === 'CANCELADA').length,
      active: derived.filter((d) => !EXEC_TERMINAL.has(d.status)).length,
    };
    return {
      id: wo.id,
      code: wo.code,
      status: wo.status,
      customerId: wo.customerId,
      assignedTo: wo.assignedTo,
      createdAt: wo.createdAt,
      updatedAt: wo.updatedAt,
      meta,
      watchers,
      derived,
      progress,
    };
  }

  // ── list + board ────────────────────────────────────────────────────────────────
  async list(tenantId: string, opts: { status?: string; view?: TicketView; viewerUserId: string; limit?: number }) {
    const scope = await this.buildScope(tenantId, opts.view ?? 'ALL', opts.viewerUserId);
    const [items, counts] = await Promise.all([
      ticketRepository.listTickets(tenantId, { status: opts.status, scope, limit: opts.limit }),
      ticketRepository.countByStatus(tenantId, scope),
    ]);
    const board = {
      ABERTO: counts.ABERTO ?? 0,
      PENDENTE: counts.PENDENTE ?? 0,
      AGUARDANDO: counts.AGUARDANDO ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
    return { items, board };
  }

  /** Lightweight visibility resolver (RFC-0044 §5). ALL = no restriction. */
  private async buildScope(tenantId: string, view: TicketView, viewerUserId: string): Promise<SQL | undefined> {
    if (view === 'ALL') return undefined;
    const viewer = await ticketRepository.getViewer(tenantId, viewerUserId);
    if (!viewer) return undefined;
    const { workOrders, workOrdersTicketMeta } = schema;
    if (view === 'TECNICO') {
      const conds: SQL[] = [];
      if (viewer.email) conds.push(eq(workOrdersTicketMeta.requesterEmail, viewer.email));
      conds.push(eq(workOrders.assignedTo, viewer.id));
      return or(...conds);
    }
    if (view === 'SUPERVISOR') {
      // Single-unit scope for now; subtree expansion is a refinement.
      return viewer.customerId ? eq(workOrders.customerId, viewer.customerId) : undefined;
    }
    if (view === 'HOLDING') {
      const domain = viewer.email ? domainOf(viewer.email) : null;
      return domain ? eq(workOrdersTicketMeta.requesterDomain, domain) : undefined;
    }
    return undefined;
  }

  // ── aggregated timeline ──────────────────────────────────────────────────────────
  async timeline(tenantId: string, ticketId: string) {
    const wo = await workOrderService.getById(tenantId, ticketId);
    if (wo.type !== 'CHAMADO') throw new NotFoundError(`Ticket ${ticketId} not found`);
    const derived = await ticketRepository.listDerived(tenantId, ticketId);
    const ids = [ticketId, ...derived.map((d) => d.id)];
    const events = await ticketRepository.listEventsForWorkOrders(tenantId, ids);
    return events.map((e) => {
      const a = (e.actor ?? {}) as { name?: string; email?: string };
      return {
        workOrder: e.code,
        type: e.type,
        isTicket: e.workOrderId === ticketId,
        eventType: e.eventType,
        by: a.name || a.email || null,
        at: e.createdAt,
        payload: e.payload ?? {},
      };
    });
  }

  // ── derive / attach / detach ─────────────────────────────────────────────────────
  async derive(tenantId: string, ticketId: string, input: DeriveWorkOrderInput, ctx: ActorContext) {
    await this.ensureTicket(tenantId, ticketId);
    const ticket = await workOrderService.getById(tenantId, ticketId);

    const child = await workOrderService.create(
      tenantId,
      {
        customerId: ticket.customerId,
        type: input.type,
        assignedTo: input.assignedTo ?? null,
        rootAssetId: input.rootAssetId ?? null,
        scheduledAt: input.scheduledAt ?? null,
        devices: input.devices,
      },
      ctx,
    );

    await ticketRepository.setTicketId(tenantId, child.id, ticketId);
    await this.linkMarker(tenantId, ticketId, 'CHAMADO_OS_VINCULADA', child.id, child.code, ctx);
    await this.recomputeAggregate(tenantId, ticketId, ctx);
    return child;
  }

  async attach(tenantId: string, workOrderId: string, ticketId: string, ctx: ActorContext) {
    await this.ensureTicket(tenantId, ticketId);
    const wo = await workOrderService.getById(tenantId, workOrderId);
    if (wo.type === 'CHAMADO') throw new ValidationError('Cannot attach a CHAMADO to another CHAMADO');

    const prev = await ticketRepository.getTicketIdOf(tenantId, workOrderId);
    await ticketRepository.setTicketId(tenantId, workOrderId, ticketId);
    await this.linkMarker(tenantId, ticketId, 'CHAMADO_OS_VINCULADA', wo.id, wo.code, ctx);
    if (prev && prev !== ticketId) {
      await this.linkMarker(tenantId, prev, 'CHAMADO_OS_DESVINCULADA', wo.id, wo.code, ctx);
      await this.recomputeAggregate(tenantId, prev, ctx);
    }
    await this.recomputeAggregate(tenantId, ticketId, ctx);
    return this.get(tenantId, ticketId);
  }

  async detach(tenantId: string, workOrderId: string, ctx: ActorContext) {
    const wo = await workOrderService.getById(tenantId, workOrderId);
    const prev = await ticketRepository.getTicketIdOf(tenantId, workOrderId);
    if (!prev) return;
    await ticketRepository.setTicketId(tenantId, workOrderId, null);
    await this.linkMarker(tenantId, prev, 'CHAMADO_OS_DESVINCULADA', wo.id, wo.code, ctx);
    await this.recomputeAggregate(tenantId, prev, ctx);
  }

  // ── transitions ──────────────────────────────────────────────────────────────────
  async transition(tenantId: string, ticketId: string, action: string, ctx: ActorContext, note?: string) {
    await this.ensureTicket(tenantId, ticketId);
    const eventType = ACTION_EVENT[action];
    if (!eventType) throw new ValidationError(`Unknown ticket action "${action}"`);

    if (action === 'resolve' || action === 'close') {
      const derived = await ticketRepository.listDerived(tenantId, ticketId);
      const active = derived.filter((d) => !EXEC_TERMINAL.has(d.status));
      if (active.length) {
        throw new ConflictError(
          `Cannot ${action} ticket: ${active.length} derived work order(s) still active`,
        );
      }
    }

    await workOrderService.appendEvent(tenantId, ticketId, { eventType, payload: note ? { note } : {} }, ctx);
    return this.get(tenantId, ticketId);
  }

  // ── aggregation roll-up (RFC-0044 §4.3) ──────────────────────────────────────────
  async recomputeAggregate(tenantId: string, ticketId: string, ctx: ActorContext) {
    const ticket = await workOrderService.getById(tenantId, ticketId);
    if (ticket.type !== 'CHAMADO' || TICKET_TERMINAL.has(ticket.status)) return;

    const derived = await ticketRepository.listDerived(tenantId, ticketId);
    if (derived.length === 0) return;

    const anyActive = derived.some((d) => !EXEC_TERMINAL.has(d.status));
    const allCancelled = derived.every((d) => d.status === 'CANCELADA');

    // Auto-cancel: every linked OS is cancelled and none is active.
    if (!anyActive && allCancelled) {
      await workOrderService.appendEvent(
        tenantId,
        ticketId,
        { eventType: 'CHAMADO_CANCELADO', payload: { reason: 'all_derived_cancelled', auto: true } },
        ctx,
      );
    }
    // Auto-resolve stays a suggestion (surfaced via progress); not applied here.
  }

  /** Called by the WO event flow when a child OS transitions (RFC-0044 §4.3). */
  async onChildTransition(tenantId: string, childWorkOrderId: string, ctx: ActorContext) {
    const ticketId = await ticketRepository.getTicketIdOf(tenantId, childWorkOrderId);
    if (ticketId) await this.recomputeAggregate(tenantId, ticketId, ctx);
  }

  // ── helpers ────────────────────────────────────────────────────────────────────
  private async ensureTicket(tenantId: string, ticketId: string) {
    const wo = await workOrderService.getById(tenantId, ticketId);
    if (wo.type !== 'CHAMADO') throw new NotFoundError(`Ticket ${ticketId} not found`);
    return wo;
  }

  private async linkMarker(
    tenantId: string,
    ticketId: string,
    eventType: 'CHAMADO_OS_VINCULADA' | 'CHAMADO_OS_DESVINCULADA',
    workOrderId: string,
    code: string,
    ctx: ActorContext,
  ) {
    await workOrderService.appendEvent(
      tenantId,
      ticketId,
      { eventType, payload: { workOrderId, code } },
      ctx,
    );
  }
}

export const ticketService = new TicketService();
