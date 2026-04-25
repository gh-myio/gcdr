import express, { Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import {
  contextMiddleware,
  authMiddleware,
  hybridAuthMiddleware,
  hybridAuthByMethod,
  errorHandler,
  notFoundHandler,
} from './middleware';

import {
  authController,
  healthController,
  docsController,
  customersController,
  assetsController,
  partnersController,
  groupsController,
  domainsController,
  devicesController,
  devicesListByAssetHandler,
  devicesListByCustomerHandler,
  usersController,
  usersListByCustomerHandler,
  policiesController,
  rolesController,
  authorizationController,
  rulesController,
  rulesListByCustomerHandler,
  clearCustomerRuleDevicesHandler,
  getAlarmBundleHandler,
  getSimplifiedAlarmBundleHandler,
  getAlarmBundleVersionsHandler,
  invalidateAlarmBundleCacheHandler,
  getAlarmBundleVerifyHandler,
  listInternalSupportRulesHandler,
  integrationsController,
  customerApiKeysController,
  auditLogsController,
  simulatorController,
  dbAdminController,
  monitorAdminController,
  centralsController,
  centralsListByCustomerHandler,
  centralsListByAssetHandler,
  themesController,
  themesListByCustomerHandler,
  themesGetDefaultByCustomerHandler,
  // RFC-0013: User Access Profile Bundle
  maintenanceGroupsController,
  accessBundleController,
  // RFC-0020: Public Single Apps
  publicSingleAppsController,
  // RFC-0021: HTML Templates Engine
  templatesController,
  templateTypesController,
  // Dashboard
  dashboardController,
  // RFC-0023: Device Sync Jobs
  deviceSyncJobsController,
  // RFC-0024: Alarm Dispatch Configuration
  customerChannelsController,
  groupDispatchController,
  groupChannelsController,
  userContactsController,
  // RFC-0030: MYIO Wiki (Knowledge Base Module)
  wikiController,
  wikiPublicController,
  // Generic file/asset storage (S3)
  fileAssetsController,
} from './controllers';

import { simulatorAdminController } from './controllers/admin/simulator-admin.controller';
import { userAdminController } from './controllers/admin/user-admin.controller';

import { requestMonitorMiddleware } from './middleware/requestMonitor';
import { initializeAuditLogging } from './infrastructure/audit';
import { initializeSimulator, registerShutdownHandlers } from './services/SimulatorStartup';

const app: Express = express();

// Initialize audit logging (RFC-0009)
initializeAuditLogging();

// =============================================================================
// Global Middleware (order matters!)
// =============================================================================

// CORS configuration (must be early for preflight requests)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'X-API-Key', 'X-Admin-Password'],
}));

// Compression
app.use(compression());

// Body parsing (must be before routes that need req.body)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =============================================================================
// Routes BEFORE Helmet (need relaxed CSP for external scripts)
// =============================================================================

// API Documentation (Swagger UI - needs external scripts)
app.use('/docs', docsController);

// Database Admin UI (development only - needs external scripts for CodeMirror)
app.use('/admin/db', dbAdminController);

// Simulator Cockpit UI (RFC-0010)
app.use('/admin/simulator', simulatorAdminController);

// Admin User Management (RFC-0011)
app.use('/admin/users', userAdminController);

// API Monitor UI
app.use('/admin/monitor', monitorAdminController);

// =============================================================================
// Security Middleware (after admin routes that need relaxed CSP)
// =============================================================================

// Security headers
app.use(helmet());

// Request context
app.use(contextMiddleware);

// Request monitor (after contextMiddleware to capture tenantId/userId)
app.use(requestMonitorMiddleware);

// =============================================================================
// Public Routes (no authentication required)
// =============================================================================

// Health checks (no prefix - standard for k8s probes)
app.use('/health', healthController);

// =============================================================================
// API v1 Router
// =============================================================================

const apiV1Router = Router();

// -----------------------------------------------------------------------------
// Authentication (public)
// -----------------------------------------------------------------------------
apiV1Router.use('/auth', authController);

