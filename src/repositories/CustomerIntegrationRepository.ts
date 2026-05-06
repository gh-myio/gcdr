import { sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { now } from '../shared/utils/dateUtils';
import { NotFoundError } from '../shared/errors/AppError';
import type { IntegrationKey } from '../domain/integrations/IntegrationKey';

const { customers } = schema;

// =============================================================================
// RFC-0033 — Customer Integration Sync State (repository)
// =============================================================================
// Reads and writes go through a single JSONB path:
//   customers.metadata -> 'integrations' -> '<key>'
//
// Writes use jsonb_set on a coalesced metadata column so concurrent
// updates to OTHER integration keys (or to other top-level metadata
// fields) are not clobbered.
//
// Two writers updating the SAME key race for last-write-wins on the
// path; the per-call audit row in audit_logs (RFC-0009 §9) preserves
// both attempts.

export interface CustomerIntegrationRow {
  customerId: string;
  tenantId:   string;
  // Raw integrations map (no masking applied here — that is the
  // service / DTO layer's job).
  integrations: Record<string, unknown>;
}

export class CustomerIntegrationRepository {

  /**
   * Read the full integrations map for one customer. Returns `{}` when
   * the customer exists but has no integrations recorded, and throws
   * NotFoundError when the customer does not exist in the tenant.
   */
  async getAll(tenantId: string, customerId: string): Promise<CustomerIntegrationRow> {
    const rows = await db.execute(sql`
      SELECT
        coalesce(metadata->'integrations', '{}'::jsonb) AS integrations,
        id, tenant_id
      FROM customers
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
      LIMIT 1
    `);
    const row = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows?.[0]
             ?? (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!row) {
      throw new NotFoundError(`Customer ${customerId} not found in tenant ${tenantId}`);
    }
    const integrations = (row['integrations'] as Record<string, unknown> | null) ?? {};
    return { customerId, tenantId, integrations };
  }

  /**
   * Read one integration's state. Returns null when the key is absent
   * (= "never synchronised"). Throws NotFoundError if the customer does
   * not exist.
   */
  async getOne(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
  ): Promise<Record<string, unknown> | null> {
    const all = await this.getAll(tenantId, customerId);
    const value = all.integrations[key];
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  /**
   * Replace the state at metadata.integrations.<key> in a single
   * UPDATE. The full state object is passed in — caller is responsible
   * for merging with the previous value.
   */
  async setIntegration(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
    state: Record<string, unknown>,
  ): Promise<void> {
    const ts = now();
    const result = await db.execute(sql`
      UPDATE customers
      SET metadata = jsonb_set(
            jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{integrations}',
              coalesce(metadata->'integrations', '{}'::jsonb),
              true
            ),
            ${sql.raw(`'{integrations,${key}}'`)},
            ${JSON.stringify(state)}::jsonb,
            true
          ),
          updated_at = ${ts},
          version    = version + 1
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
    `);
    const rowCount = (result as unknown as { rowCount?: number }).rowCount;
    if (rowCount === 0) {
      throw new NotFoundError(`Customer ${customerId} not found in tenant ${tenantId}`);
    }
  }

  /**
   * Remove metadata.integrations.<key> entirely (used by reset).
   */
  async clearIntegration(
    tenantId: string,
    customerId: string,
    key: IntegrationKey,
  ): Promise<void> {
    const ts = now();
    const result = await db.execute(sql`
      UPDATE customers
      SET metadata = jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{integrations}',
            coalesce(metadata->'integrations', '{}'::jsonb) - ${key},
            true
          ),
          updated_at = ${ts},
          version    = version + 1
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
    `);
    const rowCount = (result as unknown as { rowCount?: number }).rowCount;
    if (rowCount === 0) {
      throw new NotFoundError(`Customer ${customerId} not found in tenant ${tenantId}`);
    }
  }
}

export const customerIntegrationRepository = new CustomerIntegrationRepository();
