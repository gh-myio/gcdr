import express, { Express, Router } from 'express';
import rateLimit from 'express-rate-limit';
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
import { rateLimit as expressRateLimit } from 'express-rate-limit';
import { clientIp } from './middleware/rateLimit';

import {
  authController,
  healthController,
  docsController,
  customersController,
  consumptionGoalsController,
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
  centralAgentController,
  centralAgentEnrollHandler,
  centralsListByCustomerHandler,
  centralsListByAssetHandler,
  centralSerialAvailableHandler,
  centralSerialNextHandler,
  themesController,
  themesListByCustomerHandler,
  themesGetDefaultByCustomerHandler,
  // RFC-0047: Generic Entity Registry
  entitiesController,
  entityTypesController,
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
  customerIntegrationsController,
  groupDispatchController,
  groupChannelsController,
  userContactsController,
  // RFC-0030: MYIO Wiki (Knowledge Base Module)
  wikiController,
  wikiPublicController,
  // Generic file/asset storage (S3)
  fileAssetsController,
  fileAssetsPublicController,
  // RFC-0037: Work Orders — Event Model
  workOrdersController,
  woCustomersController,
  woLifecycleController,
  woTicketsController,
  woEventTypesHandler,
  assistantController,
  // RFC-0036: Device/Work-Order Annotations (polymorphic)
  annotationsController,
} from './controllers';

import { simulatorAdminController } from './controllers/admin/simulator-admin.controller';
import { userAdminController } from './controllers/admin/user-admin.controller';

import { centralAuthMiddleware } from './middleware/centralAuth';
import {
  centralEnrollRateLimiter,
  centralPollRateLimiter,
  centralPollIpRateLimiter,
  startRateLimitJanitor,
} from './middleware/rateLimit';
import { validateSecretEncryptionKey } from './shared/utils/secretEnvelope';
import { requestMonitorMiddleware } from './middleware/requestMonitor';
import { initializeAuditLogging } from './infrastructure/audit';
import { initializeSimulator, registerShutdownHandlers } from './services/SimulatorStartup';
import { startRestoreSweep } from './services/CentralRestoreSweep';

const app: Express = express();

// CR-S7: trust the reverse proxy in front of us (Dokploy/Traefik = 1 hop) so
// `req.ip` resolves to the real client from a VETTED X-Forwarded-For instead of
// a spoofable raw header. TRUST_PROXY_HOPS configures how many proxies to trust;
// 0 disables it (direct exposure). Without this, the rate limiters key on an
// attacker-controllable XFF.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? '1');
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 1);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'X-API-Key', 'X-Admin-Password', 'If-Match', 'If-None-Match'],
  // Custom response headers the browser must be allowed to read (optimistic
  // concurrency / cache validation): the entities bulk-replace and alarm-bundle
  // endpoints return the new version in X-Version-Id; ETag is the If-Match token.
  exposedHeaders: ['X-Version-Id', 'X-Request-Id', 'ETag'],
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

// Defense-in-depth baseline: a generous global rate limit on every /api/v1 route.
// The per-route limiters in middleware/rateLimit.ts add stricter caps where it
// matters (operator-pin, central-agent enroll/poll). Implemented with
// express-rate-limit — which CodeQL's js/missing-rate-limiting query models — so
// authenticated routes guarded only by our custom limiter aren't false-flagged.
// Single-instance in-memory store; see the CR-S7 note in middleware/rateLimit.ts
// for the multi-replica follow-up (shared store).
apiV1Router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests; please slow down' },
    },
  }),
);

// Frequently-reused permission scopes (sonarjs/no-duplicate-string).
const PERM_BUNDLES_READ = 'bundles:read';
const PERM_CUSTOMERS_READ = 'customers:read';

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
apiV1Router.delete('/customers/:customerId/alarm-rules/bundle/cache', hybridAuthMiddleware(PERM_BUNDLES_READ), invalidateAlarmBundleCacheHandler);

// Bundle Versions (must come before /bundle/simple and /bundle)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/versions', hybridAuthMiddleware(PERM_BUNDLES_READ), getAlarmBundleVersionsHandler);

