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
const queryClient = postgres(connectionString);

// Create Drizzle instance with schema
export const db = drizzle(queryClient, { schema });

// Export schema for use in queries
export { schema };

// Export types inferred from schema
export type Customer = typeof schema.customers.$inferSelect;
export type NewCustomer = typeof schema.customers.$inferInsert;

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;

export type Asset = typeof schema.assets.$inferSelect;
export type NewAsset = typeof schema.assets.$inferInsert;

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

// RFC-0032: QR Checker module
export type WoCustomerSettingsRow = typeof schema.woCustomerSettings.$inferSelect;
export type NewWoCustomerSettingsRow = typeof schema.woCustomerSettings.$inferInsert;

export type WoInstallationRow = typeof schema.woInstallations.$inferSelect;
export type NewWoInstallationRow = typeof schema.woInstallations.$inferInsert;

export type WoInstallationImageRow = typeof schema.woInstallationImages.$inferSelect;
export type NewWoInstallationImageRow = typeof schema.woInstallationImages.$inferInsert;

export type WoInstallationAuditRow = typeof schema.woInstallationAudit.$inferSelect;
export type NewWoInstallationAuditRow = typeof schema.woInstallationAudit.$inferInsert;

export type WoMaintenanceTaskRow = typeof schema.woMaintenanceTasks.$inferSelect;
export type NewWoMaintenanceTaskRow = typeof schema.woMaintenanceTasks.$inferInsert;

export type WoCustomerObservationRow = typeof schema.woCustomerObservations.$inferSelect;
export type NewWoCustomerObservationRow = typeof schema.woCustomerObservations.$inferInsert;

export type WoVisitaTecnicaRow = typeof schema.woVisitasTecnicas.$inferSelect;
export type NewWoVisitaTecnicaRow = typeof schema.woVisitasTecnicas.$inferInsert;

export type WoVisitaAmbienteRow = typeof schema.woVisitaAmbientes.$inferSelect;
export type NewWoVisitaAmbienteRow = typeof schema.woVisitaAmbientes.$inferInsert;

export type WoVisitaAmbienteImageRow = typeof schema.woVisitaAmbienteImages.$inferSelect;
export type NewWoVisitaAmbienteImageRow = typeof schema.woVisitaAmbienteImages.$inferInsert;

export type WoVisitaProductRow = typeof schema.woVisitaProducts.$inferSelect;
export type NewWoVisitaProductRow = typeof schema.woVisitaProducts.$inferInsert;

export type WoVisitaProductImageRow = typeof schema.woVisitaProductImages.$inferSelect;
export type NewWoVisitaProductImageRow = typeof schema.woVisitaProductImages.$inferInsert;

export type WoVisitaObservationRow = typeof schema.woVisitaObservations.$inferSelect;
export type NewWoVisitaObservationRow = typeof schema.woVisitaObservations.$inferInsert;

export type WoVisitaAuditRow = typeof schema.woVisitaAudit.$inferSelect;
export type NewWoVisitaAuditRow = typeof schema.woVisitaAudit.$inferInsert;
