// Public routes
export { default as authController } from './auth.controller';
export { default as healthController } from './health.controller';
export { default as docsController } from './docs.controller';

// Admin routes (development only)
export { dbAdminController } from './admin/db-admin.controller';

// Protected routes
export { default as customersController } from './customers.controller';
export { default as devicesController, listByAssetHandler as devicesListByAssetHandler } from './devices.controller';
export { default as usersController, listByCustomerHandler as usersListByCustomerHandler } from './users.controller';
export { default as policiesController } from './policies.controller';
export { default as authorizationController } from './authorization.controller';
export { default as rulesController, listByCustomerHandler as rulesListByCustomerHandler, getAlarmBundleHandler } from './rules.controller';
export { default as integrationsController } from './integrations.controller';
export { default as customerApiKeysController } from './customer-api-keys.controller';
