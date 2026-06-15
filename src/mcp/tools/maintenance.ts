// RFC-0042 — maintenance tool (MANUTENCAO work orders).
import { z } from 'zod';
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
const OPEN = new Set(['PLANEJADA', 'EM_ANDAMENTO', 'INTERROMPIDA', 'AGUARDANDO', 'REAGENDADA']);

export const getMaintenanceSchema = z.object({
  customer: z.string().optional().describe('Customer name/code; omit for tenant-wide'),
  status: z.enum(STATUS).optional(),
});

export async function getMaintenance(
  ctx: McpContext,
  p: z.infer<typeof getMaintenanceSchema>,
): Promise<ToolResponse> {
  let customerId: string | undefined;
  let customerName: string | undefined;
  if (p.customer) {
    const c = await resolveCustomer(ctx, p.customer);
    if (!c) {
      return {
        success: false,
        message: `No customer matches "${p.customer}"`,
        data: null,
        summary: `No customer matched "${p.customer}".`,
      };
    }
    customerId = c.id;
    customerName = c.name;
  }

  const res = await ctx.workOrders.list(ctx.tenantId, {
    customerId,
    type: 'MANUTENCAO',
    status: p.status,
    limit: 100,
    sort: 'createdAt_desc',
  });
  const items = res.items.map((wo) => ({
    code: wo.code,
    status: wo.status,
    scheduledAt: wo.scheduledAt,
    assignedTo: wo.assignedTo,
  }));
  const open = items.filter((i) => OPEN.has(i.status)).length;
  const scope = customerName ? `for ${customerName}` : 'tenant-wide';
  return {
    success: true,
    message: `${items.length} maintenance work order(s) ${scope}`,
    data: { maintenance: items },
    summary: `${items.length} maintenance work order(s) ${scope}, ${open} still open.`,
  };
}
