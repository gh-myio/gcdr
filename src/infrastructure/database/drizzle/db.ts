// =============================================================================
// Drizzle Database Connection
// =============================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Connection string from environment
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create postgres client
// For query purposes (used by Drizzle)
const queryClient = postgres(connectionString, {
  onnotice: (notice) => {
    // executeRawScript() always ends with a defensive ROLLBACK so the reserved
    // socket returns to the pool clean; when no transaction is open Postgres
    // answers with WARNING 25P01 ("there is no transaction in progress").
    // That is expected on every DB-admin statement — swallow it so prod logs
    // only carry notices that mean something. Everything else still surfaces
    // (e.g. RAISE NOTICE from seeds/migrations).
    if (notice.code === '25P01') return;
    // eslint-disable-next-line no-console -- server-side notices are operational signal
    console.log(notice);
  },
});

// Create Drizzle instance with schema
export const db = drizzle(queryClient, { schema });

/**
 * Executes a raw (possibly multi-statement, possibly transactional) SQL script
 * on a RESERVED connection from the pool. postgres.js forbids explicit
 * BEGIN/COMMIT on pooled connections (UNSAFE_TRANSACTION) because statements
 * could land on different sockets; a reserved connection pins the whole script
 * to ONE socket, so ops scripts with BEGIN/COMMIT + temp tables run with real
 * transactional semantics (same class of fix as the {max: 1} one-liners used
 * during incident response).
 *
 * Returns: for a single statement, its rows; for multi-statement scripts, an
 * array with each statement's result (postgres.js semantics).
 */
export async function executeRawScript(sqlText: string): Promise<unknown> {
  const reserved = await queryClient.reserve();
  try {
    return await reserved.unsafe(sqlText);
  } finally {
    // The reserved socket goes BACK TO THE POOL: if the script failed mid-
    // transaction (or did BEGIN without COMMIT), the open aborted transaction
    // would poison every later query on this connection ("current transaction
    // is aborted..."). Defensive ROLLBACK — a no-op warning when there is no
    // transaction — guarantees the connection is returned clean.
    try {
      await reserved.unsafe('ROLLBACK');
    } catch {
      // connection-level failure; the pool will recycle the socket.
    }
    reserved.release();
  }
}

// Export schema for use in queries
export { schema };

// Export types inferred from schema
export type Customer = typeof schema.customers.$inferSelect;
export type NewCustomer = typeof schema.customers.$inferInsert;

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;

export type Asset = typeof schema.assets.$inferSelect;
export type NewAsset = typeof schema.assets.$inferInsert;

// RFC-0047: Generic Entity Registry
export type Entity = typeof schema.entities.$inferSelect;
export type NewEntity = typeof schema.entities.$inferInsert;

export type EntityType = typeof schema.entityTypes.$inferSelect;
export type NewEntityType = typeof schema.entityTypes.$inferInsert;

export type Device = typeof schema.devices.$inferSelect;
export type NewDevice = typeof schema.devices.$inferInsert;

export type Partner = typeof schema.partners.$inferSelect;
export type NewPartner = typeof schema.partners.$inferInsert;

export type Role = typeof schema.roles.$inferSelect;
export type NewRole = typeof schema.roles.$inferInsert;

export type Policy = typeof schema.policies.$inferSelect;
export type NewPolicy = typeof schema.policies.$inferInsert;

export type RoleAssignment = typeof schema.roleAssignments.$inferSelect;
export type NewRoleAssignment = typeof schema.roleAssignments.$inferInsert;

export type Rule = typeof schema.rules.$inferSelect;
export type NewRule = typeof schema.rules.$inferInsert;

export type Central = typeof schema.centrals.$inferSelect;
export type NewCentral = typeof schema.centrals.$inferInsert;

export type CentralBackup = typeof schema.centralBackups.$inferSelect;
export type NewCentralBackup = typeof schema.centralBackups.$inferInsert;

export type CentralRestoreJob = typeof schema.centralRestoreJobs.$inferSelect;
export type NewCentralRestoreJob = typeof schema.centralRestoreJobs.$inferInsert;

export type CentralCommand = typeof schema.centralCommands.$inferSelect;
export type NewCentralCommand = typeof schema.centralCommands.$inferInsert;

export type Group = typeof schema.groups.$inferSelect;
export type NewGroup = typeof schema.groups.$inferInsert;

export type LookAndFeel = typeof schema.lookAndFeels.$inferSelect;
export type NewLookAndFeel = typeof schema.lookAndFeels.$inferInsert;