// Customer Alarm Bundle - Simplified (supports JWT or API Key auth for M2M integration)
// More specific route MUST come first
apiV1Router.get('/customers/:customerId/alarm-rules/bundle/simple', hybridAuthMiddleware(PERM_BUNDLES_READ), getSimplifiedAlarmBundleHandler);

// Customer Alarm Bundle - Full (supports JWT or API Key auth for M2M integration)
apiV1Router.get('/customers/:customerId/alarm-rules/bundle', hybridAuthMiddleware(PERM_BUNDLES_READ), getAlarmBundleHandler);

// Customer API Keys (nested under customers)
apiV1Router.use('/customers/:customerId/api-keys', authMiddleware, customerApiKeysController);

// Customer Users (nested route)
apiV1Router.get('/customers/:customerId/users', authMiddleware, usersListByCustomerHandler);

// Customer Devices (nested route)
apiV1Router.get('/customers/:customerId/devices', authMiddleware, devicesListByCustomerHandler);

// Customer Rules (nested route)
apiV1Router.get('/customers/:customerId/rules', hybridAuthMiddleware(PERM_CUSTOMERS_READ), rulesListByCustomerHandler);
apiV1Router.get('/customers/:customerId/internal-support-rules', hybridAuthMiddleware(PERM_CUSTOMERS_READ), listInternalSupportRulesHandler);
apiV1Router.delete('/customers/:customerId/rules/devices', authMiddleware, clearCustomerRuleDevicesHandler);

// Customer Centrals (nested route)
apiV1Router.get('/customers/:customerId/centrals', authMiddleware, centralsListByCustomerHandler);

// Customer Themes (nested routes)
apiV1Router.get('/customers/:customerId/themes/default', authMiddleware, themesGetDefaultByCustomerHandler);
apiV1Router.get('/customers/:customerId/themes', authMiddleware, themesListByCustomerHandler);

// RFC-0024: User notification contacts (nested — must come before general /users router)
apiV1Router.use('/users/:userId/contacts', authMiddleware, userContactsController);

// RFC-0024: Customer dispatch channels (nested — must come before general /customers router)
// hybridAuth: supports JWT + API Key (alarm-orchestrator M2M)
apiV1Router.use('/customers/:customerId/channels', hybridAuthByMethod(PERM_CUSTOMERS_READ, 'customers:write'), customerChannelsController);

// RFC-0033: Customer integration sync state (nested — must come before general /customers router)
// hybridAuth: GET requires customers:read; POST/PATCH/DELETE require customers:write.
apiV1Router.use('/customers/:customerId/integrations', hybridAuthByMethod(PERM_CUSTOMERS_READ, 'customers:write'), customerIntegrationsController);

// RFC-0046: Customer consumption goals (nested — must come before general /customers router)
// hybridAuth: GET requires goals:read; PUT/PATCH/POST/DELETE require goals:write.
// Rate-limited per IP+customer (auth'd, DB-backed route). Uses express-rate-limit
// (recognized by CodeQL's js/missing-rate-limiting). Generous ceiling so
// dashboards / M2M bundles are not throttled in normal use; blocks abusive floods.
// validate:false — we key on a custom XFF-aware string (single-instance), not req.ip.
const goalsRateLimiter = expressRateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `${clientIp(req)}:${req.params.customerId ?? ''}`,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many goals requests; please slow down' },
      meta: { requestId: req.context?.requestId, timestamp: new Date().toISOString() },
    }),
});
apiV1Router.use(
  '/customers/:customerId/goals',
  goalsRateLimiter,
  hybridAuthByMethod('goals:read', 'goals:write'),
  consumptionGoalsController,
);

// Customers (general router - must come after specific nested routes)
// hybridAuth: supports JWT + API Key for ThingsBoard integration (RFC-0016)
apiV1Router.use('/customers', hybridAuthByMethod(PERM_CUSTOMERS_READ, 'customers:write'), customersController);

// Devices (hybridAuth for ThingsBoard integration)
apiV1Router.use('/devices', hybridAuthByMethod('devices:read', 'devices:write'), devicesController);

