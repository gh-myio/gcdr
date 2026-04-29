import { QrcCustomerSettings } from '../../../domain/entities/qrc/CustomerSettings';

export interface IQrcCustomerSettingsRepository {
  /** Insert a new settings row. Throws CONFLICT if customer is already QR-enabled. */
  enable(
    tenantId: string,
    customerId: string,
    data: {
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      qrcMetadata:        Record<string, unknown>;
    },
    createdBy: string,
  ): Promise<QrcCustomerSettings>;

  /** Read by customer id. */
  getByCustomerId(tenantId: string, customerId: string): Promise<QrcCustomerSettings | null>;

  /** Patch an existing row. Returns the updated entity. */
  update(
    tenantId: string,
    customerId: string,
    patch: Partial<{
      viewerPasswordHash: string | null;
      defaultCentralId:   string | null;
      qrcMetadata:        Record<string, unknown>;
    }>,
  ): Promise<QrcCustomerSettings>;

  /** Hard-delete the settings row (the customer itself is preserved). */
  disable(tenantId: string, customerId: string): Promise<void>;

  /** List every QR-enabled customer in the tenant (admin scope). */
  listEnabled(tenantId: string): Promise<QrcCustomerSettings[]>;
}
