#!/usr/bin/env npx tsx
/**
 * RFC-0042 — Work Orders MCP server (read-only).
 *
 * Lets chatbots/LLMs query the GCDR Work Orders (OS) domain in natural language.
 * Pinned to one tenant via GCDR_TENANT_ID; reads through the WO services/repos.
 *
 * Usage:   npx tsx src/mcp/server.ts
 * Env:     DATABASE_URL, GCDR_TENANT_ID (required)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadContext, ToolResponse } from './context';
import {
  listCustomersSchema,
  findCustomerSchema,
  listCustomers,
  findCustomer,
} from './tools/customers';
import {
  listWorkOrdersSchema,
  getWorkOrderSchema,
  getTransitionsSchema,
  listWorkOrders,
  getWorkOrder,
  getTransitions,
} from './tools/workOrders';
import {
  getDevicesSchema,
  getDeviceDetailsSchema,
  getDevices,
  getDeviceDetails,
} from './tools/devices';
import { getMaintenanceSchema, getMaintenance } from './tools/maintenance';
import {
  findTechnicianSchema,
  listTechnicianWorkOrdersSchema,
  findTechnician,
  listTechnicianWorkOrders,
} from './tools/technicians';
import {
  listAlarmRulesSchema,
  getAlarmRuleSchema,
  getRuleDevicesSchema,
  compareAlarmRulesSchema,
  listAlarmRules,
  getAlarmRule,
  getRuleDevices,
  compareAlarmRules,
} from './tools/rules';
import {
  getProgressSchema,
  getAverageTimeSchema,
  getTechnicianPerformanceSchema,
  getActivityLogSchema,
  getDailySummarySchema,
  getProgress,
  getAverageTime,
  getTechnicianPerformance,
  getActivityLog,
  getDailySummary,
} from './tools/analytics';

const ctx = loadContext();

const server = new Server(
  { name: 'gcdr-wo', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
});

const TOOLS = [
  {
    name: 'list_customers',
    description:
      'List OS-enabled customers with their work-order counts by status. The GCDR equivalent of the old "list malls".',
    inputSchema: obj({}),
  },
  {
    name: 'find_customer',
    description: 'Resolve a customer by fuzzy name or code (typo-tolerant).',
    inputSchema: obj({ name: { type: 'string', description: 'Customer name or code' } }, ['name']),
  },
  {
    name: 'list_work_orders',
    description: 'List a customer work orders, optionally filtered by status and type.',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        status: { type: 'string' },
        type: { type: 'string' },
        limit: { type: 'number' },
      },
      ['customer'],
    ),
  },
  {
    name: 'find_technician',
    description: 'Resolve a technician (the responsible person of work orders) by fuzzy name or email.',
    inputSchema: obj({ name: { type: 'string', description: 'Technician name or email' } }, ['name']),
  },
  {
    name: 'list_technician_work_orders',
    description:
      'List the work orders a technician is responsible for (assignedTo), optionally by status. Answers "which OS belong to <person>".',
    inputSchema: obj(
      {
        technician: { type: 'string', description: 'Technician name or email (fuzzy)' },
        status: { type: 'string' },
      },
      ['technician'],
    ),
  },
  {
    name: 'get_work_order',
    description: 'Full work order by code: type, status, device scope and recent timeline.',
    inputSchema: obj({ code: { type: 'string', description: 'Work order code, e.g. OS-ABC1D2' } }, [
      'code',
    ]),
  },
  {
    name: 'get_transitions',
    description:
      'Rules-engine evaluation (RFC-0041): which events can/cannot be appended next and why.',
    inputSchema: obj({ code: { type: 'string', description: 'Work order code' } }, ['code']),
  },
  {
    name: 'get_devices',
    description: 'Devices in a customer work-order scope, filterable by install state.',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        filter: { type: 'string', enum: ['all', 'installed', 'pending'] },
      },
      ['customer'],
    ),
  },
  {
    name: 'get_device_details',
    description: 'A device (fuzzy by name/serial/code) with its event history.',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        device: { type: 'string', description: 'Device name, serial or code (fuzzy)' },
      },
      ['customer', 'device'],
    ),
  },
  {
    name: 'get_maintenance',
    description: 'Maintenance (MANUTENCAO) work orders, optionally by customer/status.',
    inputSchema: obj({ customer: { type: 'string' }, status: { type: 'string' } }),
  },
  {
    name: 'list_alarm_rules',
    description: 'List a customer alarm rules (name, type, priority, enabled, scope, device count).',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        type: {
          type: 'string',
          enum: ['ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW', 'DEVICE_OFFLINE'],
        },
        enabled: { type: 'boolean' },
      },
      ['customer'],
    ),
  },
  {
    name: 'get_alarm_rule',
    description:
      'A customer alarm rule in detail: Condition, Behavior (guards/escalation/channels), Schedule and Scope (with devices).',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        rule: { type: 'string', description: 'Rule name (fuzzy)' },
      },
      ['customer', 'rule'],
    ),
  },
  {
    name: 'get_rule_devices',
    description: 'The devices a given alarm rule applies to (scope).',
    inputSchema: obj(
      {
        customer: { type: 'string', description: 'Customer name or code (fuzzy)' },
        rule: { type: 'string', description: 'Rule name (fuzzy)' },
      },
      ['customer', 'rule'],
    ),
  },
  {
    name: 'compare_alarm_rules',
    description:
      'Compare the alarm rule sets of two customers: same-named rules and whether their Condition, Behavior, Schedule and Scope match, plus rules unique to each.',
    inputSchema: obj(
      {
        customerA: { type: 'string', description: 'First customer name or code (fuzzy)' },
        customerB: { type: 'string', description: 'Second customer name or code (fuzzy)' },
      },
      ['customerA', 'customerB'],
    ),
  },
  {
    name: 'get_progress',
    description: 'Installation progress % for a customer or tenant-wide.',
    inputSchema: obj({ customer: { type: 'string' } }),
  },
  {
    name: 'get_average_time',
    description: 'Average installation time (gap model) for a customer or tenant-wide.',
    inputSchema: obj({ customer: { type: 'string' } }),
  },
  {
    name: 'get_technician_performance',
    description: 'Technician ranking by installs with total/average time.',
    inputSchema: obj({ customer: { type: 'string' } }),
  },
  {
    name: 'get_activity_log',
    description: 'Recent work-order events (timeline feed).',
    inputSchema: obj({ customer: { type: 'string' }, limit: { type: 'number' } }),
  },
  {
    name: 'get_daily_summary',
    description: "Today's installs and the open work-order backlog.",
    inputSchema: obj({ customer: { type: 'string' } }),
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: ToolResponse;
    switch (name) {
      case 'list_customers':
        listCustomersSchema.parse(args ?? {});
        result = await listCustomers(ctx);
        break;
      case 'find_customer':
        result = await findCustomer(ctx, findCustomerSchema.parse(args));
        break;
      case 'list_work_orders':
        result = await listWorkOrders(ctx, listWorkOrdersSchema.parse(args));
        break;
      case 'find_technician':
        result = await findTechnician(ctx, findTechnicianSchema.parse(args));
        break;
      case 'list_technician_work_orders':
        result = await listTechnicianWorkOrders(ctx, listTechnicianWorkOrdersSchema.parse(args));
        break;
      case 'get_work_order':
        result = await getWorkOrder(ctx, getWorkOrderSchema.parse(args));
        break;
      case 'get_transitions':
        result = await getTransitions(ctx, getTransitionsSchema.parse(args));
        break;
      case 'get_devices':
        result = await getDevices(ctx, getDevicesSchema.parse(args));
        break;
      case 'get_device_details':
        result = await getDeviceDetails(ctx, getDeviceDetailsSchema.parse(args));
        break;
      case 'get_maintenance':
        result = await getMaintenance(ctx, getMaintenanceSchema.parse(args ?? {}));
        break;
      case 'list_alarm_rules':
        result = await listAlarmRules(ctx, listAlarmRulesSchema.parse(args));
        break;
      case 'get_alarm_rule':
        result = await getAlarmRule(ctx, getAlarmRuleSchema.parse(args));
        break;
      case 'get_rule_devices':
        result = await getRuleDevices(ctx, getRuleDevicesSchema.parse(args));
        break;
      case 'compare_alarm_rules':
        result = await compareAlarmRules(ctx, compareAlarmRulesSchema.parse(args));
        break;
      case 'get_progress':
        result = await getProgress(ctx, getProgressSchema.parse(args ?? {}));
        break;
      case 'get_average_time':
        result = await getAverageTime(ctx, getAverageTimeSchema.parse(args ?? {}));
        break;
      case 'get_technician_performance':
        result = await getTechnicianPerformance(ctx, getTechnicianPerformanceSchema.parse(args ?? {}));
        break;
      case 'get_activity_log':
        result = await getActivityLog(ctx, getActivityLogSchema.parse(args ?? {}));
        break;
      case 'get_daily_summary':
        result = await getDailySummary(ctx, getDailySummarySchema.parse(args ?? {}));
        break;
      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Unknown tool: ${name}`,
                data: null,
                summary: `Tool "${name}" is not available.`,
              }),
            },
          ],
        };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: err instanceof Error ? err.message : String(err),
            data: null,
            summary: 'The tool call failed.',
          }),
        },
      ],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — log to stderr.
  console.error(`[gcdr-wo] MCP server ready (tenant ${ctx.tenantId})`);
}

main().catch((err) => {
  console.error('[gcdr-wo] fatal:', err);
  process.exit(1);
});
