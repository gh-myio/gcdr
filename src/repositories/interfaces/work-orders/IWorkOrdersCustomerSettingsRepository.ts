import { WorkOrdersCustomerSettings } from '../../../domain/entities/work-orders';

export interface IWorkOrdersCustomerSettingsRepository {
  /** Insert a new settings row. Throws CONFLICT if customer is already WO-enabled. */
  enable(
    tenantId: string,
    customerId: string,
    data: {
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      woMetadata:         Record<string, unknown>;
    },
    createdBy: string,
  ): Promise<WorkOrdersCustomerSettings>;

  getByCustomerId(tenantId: string, customerId: string): Promise<WorkOrdersCustomerSettings | null>;

  update(
    tenantId: string,
    customerId: string,
    patch: Partial<{
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      woMetadata:         Record<string, unknown>;
    }>,
  ): Promise<WorkOrdersCustomerSettings>;

  /** Hard-delete the settings row (the customer itself is preserved). */
  disable(tenantId: string, customerId: string): Promise<void>;

  /** List every WO-enabled customer in the tenant. */
  listEnabled(tenantId: string): Promise<WorkOrdersCustomerSettings[]>;
}
