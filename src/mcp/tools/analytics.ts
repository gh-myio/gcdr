// RFC-0042 — analytics tools (progress, time, technicians, activity, daily).
import { z } from 'zod';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { McpContext, ToolResponse } from '../context';
import { resolveCustomer } from './customers';

const INSTALL = 'PRODUTO_INSTALADO';
const TERMINAL = ['FINALIZADA', 'CANCELADA'];
const GAP_CAP_MS = 4 * 60 * 60 * 1000;
const DEFAULT_FIRST_MS = 20 * 60 * 1000;

/** Resolve the optional `customer` arg to an id (or null = whole tenant). */
async function scopeCustomerId(ctx: McpContext, customer?: string): Promise<string | null | false> {
  if (!customer) return null;
  const c = await resolveCustomer(ctx, customer);
  return c ? c.id : false; // false = not found
}

interface InstallRec {
  deviceId: string;
  techKey: string;
  techName: string;
  ts: number;
}

async function installEvents(ctx: McpContext, customerId: string | null): Promise<InstallRec[]> {
  const { workOrders, workOrdersEvents } = ctx.schema;
  const conds = [
    eq(workOrders.tenantId, ctx.tenantId),
    eq(workOrdersEvents.eventType, INSTALL),
    isNotNull(workOrdersEvents.deviceId),
  ];
  if (customerId) conds.push(eq(workOrders.customerId, customerId));
  const rows = await ctx.db
    .select({
      deviceId: workOrdersEvents.deviceId,
      actorUserId: workOrdersEvents.actorUserId,
      actor: workOrdersEvents.actor,
      createdAt: workOrdersEvents.createdAt,
    })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(and(...conds));
  return rows.map((r) => {
    const actor = (r.actor ?? {}) as { id?: string; name?: string; email?: string };
    return {
      deviceId: r.deviceId as string,
      techKey: r.actorUserId || actor.id || actor.email || actor.name || 'unknown',
      techName: actor.name || actor.email || r.actorUserId || 'Sistema',
      ts: new Date(r.createdAt as unknown as string).getTime(),
    };
  });
}

/** Per-technician gap-based time (mirrors the Desempenho tab). */
function perTechnician(recs: InstallRec[]) {
  const byTech = new Map<string, InstallRec[]>();
  for (const r of recs) {
    const a = byTech.get(r.techKey);
    if (a) a.push(r);
    else byTech.set(r.techKey, [r]);
  }
  const rows = [];
  let grandTotal = 0;
  for (const [key, list] of byTech) {
    list.sort((a, b) => a.ts - b.ts);
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const g = list[i].ts - list[i - 1].ts;
      if (g > 0 && g <= GAP_CAP_MS) gaps.push(g);
    }
    const median = gaps.length
      ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      : DEFAULT_FIRST_MS;
    let total = 0;
    const devices = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const g = i === 0 ? median : list[i].ts - list[i - 1].ts;
      total += g > 0 && g <= GAP_CAP_MS ? g : median;
      devices.add(list[i].deviceId);
    }
    grandTotal += total;
    rows.push({ techKey: key, name: list[0].techName, installed: devices.size, totalMs: total });
  }
  rows.sort((a, b) => b.installed - a.installed);
  const installed = new Set(recs.map((r) => r.deviceId)).size;
  return { rows, grandTotal, installed };
}

function fmtH(ms: number): string {
  if (!ms || ms <= 0) return '0min';
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}min` : `${m}min`;
}

async function scopeError(query: string): Promise<ToolResponse> {
  return {
    success: false,
    message: `No customer matches "${query}"`,
    data: null,
    summary: `No customer matched "${query}".`,
  };
}

// ── get_progress ──────────────────────────────────────────────────────────────
export const getProgressSchema = z.object({
  customer: z.string().optional().describe('Customer name/code; omit for tenant-wide'),
});

export async function getProgress(
  ctx: McpContext,
  p: z.infer<typeof getProgressSchema>,
): Promise<ToolResponse> {
  const cid = await scopeCustomerId(ctx, p.customer);
  if (cid === false) return scopeError(p.customer!);
  const { workOrders, workOrdersDevices, workOrdersEvents } = ctx.schema;

  const woCustomer = cid ? [eq(workOrders.customerId, cid)] : [];

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(distinct ${workOrdersDevices.deviceId})::int` })
    .from(workOrdersDevices)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersDevices.workOrderId))
    .where(and(eq(workOrders.tenantId, ctx.tenantId), ...woCustomer));

  const [{ installed }] = await ctx.db
    .select({ installed: sql<number>`count(distinct ${workOrdersEvents.deviceId})::int` })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(
      and(
        eq(workOrders.tenantId, ctx.tenantId),
        eq(workOrdersEvents.eventType, INSTALL),
        isNotNull(workOrdersEvents.deviceId),
        ...woCustomer,
      ),
    );

  const progress = total > 0 ? Math.round((installed / total) * 100) : 0;
  const scope = p.customer ? `for "${p.customer}"` : 'tenant-wide';
  return {
    success: true,
    message: `Progress ${scope}`,
    data: { total, installed, pending: Math.max(0, total - installed), progress },
    summary: `Installation progress ${scope}: ${progress}% (${installed}/${total} devices installed).`,
  };
}

