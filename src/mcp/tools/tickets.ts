// RFC-0044 — chamado (ticket) tools for the Copiloto/MCP. Read-only, tenant-wide
// (view ALL). Reuses TicketService so numbers match the API/UI.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { McpContext, ToolResponse } from '../context';
import { ticketService } from '../../services/work-orders/TicketService';
import { resolveCustomer, customerRoster } from './customers';

async function resolveTicketIdByCode(ctx: McpContext, code: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ id: ctx.schema.workOrders.id })
    .from(ctx.schema.workOrders)
    .where(
      and(
        eq(ctx.schema.workOrders.tenantId, ctx.tenantId),
        eq(ctx.schema.workOrders.code, code),
        eq(ctx.schema.workOrders.type, 'CHAMADO'),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// ── list_tickets ────────────────────────────────────────────────────────────────
export const listTicketsSchema = z.object({
  customer: z.string().optional().describe('Customer name/code (fuzzy); omit for tenant-wide'),
  status: z.string().optional().describe('ABERTO|PENDENTE|AGUARDANDO|RESOLVIDO|FECHADO|CANCELADO'),
});

export async function listTickets(
  ctx: McpContext,
  p: z.infer<typeof listTicketsSchema>,
): Promise<ToolResponse> {
  let customerId: string | undefined;
  let customerName: string | undefined;
  if (p.customer) {
    const c = await resolveCustomer(ctx, p.customer);
    if (!c) {
      return { success: false, message: `No customer matches "${p.customer}"`, data: null, summary: `No customer matched "${p.customer}".` };
    }
    customerId = c.id;
    customerName = c.name;
  }

  const { items, board } = await ticketService.list(ctx.tenantId, {
    status: p.status,
    view: 'ALL',
    viewerUserId: '',
    limit: 100,
  });
  const filtered = customerId ? items.filter((t) => t.customerId === customerId) : items;
  const names = new Map((await customerRoster(ctx)).map((c) => [c.id, c.name]));

  const list = filtered.map((t) => ({
    code: t.code,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    customer: names.get(t.customerId) ?? null,
    requester: t.requesterEmail,
    updatedAt: t.updatedAt,
  }));
  const scope = customerName ? `for ${customerName}` : 'tenant-wide';
  return {
    success: true,
    message: `${list.length} ticket(s) ${scope}`,
    data: { board, tickets: list },
    summary: `${scope}: ${board.ABERTO} open, ${board.PENDENTE} pending, ${board.AGUARDANDO} awaiting (total ${board.total}).`,
  };
}

// ── get_ticket ──────────────────────────────────────────────────────────────────
export const getTicketSchema = z.object({
  code: z.string().describe('Ticket code, e.g. OS-ABC1D2 (type CHAMADO)'),
});

export async function getTicket(
  ctx: McpContext,
  p: z.infer<typeof getTicketSchema>,
): Promise<ToolResponse> {
  const id = await resolveTicketIdByCode(ctx, p.code);
  if (!id) {
    return { success: false, message: `No ticket "${p.code}"`, data: null, summary: `Ticket "${p.code}" was not found.` };
  }
  const t = await ticketService.get(ctx.tenantId, id);
  return {
    success: true,
    message: `Ticket ${t.code}`,
    data: {
      code: t.code,
      subject: t.meta?.subject ?? null,
      status: t.status,
      priority: t.meta?.priority ?? null,
      requester: t.meta?.requesterEmail ?? null,
      derived: t.derived.map((d) => ({ code: d.code, type: d.type, status: d.status })),
      progress: t.progress,
    },
    summary: `${t.code} (${t.status}) — ${t.progress.total} derived OS: ${t.progress.finalized} finalized, ${t.progress.cancelled} cancelled, ${t.progress.active} active.`,
  };
}

// ── get_ticket_timeline ───────────────────────────────────────────────────────────
export const getTicketTimelineSchema = z.object({
  code: z.string().describe('Ticket code to get the aggregated timeline for'),
});

export async function getTicketTimeline(
  ctx: McpContext,
  p: z.infer<typeof getTicketTimelineSchema>,
): Promise<ToolResponse> {
  const id = await resolveTicketIdByCode(ctx, p.code);
  if (!id) {
    return { success: false, message: `No ticket "${p.code}"`, data: null, summary: `Ticket "${p.code}" was not found.` };
  }
  const events = await ticketService.timeline(ctx.tenantId, id);
  return {
    success: true,
    message: `Timeline for ${p.code}`,
    data: { events: events.map((e) => ({ workOrder: e.workOrder, eventType: e.eventType, by: e.by, at: e.at })) },
    summary: `${p.code} has ${events.length} event(s) across the chamado and its derived OS.`,
  };
}