export type CustomerApiKey = typeof schema.customerApiKeys.$inferSelect;
export type NewCustomerApiKey = typeof schema.customerApiKeys.$inferInsert;

export type IntegrationPackage = typeof schema.integrationPackages.$inferSelect;
export type NewIntegrationPackage = typeof schema.integrationPackages.$inferInsert;

export type PackageSubscription = typeof schema.packageSubscriptions.$inferSelect;
export type NewPackageSubscription = typeof schema.packageSubscriptions.$inferInsert;

export type AuditLog = typeof schema.auditLogs.$inferSelect;
export type NewAuditLog = typeof schema.auditLogs.$inferInsert;

export type AlarmBundleVersion = typeof schema.alarmBundleVersions.$inferSelect;
export type NewAlarmBundleVersion = typeof schema.alarmBundleVersions.$inferInsert;

export type PublicSingleApp = typeof schema.publicSingleApps.$inferSelect;
export type NewPublicSingleApp = typeof schema.publicSingleApps.$inferInsert;

export type PublicSingleAppResponse = typeof schema.publicSingleAppResponses.$inferSelect;
export type NewPublicSingleAppResponse = typeof schema.publicSingleAppResponses.$inferInsert;

// RFC-0030: Wiki
export type WikiPageRow = typeof schema.wikiPages.$inferSelect;
export type NewWikiPageRow = typeof schema.wikiPages.$inferInsert;

export type WikiPageRevisionRow = typeof schema.wikiPageRevisions.$inferSelect;
export type NewWikiPageRevisionRow = typeof schema.wikiPageRevisions.$inferInsert;

export type WikiNamespaceRow = typeof schema.wikiNamespaces.$inferSelect;
export type NewWikiNamespaceRow = typeof schema.wikiNamespaces.$inferInsert;

export type WikiPageLinkRow = typeof schema.wikiPageLinks.$inferSelect;
export type NewWikiPageLinkRow = typeof schema.wikiPageLinks.$inferInsert;

// File Assets (generic file storage)
export type FileAssetRow = typeof schema.fileAssets.$inferSelect;
export type NewFileAssetRow = typeof schema.fileAssets.$inferInsert;

// RFC-0037: Work Orders — event model (replaces the RFC-0032 QR-Checker tables).
export type WoCustomerSettingsRow = typeof schema.woCustomerSettings.$inferSelect;
export type NewWoCustomerSettingsRow = typeof schema.woCustomerSettings.$inferInsert;

export type WorkOrderRow = typeof schema.workOrders.$inferSelect;
export type NewWorkOrderRow = typeof schema.workOrders.$inferInsert;

export type WorkOrderDeviceRow = typeof schema.workOrdersDevices.$inferSelect;
export type NewWorkOrderDeviceRow = typeof schema.workOrdersDevices.$inferInsert;

export type WorkOrderEventTypeRow = typeof schema.workOrdersEventTypes.$inferSelect;
export type NewWorkOrderEventTypeRow = typeof schema.workOrdersEventTypes.$inferInsert;

export type WorkOrderEventRow = typeof schema.workOrdersEvents.$inferSelect;
export type NewWorkOrderEventRow = typeof schema.workOrdersEvents.$inferInsert;

export type WorkOrderFileRow = typeof schema.workOrderFiles.$inferSelect;
export type NewWorkOrderFileRow = typeof schema.workOrderFiles.$inferInsert;

// =============================================================================
// Boot-time DB readiness gate.
//
// On Dokploy, the app container can come up before Docker DNS has registered
// the postgres service alias on the shared network — the first queries then die
// with ENOTFOUND (2026-08-28 prod incident: simulator init failed at boot and
// never retried). postgres.js connects lazily, so we probe with SELECT 1 and
// back off until the database answers; startup subsystems run only after this
// resolves. Never throws — after the attempts are exhausted the server still
// starts (requests will surface their own errors) but the wait is logged.
// =============================================================================
export async function waitForDatabaseReady(maxAttempts = 12, delayMs = 5000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await queryClient`select 1`;
      if (attempt > 1) {
        // eslint-disable-next-line no-console -- startup diagnostics
        console.log(`[db] Database reachable after ${attempt} attempt(s)`);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- startup diagnostics
      console.warn(`[db] Not reachable yet (attempt ${attempt}/${maxAttempts}): ${msg.slice(0, 200)}`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // eslint-disable-next-line no-console -- startup diagnostics
  console.error(`[db] Still unreachable after ${maxAttempts} attempts — starting anyway (subsystems degraded)`);
  return false;
}
