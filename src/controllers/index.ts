// Public routes
export { default as authController } from './auth.controller';
export { default as healthController } from './health.controller';
export { default as docsController } from './docs.controller';

// Admin routes (development only)
export { dbAdminController } from './admin/db-admin.controller';
export { monitorAdminController } from './admin/monitor-admin.controller';

// Protected routes
export { default as customersController } from './customers.controller';
export { default as assetsController } from './assets.controller';
export { default as partnersController } from './partners.controller';
export { default as groupsController } from './groups.controller';
export { default as domainsController } from './domains.controller';
export { default as devicesController, listByAssetHandler as devicesListByAssetHandler, listByCustomerHandler as devicesListByCustomerHandler } from './devices.controller';
export { default as usersController, listByCustomerHandler as usersListByCustomerHandler } from './users.controller';
export { default as policiesController } from './policies.controller';
export { default as rolesController } from './roles.controller';
export { default as authorizationController } from './authorization.controller';
export { default as rulesController, listByCustomerHandler as rulesListByCustomerHandler, clearCustomerRuleDevicesHandler, getAlarmBundleHandler, getSimplifiedAlarmBundleHandler, getAlarmBundleVersionsHandler, invalidateAlarmBundleCacheHandler, getAlarmBundleVerifyHandler, listInternalSupportRulesHandler } from './rules.controller';
export { default as integrationsController } from './integrations.controller';
export { default as customerApiKeysController } from './customer-api-keys.controller';
export { auditLogsController } from './audit-logs.controller';
export { simulatorController } from './simulator.controller';
export { default as centralsController, listByCustomerHandler as centralsListByCustomerHandler, listByAssetHandler as centralsListByAssetHandler } from './centrals.controller';
export { default as themesController, listByCustomerHandler as themesListByCustomerHandler, getDefaultByCustomerHandler as themesGetDefaultByCustomerHandler } from './themes.controller';

// RFC-0013: User Access Profile Bundle
export { default as maintenanceGroupsController } from './maintenance-groups.controller';
export { default as accessBundleController } from './access-bundle.controller';

// RFC-0020: Public Single Apps
export { default as publicSingleAppsController } from './public-single-apps.controller';

// RFC-0021: HTML Templates Engine
export { default as templatesController } from './templates.controller';
export { default as templateTypesController } from './template-types.controller';

// Dashboard
export { dashboardController } from './dashboard.controller';

// RFC-0030: MYIO Wiki (Knowledge Base Module)
export { default as wikiController } from './wiki.controller';
export { default as wikiPublicController } from './wiki-public.controller';

// Generic file/asset storage (S3-backed) — RFC-0030 / RFC-0031
export { default as fileAssetsController } from './file-assets.controller';
export { default as fileAssetsPublicController } from './file-assets-public.controller';

// RFC-0032: QR Checker module
export {
  qrcCustomersController,
  qrcInstallationsController,
  qrcVisitasController,
  qrcUsersController,
} from './qrc';

// RFC-0023: Device Sync Jobs
export { default as deviceSyncJobsController } from './device-sync-jobs.controller';

// RFC-0024: Alarm Dispatch Configuration
export { default as customerChannelsController } from './customer-channels.controller';
export { default as groupDispatchController } from './group-dispatch.controller';
export { default as groupChannelsController } from './group-channels.controller';
export { default as userContactsController } from './user-contacts.controller';

// RFC-0033: Customer Integration Sync State
export { default as customerIntegrationsController } from './customer-integrations.controller';
