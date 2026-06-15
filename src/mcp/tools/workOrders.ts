// RFC-0042 — work-order tools.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { McpContext, ToolResponse } from '../context';
import { resolveCustomer } from './customers';

const STATUS = [
  'PLANEJADA',
  'EM_ANDAMENTO',
  'INTERROMPIDA',
  'AGUARDANDO',
  'REAGENDADA',
  'FINALIZADA',
  'CANCELADA',
] as const;
const TYPE = ['INSTALACAO', 'MANUTENCAO', 'VISITA_TECNICA'] as const;

function customerNotFound(query: string): ToolResponse {
  return {
    success: false,
    message: `No customer matches "${query}"`,
    data: null,
    summary: `No customer matched "${query}". Use find_customer to resolve it.`,
  };
}

async function resolveWoIdByCode(ctx: McpContext, code: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ id: ctx.schema.workOrders.id })
    .from(ctx.schema.workOrders)
    .where(
      and(
        eq(ctx.schema.workOrders.tenantId, ctx.tenantId),
        eq(ctx.schema.workOrders.code, code),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// ── list_work_orders ──────────────────────────────────────────────────────────
export const listWorkOrdersSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  status: z.enum(STATUS).optional(),
  type: z.enum(TYPE).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function listWorkOrders(
  ctx: McpContext,
  p: z.infer<typeof listWorkOrdersSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);

  const res = await ctx.workOrders.list(ctx.tenantId, {
    customerId: c.id,
    status: p.status,
    type: p.type,
    limit: p.limit ?? 50,
    sort: 'createdAt_desc',
  });
  const items = res.items.map((wo) => ({
    code: wo.code,
    type: wo.type,
    status: wo.status,
    scheduledAt: wo.scheduledAt,
    assignedTo: wo.assignedTo,
  }));
  return {
    success: true,
    message: `${items.length} work order(s) for ${c.name}`,
    data: { customer: c, workOrders: items },
    summary: `${c.name} has ${res.pagination.total ?? items.length} work order(s) matching the filter.`,
  };
}

// ── get_work_order ────────────────────────────────────────────────────────────
export const getWorkOrderSchema = z.object({
  code: z.string().describe('Work order code, e.g. OS-ABC1D2'),
});

export async function getWorkOrder(
  ctx: McpContext,
  p: z.infer<typeof getWorkOrderSchema>,
): Promise<ToolResponse> {
  const id = await resolveWoIdByCode(ctx, p.code);
  if (!id) {
    return {
      success: false,
      message: `No work order "${p.code}"`,
      data: null,
      summary: `Work order "${p.code}" was not found.`,
    };
  }
  const wo = await ctx.workOrders.detail(ctx.tenantId, id);
  const events = [...wo.events]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((e) => ({ eventType: e.eventType, at: e.createdAt, by: e.actor?.name ?? e.actor?.email ?? null }));
  return {
    success: true,
    message: `Work order ${wo.code}`,
    data: {
      code: wo.code,
      type: wo.type,
      status: wo.status,
      scheduledAt: wo.scheduledAt,
      devices: wo.devices.length,
      events,
    },
    summary: `${wo.code} (${wo.type}) is ${wo.status} with ${wo.devices.length} device(s) in scope.`,
  };
}

// ── get_transitions ───────────────────────────────────────────────────────────
export const getTransitionsSchema = z.object({
  code: z.string().describe('Work order code to evaluate next allowed events'),
});

export async function getTransitions(
  ctx: McpContext,
  p: z.infer<typeof getTransitionsSchema>,
): Promise<ToolResponse> {
  const id = await resolveWoIdByCode(ctx, p.code);
  if (!id) {
    return {
      success: false,
      message: `No work order "${p.code}"`,
      data: null,
      summary: `Work order "${p.code}" was not found.`,
    };
  }
  const r = await ctx.workOrders.getTransitions(ctx.tenantId, id);
  const allowed = r.transitions.filter((t) => t.allowed).map((t) => t.code);
  const blocked = r.transitions
    .filter((t) => !t.allowed)
    .map((t) => ({ code: t.code, reason: t.reasonCode, missing: t.missing }));
  return {
    success: true,
    message: `Transitions for ${p.code}`,
    data: { status: r.status, allowed, blocked },
    summary: `${p.code} is ${r.status}. Allowed next: ${allowed.join(', ') || 'none'}.`,
  };
}
