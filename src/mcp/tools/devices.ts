// RFC-0042 — device tools (scope + details), customer-scoped.
import { z } from 'zod';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { McpContext, ToolResponse } from '../context';
import { resolveCustomer } from './customers';
import { fuzzyMatch } from '../utils/fuzzyMatch';

const INSTALL = 'PRODUTO_INSTALADO';

interface ScopeDevice {
  id: string;
  name: string;
  code: string | null;
  serialNumber: string | null;
}

async function scopeDevices(ctx: McpContext, customerId: string): Promise<ScopeDevice[]> {
  const { workOrders, workOrdersDevices, devices } = ctx.schema;
  const rows = await ctx.db
    .selectDistinct({
      id: devices.id,
      name: devices.displayName,
      code: devices.code,
      serialNumber: devices.serialNumber,
    })
    .from(workOrdersDevices)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersDevices.workOrderId))
    .innerJoin(devices, eq(devices.id, workOrdersDevices.deviceId))
    .where(and(eq(workOrders.tenantId, ctx.tenantId), eq(workOrders.customerId, customerId)));
  return rows as ScopeDevice[];
}

async function installedDeviceIds(ctx: McpContext, customerId: string): Promise<Set<string>> {
  const { workOrders, workOrdersEvents } = ctx.schema;
  const rows = await ctx.db
    .selectDistinct({ deviceId: workOrdersEvents.deviceId })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(
      and(
        eq(workOrders.tenantId, ctx.tenantId),
        eq(workOrders.customerId, customerId),
        eq(workOrdersEvents.eventType, INSTALL),
        isNotNull(workOrdersEvents.deviceId),
      ),
    );
  return new Set(rows.map((r) => r.deviceId as string));
}

function customerNotFound(query: string): ToolResponse {
  return {
    success: false,
    message: `No customer matches "${query}"`,
    data: null,
    summary: `No customer matched "${query}".`,
  };
}

// ── get_devices ───────────────────────────────────────────────────────────────
export const getDevicesSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  filter: z.enum(['all', 'installed', 'pending']).optional().default('all'),
});

export async function getDevices(
  ctx: McpContext,
  p: z.infer<typeof getDevicesSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);

  const [all, installed] = await Promise.all([
    scopeDevices(ctx, c.id),
    installedDeviceIds(ctx, c.id),
  ]);
  const enriched = all.map((d) => ({ ...d, installed: installed.has(d.id) }));
  const filtered =
    p.filter === 'installed'
      ? enriched.filter((d) => d.installed)
      : p.filter === 'pending'
        ? enriched.filter((d) => !d.installed)
        : enriched;

  return {
    success: true,
    message: `${filtered.length} device(s) (${p.filter}) for ${c.name}`,
    data: { customer: c, devices: filtered },
    summary: `${c.name}: ${all.length} devices in scope, ${installed.size} installed, ${
      all.length - installed.size
    } pending.`,
  };
}

// ── get_device_details ────────────────────────────────────────────────────────
export const getDeviceDetailsSchema = z.object({
  customer: z.string().describe('Customer name or code (fuzzy)'),
  device: z.string().describe('Device name, serial or code (fuzzy)'),
});

export async function getDeviceDetails(
  ctx: McpContext,
  p: z.infer<typeof getDeviceDetailsSchema>,
): Promise<ToolResponse> {
  const c = await resolveCustomer(ctx, p.customer);
  if (!c) return customerNotFound(p.customer);

  const all = await scopeDevices(ctx, c.id);
  const match = fuzzyMatch(p.device, all, [
    (d) => d.serialNumber,
    (d) => d.code,
    (d) => d.name,
    (d) => d.id,
  ]);
  if (!match) {
    return {
      success: false,
      message: `No device matches "${p.device}" for ${c.name}`,
      data: { available: all.slice(0, 20).map((d) => d.name) },
      summary: `No device matched "${p.device}" in ${c.name}'s scope.`,
    };
  }

  const { workOrders, workOrdersEvents } = ctx.schema;
  const events = await ctx.db
    .select({
      code: workOrders.code,
      eventType: workOrdersEvents.eventType,
      actor: workOrdersEvents.actor,
      createdAt: workOrdersEvents.createdAt,
    })
    .from(workOrdersEvents)
    .innerJoin(workOrders, eq(workOrders.id, workOrdersEvents.workOrderId))
    .where(
      and(eq(workOrders.tenantId, ctx.tenantId), eq(workOrdersEvents.deviceId, match.id)),
    )
    .orderBy(desc(workOrdersEvents.createdAt))
    .limit(20);

  const history = events.map((e) => {
    const a = (e.actor ?? {}) as { name?: string; email?: string };
    return { workOrder: e.code, eventType: e.eventType, by: a.name || a.email || null, at: e.createdAt };
  });
  const installed = history.some((h) => h.eventType === INSTALL);

  return {
    success: true,
    message: `Device ${match.name}`,
    data: { device: match, installed, history },
    summary: `${match.name} (serial ${match.serialNumber ?? '—'}) is ${
      installed ? 'installed' : 'pending'
    }; ${history.length} event(s) on record.`,
  };
}
