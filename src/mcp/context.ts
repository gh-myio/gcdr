// RFC-0042 — shared context for the Work Orders MCP server.
// A server instance is pinned to one tenant (GCDR_TENANT_ID) and reads through
// the existing WO services/repositories. Read-only: no tool performs writes.

import { workOrderService } from '../services/work-orders/WorkOrderService';
import { workOrdersCustomerSettingsService } from '../services/work-orders/WorkOrdersCustomerSettingsService';
import { ruleService } from '../services/RuleService';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { db, schema } from '../infrastructure/database/drizzle/db';

export interface ToolResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  summary: string;
}

export interface McpContext {
  tenantId: string;
  workOrders: typeof workOrderService;
  settings: typeof workOrdersCustomerSettingsService;
  rules: typeof ruleService;
  customers: CustomerRepository;
  db: typeof db;
  schema: typeof schema;
}

/** Build a context for a given tenant (used by the HTTP assistant, RFC-0043). */
export function makeContext(tenantId: string): McpContext {
  return {
    tenantId,
    workOrders: workOrderService,
    settings: workOrdersCustomerSettingsService,
    rules: ruleService,
    customers: new CustomerRepository(),
    db,
    schema,
  };
}

/** Env-pinned context for the stdio MCP server (RFC-0042). */
export function loadContext(): McpContext {
  const tenantId = process.env.GCDR_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'GCDR_TENANT_ID is required to run the Work Orders MCP server (RFC-0042).',
    );
  }
  return makeContext(tenantId);
}
