// RFC-0041 — reader for the per-tenant WO lifecycle rules table.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const { workOrdersLifecycleRules } = schema;

export type LifecycleRuleRow = typeof workOrdersLifecycleRules.$inferSelect;

export const workOrderLifecycleRepository = {
  /** Active rules for a tenant (empty array → engine uses the built-in default). */
  async listByTenant(tenantId: string): Promise<LifecycleRuleRow[]> {
    return db
      .select()
      .from(workOrdersLifecycleRules)
      .where(
        and(
          eq(workOrdersLifecycleRules.tenantId, tenantId),
          eq(workOrdersLifecycleRules.active, true),
        ),
      );
  },
};
