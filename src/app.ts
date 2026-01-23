import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import {
  contextMiddleware,
  authMiddleware,
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
  integrationsController,
  customerApiKeysController,
  dbAdminController,
} from './controllers';

const app: Express = express();

// =============================================================================
// Global Middleware
// =============================================================================

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'X-API-Key'],
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Database Admin UI (development only - has its own protection middleware)
app.use('/admin/db', dbAdminController);

// =============================================================================
// Protected Routes (authentication required)
// =============================================================================

// Customers
app.use('/customers', authMiddleware, customersController);

// Customer API Keys (nested under customers)
app.use('/customers/:customerId/api-keys', authMiddleware, customerApiKeysController);

// Customer Users (nested route)
app.get('/customers/:customerId/users', authMiddleware, usersListByCustomerHandler);

// Customer Rules (nested route)
app.get('/customers/:customerId/rules', authMiddleware, rulesListByCustomerHandler);

// Customer Alarm Bundle (nested route - supports API Key auth)
app.get('/customers/:customerId/alarm-rules/bundle', authMiddleware, getAlarmBundleHandler);

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

const PORT = parseInt(process.env.PORT || '3000', 10);
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