// -----------------------------------------------------------------------------
// Protected Routes (authentication required)
// -----------------------------------------------------------------------------

// Customer-specific nested routes MUST come before the general /customers router
// to ensure proper route matching (more specific routes first)

// Bundle Verify — health check for bundle config (no cache, no bundle generated)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/to-verify-service', authMiddleware, getAlarmBundleVerifyHandler);

// Bundle Cache Invalidation (must come before /bundle routes)
apiV1Router.delete('/customers/:customerId/alarm-rules/bundle/cache', hybridAuthMiddleware('bundles:read'), invalidateAlarmBundleCacheHandler);

// Bundle Versions (must come before /bundle/simple and /bundle)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/versions', hybridAuthMiddleware('bundles:read'), getAlarmBundleVersionsHandler);

// Customer Alarm Bundle - Simplified (supports JWT or API Key auth for M2M integration)
// More specific route MUST come first
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/simple', hybridAuthMiddleware('bundles:read'), getSimplifiedAlarmBundleHandler);

// Customer Alarm Bundle - Full (supports JWT or API Key auth for M2M integration)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle', hybridAuthMiddleware('bundles:read'), getAlarmBundleHandler);

// Customer API Keys (nested under customers)
apiV1Router.use('/customers/:customerId/api-keys', authMiddleware, customerApiKeysController);

// Customer Users (nested route)
apiV1Router.get('/customers/:customerId/users', authMiddleware, usersListByCustomerHandler);

// Customer Devices (nested route)
apiV1Router.get('/customers/:customerId/devices', authMiddleware, devicesListByCustomerHandler);

// Customer Rules (nested route)
apiV1Router.get('/customers/:customerId/rules', hybridAuthMiddleware('customers:read'), rulesListByCustomerHandler);
apiV1Router.get('/customers/:customerId/internal-support-rules', hybridAuthMiddleware('customers:read'), listInternalSupportRulesHandler);
apiV1Router.delete('/customers/:customerId/rules/devices', authMiddleware, clearCustomerRuleDevicesHandler);

// Customer Centrals (nested route)
apiV1Router.get('/customers/:customerId/centrals', authMiddleware, centralsListByCustomerHandler);

// Customer Themes (nested routes)
apiV1Router.get('/customers/:customerId/themes/default', authMiddleware, themesGetDefaultByCustomerHandler);
apiV1Router.get('/customers/:customerId/themes', authMiddleware, themesListByCustomerHandler);

// RFC-0024: User notification contacts (nested — must come before general /users router)
apiV1Router.use('/users/:userId/contacts', authMiddleware, userContactsController);

// RFC-0024: Customer dispatch channels (nested — must come before general /customers router)
apiV1Router.use('/customers/:customerId/channels', authMiddleware, customerChannelsController);

// Customers (general router - must come after specific nested routes)
// hybridAuth: supports JWT + API Key for ThingsBoard integration (RFC-0016)
apiV1Router.use('/customers', hybridAuthByMethod('customers:read', 'customers:write'), customersController);

// Devices (hybridAuth for ThingsBoard integration)
apiV1Router.use('/devices', hybridAuthByMethod('devices:read', 'devices:write'), devicesController);

// Assets (hybridAuth for ThingsBoard integration)
apiV1Router.use('/assets', hybridAuthByMethod('assets:read', 'assets:write'), assetsController);

// Asset Devices (nested route - must come after assets router for :assetId routes)
apiV1Router.get('/assets/:assetId/devices', authMiddleware, devicesListByAssetHandler);

// Asset Centrals (nested route)
apiV1Router.get('/assets/:assetId/centrals', authMiddleware, centralsListByAssetHandler);

// Centrals
apiV1Router.use('/centrals', authMiddleware, centralsController);

// Themes (Look and Feel)
apiV1Router.use('/themes', authMiddleware, themesController);

// Users
apiV1Router.use('/users', authMiddleware, usersController);

// Policies
apiV1Router.use('/policies', authMiddleware, policiesController);