// ── get_average_time ──────────────────────────────────────────────────────────
export const getAverageTimeSchema = z.object({ customer: z.string().optional() });

export async function getAverageTime(
  ctx: McpContext,
  p: z.infer<typeof getAverageTimeSchema>,
): Promise<ToolResponse> {
  const cid = await scopeCustomerId(ctx, p.customer);
  if (cid === false) return scopeError(p.customer!);
  const { grandTotal, installed } = perTechnician(await installEvents(ctx, cid));
  const avgMs = installed ? grandTotal / installed : 0;
  const scope = p.customer ? `for "${p.customer}"` : 'tenant-wide';
  return {
    success: true,
    message: `Average installation time ${scope}`,
    data: { installed, totalMs: grandTotal, avgMs },
    summary: `Average installation time ${scope}: ${fmtH(avgMs)} per device (${fmtH(
      grandTotal,
    )} over ${installed} installs).`,
  };
}

// ── get_technician_performance ───────────────────────────────────────────────
export const getTechnicianPerformanceSchema = z.object({ customer: z.string().optional() });

export async function getTechnicianPerformance(
  ctx: McpContext,
  p: z.infer<typeof getTechnicianPerformanceSchema>,
): Promise<ToolResponse> {
  const cid = await scopeCustomerId(ctx, p.customer);
  if (cid === false) return scopeError(p.customer!);
  const { rows } = perTechnician(await installEvents(ctx, cid));
  const ranking = rows.map((r) => ({
    technician: r.name,
    installed: r.installed,
    totalTime: fmtH(r.totalMs),
    avgTime: fmtH(r.installed ? r.totalMs / r.installed : 0),
  }));
  const top = ranking[0];
  return {
    success: true,
    message: `Technician ranking (${ranking.length})`,
    data: { technicians: ranking },
    summary: top
      ? `Top technician: ${top.technician} with ${top.installed} installs (avg ${top.avgTime}).`
      : 'No installations recorded yet.',
  };
}

// ── get_activity_log ──────────────────────────────────────────────────────────
export const getActivityLogSchema = z.object({
  customer: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function getActivityLog(
  ctx: McpContext,
  p: z.infer<typeof getActivityLogSchema>,
): Promise<ToolResponse> {
  const cid = await scopeCustomerId(ctx, p.customer);
  if (cid === false) return scopeError(p.customer!);
  const { workOrders, workOrdersEvents } = ctx.schema;
  const conds = [eq(workOrders.tenantId, ctx.tenantId)];
  if (cid) conds.push(eq(workOrders.customerId, cid));

  const rows = await ctx.db
    .select({
      code: workOrders.code,
      eventType: workOrdersEvents.eventType,
      actor: workOrdersEvents.actor,
      createdAt: workOrdersEvents.createdAt,
    })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(and(...conds))
    .orderBy(desc(workOrdersEvents.createdAt))
    .limit(p.limit ?? 20);

  const items = rows.map((r) => {
    const a = (r.actor ?? {}) as { name?: string; email?: string };
    return {
      workOrder: r.code,
      eventType: r.eventType,
      by: a.name || a.email || null,
      at: r.createdAt,
    };
  });
  return {
    success: true,
    message: `${items.length} recent event(s)`,
    data: { activity: items },
    summary: `Most recent activity: ${items
      .slice(0, 3)
      .map((i) => `${i.eventType} on ${i.workOrder}`)
      .join('; ') || 'none'}.`,
  };
}

// ── get_daily_summary ─────────────────────────────────────────────────────────
export const getDailySummarySchema = z.object({ customer: z.string().optional() });

export async function getDailySummary(
  ctx: McpContext,
  p: z.infer<typeof getDailySummarySchema>,
): Promise<ToolResponse> {
  const cid = await scopeCustomerId(ctx, p.customer);
  if (cid === false) return scopeError(p.customer!);
  const { workOrders, workOrdersEvents } = ctx.schema;
  const woCustomer = cid ? [eq(workOrders.customerId, cid)] : [];

  const [{ installsToday }] = await ctx.db
    .select({ installsToday: sql<number>`count(distinct ${workOrdersEvents.deviceId})::int` })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(
      and(
        eq(workOrders.tenantId, ctx.tenantId),
        eq(workOrdersEvents.eventType, INSTALL),
        sql`${workOrdersEvents.createdAt} >= date_trunc('day', now())`,
        ...woCustomer,
      ),
    );

  const [{ open }] = await ctx.db
    .select({ open: sql<number>`count(*)::int` })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, ctx.tenantId),
        sql`${workOrders.status} <> all(${TERMINAL})`,
        ...woCustomer,
      ),
    );

  const scope = p.customer ? `for "${p.customer}"` : 'tenant-wide';
  return {
    success: true,
    message: `Daily summary ${scope}`,
    data: { installsToday, openWorkOrders: open },
    summary: `Today ${scope}: ${installsToday} device(s) installed, ${open} work order(s) still open.`,
  };
}