// Assets (hybridAuth for ThingsBoard integration)
apiV1Router.use('/assets', hybridAuthByMethod('assets:read', 'assets:write'), assetsController);

// RFC-0047: Generic Entity Registry (hybridAuth — JWT or customer API key).
// GET requires entities:read (or *:read); writes require entities:write
// (MYIO-operator only — a customer key gcdr_cust_* is read/resolve-only and a
// write attempt gets 403). entity_type creation + is_system mutation need the
// extra admin tier, computed inside the controller from req.context.
//
// Rate-limited per IP. Same express-rate-limit pattern as the goals router
// (recognized by CodeQL's js/missing-rate-limiting); shared bucket across
// /entities and /entity-types. Generous ceiling so the admin UI and M2M
// read/resolve consumers (Node-RED bundles) are not throttled in normal use,
// while bounding runaway/abuse. validate:false — we key on a custom XFF-aware
// string (single-instance), not req.ip.
const entitiesRateLimiter = expressRateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many entity-registry requests; please slow down' },
      meta: { requestId: req.context?.requestId, timestamp: new Date().toISOString() },
    }),
});
apiV1Router.use('/entities', entitiesRateLimiter, hybridAuthByMethod('entities:read', 'entities:write'), entitiesController);

// RFC-0047: entity-type registry — top-level sibling of /entities (API §2).
// GET /entity-types requires entities:read; POST requires entities:write + the
// admin tier (enforced in the controller). Mounted separately so the canonical
// path is /api/v1/entity-types, not /api/v1/entities/entity-types.
apiV1Router.use('/entity-types', entitiesRateLimiter, hybridAuthByMethod('entities:read', 'entities:write'), entityTypesController);

// Asset Devices (nested route - must come after assets router for :assetId routes)
apiV1Router.get('/assets/:assetId/devices', authMiddleware, devicesListByAssetHandler);

// Asset Centrals (nested route)
apiV1Router.get('/assets/:assetId/centrals', authMiddleware, centralsListByAssetHandler);

// Central ID (serial) helpers — PUBLIC (no auth), must come before the
// auth-gated /centrals router. Global collision check, format S1.S2.S3.S4.
apiV1Router.get('/centrals/serial/available', centralSerialAvailableHandler);
apiV1Router.get('/centrals/serial/next', centralSerialNextHandler);

// Centrals
apiV1Router.use('/centrals', authMiddleware, centralsController);

// Zero-touch enrollment (Slice 1.5). PUBLIC and mounted BEFORE the
// centralAuthMiddleware /central-agent mount: a freshly-flashed central has no
// agent_secret yet, so its one-time enroll token IS the credential. It exchanges
// { uuid, enrollToken } for its agent_secret here, then authenticates the poll
// loop below.
// Rate-limited per IP: the enroll token is the only credential here, so throttle
// brute-force / abuse before the handler.
apiV1Router.post('/central-agent/enroll', centralEnrollRateLimiter, centralAgentEnrollHandler);

// Central-agent poll loop (field-swap restore). NOT operator-authed — the
// central authenticates itself with its agent_secret-signed JWT
// (centralAuthMiddleware sets req.centralContext + tenant from the central row).
// Rate-limited per-central (by uuid header) so one runaway device can't hammer
// the control plane, without starving other centrals behind the same NAT; an
// outer per-IP bound (centralPollIpRateLimiter) runs FIRST to cap total PRE-AUTH
// load, since the uuid header is unauthenticated/spoofable before centralAuth.
apiV1Router.use('/central-agent', centralPollIpRateLimiter, centralPollRateLimiter, centralAuthMiddleware, centralAgentController);

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
// hybridAuth: supports JWT + API Key (alarm-orchestrator M2M)
apiV1Router.use('/groups/:groupId/dispatch', hybridAuthByMethod(PERM_CUSTOMERS_READ, 'customers:write'), groupDispatchController);

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

// Public file-assets — mounted BEFORE the authenticated /files router so the
// path /api/v1/public/files/by-slug/... is reachable without auth.
apiV1Router.use('/public/files', fileAssetsPublicController);

