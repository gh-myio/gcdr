// =============================================================================
// GCDR Simulator Cockpit Controller (RFC-0010 + RFC-0014)
// =============================================================================
// Premium UI for managing alarm simulations
// RFC-0014: 2x3 grid layout + Scenario Builder wizard
// Access: http://localhost:3015/admin/simulator
// =============================================================================

import { Router, Request, Response } from 'express';
import { simulatorEngine } from '../../services/SimulatorEngine';
import { simulatorQuotaService } from '../../services/SimulatorQuotaService';
import { simulatorRepository } from '../../repositories/SimulatorRepository';
import { simulatorQueueService } from '../../services/SimulatorQueueService';
import { simulatorMetricsService } from '../../services/SimulatorMetrics';
import { simulatorMonitorService } from '../../services/SimulatorMonitor';
import { computeSessionStats } from '../../domain/entities/Simulator';

const router = Router();

// =============================================================================
// API Routes (for UI)
// =============================================================================

// Get sessions for a tenant
router.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const sessions = await simulatorRepository.listSessionsByTenant(tenantId, { limit: 50 });
    const sessionsWithStats = sessions.map((s) => ({
      ...computeSessionStats(s),
      isActive: simulatorEngine.isSessionActive(s.id),
    }));

    res.json({ sessions: sessionsWithStats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get quotas for a tenant
router.get('/api/quotas', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const quotaSummary = await simulatorQuotaService.getQuotaSummary(tenantId);
    res.json(quotaSummary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get metrics
router.get('/api/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await simulatorMetricsService.getMetrics();
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get session events
router.get('/api/sessions/:sessionId/events', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const events = await simulatorRepository.listEventsBySession(sessionId, { limit });
    res.json({ events });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start a session
router.post('/api/sessions/start', async (req: Request, res: Response) => {
  try {
    const { tenantId, customerId, userId, name, config } = req.body;

    if (!tenantId || !customerId || !name || !config) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Use provided userId or fallback to a valid UUID for admin cockpit
    const effectiveUserId = userId || '00000000-0000-0000-0000-000000000000';

    const session = await simulatorEngine.startSession(
      tenantId,
      customerId,
      effectiveUserId,
      name,
      config
    );

    res.json({ success: true, session: computeSessionStats(session) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop a session
router.post('/api/sessions/:sessionId/stop', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body;

    await simulatorEngine.stopSession(sessionId, reason || 'USER_REQUESTED');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// SSE Monitor endpoint
router.get('/api/sessions/:sessionId/monitor', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    simulatorMonitorService.addClient(sessionId, res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get queue stats
router.get('/api/queue/stats', (req: Request, res: Response) => {
  try {
    const stats = simulatorQueueService.getAllQueueStats();
    res.json({ queues: stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Wizard API Routes — Centrals, Devices per Central, Rules (RFC-0014)
// =============================================================================

// List centrals for a customer (wizard step 1)
router.get('/api/centrals', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    const customerId = req.query.customerId as string;
    if (!tenantId || !customerId) {
      return res.status(400).json({ error: 'tenantId and customerId are required' });
    }

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { centrals } = await import('../../infrastructure/database/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');

    const result = await db
      .select({
        id: centrals.id,
        name: centrals.name,
        serialNumber: centrals.serialNumber,
        type: centrals.type,
        connectionStatus: centrals.connectionStatus,
        status: centrals.status,
      })
      .from(centrals)
      .where(and(
        eq(centrals.tenantId, tenantId),
        eq(centrals.customerId, customerId),
        eq(centrals.status, 'ACTIVE')
      ))
      .limit(100);

    res.json({ centrals: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List devices for a specific central (wizard step 2)
router.get('/api/centrals/:centralId/devices', async (req: Request, res: Response) => {
  try {
    const { centralId } = req.params;
    const tenantId = req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { devices } = await import('../../infrastructure/database/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');

    const result = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        serialNumber: devices.serialNumber,
        slaveId: devices.slaveId,
        identifier: devices.identifier,
        specs: devices.specs,
        connectivityStatus: devices.connectivityStatus,
      })
      .from(devices)
      .where(and(
        eq(devices.tenantId, tenantId),
        eq(devices.centralId, centralId),
        eq(devices.status, 'ACTIVE')
      ))
      .limit(200);

    // Expose channels for OUTLET devices
    const mapped = result.map(d => ({
      ...d,
      channels: d.type === 'OUTLET' && d.specs && typeof d.specs === 'object'
        ? (d.specs as any).channels || []
        : undefined,
    }));

    res.json({ devices: mapped });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List alarm rules for a customer (wizard step 3)
router.get('/api/rules', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    const customerId = req.query.customerId as string;
    if (!tenantId || !customerId) {
      return res.status(400).json({ error: 'tenantId and customerId are required' });
    }

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { rules } = await import('../../infrastructure/database/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');

    const result = await db
      .select({
        id: rules.id,
        name: rules.name,
        type: rules.type,
        priority: rules.priority,
        alarmConfig: rules.alarmConfig,
        enabled: rules.enabled,
        scopeType: rules.scopeType,
      })
      .from(rules)
      .where(and(
        eq(rules.tenantId, tenantId),
        eq(rules.customerId, customerId),
        eq(rules.status, 'ACTIVE'),
        eq(rules.enabled, true)
      ))
      .limit(200);

    res.json({ rules: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// DEMO Setup - Creates everything needed for a working demo
// =============================================================================

const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_ASSET_ID = '33333333-3333-3333-3333-333333333333';
const DEMO_CENTRAL_ID = '44444444-4444-4444-4444-444444444444';
const DEMO_USER_ID = '77777777-7777-7777-7777-777777777777';
const DEMO_DEVICE_IDS = [
  '55555555-5555-5555-5555-555555555501',
  '55555555-5555-5555-5555-555555555502',
  '55555555-5555-5555-5555-555555555503',
];
const DEMO_RULE_IDS = [
  '66666666-6666-6666-6666-666666666601',
  '66666666-6666-6666-6666-666666666602',
];

router.post('/api/demo/setup', async (req: Request, res: Response) => {
  try {
    console.log('[Demo Setup] Starting demo environment setup...');

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { customers, assets, devices, rules, centrals } = await import('../../infrastructure/database/drizzle/schema');
    const { eq } = await import('drizzle-orm');

    // Check if demo customer already exists
    const existingCustomer = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, DEMO_CUSTOMER_ID))
      .limit(1);

    if (existingCustomer.length > 0) {
      console.log('[Demo Setup] Demo already configured, returning existing IDs');
      return res.json({
        success: true,
        message: 'Demo already configured',
        demo: {
          tenantId: DEMO_TENANT_ID,
          customerId: DEMO_CUSTOMER_ID,
          assetId: DEMO_ASSET_ID,
          centralId: DEMO_CENTRAL_ID,
          deviceIds: DEMO_DEVICE_IDS,
          ruleIds: DEMO_RULE_IDS,
        }
      });
    }

    console.log('[Demo Setup] Creating demo customer...');

    await db.insert(customers).values({
      id: DEMO_CUSTOMER_ID,
      tenantId: DEMO_TENANT_ID,
      name: 'DEMO Corp',
      displayName: 'DEMO Corporation',
      code: 'DEMO-001',
      type: 'COMPANY',
      path: `/${DEMO_TENANT_ID}/${DEMO_CUSTOMER_ID}`,
      depth: 1,
      email: 'demo@example.com',
      status: 'ACTIVE',
    });

    console.log('[Demo Setup] Customer created successfully');

    await db.insert(assets).values({
      id: DEMO_ASSET_ID,
      tenantId: DEMO_TENANT_ID,
      customerId: DEMO_CUSTOMER_ID,
      name: 'Demo Building',
      displayName: 'Demo Building - Main',
      code: 'DEMO-BLD-001',
      type: 'BUILDING',
      path: `/${DEMO_TENANT_ID}/${DEMO_CUSTOMER_ID}/${DEMO_ASSET_ID}`,
      depth: 2,
      status: 'ACTIVE',
    });

    await db.insert(centrals).values({
      id: DEMO_CENTRAL_ID,
      tenantId: DEMO_TENANT_ID,
      customerId: DEMO_CUSTOMER_ID,
      assetId: DEMO_ASSET_ID,
      name: 'Demo NodeHub',
      displayName: 'Demo NodeHub Central',
      serialNumber: 'DEMO-NH-001',
      type: 'NODEHUB',
      status: 'ACTIVE',
      connectionStatus: 'ONLINE',
      firmwareVersion: '1.0.0',
      softwareVersion: '2.0.0',
    });

    const demoDevices = [
      {
        id: DEMO_DEVICE_IDS[0],
        name: 'Temperature Sensor A',
        displayName: 'Temp Sensor - Floor 1',
        serialNumber: 'DEMO-TEMP-001',
        type: 'SENSOR' as const,
        slaveId: 1,
        identifier: 'TEMP-A',
        deviceProfile: 'TEMPERATURE_SENSOR',
      },
      {
        id: DEMO_DEVICE_IDS[1],
        name: 'Humidity Sensor B',
        displayName: 'Humidity Sensor - Floor 1',
        serialNumber: 'DEMO-HUM-001',
        type: 'SENSOR' as const,
        slaveId: 2,
        identifier: 'HUM-B',
        deviceProfile: 'HUMIDITY_SENSOR',
      },
      {
        id: DEMO_DEVICE_IDS[2],
        name: 'Power Meter C',
        displayName: 'Power Meter - Main Panel',
        serialNumber: 'DEMO-PWR-001',
        type: 'METER' as const,
        slaveId: 3,
        identifier: 'PWR-C',
        deviceProfile: 'POWER_METER',
      },
    ];

    for (const device of demoDevices) {
      await db.insert(devices).values({
        id: device.id,
        tenantId: DEMO_TENANT_ID,
        customerId: DEMO_CUSTOMER_ID,
        assetId: DEMO_ASSET_ID,
        centralId: DEMO_CENTRAL_ID,
        name: device.name,
        displayName: device.displayName,
        serialNumber: device.serialNumber,
        type: device.type,
        slaveId: device.slaveId,
        identifier: device.identifier,
        deviceProfile: device.deviceProfile,
        status: 'ACTIVE',
        connectivityStatus: 'ONLINE',
      });
    }

    const demoRules = [
      {
        id: DEMO_RULE_IDS[0],
        name: 'High Temperature Alert',
        description: 'Triggers when temperature exceeds 28C',
        type: 'ALARM_THRESHOLD' as const,
        priority: 'HIGH' as const,
        alarmConfig: {
          field: 'temperature',
          operator: 'gt',
          threshold: 28,
          unit: 'C',
          duration: 60,
          message: 'Temperature is above normal threshold',
        },
      },
      {
        id: DEMO_RULE_IDS[1],
        name: 'High Humidity Warning',
        description: 'Triggers when humidity exceeds 70%',
        type: 'ALARM_THRESHOLD' as const,
        priority: 'MEDIUM' as const,
        alarmConfig: {
          field: 'humidity',
          operator: 'gt',
          threshold: 70,
          unit: '%',
          duration: 120,
          message: 'Humidity is above comfortable range',
        },
      },
    ];

    for (const rule of demoRules) {
      await db.insert(rules).values({
        id: rule.id,
        tenantId: DEMO_TENANT_ID,
        customerId: DEMO_CUSTOMER_ID,
        name: rule.name,
        description: rule.description,
        type: rule.type,
        priority: rule.priority,
        scopeType: 'CUSTOMER',
        scopeEntityId: DEMO_CUSTOMER_ID,
        alarmConfig: rule.alarmConfig,
        enabled: true,
        status: 'ACTIVE',
      });
    }

    console.log('[Demo Setup] All demo entities created successfully');

    res.json({
      success: true,
      message: 'Demo environment created successfully',
      demo: {
        tenantId: DEMO_TENANT_ID,
        customerId: DEMO_CUSTOMER_ID,
        assetId: DEMO_ASSET_ID,
        centralId: DEMO_CENTRAL_ID,
        deviceIds: DEMO_DEVICE_IDS,
        ruleIds: DEMO_RULE_IDS,
      }
    });
  } catch (error: any) {
    console.error('[Demo Setup] Error:', error);
    res.status(500).json({ error: error.message, details: error.toString() });
  }
});

// Start demo session automatically
router.post('/api/demo/start-session', async (req: Request, res: Response) => {
  try {
    const sessionName = `Demo Session ${new Date().toLocaleTimeString()}`;

    const session = await simulatorEngine.startSession(
      DEMO_TENANT_ID,
      DEMO_CUSTOMER_ID,
      DEMO_USER_ID,
      sessionName,
      {
        customerId: DEMO_CUSTOMER_ID,
        deviceScanIntervalMs: 30000,
        bundleRefreshIntervalMs: 60000,
        devices: [
          {
            deviceId: DEMO_DEVICE_IDS[0],
            telemetryProfile: {
              temperature: { min: 22, max: 32, unit: 'C' },
            }
          },
          {
            deviceId: DEMO_DEVICE_IDS[1],
            telemetryProfile: {
              humidity: { min: 50, max: 80, unit: '%' },
            }
          },
          {
            deviceId: DEMO_DEVICE_IDS[2],
            telemetryProfile: {
              power: { min: 100, max: 500, unit: 'W' },
              voltage: { min: 110, max: 130, unit: 'V' },
            }
          },
        ],
      }
    );

    res.json({
      success: true,
      session: computeSessionStats(session),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get customers for dropdown
router.get('/api/customers', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { customers } = await import('../../infrastructure/database/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');

    const result = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.status, 'ACTIVE')
      ))
      .limit(100);

    console.log(`[Simulator] Loaded ${result.length} customers for tenant ${tenantId}`);
    res.json({ customers: result });
  } catch (error: any) {
    console.error('[Simulator] Failed to load customers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get devices for dropdown
router.get('/api/devices', async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customerId as string;
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    const { db } = await import('../../infrastructure/database/drizzle/db');
    const { devices } = await import('../../infrastructure/database/drizzle/schema');
    const { eq } = await import('drizzle-orm');

    const result = await db
      .select({ id: devices.id, name: devices.name, type: devices.type })
      .from(devices)
      .where(eq(devices.customerId, customerId))
      .limit(200);

    res.json({ devices: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// HTML UI (RFC-0014: 2x3 Grid + Scenario Builder Wizard)
// =============================================================================

router.get('/', (req: Request, res: Response) => {
  res.send(getHtmlPage());
});

function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GCDR Simulator Cockpit</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #3b82f6;
      --accent-green: #22c55e;
      --accent-yellow: #eab308;
      --accent-red: #ef4444;
      --accent-purple: #a855f7;
      --accent-orange: #f97316;
      --border-color: #475569;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg-primary); color: var(--text-primary); height: 100vh; overflow: hidden; }

    /* ===== HEADER ===== */
    .top-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); height: 52px; }
    .top-bar h1 { font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    .top-bar .badge { font-size: 10px; padding: 3px 7px; border-radius: 4px; font-weight: 600; text-transform: uppercase; background: linear-gradient(135deg, #a855f7, #6366f1); color: white; }
    .top-bar-actions { display: flex; align-items: center; gap: 10px; }
    .top-bar-actions label { color: var(--text-secondary); font-size: 13px; }
    .top-bar-actions input { background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 5px 10px; border-radius: 5px; font-size: 13px; width: 280px; }
    .btn { padding: 6px 14px; border-radius: 5px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all .15s; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .btn-primary { background: var(--accent-blue); color: white; }
    .btn-primary:hover:not(:disabled) { background: #2563eb; }
    .btn-success { background: var(--accent-green); color: white; }
    .btn-success:hover:not(:disabled) { background: #16a34a; }
    .btn-danger { background: var(--accent-red); color: white; }
    .btn-danger:hover:not(:disabled) { background: #dc2626; }
    .btn-outline { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-color); }
    .btn-outline:hover:not(:disabled) { border-color: var(--accent-blue); color: var(--text-primary); }
    .btn-demo { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; font-weight: 600; box-shadow: 0 2px 8px rgba(34,197,94,.3); }
    .btn-demo:hover:not(:disabled) { box-shadow: 0 4px 12px rgba(34,197,94,.4); }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    .btn-lg { padding: 10px 24px; font-size: 14px; font-weight: 600; }

    /* ===== 2x3 GRID ===== */
    .simulator-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 12px; padding: 12px; height: calc(100vh - 52px); }

    /* ===== BLOCK (card) ===== */
    .block { background: var(--bg-secondary); border-radius: 10px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    .block-header { padding: 10px 14px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    .block-header h2 { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 7px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-secondary); }
    .block-body { padding: 12px 14px; overflow-y: auto; flex: 1; min-height: 0; }

    /* ===== BLOCK 1: SCENARIO OVERVIEW ===== */
    .scenario-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .summary-item { background: var(--bg-tertiary); padding: 8px 10px; border-radius: 6px; }
    .summary-item .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
    .summary-item .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
    .status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .status-badge.not-configured { background: rgba(100,116,139,.2); color: var(--text-muted); }
    .status-badge.ready { background: rgba(59,130,246,.2); color: var(--accent-blue); }
    .status-badge.running { background: rgba(34,197,94,.2); color: var(--accent-green); }
    .status-badge.stopped { background: rgba(239,68,68,.2); color: var(--accent-red); }
    .status-badge.error { background: rgba(239,68,68,.2); color: var(--accent-red); }
    @keyframes pulse-dot { 0%,100%{opacity:1}50%{opacity:.4} }
    .pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse-dot 1.5s infinite; }
    .block-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 8px; }
    .block-actions .btn { flex: 1; }

    /* ===== BLOCK 2: BUNDLE & RULES ===== */
    .bundle-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
    .bundle-field { background: var(--bg-tertiary); padding: 6px 8px; border-radius: 5px; }
    .bundle-field .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
    .bundle-field .value { font-size: 13px; font-weight: 500; }
    .rules-list { max-height: 999px; }
    .rule-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 4px; font-size: 12px; border-bottom: 1px solid rgba(71,85,105,.3); }
    .rule-row:last-child { border-bottom: none; }
    .rule-name { font-weight: 500; }
    .rule-meta { color: var(--text-muted); font-size: 11px; }

    /* ===== BLOCK 3: DEVICE SCANNER ===== */
    .feed { font-family: 'Consolas','Monaco',monospace; font-size: 12px; }
    .feed-entry { padding: 3px 0; display: flex; gap: 8px; border-bottom: 1px solid rgba(71,85,105,.15); }
    .feed-entry:last-child { border-bottom: none; }
    .feed-time { color: var(--text-muted); flex-shrink: 0; font-size: 11px; }
    .feed-device { color: var(--accent-blue); font-weight: 500; min-width: 80px; flex-shrink: 0; }
    .feed-values { color: var(--text-secondary); }
    .feed-values .val-green { color: var(--accent-green); }
    .feed-values .val-yellow { color: var(--accent-yellow); }
    .feed-values .val-red { color: var(--accent-red); }

    /* ===== BLOCK 4: RULE EVALUATOR ===== */
    .eval-entry { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 12px; border-bottom: 1px solid rgba(71,85,105,.15); }
    .eval-entry:last-child { border-bottom: none; }
    .eval-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .eval-badge.pass { background: rgba(34,197,94,.15); color: var(--accent-green); }
    .eval-badge.fail { background: rgba(239,68,68,.15); color: var(--accent-red); }

    /* ===== BLOCK 5: ALARM CANDIDATES ===== */
    .alarm-entry { padding: 6px 8px; border-radius: 5px; margin-bottom: 4px; font-size: 12px; background: rgba(239,68,68,.08); border-left: 3px solid var(--accent-red); }
    .alarm-entry .alarm-head { display: flex; justify-content: space-between; align-items: center; }
    .alarm-entry .alarm-detail { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
    .severity-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .severity-badge.WARNING { background: rgba(234,179,8,.2); color: var(--accent-yellow); }
    .severity-badge.CRITICAL { background: rgba(239,68,68,.2); color: var(--accent-red); }
    .severity-badge.INFO { background: rgba(59,130,246,.2); color: var(--accent-blue); }

    /* ===== BLOCK 6: METRICS & QUOTAS ===== */
    .metrics-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
    .metric-box { background: var(--bg-tertiary); padding: 8px; border-radius: 6px; text-align: center; }
    .metric-box .val { font-size: 20px; font-weight: 700; }
    .metric-box .lbl { font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
    .quota-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12px; }
    .quota-row .quota-label { min-width: 90px; color: var(--text-secondary); }
    .quota-bar { flex: 1; height: 6px; background: var(--bg-primary); border-radius: 3px; overflow: hidden; }
    .quota-fill { height: 100%; background: var(--accent-blue); transition: width .3s; }
    .quota-fill.warn { background: var(--accent-yellow); }
    .quota-fill.crit { background: var(--accent-red); }
    .quota-val { min-width: 50px; text-align: right; color: var(--text-muted); font-size: 11px; }

    /* ===== EMPTY STATE ===== */
    .empty { text-align: center; padding: 24px 12px; color: var(--text-muted); }
    .empty .icon { font-size: 32px; margin-bottom: 8px; }
    .empty p { font-size: 13px; }
    .empty small { font-size: 11px; }

    /* ===== SESSIONS DROPDOWN ===== */
    .sessions-dropdown { position: relative; }
    .sessions-dropdown select { background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; font-size: 12px; max-width: 160px; }

    /* ===== WIZARD OVERLAY ===== */
    .wizard-overlay { display: none; position: fixed; inset: 0; background: var(--bg-primary); z-index: 1000; flex-direction: column; }
    .wizard-overlay.active { display: flex; }
    .wizard-top { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
    .wizard-top h2 { font-size: 18px; font-weight: 600; }
    .wizard-steps { display: flex; gap: 4px; align-items: center; }
    .wizard-step { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; font-size: 13px; color: var(--text-muted); transition: all .2s; }
    .wizard-step.active { background: var(--accent-blue); color: white; font-weight: 600; }
    .wizard-step.completed { color: var(--accent-green); }
    .wizard-step .step-num { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: var(--bg-tertiary); }
    .wizard-step.active .step-num { background: rgba(255,255,255,.2); }
    .wizard-step.completed .step-num { background: rgba(34,197,94,.2); }
    .wizard-step-arrow { color: var(--text-muted); font-size: 11px; }
    .wizard-body { flex: 1; overflow-y: auto; padding: 24px 32px; }
    .wizard-footer { display: flex; justify-content: space-between; padding: 16px 24px; border-top: 1px solid var(--border-color); background: var(--bg-secondary); }

    /* ===== WIZARD CONTENT ===== */
    .wizard-section { display: none; }
    .wizard-section.active { display: block; }
    .wizard-section h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .wizard-section p.desc { color: var(--text-secondary); font-size: 14px; margin-bottom: 16px; }
    .check-list { list-style: none; }
    .check-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 6px; cursor: pointer; transition: all .15s; }
    .check-item:hover { border-color: var(--accent-blue); background: rgba(59,130,246,.05); }
    .check-item.selected { border-color: var(--accent-blue); background: rgba(59,130,246,.1); }
    .check-item input[type=checkbox] { accent-color: var(--accent-blue); width: 16px; height: 16px; }
    .check-item .item-info { flex: 1; }
    .check-item .item-name { font-weight: 500; font-size: 14px; }
    .check-item .item-meta { font-size: 12px; color: var(--text-muted); }
    .check-item .item-badges { display: flex; gap: 4px; flex-wrap: wrap; }
    .ch-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(168,85,247,.15); color: var(--accent-purple); }
    .type-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(59,130,246,.15); color: var(--accent-blue); }
    .conn-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .conn-badge.ONLINE { background: rgba(34,197,94,.15); color: var(--accent-green); }
    .conn-badge.OFFLINE { background: rgba(239,68,68,.15); color: var(--accent-red); }

    /* Wizard control form */
    .control-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .ctrl-field { margin-bottom: 0; }
    .ctrl-field label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
    .ctrl-field input, .ctrl-field select { width: 100%; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 10px; border-radius: 5px; font-size: 14px; }
    .ctrl-field input:focus, .ctrl-field select:focus { outline: none; border-color: var(--accent-blue); }

    /* Wizard review */
    .review-section { margin-bottom: 16px; }
    .review-section h4 { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .review-list { background: var(--bg-tertiary); border-radius: 6px; padding: 8px 12px; }
    .review-list .review-item { padding: 3px 0; font-size: 13px; border-bottom: 1px solid rgba(71,85,105,.3); }
    .review-list .review-item:last-child { border-bottom: none; }
    .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .review-stat { background: var(--bg-tertiary); padding: 10px; border-radius: 6px; text-align: center; }
    .review-stat .rval { font-size: 20px; font-weight: 700; }
    .review-stat .rlbl { font-size: 11px; color: var(--text-muted); }

    /* Device group in wizard */
    .device-group { margin-bottom: 16px; }
    .device-group h4 { font-size: 13px; color: var(--accent-blue); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .select-all { font-size: 12px; color: var(--accent-blue); cursor: pointer; margin-left: auto; }
    .select-all:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <!-- TOP BAR -->
  <div class="top-bar">
    <h1>Simulator Cockpit <span class="badge">Premium</span></h1>
    <div class="top-bar-actions">
      <button class="btn btn-demo btn-sm" id="demoBtn" onclick="runDemo()">DEMO</button>
      <label>Tenant:</label>
      <input type="text" id="tenantId" placeholder="Enter tenant UUID..." />
      <label>Customer:</label>
      <select id="customerId" style="background:var(--bg-primary);border:1px solid var(--border-color);color:var(--text-primary);padding:5px 10px;border-radius:5px;font-size:13px;min-width:160px;">
        <option value="">Select...</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="loadData()">Load</button>
    </div>
  </div>

  <!-- 2x3 GRID -->
  <div class="simulator-grid">
    <!-- BLOCK 1: Scenario Overview -->
    <div class="block" id="block1">
      <div class="block-header">
        <h2>B1 Scenario Overview</h2>
        <span class="status-badge not-configured" id="simStatusBadge">Not Configured</span>
      </div>
      <div class="block-body">
        <div class="scenario-summary" id="scenarioSummary">
          <div class="summary-item"><div class="label">Centrals</div><div class="value" id="sumCentrals">0</div></div>
          <div class="summary-item"><div class="label">Devices</div><div class="value" id="sumDevices">0</div></div>
          <div class="summary-item"><div class="label">Rules</div><div class="value" id="sumRules">0</div></div>
          <div class="summary-item"><div class="label">Mode</div><div class="value" id="sumMode">-</div></div>
        </div>
        <div id="sessionInfo" style="display:none; margin-bottom:8px;">
          <div style="font-size:12px;color:var(--text-secondary);">Session: <strong id="sessionNameDisplay"></strong></div>
          <div style="font-size:11px;color:var(--text-muted);" id="sessionTimerDisplay"></div>
        </div>
        <div class="block-actions">
          <button class="btn btn-primary" id="btnConfigure" onclick="openWizard()">Configure Simulator</button>
          <button class="btn btn-success" id="btnStart" onclick="startSimulation()" disabled>Start Simulation</button>
        </div>
        <div class="block-actions" id="runningActions" style="display:none;">
          <button class="btn btn-danger" id="btnStop" onclick="stopSimulation()">Stop Simulation</button>
          <button class="btn btn-outline" id="btnReconfigure" onclick="openWizard()">Reconfigure</button>
        </div>
      </div>
    </div>

    <!-- BLOCK 2: Bundle Status & Rules -->
    <div class="block" id="block2">
      <div class="block-header">
        <h2>B2 Bundle & Rules</h2>
        <span style="font-size:11px;color:var(--text-muted);" id="bundleStatus">-</span>
      </div>
      <div class="block-body">
        <div class="bundle-info" id="bundleInfo">
          <div class="bundle-field"><div class="label">Version</div><div class="value" id="bundleVersion">-</div></div>
          <div class="bundle-field"><div class="label">Last Fetch</div><div class="value" id="bundleLastFetch">-</div></div>
          <div class="bundle-field"><div class="label">Rules</div><div class="value" id="bundleRulesCount">-</div></div>
          <div class="bundle-field"><div class="label">Devices</div><div class="value" id="bundleDevicesCount">-</div></div>
        </div>
        <div class="rules-list" id="rulesListBlock">
          <div class="empty"><p>Waiting for bundle...</p></div>
        </div>
      </div>
    </div>

    <!-- BLOCK 3: Device Scanner -->
    <div class="block" id="block3">
      <div class="block-header">
        <h2>B3 Device Scanner</h2>
        <span style="font-size:11px;color:var(--text-muted);" id="scanCounter">0 scans</span>
      </div>
      <div class="block-body">
        <div class="feed" id="scanFeed">
          <div class="empty"><div class="icon">&#128225;</div><p>Waiting for scans...</p></div>
        </div>
      </div>
    </div>

    <!-- BLOCK 4: Rule Evaluator -->
    <div class="block" id="block4">
      <div class="block-header">
        <h2>B4 Rule Evaluator</h2>
        <span style="font-size:11px;color:var(--text-muted);" id="evalCounter">0 evaluations</span>
      </div>
      <div class="block-body">
        <div id="evalFeed">
          <div class="empty"><p>Waiting for evaluations...</p></div>
        </div>
      </div>
    </div>

    <!-- BLOCK 5: Alarm Candidates -->
    <div class="block" id="block5">
      <div class="block-header">
        <h2>B5 Alarm Candidates</h2>
        <span style="font-size:11px;color:var(--accent-red);font-weight:600;" id="alarmCounter">0</span>
      </div>
      <div class="block-body">
        <div id="alarmFeed">
          <div class="empty"><div class="icon">&#128276;</div><p>No alarms yet</p></div>
        </div>
      </div>
    </div>

    <!-- BLOCK 6: Metrics & Quotas -->
    <div class="block" id="block6">
      <div class="block-header">
        <h2>B6 Metrics & Quotas</h2>
        <span class="status-badge ready" id="healthBadge" style="font-size:10px;">Healthy</span>
      </div>
      <div class="block-body">
        <div class="metrics-row">
          <div class="metric-box"><div class="val" id="m_active">0</div><div class="lbl">Active</div></div>
          <div class="metric-box"><div class="val" id="m_scans">0</div><div class="lbl">Scans</div></div>
          <div class="metric-box"><div class="val" id="m_alarms">0</div><div class="lbl">Alarms</div></div>
          <div class="metric-box"><div class="val" id="m_monitors">0</div><div class="lbl">Monitors</div></div>
        </div>
        <div id="quotasArea">
          <div class="quota-row"><span class="quota-label">Sessions</span><div class="quota-bar"><div class="quota-fill" id="qbar_sessions" style="width:0%"></div></div><span class="quota-val" id="qval_sessions">-/-</span></div>
          <div class="quota-row"><span class="quota-label">Max Devices</span><div class="quota-bar"><div class="quota-fill" style="width:0%"></div></div><span class="quota-val" id="qval_devices">-</span></div>
          <div class="quota-row"><span class="quota-label">Scans/hr</span><div class="quota-bar"><div class="quota-fill" style="width:0%"></div></div><span class="quota-val" id="qval_scans">-</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- WIZARD OVERLAY -->
  <div class="wizard-overlay" id="wizardOverlay">
    <div class="wizard-top">
      <h2>Scenario Builder</h2>
      <div class="wizard-steps" id="wizardSteps">
        <div class="wizard-step active" data-step="1"><span class="step-num">1</span> Centrals</div>
        <span class="wizard-step-arrow">&#9654;</span>
        <div class="wizard-step" data-step="2"><span class="step-num">2</span> Devices</div>
        <span class="wizard-step-arrow">&#9654;</span>
        <div class="wizard-step" data-step="3"><span class="step-num">3</span> Rules</div>
        <span class="wizard-step-arrow">&#9654;</span>
        <div class="wizard-step" data-step="4"><span class="step-num">4</span> Control</div>
        <span class="wizard-step-arrow">&#9654;</span>
        <div class="wizard-step" data-step="5"><span class="step-num">5</span> Review</div>
      </div>
      <button class="btn btn-outline" onclick="closeWizard()">Close</button>
    </div>
    <div class="wizard-body" id="wizardBody">
      <!-- Step 1: Centrals -->
      <div class="wizard-section active" id="wiz_step1">
        <h3>Step 1: Select Centrals</h3>
        <p class="desc">Choose which centrals to include in this simulation scenario. Devices will be loaded from selected centrals.</p>
        <div id="centralsList"><div class="empty"><p>Select a customer first</p></div></div>
      </div>
      <!-- Step 2: Devices -->
      <div class="wizard-section" id="wiz_step2">
        <h3>Step 2: Select Devices</h3>
        <p class="desc">Pick devices from your selected centrals. OUTLET devices show their channel configuration.</p>
        <div id="devicesListWiz"><div class="empty"><p>Select centrals first</p></div></div>
      </div>
      <!-- Step 3: Rules -->
      <div class="wizard-section" id="wiz_step3">
        <h3>Step 3: Select Alarm Rules</h3>
        <p class="desc">Choose which alarm rules should be evaluated during simulation. Only active rules are shown.</p>
        <div id="rulesListWiz"><div class="empty"><p>Loading rules...</p></div></div>
      </div>
      <!-- Step 4: Control -->
      <div class="wizard-section" id="wiz_step4">
        <h3>Step 4: Simulation Control</h3>
        <p class="desc">Configure timing and session parameters.</p>
        <div class="control-grid">
          <div class="ctrl-field"><label>Session Name *</label><input type="text" id="wizName" placeholder="e.g., QA Test Session" /></div>
          <div class="ctrl-field"><label>Description</label><input type="text" id="wizDesc" placeholder="Optional description..." /></div>
          <div class="ctrl-field"><label>Device Scan Interval</label><select id="wizScanInterval"><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="120">2 minutes</option></select></div>
          <div class="ctrl-field"><label>Bundle Refresh Interval</label><select id="wizBundleInterval"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="300" selected>5 minutes</option></select></div>
          <div class="ctrl-field"><label>Session Duration</label><select id="wizDuration"><option value="1">1 hour</option><option value="4">4 hours</option><option value="12">12 hours</option><option value="24" selected>24 hours</option><option value="72">72 hours (Premium)</option></select></div>
        </div>
      </div>
      <!-- Step 5: Review -->
      <div class="wizard-section" id="wiz_step5">
        <h3>Step 5: Review & Create</h3>
        <p class="desc">Verify your scenario configuration before creating.</p>
        <div class="review-grid" id="reviewGrid">
          <div class="review-stat"><div class="rval" id="revCentrals">0</div><div class="rlbl">Centrals</div></div>
          <div class="review-stat"><div class="rval" id="revDevices">0</div><div class="rlbl">Devices</div></div>
          <div class="review-stat"><div class="rval" id="revRules">0</div><div class="rlbl">Rules</div></div>
          <div class="review-stat"><div class="rval" id="revDuration">24h</div><div class="rlbl">Duration</div></div>
        </div>
        <div id="reviewDetails" style="margin-top:12px;"></div>
      </div>
    </div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wizBtnBack" onclick="wizardBack()" style="display:none;">Back</button>
      <div style="margin-left:auto; display:flex; gap:8px;">
        <button class="btn btn-primary btn-lg" id="wizBtnNext" onclick="wizardNext()">Next</button>
        <button class="btn btn-success btn-lg" id="wizBtnCreate" onclick="wizardCreate()" style="display:none;">Create Scenario</button>
      </div>
    </div>
  </div>

  <script>
    // =========================================================================
    // STATE
    // =========================================================================
    let scenario = null;     // completed scenario config (null = not configured)
    let runningSessionId = null;
    let eventSource = null;
    let demoRunning = false;
    let wizardStep = 1;

    // Wizard transient state
    let wiz = { centralIds: [], centralsData: [], devices: [], devicesData: {}, ruleIds: [], rulesData: [] };

    // Counters for blocks
    let scanCount = 0, evalCount = 0, alarmCount = 0;

    // =========================================================================
    // INIT
    // =========================================================================
    document.addEventListener('DOMContentLoaded', () => {
      const saved = localStorage.getItem('simulatorTenantId');
      if (saved) { document.getElementById('tenantId').value = saved; loadData(); }
      loadMetrics();
      setInterval(loadMetrics, 10000);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWizard(); });
    });

    // =========================================================================
    // TOP BAR: LOAD DATA
    // =========================================================================
    async function loadData() {
      const tid = document.getElementById('tenantId').value.trim();
      if (!tid) return alert('Enter a Tenant ID');
      localStorage.setItem('simulatorTenantId', tid);
      await Promise.all([loadCustomers(), loadQuotas(), loadSessions()]);
    }

    async function loadCustomers() {
      const tid = document.getElementById('tenantId').value.trim(); if (!tid) return;
      try {
        const r = await fetch(\`/admin/simulator/api/customers?tenantId=\${tid}\`);
        const d = await r.json();
        const sel = document.getElementById('customerId');
        if (!d.customers || !d.customers.length) { sel.innerHTML = '<option value="">No customers</option>'; return; }
        sel.innerHTML = '<option value="">Select...</option>' + d.customers.map(c => \`<option value="\${c.id}">\${c.name}</option>\`).join('');
      } catch(e) { console.error(e); }
    }

    async function loadSessions() {
      const tid = document.getElementById('tenantId').value.trim(); if (!tid) return;
      try {
        const r = await fetch(\`/admin/simulator/api/sessions?tenantId=\${tid}\`);
        const d = await r.json();
        // If there's a running session, track it
        if (d.sessions) {
          const running = d.sessions.find(s => s.status === 'RUNNING' && s.isActive);
          if (running && !runningSessionId) {
            runningSessionId = running.id;
            showRunningState(running.name);
            startMonitor(running.id);
          }
        }
      } catch(e) { console.error(e); }
    }

    async function loadQuotas() {
      const tid = document.getElementById('tenantId').value.trim(); if (!tid) return;
      try {
        const r = await fetch(\`/admin/simulator/api/quotas?tenantId=\${tid}\`);
        const d = await r.json();
        const pct = (d.activeSessions / d.quotas.maxConcurrentSessions) * 100;
        document.getElementById('qval_sessions').textContent = d.activeSessions+'/'+d.quotas.maxConcurrentSessions;
        const bar = document.getElementById('qbar_sessions');
        bar.style.width = pct+'%';
        bar.className = 'quota-fill' + (pct > 80 ? ' crit' : pct > 50 ? ' warn' : '');
        document.getElementById('qval_devices').textContent = d.quotas.maxDevicesPerSession;
        document.getElementById('qval_scans').textContent = d.quotas.maxScansPerHour+'/hr';
      } catch(e) { console.error(e); }
    }

    async function loadMetrics() {
      try {
        const r = await fetch('/admin/simulator/api/metrics');
        const d = await r.json();
        document.getElementById('m_active').textContent = d.sessions.active;
        document.getElementById('m_scans').textContent = d.processing.scansPerformed;
        document.getElementById('m_alarms').textContent = d.processing.alarmsTriggered;
        document.getElementById('m_monitors').textContent = d.monitor.connectedClients;
        const h = document.getElementById('healthBadge');
        h.textContent = d.health.status.charAt(0).toUpperCase() + d.health.status.slice(1);
        h.className = 'status-badge ' + (d.health.status === 'healthy' ? 'ready' : d.health.status === 'degraded' ? 'stopped' : 'error');
      } catch(e) {}
    }

    // =========================================================================
    // BLOCK 1: SCENARIO CONTROL
    // =========================================================================
    function updateBlock1() {
      if (runningSessionId) return; // handled by showRunningState
      if (!scenario) {
        document.getElementById('simStatusBadge').className = 'status-badge not-configured';
        document.getElementById('simStatusBadge').textContent = 'Not Configured';
        document.getElementById('sumCentrals').textContent = '0';
        document.getElementById('sumDevices').textContent = '0';
        document.getElementById('sumRules').textContent = '0';
        document.getElementById('sumMode').textContent = '-';
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnConfigure').textContent = 'Configure Simulator';
        document.getElementById('btnConfigure').style.display = '';
        document.getElementById('btnStart').style.display = '';
        document.getElementById('runningActions').style.display = 'none';
        document.getElementById('sessionInfo').style.display = 'none';
      } else {
        document.getElementById('simStatusBadge').className = 'status-badge ready';
        document.getElementById('simStatusBadge').textContent = 'Ready';
        document.getElementById('sumCentrals').textContent = scenario.centralIds.length;
        document.getElementById('sumDevices').textContent = scenario.devices.length;
        document.getElementById('sumRules').textContent = scenario.ruleIds.length;
        document.getElementById('sumMode').textContent = scenario.scanInterval + 's scan';
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnConfigure').textContent = 'Reconfigure';
        document.getElementById('btnConfigure').style.display = '';
        document.getElementById('btnStart').style.display = '';
        document.getElementById('runningActions').style.display = 'none';
        document.getElementById('sessionInfo').style.display = 'none';
      }
    }

    function showRunningState(sessionName) {
      document.getElementById('simStatusBadge').className = 'status-badge running';
      document.getElementById('simStatusBadge').innerHTML = '<span class="pulse-dot"></span> Running';
      document.getElementById('btnConfigure').style.display = 'none';
      document.getElementById('btnStart').style.display = 'none';
      document.getElementById('runningActions').style.display = 'flex';
      document.getElementById('sessionInfo').style.display = 'block';
      document.getElementById('sessionNameDisplay').textContent = sessionName;
    }

    function showStoppedState() {
      runningSessionId = null;
      document.getElementById('simStatusBadge').className = 'status-badge stopped';
      document.getElementById('simStatusBadge').textContent = 'Stopped';
      document.getElementById('runningActions').style.display = 'none';
      document.getElementById('sessionInfo').style.display = 'none';
      document.getElementById('btnConfigure').style.display = '';
      document.getElementById('btnStart').style.display = '';
      document.getElementById('btnStart').disabled = !!scenario;
      document.getElementById('btnConfigure').textContent = scenario ? 'Reconfigure' : 'Configure Simulator';
    }

    // =========================================================================
    // START / STOP SIMULATION
    // =========================================================================
    async function startSimulation() {
      if (!scenario) return;
      const tid = document.getElementById('tenantId').value.trim();
      const cid = document.getElementById('customerId').value;
      if (!tid || !cid) return alert('Set Tenant and Customer first');

      const config = {
        customerId: cid,
        deviceScanIntervalMs: scenario.scanInterval * 1000,
        bundleRefreshIntervalMs: scenario.bundleInterval * 1000,
        devices: scenario.devices,
        centralIds: scenario.centralIds,
        ruleIds: scenario.ruleIds,
        sessionDurationHours: scenario.duration,
        description: scenario.description,
      };

      try {
        const r = await fetch('/admin/simulator/api/sessions/start', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ tenantId: tid, customerId: cid, name: scenario.name, config })
        });
        const d = await r.json();
        if (!d.success) return alert('Error: ' + d.error);
        runningSessionId = d.session.id;
        showRunningState(scenario.name);
        startMonitor(d.session.id);
        loadQuotas();
      } catch(e) { alert('Failed: ' + e.message); }
    }

    async function stopSimulation() {
      if (!runningSessionId) return;
      try {
        await fetch(\`/admin/simulator/api/sessions/\${runningSessionId}/stop\`, {
          method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({reason:'USER_REQUESTED'})
        });
        stopMonitor();
        showStoppedState();
        loadQuotas();
      } catch(e) { alert('Failed: ' + e.message); }
    }

    // =========================================================================
    // SSE MONITOR — routes events to blocks
    // =========================================================================
    function startMonitor(sessionId) {
      stopMonitor();
      scanCount = 0; evalCount = 0; alarmCount = 0;
      clearBlocks();
      eventSource = new EventSource(\`/admin/simulator/api/sessions/\${sessionId}/monitor\`);

      eventSource.addEventListener('bundle:fetched', (e) => {
        const ev = JSON.parse(e.data);
        const bd = ev.data;
        document.getElementById('bundleVersion').textContent = bd.version || '-';
        document.getElementById('bundleLastFetch').textContent = new Date().toLocaleTimeString();
        document.getElementById('bundleRulesCount').textContent = bd.rulesCount ?? '-';
        document.getElementById('bundleDevicesCount').textContent = bd.devicesCount ?? '-';
        document.getElementById('bundleStatus').textContent = bd.isUpdated ? 'Updated' : 'Unchanged';
      });

      eventSource.addEventListener('device:scanned', (e) => {
        const ev = JSON.parse(e.data);
        scanCount++;
        document.getElementById('scanCounter').textContent = scanCount + ' scans';
        const feed = document.getElementById('scanFeed');
        if (scanCount === 1) feed.innerHTML = '';
        const telParts = Object.entries(ev.data.telemetry).map(([k,v]) => {
          return \`<span>\${k}=\${Number(v).toFixed(1)}</span>\`;
        }).join(' ');
        const row = document.createElement('div');
        row.className = 'feed-entry';
        row.innerHTML = \`<span class="feed-time">\${new Date().toLocaleTimeString()}</span><span class="feed-device">\${(ev.data.deviceId||'').substring(0,8)}...</span><span class="feed-values">\${telParts}</span>\`;
        feed.insertBefore(row, feed.firstChild);
        while (feed.children.length > 60) feed.removeChild(feed.lastChild);
      });

      eventSource.addEventListener('alarm:candidate', (e) => {
        const ev = JSON.parse(e.data);
        alarmCount++;
        document.getElementById('alarmCounter').textContent = alarmCount;

        // Block 4: eval result (fail)
        evalCount++;
        document.getElementById('evalCounter').textContent = evalCount + ' evaluations';
        const evalFeed = document.getElementById('evalFeed');
        if (evalCount === 1) evalFeed.innerHTML = '';
        const evalRow = document.createElement('div');
        evalRow.className = 'eval-entry';
        evalRow.innerHTML = \`<span>\${ev.data.ruleName} on \${(ev.data.deviceId||'').substring(0,8)}</span><span>\${ev.data.field}=\${Number(ev.data.value).toFixed(1)} vs \${ev.data.threshold}</span><span class="eval-badge fail">FAIL</span>\`;
        evalFeed.insertBefore(evalRow, evalFeed.firstChild);
        while (evalFeed.children.length > 40) evalFeed.removeChild(evalFeed.lastChild);

        // Block 5: alarm entry
        const af = document.getElementById('alarmFeed');
        if (alarmCount === 1) af.innerHTML = '';
        const ae = document.createElement('div');
        ae.className = 'alarm-entry';
        ae.innerHTML = \`<div class="alarm-head"><strong>\${ev.data.ruleName}</strong><span class="severity-badge WARNING">WARNING</span></div><div class="alarm-detail">\${ev.data.field}=\${Number(ev.data.value).toFixed(1)} (threshold: \${ev.data.threshold}) | Device: \${(ev.data.deviceId||'').substring(0,8)}... | \${new Date().toLocaleTimeString()}</div>\`;
        af.insertBefore(ae, af.firstChild);
        while (af.children.length > 30) af.removeChild(af.lastChild);
      });

      eventSource.addEventListener('session:stopped', () => { stopMonitor(); showStoppedState(); });
      eventSource.addEventListener('session:expired', () => { stopMonitor(); showStoppedState(); });
      eventSource.onerror = () => { console.log('SSE reconnecting...'); };
    }

    function stopMonitor() {
      if (eventSource) { eventSource.close(); eventSource = null; }
    }

    function clearBlocks() {
      document.getElementById('scanFeed').innerHTML = '<div class="empty"><div class="icon">&#128225;</div><p>Waiting for scans...</p></div>';
      document.getElementById('evalFeed').innerHTML = '<div class="empty"><p>Waiting for evaluations...</p></div>';
      document.getElementById('alarmFeed').innerHTML = '<div class="empty"><div class="icon">&#128276;</div><p>No alarms yet</p></div>';
      document.getElementById('scanCounter').textContent = '0 scans';
      document.getElementById('evalCounter').textContent = '0 evaluations';
      document.getElementById('alarmCounter').textContent = '0';
    }

    // =========================================================================
    // WIZARD
    // =========================================================================
    function openWizard() {
      const cid = document.getElementById('customerId').value;
      if (!cid) return alert('Select a Customer first');
      wizardStep = 1;
      wiz = { centralIds:[], centralsData:[], devices:[], devicesData:{}, ruleIds:[], rulesData:[] };
      showWizardStep(1);
      document.getElementById('wizardOverlay').classList.add('active');
      loadWizardCentrals();
    }

    function closeWizard() {
      document.getElementById('wizardOverlay').classList.remove('active');
    }

    function showWizardStep(step) {
      wizardStep = step;
      for (let i = 1; i <= 5; i++) {
        document.getElementById('wiz_step'+i).classList.toggle('active', i === step);
      }
      document.querySelectorAll('.wizard-step[data-step]').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.toggle('active', s === step);
        el.classList.toggle('completed', s < step);
      });
      document.getElementById('wizBtnBack').style.display = step > 1 ? '' : 'none';
      document.getElementById('wizBtnNext').style.display = step < 5 ? '' : 'none';
      document.getElementById('wizBtnCreate').style.display = step === 5 ? '' : 'none';
    }

    function wizardNext() {
      if (wizardStep === 1) {
        wiz.centralIds = getCheckedIds('centralsList');
        if (!wiz.centralIds.length) return alert('Select at least one central');
        loadWizardDevices();
      } else if (wizardStep === 2) {
        wiz.devices = getCheckedDevices();
        if (!wiz.devices.length) return alert('Select at least one device');
        loadWizardRules();
      } else if (wizardStep === 3) {
        wiz.ruleIds = getCheckedIds('rulesListWiz');
        if (!wiz.ruleIds.length) return alert('Select at least one rule');
      } else if (wizardStep === 4) {
        if (!document.getElementById('wizName').value.trim()) return alert('Enter a session name');
        buildReview();
      }
      showWizardStep(wizardStep + 1);
    }

    function wizardBack() { if (wizardStep > 1) showWizardStep(wizardStep - 1); }

    function wizardCreate() {
      scenario = {
        centralIds: wiz.centralIds,
        devices: wiz.devices,
        ruleIds: wiz.ruleIds,
        name: document.getElementById('wizName').value.trim(),
        description: document.getElementById('wizDesc').value.trim(),
        scanInterval: parseInt(document.getElementById('wizScanInterval').value),
        bundleInterval: parseInt(document.getElementById('wizBundleInterval').value),
        duration: parseInt(document.getElementById('wizDuration').value),
      };
      closeWizard();
      updateBlock1();
    }

    // --- Wizard data loaders ---
    async function loadWizardCentrals() {
      const tid = document.getElementById('tenantId').value.trim();
      const cid = document.getElementById('customerId').value;
      try {
        const r = await fetch(\`/admin/simulator/api/centrals?tenantId=\${tid}&customerId=\${cid}\`);
        const d = await r.json();
        wiz.centralsData = d.centrals || [];
        const container = document.getElementById('centralsList');
        if (!wiz.centralsData.length) { container.innerHTML = '<div class="empty"><p>No centrals found</p></div>'; return; }
        container.innerHTML = '<ul class="check-list">' + wiz.centralsData.map(c => \`
          <li class="check-item" onclick="toggleCheck(this)">
            <input type="checkbox" data-id="\${c.id}" />
            <div class="item-info">
              <div class="item-name">\${c.name}</div>
              <div class="item-meta">SN: \${c.serialNumber} | \${c.type} <span class="conn-badge \${c.connectionStatus}">\${c.connectionStatus}</span></div>
            </div>
          </li>
        \`).join('') + '</ul>';
      } catch(e) { console.error(e); }
    }

    async function loadWizardDevices() {
      const tid = document.getElementById('tenantId').value.trim();
      const container = document.getElementById('devicesListWiz');
      container.innerHTML = '<div class="empty"><p>Loading devices...</p></div>';
      let html = '';
      for (const cid of wiz.centralIds) {
        try {
          const r = await fetch(\`/admin/simulator/api/centrals/\${cid}/devices?tenantId=\${tid}\`);
          const d = await r.json();
          wiz.devicesData[cid] = d.devices || [];
          const centralName = wiz.centralsData.find(c => c.id === cid)?.name || cid.substring(0,8);
          html += \`<div class="device-group"><h4>&#9881; \${centralName} <span class="select-all" onclick="selectAllInGroup(this)">Select All</span></h4><ul class="check-list">\`;
          for (const dev of wiz.devicesData[cid]) {
            const chBadges = dev.channels ? dev.channels.map(ch => \`<span class="ch-badge">\${ch.name}</span>\`).join('') : '';
            html += \`<li class="check-item" onclick="toggleCheck(this)">
              <input type="checkbox" data-id="\${dev.id}" data-name="\${dev.name}" data-type="\${dev.type}" data-slave="\${dev.slaveId||''}" data-channels='\${JSON.stringify(dev.channels||[])}' />
              <div class="item-info">
                <div class="item-name">\${dev.name}</div>
                <div class="item-meta">
                  <span class="type-badge">\${dev.type}</span>
                  SN: \${dev.serialNumber || '-'} | Slave: \${dev.slaveId ?? '-'}
                </div>
                \${chBadges ? '<div class="item-badges">' + chBadges + '</div>' : ''}
              </div>
            </li>\`;
          }
          html += '</ul></div>';
        } catch(e) { console.error(e); }
      }
      container.innerHTML = html || '<div class="empty"><p>No devices found</p></div>';
    }

    async function loadWizardRules() {
      const tid = document.getElementById('tenantId').value.trim();
      const cid = document.getElementById('customerId').value;
      const container = document.getElementById('rulesListWiz');
      try {
        const r = await fetch(\`/admin/simulator/api/rules?tenantId=\${tid}&customerId=\${cid}\`);
        const d = await r.json();
        wiz.rulesData = d.rules || [];
        if (!wiz.rulesData.length) { container.innerHTML = '<div class="empty"><p>No rules found</p></div>'; return; }
        container.innerHTML = '<ul class="check-list">' + wiz.rulesData.map(rule => {
          const ac = rule.alarmConfig || {};
          return \`<li class="check-item" onclick="toggleCheck(this)">
            <input type="checkbox" data-id="\${rule.id}" />
            <div class="item-info">
              <div class="item-name">\${rule.name}</div>
              <div class="item-meta">\${rule.type} | \${rule.priority} | \${ac.field || '-'} \${ac.operator || ''} \${ac.threshold ?? ''}</div>
            </div>
          </li>\`;
        }).join('') + '</ul>';
      } catch(e) { console.error(e); }
    }

    // --- Wizard helpers ---
    function toggleCheck(li) {
      const cb = li.querySelector('input[type=checkbox]');
      cb.checked = !cb.checked;
      li.classList.toggle('selected', cb.checked);
    }

    function selectAllInGroup(el) {
      const group = el.closest('.device-group');
      const items = group.querySelectorAll('.check-item');
      const allChecked = Array.from(items).every(li => li.querySelector('input').checked);
      items.forEach(li => {
        li.querySelector('input').checked = !allChecked;
        li.classList.toggle('selected', !allChecked);
      });
    }

    function getCheckedIds(containerId) {
      return Array.from(document.querySelectorAll('#'+containerId+' input[type=checkbox]:checked')).map(cb => cb.dataset.id);
    }

    function getCheckedDevices() {
      return Array.from(document.querySelectorAll('#devicesListWiz input[type=checkbox]:checked')).map(cb => {
        const devType = cb.dataset.type;
        let profile = { temperature: {min:20,max:32,unit:'C'}, humidity: {min:40,max:80,unit:'%'} };
        // Auto-profile from channels for OUTLET
        const channels = JSON.parse(cb.dataset.channels || '[]');
        if (channels.length) {
          profile = {};
          channels.forEach(ch => {
            const defaults = { temperature:{min:18,max:35,unit:'C'}, humidity:{min:30,max:85,unit:'%'}, flow:{min:0,max:100,unit:'L/min'}, energy:{min:0,max:500,unit:'kWh'} };
            profile[ch.name] = defaults[ch.type] || {min:0,max:100,unit:''};
          });
        }
        return { deviceId: cb.dataset.id, telemetryProfile: profile };
      });
    }

    function buildReview() {
      document.getElementById('revCentrals').textContent = wiz.centralIds.length;
      document.getElementById('revDevices').textContent = wiz.devices.length;
      document.getElementById('revRules').textContent = wiz.ruleIds.length;
      document.getElementById('revDuration').textContent = document.getElementById('wizDuration').value + 'h';
      let details = '';
      // Centrals detail
      details += '<div class="review-section"><h4>Centrals</h4><div class="review-list">';
      wiz.centralIds.forEach(id => {
        const c = wiz.centralsData.find(x => x.id === id);
        details += '<div class="review-item">' + (c ? c.name + ' (' + c.type + ')' : id.substring(0,8)) + '</div>';
      });
      details += '</div></div>';
      // Devices detail
      details += '<div class="review-section"><h4>Devices</h4><div class="review-list">';
      wiz.devices.forEach(d => {
        const metrics = Object.keys(d.telemetryProfile).join(', ');
        details += '<div class="review-item">' + d.deviceId.substring(0,8) + '... [' + metrics + ']</div>';
      });
      details += '</div></div>';
      // Rules detail
      details += '<div class="review-section"><h4>Rules</h4><div class="review-list">';
      wiz.ruleIds.forEach(id => {
        const r = wiz.rulesData.find(x => x.id === id);
        details += '<div class="review-item">' + (r ? r.name : id.substring(0,8)) + '</div>';
      });
      details += '</div></div>';
      // Control detail
      details += '<div class="review-section"><h4>Control</h4><div class="review-list">';
      details += '<div class="review-item">Name: ' + document.getElementById('wizName').value + '</div>';
      details += '<div class="review-item">Scan: ' + document.getElementById('wizScanInterval').value + 's | Bundle: ' + document.getElementById('wizBundleInterval').value + 's</div>';
      details += '<div class="review-item">Duration: ' + document.getElementById('wizDuration').value + ' hours</div>';
      details += '</div></div>';
      document.getElementById('reviewDetails').innerHTML = details;
    }

    // =========================================================================
    // DEMO
    // =========================================================================
    async function runDemo() {
      if (demoRunning) return;
      demoRunning = true;
      const btn = document.getElementById('demoBtn');
      btn.disabled = true; btn.textContent = 'Setting up...';
      clearBlocks();
      try {
        const sr = await fetch('/admin/simulator/api/demo/setup', {method:'POST'});
        const sd = await sr.json();
        if (!sd.success) throw new Error(sd.error);
        document.getElementById('tenantId').value = sd.demo.tenantId;
        localStorage.setItem('simulatorTenantId', sd.demo.tenantId);
        await loadData();
        document.getElementById('customerId').value = sd.demo.customerId;
        btn.textContent = 'Starting...';
        const sess = await fetch('/admin/simulator/api/demo/start-session', {method:'POST'});
        const sessD = await sess.json();
        if (!sessD.success) throw new Error(sessD.error);
        // Set scenario from demo
        scenario = { centralIds: [sd.demo.centralId], devices: sessD.session.config?.devices || [], ruleIds: sd.demo.ruleIds, name: sessD.session.name, description: 'Demo', scanInterval: 30, bundleInterval: 60, duration: 24 };
        runningSessionId = sessD.session.id;
        showRunningState(sessD.session.name);
        updateBlock1();
        startMonitor(sessD.session.id);
        btn.textContent = 'Running';
        setTimeout(() => { btn.textContent = 'DEMO'; btn.disabled = false; demoRunning = false; }, 2000);
      } catch(e) {
        alert('Demo failed: ' + e.message);
        btn.textContent = 'DEMO'; btn.disabled = false; demoRunning = false;
      }
    }

    // Init block 1
    updateBlock1();
  </script>
</body>
</html>`;
}

export const simulatorAdminController = router;
