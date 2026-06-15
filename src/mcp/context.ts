// RFC-0042 — shared context for the Work Orders MCP server.
// A server instance is pinned to one tenant (GCDR_TENANT_ID) and reads through
// the existing WO services/repositories. Read-only: no tool performs writes.

import { workOrderService } from '../services/work-orders/WorkOrderService';
import { workOrdersCustomerSettingsService } from '../services/work-orders/WorkOrdersCustomerSettingsService';
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
  customers: CustomerRepository;
  db: typeof db;
  schema: typeof schema;
}

export function loadContext(): McpContext {
  const tenantId = process.env.GCDR_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'GCDR_TENANT_ID is required to run the Work Orders MCP server (RFC-0042).',
    );
  }
  return {
    tenantId,
    workOrders: workOrderService,
    settings: workOrdersCustomerSettingsService,
    customers: new CustomerRepository(),
    db,
    schema,
  };
}