// Generic file/asset storage (S3-backed). Mounted at /files because /assets
// is already taken by the IoT asset hierarchy (SITE/BUILDING/FLOOR/EQUIPMENT)
// in src/controllers/assets.controller.ts and Express's first-match routing
// would never reach this handler if both shared the path.
apiV1Router.use('/files', authMiddleware, fileAssetsController);

// =============================================================================
// RFC-0036: Device / Work-Order Annotations (polymorphic).
// Reads req.context (tenantId, userId, requestId); needs the standard auth.
// Observations on work orders are expressed via
// /annotations?entityType=work_order|work_order_event&entityId=...
// =============================================================================
apiV1Router.use('/annotations', authMiddleware, annotationsController);

// =============================================================================
// RFC-0037: Work Orders — Event Model (replaces the RFC-0032 QR Checker module).
//
// - /wo/work-orders applies NO auth internally → mount behind standard auth
//   (JWT or Customer API-Key), like /centrals.
// - /wo/customers applies authMiddleware PER-HANDLER and intentionally leaves
//   POST /wo/customers/:customerId/viewer-login PUBLIC (self-authenticates via
//   password). Do NOT blanket-auth this mount or viewer-login breaks.
//   It is mounted LAST so its generic /:customerId matchers do not shadow the
//   specific /wo/work-orders paths.
// =============================================================================
// Event-type catalog (global, read-only) — mounted BEFORE /wo/work-orders so the
// specific path is not captured by the work-orders /:id matcher.
apiV1Router.get('/wo/event-types', authMiddleware, woEventTypesHandler);
// Lifecycle-rules admin (RFC-0041) — mounted BEFORE /wo/work-orders so it's not
// shadowed by the work-orders /:id matcher.
apiV1Router.use('/wo/lifecycle-rules', authMiddleware, woLifecycleController);
// RFC-0044: Chamados (WO type CHAMADO) — mounted BEFORE /wo/work-orders so its
// specific paths are not shadowed by the work-orders /:id matcher.
apiV1Router.use('/wo/tickets', authMiddleware, woTicketsController);
apiV1Router.use('/wo/work-orders', authMiddleware, workOrdersController);
apiV1Router.use('/wo/customers', woCustomersController);

// RFC-0043: GCDR Copiloto (read-only LLM assistant over the WO tools).
apiV1Router.use('/assistant', authMiddleware, assistantController);

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
  // round-3 #8: validate SECRET_ENCRYPTION_KEY at boot so a misconfig surfaces
  // immediately instead of as request-time 500s on the first enroll/secret
  // write. Non-fatal in every environment: a missing key only disables central
  // enrollment/secret WRITES (legacy plaintext still decrypts without it), so
  // the rest of the API must come up — the error stays loud in the log and the
  // affected endpoints fail per-request until the key is provided.
  try {
    validateSecretEncryptionKey();
  } catch (error) {
    const message = (error as Error).message;
    // eslint-disable-next-line no-console -- boot diagnostics
    console.error(
      `ERROR: ${message} — starting WITHOUT secrets-at-rest support: ` +
        'central enrollment/secret writes will fail until SECRET_ENCRYPTION_KEY is set ' +
        '(generate: openssl rand -hex 32)'
    );
  }

  app.listen(PORT, HOST, async () => {
    const isDev = process.env.NODE_ENV !== 'production';
    const baseUrl = `http://${HOST}:${PORT}`;
    // eslint-disable-next-line no-console -- startup banner
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
      // eslint-disable-next-line no-console -- startup diagnostics
      console.error('Failed to initialize simulator subsystem:', error);
    }

    // CR-S5: periodically fail RUNNING restore jobs orphaned by a dead central.
    try {
      startRestoreSweep();
    } catch (error) {
      // eslint-disable-next-line no-console -- startup diagnostics
      console.error('Failed to start the restore-sweep:', error);
    }

    // round-3 #6: periodically evict expired rate-limit buckets so rotated keys
    // (e.g. spoofed uuids on the poll route) can't grow the store without bound.
    try {
      startRateLimitJanitor();
    } catch (error) {
      // eslint-disable-next-line no-console -- startup diagnostics
      console.error('Failed to start the rate-limit janitor:', error);
    }
  });
}

export default app;
