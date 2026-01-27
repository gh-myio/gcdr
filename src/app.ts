import express, { Express } from 'express';
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
  dbAdminController,
} from './controllers';

import { initializeAuditLogging } from './infrastructure/audit';

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

// Database Admin UI (development only - needs external scripts for CodeMirror)
app.use('/admin/db', dbAdminController);

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

// Health checks
app.use('/health', healthController);

// API Documentation (Swagger UI)
app.use('/docs', docsController);

// Authentication routes
app.use('/auth', authController);

// =============================================================================
// Protected Routes (authentication required)
// =============================================================================

// Customer-specific nested routes MUST come before the general /customers router
// to ensure proper route matching (more specific routes first)

// Customer Alarm Bundle - Simplified (supports JWT or API Key auth for M2M integration)
// More specific route MUST come first
app.get('/customers/:customerId/alarm-rules/bundle/simple', hybridAuthMiddleware('bundles:read'), getSimplifiedAlarmBundleHandler);

// Customer Alarm Bundle - Full (supports JWT or API Key auth for M2M integration)
app.get('/customers/:customerId/alarm-rules/bundle', hybridAuthMiddleware('bundles:read'), getAlarmBundleHandler);

// Customer API Keys (nested under customers)
app.use('/customers/:customerId/api-keys', authMiddleware, customerApiKeysController);

// Customer Users (nested route)
app.get('/customers/:customerId/users', authMiddleware, usersListByCustomerHandler);

// Customer Rules (nested route)
app.get('/customers/:customerId/rules', authMiddleware, rulesListByCustomerHandler);

// Customers (general router - must come after specific nested routes)
app.use('/customers', authMiddleware, customersController);

// Devices
app.use('/devices', authMiddleware, devicesController);

// Asset Devices (nested route)
app.get('/assets/:assetId/devices', authMiddleware, devicesListByAssetHandler);

// Users
app.use('/users', authMiddleware, usersController);

// Policies
app.use('/policies', authMiddleware, policiesController);

// Authorization
app.use('/authorization', authMiddleware, authorizationController);

// Rules
app.use('/rules', authMiddleware, rulesController);

// Integrations
app.use('/integrations', authMiddleware, integrationsController);

// Audit Logs (RFC-0009)
app.use('/audit-logs', authMiddleware, auditLogsController);

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
  app.listen(PORT, HOST, () => {
    const isDev = process.env.NODE_ENV !== 'production';
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    GCDR API Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(42)}║
║  Server:      http://${HOST}:${PORT.toString().padEnd(33)}║
║  Health:      http://${HOST}:${PORT}/health${' '.repeat(26)}║
║  Docs:        http://${HOST}:${PORT}/docs${' '.repeat(28)}║${isDev ? `
║  DB Admin:    http://${HOST}:${PORT}/admin/db${' '.repeat(22)}║` : ''}
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

export default app;
