// RFC-0043 — GCDR Copiloto tool registry.
// Domain-agnostic: each entry adapts a read-only tool for the LLM (JSON schema
// for Anthropic + a zod-validated runner). Seeded with the Work Orders tools
// (RFC-0042); add tools from other domains here as they come.
import { McpContext } from '../../mcp/context';
import * as customers from '../../mcp/tools/customers';
import * as wo from '../../mcp/tools/workOrders';
import * as devices from '../../mcp/tools/devices';
import * as maintenance from '../../mcp/tools/maintenance';
import * as analytics from '../../mcp/tools/analytics';
import * as technicians from '../../mcp/tools/technicians';

export interface AssistantTool {
  name: string;
  description: string;
  /** JSON Schema for the Anthropic tool definition. */
  inputSchema: Record<string, unknown>;
  /** Parse + run; returns the tool result object (serialized to the model). */
  run: (ctx: McpContext, args: unknown) => Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

export const ASSISTANT_TOOLS: AssistantTool[] = [
  // ── Work Orders (RFC-0042) ──────────────────────────────────────────────
  {
    name: 'list_customers',
    description: 'List OS-enabled customers with their work-order counts by status.',
    inputSchema: obj({}),
    run: (ctx) => customers.listCustomers(ctx),
  },
  {
    name: 'find_customer',
    description: 'Resolve a customer by fuzzy name or code (typo-tolerant).',
    inputSchema: obj({ name: { type: 'string', description: 'Customer name or code' } }, ['name']),
    run: (ctx, a) => customers.findCustomer(ctx, customers.findCustomerSchema.parse(a)),
  },
  {
    name: 'list_work_orders',
    description: 'List a customer work orders, optionally filtered by status and type.',
    inputSchema: obj(
      {
        customer: { type: 'string' },
        status: { type: 'string' },
        type: { type: 'string' },
        limit: { type: 'number' },
      },
      ['customer'],
    ),
    run: (ctx, a) => wo.listWorkOrders(ctx, wo.listWorkOrdersSchema.parse(a)),
  },
  {
    name: 'find_technician',
    description: 'Resolve a technician (the responsible person of work orders) by fuzzy name or email.',
    inputSchema: obj({ name: { type: 'string', description: 'Technician name or email' } }, ['name']),
    run: (ctx, a) => technicians.findTechnician(ctx, technicians.findTechnicianSchema.parse(a)),
  },
  {
    name: 'list_technician_work_orders',
    description:
      'List the work orders a technician is responsible for (assignedTo), optionally by status. Use this to answer "which OS belong to <person>".',
    inputSchema: obj(
      { technician: { type: 'string' }, status: { type: 'string' } },
      ['technician'],
    ),
    run: (ctx, a) =>
      technicians.listTechnicianWorkOrders(ctx, technicians.listTechnicianWorkOrdersSchema.parse(a)),
  },
  {
    name: 'get_work_order',
    description: 'Full work order by code: type, status, device scope and recent timeline.',
    inputSchema: obj({ code: { type: 'string' } }, ['code']),
    run: (ctx, a) => wo.getWorkOrder(ctx, wo.getWorkOrderSchema.parse(a)),
  },
  {
    name: 'get_transitions',
    description: 'Rules engine (RFC-0041): which events can/cannot be appended next and why.',
    inputSchema: obj({ code: { type: 'string' } }, ['code']),
    run: (ctx, a) => wo.getTransitions(ctx, wo.getTransitionsSchema.parse(a)),
  },
  {
    name: 'get_devices',
    description: 'Devices in a customer work-order scope, filterable by install state.',
    inputSchema: obj(
      { customer: { type: 'string' }, filter: { type: 'string', enum: ['all', 'installed', 'pending'] } },
      ['customer'],
    ),
    run: (ctx, a) => devices.getDevices(ctx, devices.getDevicesSchema.parse(a)),
  },
  {
    name: 'get_device_details',
    description: 'A device (fuzzy by name/serial/code) with its event history.',
    inputSchema: obj({ customer: { type: 'string' }, device: { type: 'string' } }, ['customer', 'device']),
    run: (ctx, a) => devices.getDeviceDetails(ctx, devices.getDeviceDetailsSchema.parse(a)),
  },
  {
    name: 'get_maintenance',
    description: 'Maintenance (MANUTENCAO) work orders, optionally by customer/status.',
    inputSchema: obj({ customer: { type: 'string' }, status: { type: 'string' } }),
    run: (ctx, a) => maintenance.getMaintenance(ctx, maintenance.getMaintenanceSchema.parse(a)),
  },
  {
    name: 'get_progress',
    description: 'Installation progress % for a customer or tenant-wide.',
    inputSchema: obj({ customer: { type: 'string' } }),
    run: (ctx, a) => analytics.getProgress(ctx, analytics.getProgressSchema.parse(a)),
  },
  {
    name: 'get_average_time',
    description: 'Average installation time (gap model) for a customer or tenant-wide.',
    inputSchema: obj({ customer: { type: 'string' } }),
    run: (ctx, a) => analytics.getAverageTime(ctx, analytics.getAverageTimeSchema.parse(a)),
  },
  {
    name: 'get_technician_performance',
    description: 'Technician ranking by installs with total/average time.',
    inputSchema: obj({ customer: { type: 'string' } }),
    run: (ctx, a) =>
      analytics.getTechnicianPerformance(ctx, analytics.getTechnicianPerformanceSchema.parse(a)),
  },
  {
    name: 'get_activity_log',
    description: 'Recent work-order events (timeline feed).',
    inputSchema: obj({ customer: { type: 'string' }, limit: { type: 'number' } }),
    run: (ctx, a) => analytics.getActivityLog(ctx, analytics.getActivityLogSchema.parse(a)),
  },
  {
    name: 'get_daily_summary',
    description: "Today's installs and the open work-order backlog.",
    inputSchema: obj({ customer: { type: 'string' } }),
    run: (ctx, a) => analytics.getDailySummary(ctx, analytics.getDailySummarySchema.parse(a)),
  },
];

export const toolByName = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));