// Roles
apiV1Router.use('/roles', authMiddleware, rolesController);

// Authorization
apiV1Router.use('/authorization', authMiddleware, authorizationController);

// Rules (hybridAuth: read=bundles:read, write=bundles:read OR rules:write)
apiV1Router.use('/rules', hybridAuthByMethod('bundles:read', ['bundles:read', 'rules:write']), rulesController);

// Integrations
apiV1Router.use('/integrations', authMiddleware, integrationsController);

// Partners
apiV1Router.use('/partners', authMiddleware, partnersController);

// RFC-0024: Group dispatch matrix (nested — must come before general /groups router)
apiV1Router.use('/groups/:groupId/dispatch', authMiddleware, groupDispatchController);

// RFC-0024: Group channel targets (nested — must come before general /groups router)
apiV1Router.use('/groups/:groupId/channels', authMiddleware, groupChannelsController);

// Groups
apiV1Router.use('/groups', authMiddleware, groupsController);

// Domains (metrics, operators, aggregations for rules)
apiV1Router.use('/domains', authMiddleware, domainsController);

// Audit Logs (RFC-0009)
apiV1Router.use('/audit-logs', authMiddleware, auditLogsController);

// Simulator (RFC-0010)
apiV1Router.use('/simulator', authMiddleware, simulatorController);

// RFC-0013: User Access Profile Bundle
apiV1Router.use('/maintenance-groups', authMiddleware, maintenanceGroupsController);
apiV1Router.use('/access-bundle', authMiddleware, accessBundleController);

// RFC-0020: Public Single Apps (mixed auth — managed within controller)
apiV1Router.use('/public-apps', authMiddleware, publicSingleAppsController);

// RFC-0021: HTML Templates Engine
apiV1Router.use('/templates', authMiddleware, templatesController);
apiV1Router.use('/template-types', authMiddleware, templateTypesController);

// Dashboard summary
apiV1Router.use('/dashboard', authMiddleware, dashboardController);

// RFC-0023: Device Sync Jobs (hybridAuth — API Key with devices:write scope)
apiV1Router.use('/device-sync/jobs', hybridAuthByMethod('devices:read', 'devices:write'), deviceSyncJobsController);

// RFC-0030: Public Wiki (anonymous, forces PUBLIC audience + PUBLISHED status).
// Mounted BEFORE the authenticated /wiki router so express's ordering gives it
// priority for /public/wiki/* paths.
apiV1Router.use('/public/wiki', wikiPublicController);

// RFC-0030: MYIO Wiki (Knowledge Base Module) — authenticated
apiV1Router.use('/wiki', authMiddleware, wikiController);

// Generic file/asset storage (S3-backed)
apiV1Router.use('/assets', authMiddleware, fileAssetsController);

// Mount API v1 router
app.use('/api/v1', apiV1Router);

// =============================================================================
// Error Handling
// =============================================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// =============================================================================
// Server Startup
// =============================================================================

const PORT = parseInt(process.env.PORT || '3015', 10);
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, async () => {
    const isDev = process.env.NODE_ENV !== 'production';
    const baseUrl = `http://${HOST}:${PORT}`;
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    GCDR API Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(42)}║
║  Server:      ${baseUrl.padEnd(42)}║
║  API:         ${(baseUrl + '/api/v1').padEnd(42)}║
║  Health:      ${(baseUrl + '/health').padEnd(42)}║
║  Docs:        ${(baseUrl + '/docs').padEnd(42)}║${isDev ? `
║  DB Admin:    ${(baseUrl + '/admin/db').padEnd(42)}║
║  Simulator:   ${(baseUrl + '/admin/simulator').padEnd(42)}║
║  Monitor:     ${(baseUrl + '/admin/monitor').padEnd(42)}║` : ''}
╚════════════════════════════════════════════════════════════╝
    `);

    // Initialize simulator subsystem (RFC-0010)
    try {
      await initializeSimulator();
      registerShutdownHandlers();
    } catch (error) {
      console.error('Failed to initialize simulator subsystem:', error);
    }
  });
}

export default app;
