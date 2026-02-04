import express, { Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import {
  contextMiddleware,
  authMiddleware,
  hybridAuthMiddleware,
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
  usersController,
  usersListByCustomerHandler,
  policiesController,
  authorizationController,
  rulesController,
  rulesListByCustomerHandler,
  getAlarmBundleHandler,
  getSimplifiedAlarmBundleHandler,
  integrationsController,
  customerApiKeysController,
  auditLogsController,
  simulatorController,
  dbAdminController,
  centralsController,
  centralsListByCustomerHandler,
  centralsListByAssetHandler,
  themesController,
  themesListByCustomerHandler,
  themesGetDefaultByCustomerHandler,
  // RFC-0013: User Access Profile Bundle
  maintenanceGroupsController,
  accessBundleController,
} from './controllers';

import { simulatorAdminController } from './controllers/admin/simulator-admin.controller';
import { userAdminController } from './controllers/admin/user-admin.controller';

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'X-API-Key'],
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

// =============================================================================
// Security Middleware (after admin routes that need relaxed CSP)
// =============================================================================

// Security headers
app.use(helmet());

// Request context
app.use(contextMiddleware);

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

// Customer Alarm Bundle - Simplified (supports JWT or API Key auth for M2M integration)
// More specific route MUST come first
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/simple', hybridAuthMiddleware('bundles:read'), getSimplifiedAlarmBundleHandler);

// Customer Alarm Bundle - Full (supports JWT or API Key auth for M2M integration)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle', hybridAuthMiddleware('bundles:read'), getAlarmBundleHandler);

// Customer API Keys (nested under customers)
apiV1Router.use('/customers/:customerId/api-keys', authMiddleware, customerApiKeysController);

// Customer Users (nested route)
apiV1Router.get('/customers/:customerId/users', authMiddleware, usersListByCustomerHandler);

// Customer Rules (nested route)
apiV1Router.get('/customers/:customerId/rules', authMiddleware, rulesListByCustomerHandler);

// Customer Centrals (nested route)
apiV1Router.get('/customers/:customerId/centrals', authMiddleware, centralsListByCustomerHandler);

// Customer Themes (nested routes)
apiV1Router.get('/customers/:customerId/themes/default', authMiddleware, themesGetDefaultByCustomerHandler);
apiV1Router.get('/customers/:customerId/themes', authMiddleware, themesListByCustomerHandler);

// Customers (general router - must come after specific nested routes)
apiV1Router.use('/customers', authMiddleware, customersController);

// Devices
apiV1Router.use('/devices', authMiddleware, devicesController);

// Assets
apiV1Router.use('/assets', authMiddleware, assetsController);

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

// Authorization
apiV1Router.use('/authorization', authMiddleware, authorizationController);

// Rules
apiV1Router.use('/rules', authMiddleware, rulesController);

// Integrations
apiV1Router.use('/integrations', authMiddleware, integrationsController);

// Partners
apiV1Router.use('/partners', authMiddleware, partnersController);

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
║  Simulator:   ${(baseUrl + '/admin/simulator').padEnd(42)}║` : ''}
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
