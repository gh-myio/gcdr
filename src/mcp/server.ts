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
      case 'get_work_order':
        result = await getWorkOrder(ctx, getWorkOrderSchema.parse(args));
        break;
      case 'get_transitions':
        result = await getTransitions(ctx, getTransitionsSchema.parse(args));
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
