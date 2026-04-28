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
export type QrcCustomerSettingsRow = typeof schema.qrcCustomerSettings.$inferSelect;
export type NewQrcCustomerSettingsRow = typeof schema.qrcCustomerSettings.$inferInsert;

export type QrcInstallationRow = typeof schema.qrcInstallations.$inferSelect;
export type NewQrcInstallationRow = typeof schema.qrcInstallations.$inferInsert;

export type QrcInstallationImageRow = typeof schema.qrcInstallationImages.$inferSelect;
export type NewQrcInstallationImageRow = typeof schema.qrcInstallationImages.$inferInsert;

export type QrcInstallationAuditRow = typeof schema.qrcInstallationAudit.$inferSelect;
export type NewQrcInstallationAuditRow = typeof schema.qrcInstallationAudit.$inferInsert;

export type QrcMaintenanceTaskRow = typeof schema.qrcMaintenanceTasks.$inferSelect;
export type NewQrcMaintenanceTaskRow = typeof schema.qrcMaintenanceTasks.$inferInsert;

export type QrcCustomerObservationRow = typeof schema.qrcCustomerObservations.$inferSelect;
export type NewQrcCustomerObservationRow = typeof schema.qrcCustomerObservations.$inferInsert;

export type QrcVisitaTecnicaRow = typeof schema.qrcVisitasTecnicas.$inferSelect;
export type NewQrcVisitaTecnicaRow = typeof schema.qrcVisitasTecnicas.$inferInsert;

export type QrcVisitaAmbienteRow = typeof schema.qrcVisitaAmbientes.$inferSelect;
export type NewQrcVisitaAmbienteRow = typeof schema.qrcVisitaAmbientes.$inferInsert;

export type QrcVisitaAmbienteImageRow = typeof schema.qrcVisitaAmbienteImages.$inferSelect;
export type NewQrcVisitaAmbienteImageRow = typeof schema.qrcVisitaAmbienteImages.$inferInsert;

export type QrcVisitaProductRow = typeof schema.qrcVisitaProducts.$inferSelect;
export type NewQrcVisitaProductRow = typeof schema.qrcVisitaProducts.$inferInsert;

export type QrcVisitaProductImageRow = typeof schema.qrcVisitaProductImages.$inferSelect;
export type NewQrcVisitaProductImageRow = typeof schema.qrcVisitaProductImages.$inferInsert;

export type QrcVisitaObservationRow = typeof schema.qrcVisitaObservations.$inferSelect;
export type NewQrcVisitaObservationRow = typeof schema.qrcVisitaObservations.$inferInsert;

export type QrcVisitaAuditRow = typeof schema.qrcVisitaAudit.$inferSelect;
export type NewQrcVisitaAuditRow = typeof schema.qrcVisitaAudit.$inferInsert;
