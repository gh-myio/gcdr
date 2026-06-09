import { WoCustomerSettings } from '../../../domain/entities/wo/CustomerSettings';

export interface IWoCustomerSettingsRepository {
  /** Insert a new settings row. Throws CONFLICT if customer is already QR-enabled. */
  enable(
    tenantId: string,
    customerId: string,
    data: {
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      woMetadata:        Record<string, unknown>;
    },
    createdBy: string,
  ): Promise<WoCustomerSettings>;

  /** Read by customer id. */
  getByCustomerId(tenantId: string, customerId: string): Promise<WoCustomerSettings | null>;

  /** Patch an existing row. Returns the updated entity. */
  update(
    tenantId: string,
    customerId: string,
    patch: Partial<{
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      woMetadata:        Record<string, unknown>;
    }>,
  ): Promise<WoCustomerSettings>;

  /** Hard-delete the settings row (the customer itself is preserved). */
  disable(tenantId: string, customerId: string): Promise<void>;

  /** List every QR-enabled customer in the tenant (admin scope). */
  listEnabled(tenantId: string): Promise<WoCustomerSettings[]>;
}
