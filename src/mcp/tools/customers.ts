// RFC-0042 — customer tools (the GCDR replacement for qr-checker's "malls").
import { z } from 'zod';
import { McpContext, ToolResponse } from '../context';
import { fuzzyMatch } from '../utils/fuzzyMatch';

export interface CustomerRef {
  id: string;
  name: string;
  code: string;
}

/** OS-enabled customers for the tenant, with display name/code resolved. */
export async function customerRoster(ctx: McpContext): Promise<CustomerRef[]> {
  const settings = await ctx.settings.listEnabled(ctx.tenantId);
  const refs: CustomerRef[] = [];
  for (const s of settings) {
    const c = await ctx.customers.getById(ctx.tenantId, s.customerId);
    refs.push({ id: s.customerId, name: c?.name ?? s.customerId, code: c?.code ?? '' });
  }
  return refs;
}

export async function resolveCustomer(
  ctx: McpContext,
  query: string,
): Promise<CustomerRef | null> {
  const roster = await customerRoster(ctx);
  return fuzzyMatch(query, roster, [(r) => r.code, (r) => r.name, (r) => r.id]);
}

// ── list_customers ──────────────────────────────────────────────────────────
export const listCustomersSchema = z.object({});

export async function listCustomers(ctx: McpContext): Promise<ToolResponse> {
  const roster = await customerRoster(ctx);
  const rows = [];
  for (const r of roster) {
    const res = await ctx.workOrders.list(ctx.tenantId, { customerId: r.id, limit: 100 });
    const byStatus: Record<string, number> = {};
    for (const wo of res.items) byStatus[wo.status] = (byStatus[wo.status] ?? 0) + 1;
    rows.push({
      ...r,
      workOrders: res.pagination.total ?? res.items.length,
      byStatus,
    });
  }
  const totalWo = rows.reduce((a, r) => a + r.workOrders, 0);
  return {
    success: true,
    message: `Found ${rows.length} OS-enabled customer(s)`,
    data: { customers: rows },
    summary: `There are ${rows.length} OS-enabled customers with ${totalWo} work orders in total.`,
  };
}

// ── find_customer ───────────────────────────────────────────────────────────
export const findCustomerSchema = z.object({
  name: z.string().describe('Customer name or code to resolve (fuzzy match)'),
});

export async function findCustomer(
  ctx: McpContext,
  params: z.infer<typeof findCustomerSchema>,
): Promise<ToolResponse> {
  const roster = await customerRoster(ctx);
  const match = fuzzyMatch(params.name, roster, [(r) => r.code, (r) => r.name, (r) => r.id]);
  if (!match) {
    const names = roster.map((r) => r.name).join(', ');
    return {
      success: false,
      message: `No customer matches "${params.name}"`,
      data: { available: roster },
      summary: `No customer matched "${params.name}". Available customers: ${names || '(none)'}.`,
    };
  }
  return {
    success: true,
    message: `Matched ${match.name}`,
    data: { customer: match },
    summary: `Matched customer "${match.name}" (code ${match.code || '—'}).`,
  };
}
