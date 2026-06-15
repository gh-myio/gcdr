// RFC-0042/0043 — technician tools. Resolve a person (the responsible
// technician of a work order = workOrders.assignedTo) by fuzzy name/email and
// list their work orders. Read-only.
import { z } from 'zod';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { McpContext, ToolResponse } from '../context';
import { fuzzyMatch } from '../utils/fuzzyMatch';
import { customerRoster } from './customers';

export interface TechnicianRef {
  id: string;
  name: string;
  email: string | null;
  assignedCount: number;
}

interface ProfileName {
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

function userDisplayName(profile: unknown, username: string | null, email: string): string {
  const p = (profile ?? {}) as ProfileName;
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return p.displayName || full || username || email || 'Sem nome';
}

/**
 * The set of people who appear as work-order responsibles (assignedTo) or event
 * actors in this tenant — i.e. the technicians the data actually knows about.
 */
export async function technicianRoster(ctx: McpContext): Promise<TechnicianRef[]> {
  const { workOrders, workOrdersEvents, users } = ctx.schema;

  const [assignedRows, actorRows] = await Promise.all([
    ctx.db
      .select({ id: workOrders.assignedTo, count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, ctx.tenantId), isNotNull(workOrders.assignedTo)))
      .groupBy(workOrders.assignedTo),
    ctx.db
      .selectDistinct({ id: workOrdersEvents.actorUserId })
      .from(workOrdersEvents)
      .where(
        and(eq(workOrdersEvents.tenantId, ctx.tenantId), isNotNull(workOrdersEvents.actorUserId)),
      ),
  ]);

  const counts = new Map<string, number>();
  for (const r of assignedRows) if (r.id) counts.set(r.id as string, r.count ?? 0);
  const ids = new Set<string>([...counts.keys()]);
  for (const r of actorRows) if (r.id) ids.add(r.id as string);
  if (ids.size === 0) return [];

  const rows = await ctx.db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      profile: users.profile,
    })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, [...ids])));

  return rows.map((u) => ({
    id: u.id,
    name: userDisplayName(u.profile, u.username, u.email),
    email: u.email ?? null,
    assignedCount: counts.get(u.id) ?? 0,
  }));
}

export async function resolveTechnician(
  ctx: McpContext,
  query: string,
): Promise<TechnicianRef | null> {
  const roster = await technicianRoster(ctx);
  return fuzzyMatch(query, roster, [(t) => t.name, (t) => t.email, (t) => t.id]);
}

// ── find_technician ─────────────────────────────────────────────────────────────
export const findTechnicianSchema = z.object({
  name: z.string().describe('Technician name or email (fuzzy, typo-tolerant)'),
});

export async function findTechnician(
  ctx: McpContext,
  p: z.infer<typeof findTechnicianSchema>,
): Promise<ToolResponse> {
  const t = await resolveTechnician(ctx, p.name);
  if (!t) {
    const roster = await technicianRoster(ctx);
    return {
      success: false,
      message: `No technician matches "${p.name}"`,
      data: { available: roster.slice(0, 20).map((r) => r.name) },
      summary: `No technician matched "${p.name}". Known technicians: ${roster
        .slice(0, 10)
        .map((r) => r.name)
        .join(', ')}.`,
    };
  }
  return {
    success: true,
    message: `Technician ${t.name}`,
    data: t,
    summary: `${t.name} is responsible for ${t.assignedCount} work order(s).`,
  };
}

// ── list_technician_work_orders ───────────────────────────────────────────────
const STATUS = [
  'PLANEJADA',
  'EM_ANDAMENTO',
  'INTERROMPIDA',
  'AGUARDANDO',
  'REAGENDADA',
  'FINALIZADA',
  'CANCELADA',
] as const;

export const listTechnicianWorkOrdersSchema = z.object({
  technician: z.string().describe('Technician name or email (fuzzy)'),
  status: z.enum(STATUS).optional(),
});

export async function listTechnicianWorkOrders(
  ctx: McpContext,
  p: z.infer<typeof listTechnicianWorkOrdersSchema>,
): Promise<ToolResponse> {
  const t = await resolveTechnician(ctx, p.technician);
  if (!t) {
    return {
      success: false,
      message: `No technician matches "${p.technician}"`,
      data: null,
      summary: `No technician matched "${p.technician}". Use find_technician to resolve it.`,
    };
  }

  const res = await ctx.workOrders.list(ctx.tenantId, {
    assignedTo: t.id,
    status: p.status,
    limit: 100,
    sort: 'scheduledAt_asc',
  });

  const roster = await customerRoster(ctx);
  const customerName = new Map(roster.map((c) => [c.id, c.name]));

  const items = res.items.map((wo) => ({
    code: wo.code,
    type: wo.type,
    status: wo.status,
    customer: customerName.get(wo.customerId) ?? null,
    scheduledAt: wo.scheduledAt,
  }));

  return {
    success: true,
    message: `${items.length} work order(s) for ${t.name}`,
    data: { technician: { id: t.id, name: t.name }, workOrders: items },
    summary: `${t.name} is responsible for ${
      res.pagination.total ?? items.length
    } work order(s)${p.status ? ` with status ${p.status}` : ''}.`,
  };
}
