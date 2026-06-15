// RFC-0041 — reader for the per-tenant WO lifecycle rules table.
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const { workOrdersLifecycleRules } = schema;

export type LifecycleRuleRow = typeof workOrdersLifecycleRules.$inferSelect;

export interface LifecycleRuleInput {
  woType: string | null;
  eventType: string;
  predecessors: string[];
  predecessorRule: string;
  activates: string[];
  projectsStatus: string | null;
  isEntry: boolean;
  sortOrder: number;
  active: boolean;
}

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

  /** All rules (incl. inactive) — for the admin editor. */
  async listAllByTenant(tenantId: string): Promise<LifecycleRuleRow[]> {
    return db
      .select()
      .from(workOrdersLifecycleRules)
      .where(eq(workOrdersLifecycleRules.tenantId, tenantId))
      .orderBy(
        asc(workOrdersLifecycleRules.woType),
        asc(workOrdersLifecycleRules.sortOrder),
        asc(workOrdersLifecycleRules.eventType),
      );
  },

  /** Replace the whole tenant flow in one transaction. */
  async replaceForTenant(tenantId: string, rules: LifecycleRuleInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(workOrdersLifecycleRules)
        .where(eq(workOrdersLifecycleRules.tenantId, tenantId));
      if (rules.length) {
        await tx.insert(workOrdersLifecycleRules).values(
          rules.map((r) => ({
            tenantId,
            woType: r.woType,
            eventType: r.eventType,
            predecessors: r.predecessors,
            predecessorRule: r.predecessorRule,
            activates: r.activates,
            projectsStatus: r.projectsStatus,
            isEntry: r.isEntry,
            sortOrder: r.sortOrder,
            active: r.active,
          })),
        );
      }
    });
  },
};
