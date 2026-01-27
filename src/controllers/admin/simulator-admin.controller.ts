// =============================================================================
// GCDR Simulator Cockpit Controller (RFC-0010)
// =============================================================================
// Premium UI for managing alarm simulations
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
      // Demo already setup, just return the IDs
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

    // Create Demo Customer
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

    // Create Demo Asset
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

    // Create Demo Central
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

    // Create Demo Devices
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

    // Create Demo Alarm Rules
    const demoRules = [
      {
        id: DEMO_RULE_IDS[0],
        name: 'High Temperature Alert',
        description: 'Triggers when temperature exceeds 28°C',
        type: 'ALARM_THRESHOLD' as const,
        priority: 'HIGH' as const,
        alarmConfig: {
          field: 'temperature',
          operator: 'gt',
          threshold: 28,
          unit: '°C',
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

    // Create session with demo devices
    const session = await simulatorEngine.startSession(
      DEMO_TENANT_ID,
      DEMO_CUSTOMER_ID,
      DEMO_USER_ID,
      sessionName,
      {
        customerId: DEMO_CUSTOMER_ID,
        deviceScanIntervalMs: 30000, // 30 seconds for demo
        bundleRefreshIntervalMs: 60000, // 1 minute
        devices: [
          {
            deviceId: DEMO_DEVICE_IDS[0],
            telemetryProfile: {
              temperature: { min: 22, max: 32, unit: '°C' }, // May trigger alarm > 28
            }
          },
          {
            deviceId: DEMO_DEVICE_IDS[1],
            telemetryProfile: {
              humidity: { min: 50, max: 80, unit: '%' }, // May trigger alarm > 70
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

    // Simple query to get customers
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
// HTML UI
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
      --border-color: #475569;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    header h1 {
      font-size: 24px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    header h1 .icon {
      font-size: 28px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .badge {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-premium {
      background: linear-gradient(135deg, #a855f7, #6366f1);
      color: white;
    }

    .btn-demo {
      background: linear-gradient(135deg, #22c55e, #16a34a);
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
    }

    .btn-demo:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
    }

    .btn-demo:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .btn-help {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      border: 1px solid var(--border-color);
      transition: all 0.2s;
    }

    .btn-help:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-blue);
    }

    /* Modal Styles */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal {
      background: var(--bg-secondary);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      max-width: 900px;
      max-height: 85vh;
      width: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-header h2 {
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 24px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .modal-close:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }

    .manual-section {
      margin-bottom: 32px;
    }

    .manual-section:last-child {
      margin-bottom: 0;
    }

    .manual-section h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--accent-blue);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .manual-section p {
      color: var(--text-secondary);
      line-height: 1.6;
      margin-bottom: 12px;
    }

    .manual-section ul {
      list-style: none;
      padding-left: 0;
    }

    .manual-section li {
      color: var(--text-secondary);
      padding: 8px 0;
      padding-left: 24px;
      position: relative;
      line-height: 1.5;
    }

    .manual-section li::before {
      content: "→";
      position: absolute;
      left: 0;
      color: var(--accent-green);
    }

    .manual-code {
      background: var(--bg-primary);
      padding: 12px 16px;
      border-radius: 8px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      color: var(--accent-green);
      margin: 12px 0;
      overflow-x: auto;
    }

    .manual-tip {
      background: rgba(59, 130, 246, 0.1);
      border-left: 4px solid var(--accent-blue);
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      margin: 16px 0;
    }

    .manual-tip strong {
      color: var(--accent-blue);
    }

    .manual-warning {
      background: rgba(234, 179, 8, 0.1);
      border-left: 4px solid var(--accent-yellow);
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      margin: 16px 0;
    }

    .manual-warning strong {
      color: var(--accent-yellow);
    }

    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--accent-blue);
      color: white;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }

    .tenant-selector {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .tenant-selector label {
      color: var(--text-secondary);
      font-size: 14px;
    }

    .tenant-selector input {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      width: 320px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .grid-full {
      grid-column: 1 / -1;
    }

    .card {
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow: hidden;
    }

    .card-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header h2 {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-body {
      padding: 20px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .form-group input,
    .form-group select {
      width: 100%;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 14px;
    }

    .form-group input:focus,
    .form-group select:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .btn {
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--accent-blue);
      color: white;
    }

    .btn-primary:hover {
      background: #2563eb;
    }

    .btn-success {
      background: var(--accent-green);
      color: white;
    }

    .btn-danger {
      background: var(--accent-red);
      color: white;
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
    }

    .sessions-list {
      max-height: 300px;
      overflow-y: auto;
    }

    .session-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .session-item:last-child {
      border-bottom: none;
    }

    .session-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .session-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .session-status.running {
      background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green);
    }

    .session-status.stopped {
      background: var(--text-muted);
    }

    .session-status.expired {
      background: var(--accent-yellow);
    }

    .session-status.error {
      background: var(--accent-red);
    }

    .session-name {
      font-weight: 500;
    }

    .session-meta {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .session-stats {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .stat {
      text-align: center;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 600;
    }

    .stat-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .monitor-log {
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 16px;
      height: 350px;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
    }

    .log-entry {
      padding: 4px 0;
      display: flex;
      gap: 12px;
    }

    .log-time {
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .log-icon {
      flex-shrink: 0;
    }

    .log-message {
      color: var(--text-secondary);
    }

    .log-entry.alarm .log-message {
      color: var(--accent-red);
    }

    .log-entry.bundle .log-message {
      color: var(--accent-blue);
    }

    .log-entry.scan .log-message {
      color: var(--accent-green);
    }

    .quotas-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }

    .quota-item {
      background: var(--bg-tertiary);
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }

    .quota-value {
      font-size: 24px;
      font-weight: 700;
    }

    .quota-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .progress-bar {
      height: 6px;
      background: var(--bg-primary);
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-blue);
      transition: width 0.3s;
    }

    .progress-fill.warning {
      background: var(--accent-yellow);
    }

    .progress-fill.danger {
      background: var(--accent-red);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    .metric-card {
      background: var(--bg-tertiary);
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
    }

    .metric-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-top: 4px;
    }

    .health-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }

    .health-status.healthy {
      background: rgba(34, 197, 94, 0.2);
      color: var(--accent-green);
    }

    .health-status.degraded {
      background: rgba(234, 179, 8, 0.2);
      color: var(--accent-yellow);
    }

    .health-status.unhealthy {
      background: rgba(239, 68, 68, 0.2);
      color: var(--accent-red);
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
    }

    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .device-list {
      max-height: 150px;
      overflow-y: auto;
      background: var(--bg-primary);
      border-radius: 6px;
      padding: 8px;
    }

    .device-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-tertiary);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      margin: 2px;
    }

    .device-chip .remove {
      cursor: pointer;
      color: var(--text-muted);
    }

    .device-chip .remove:hover {
      color: var(--accent-red);
    }

    .loading {
      opacity: 0.5;
      pointer-events: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .pulsing {
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>
        <span class="icon">🎮</span>
        Simulator Cockpit
        <span class="badge badge-premium">Premium</span>
      </h1>
      <div class="header-actions">
        <button class="btn-help" onclick="openManual()">
          📖 Manual
        </button>
        <button class="btn-demo" id="demoBtn" onclick="runDemo()">
          🚀 DEMO
        </button>
        <div class="tenant-selector">
          <label>Tenant ID:</label>
          <input type="text" id="tenantId" placeholder="Enter tenant UUID..." />
          <button class="btn btn-primary" onclick="loadData()">Load</button>
        </div>
      </div>
    </header>

    <div class="grid">
      <!-- New Session Card -->
      <div class="card">
        <div class="card-header">
          <h2>➕ New Session</h2>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Session Name</label>
            <input type="text" id="sessionName" placeholder="e.g., QA Test Session" />
          </div>
          <div class="form-group">
            <label>Customer</label>
            <select id="customerId">
              <option value="">Select customer...</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Scan Interval (seconds)</label>
              <input type="number" id="scanInterval" value="60" min="10" />
            </div>
            <div class="form-group">
              <label>Bundle Refresh (seconds)</label>
              <input type="number" id="bundleRefresh" value="300" min="30" />
            </div>
          </div>
          <div class="form-group">
            <label>Devices</label>
            <select id="deviceSelect" onchange="addDevice()">
              <option value="">Add device...</option>
            </select>
            <div class="device-list" id="deviceList">
              <div class="empty-state" style="padding: 20px;">
                <small>No devices selected</small>
              </div>
            </div>
          </div>
          <button class="btn btn-success" onclick="startSession()" style="width: 100%;">
            ▶ Start Session
          </button>
        </div>
      </div>

      <!-- Active Sessions Card -->
      <div class="card">
        <div class="card-header">
          <h2>📋 Sessions</h2>
          <button class="btn btn-sm btn-primary" onclick="loadSessions()">Refresh</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="sessions-list" id="sessionsList">
            <div class="empty-state">
              <div class="icon">📭</div>
              <p>No sessions found</p>
              <small>Enter tenant ID and click Load</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Monitor Card -->
      <div class="card grid-full">
        <div class="card-header">
          <h2>
            <span id="monitorStatus">⚪</span>
            Live Monitor
            <span id="monitorSession" style="font-weight: normal; color: var(--text-secondary); font-size: 14px;"></span>
          </h2>
          <button class="btn btn-sm btn-danger" onclick="stopMonitor()" id="stopMonitorBtn" style="display: none;">
            Stop Monitor
          </button>
        </div>
        <div class="card-body">
          <div class="monitor-log" id="monitorLog">
            <div class="empty-state">
              <div class="icon">📡</div>
              <p>Select a session to monitor</p>
              <small>Click "Monitor" on any running session</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Quotas Card -->
      <div class="card">
        <div class="card-header">
          <h2>📊 Quotas</h2>
          <span class="health-status healthy" id="planBadge">Standard</span>
        </div>
        <div class="card-body">
          <div class="quotas-grid" id="quotasGrid">
            <div class="quota-item">
              <div class="quota-value" id="quotaSessions">-/-</div>
              <div class="quota-label">Sessions</div>
              <div class="progress-bar">
                <div class="progress-fill" id="quotaSessionsBar" style="width: 0%"></div>
              </div>
            </div>
            <div class="quota-item">
              <div class="quota-value" id="quotaDevices">-</div>
              <div class="quota-label">Max Devices</div>
            </div>
            <div class="quota-item">
              <div class="quota-value" id="quotaScans">-/hr</div>
              <div class="quota-label">Scans Limit</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Metrics Card -->
      <div class="card">
        <div class="card-header">
          <h2>📈 Metrics</h2>
          <span class="health-status" id="healthStatus">Loading...</span>
        </div>
        <div class="card-body">
          <div class="metrics-grid" id="metricsGrid">
            <div class="metric-card">
              <div class="metric-value" id="metricActive">0</div>
              <div class="metric-label">Active</div>
            </div>
            <div class="metric-card">
              <div class="metric-value" id="metricScans">0</div>
              <div class="metric-label">Scans</div>
            </div>
            <div class="metric-card">
              <div class="metric-value" id="metricAlarms">0</div>
              <div class="metric-label">Alarms</div>
            </div>
            <div class="metric-card">
              <div class="metric-value" id="metricClients">0</div>
              <div class="metric-label">Monitors</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Manual Modal -->
  <div class="modal-overlay" id="manualModal" onclick="closeManualOutside(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>📖 Simulator Manual</h2>
        <button class="modal-close" onclick="closeManual()">×</button>
      </div>
      <div class="modal-body">
        <div class="manual-section">
          <h3>🎯 Overview</h3>
          <p>
            The <strong>GCDR Simulator Cockpit</strong> is a premium tool for testing alarm rules
            without affecting production systems. It simulates IoT devices generating telemetry data,
            evaluates alarm rules, and routes triggered alarms to an <strong>isolated queue</strong>.
          </p>
          <div class="manual-tip">
            <strong>💡 Tip:</strong> All simulated alarms are tagged with <code>source.type: 'SIMULATOR'</code>
            and sent to a separate queue, ensuring complete isolation from production.
          </div>
        </div>

        <div class="manual-section">
          <h3>🚀 Quick Start with DEMO</h3>
          <p>Click the <strong>🚀 DEMO</strong> button in the header to:</p>
          <ul>
            <li>Automatically create a demo tenant, customer, and devices</li>
            <li>Set up sample alarm rules (temperature &gt; 28°C, humidity &gt; 70%)</li>
            <li>Start a simulation session immediately</li>
            <li>Begin monitoring in real-time</li>
          </ul>
          <div class="manual-warning">
            <strong>⚠️ Note:</strong> Demo mode uses pre-configured UUIDs. Re-clicking DEMO will reuse existing data.
          </div>
        </div>

        <div class="manual-section">
          <h3>📋 Manual Setup (Step by Step)</h3>
          <p>If you want to use your own data:</p>
          <ul>
            <li><span class="step-number">1</span> Enter your <strong>Tenant ID</strong> in the header and click <strong>Load</strong></li>
            <li><span class="step-number">2</span> In "New Session", enter a <strong>Session Name</strong> (e.g., "QA Test")</li>
            <li><span class="step-number">3</span> Select a <strong>Customer</strong> from the dropdown</li>
            <li><span class="step-number">4</span> Add one or more <strong>Devices</strong> to simulate</li>
            <li><span class="step-number">5</span> Adjust <strong>Scan Interval</strong> (how often devices are scanned)</li>
            <li><span class="step-number">6</span> Adjust <strong>Bundle Refresh</strong> (how often rules are fetched)</li>
            <li><span class="step-number">7</span> Click <strong>▶ Start Session</strong></li>
          </ul>
        </div>

        <div class="manual-section">
          <h3>📡 Live Monitor</h3>
          <p>The Live Monitor shows real-time events from your simulation:</p>
          <ul>
            <li><strong>📦 Bundle events</strong> - When alarm rules are fetched/updated</li>
            <li><strong>📡 Scan events</strong> - Device telemetry readings (temp, humidity, etc.)</li>
            <li><strong>🔔 Alarm events</strong> - When a rule threshold is exceeded</li>
            <li><strong>ℹ️ Info events</strong> - Session lifecycle (start, stop, expire)</li>
          </ul>
          <p>Click <strong>Monitor</strong> on any running session to connect.</p>
        </div>

        <div class="manual-section">
          <h3>📊 Understanding Quotas</h3>
          <p>The Quotas panel shows your limits:</p>
          <ul>
            <li><strong>Sessions</strong> - How many concurrent simulations you can run</li>
            <li><strong>Max Devices</strong> - Devices per session (50 standard, 200 premium)</li>
            <li><strong>Scans/hr</strong> - Maximum device scans per hour</li>
          </ul>
          <div class="manual-code">Standard: 3 sessions, 50 devices, 1000 scans/hr
Premium: 10 sessions, 200 devices, 10000 scans/hr</div>
        </div>

        <div class="manual-section">
          <h3>📈 Metrics Explained</h3>
          <ul>
            <li><strong>Active</strong> - Currently running sessions (across all tenants)</li>
            <li><strong>Scans</strong> - Total device scans performed</li>
            <li><strong>Alarms</strong> - Total alarm candidates raised</li>
            <li><strong>Monitors</strong> - Connected SSE monitor clients</li>
          </ul>
        </div>

        <div class="manual-section">
          <h3>🔧 Telemetry Profiles</h3>
          <p>Each device generates random values within configured ranges:</p>
          <div class="manual-code">Temperature: { min: 22, max: 32, unit: '°C' }
Humidity:    { min: 50, max: 80, unit: '%' }
Power:       { min: 100, max: 500, unit: 'W' }</div>
          <p>Rules are evaluated against these values. If a value exceeds the rule threshold, an alarm is raised.</p>
        </div>

        <div class="manual-section">
          <h3>🛡️ Isolation & Safety</h3>
          <p>The simulator is designed with safety in mind:</p>
          <ul>
            <li>All alarms go to <code>alarm-candidates:simulated</code> queue (not production)</li>
            <li>Events are tagged with <code>metadata.simulated: true</code></li>
            <li>Sessions auto-expire after 24 hours (72h for premium)</li>
            <li>Rate limiting prevents resource exhaustion</li>
          </ul>
        </div>

        <div class="manual-section">
          <h3>❓ Troubleshooting</h3>
          <ul>
            <li><strong>"No customers found"</strong> - Check if your Tenant ID is correct and has customers</li>
            <li><strong>"No devices"</strong> - The selected customer needs devices assigned to it</li>
            <li><strong>"Quota exceeded"</strong> - Stop existing sessions or wait for expiration</li>
            <li><strong>"Connection lost"</strong> - SSE reconnects automatically, or refresh the page</li>
            <li><strong>"No alarms triggering"</strong> - Check that rules exist for the customer and telemetry ranges can exceed thresholds</li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <script>
    // State
    let selectedDevices = [];
    let eventSource = null;
    let currentMonitorSession = null;
    let demoRunning = false;

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      // Try to get tenant ID from localStorage
      const savedTenantId = localStorage.getItem('simulatorTenantId');
      if (savedTenantId) {
        document.getElementById('tenantId').value = savedTenantId;
        loadData();
      }

      // Load metrics periodically
      loadMetrics();
      setInterval(loadMetrics, 10000);

      // Close modal on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeManual();
      });
    });

    // =========================================================================
    // DEMO Functions
    // =========================================================================

    async function runDemo() {
      if (demoRunning) return;
      demoRunning = true;

      const demoBtn = document.getElementById('demoBtn');
      demoBtn.disabled = true;
      demoBtn.innerHTML = '⏳ Setting up...';

      // Clear monitor log first
      document.getElementById('monitorLog').innerHTML = '';

      try {
        // Step 1: Setup demo environment
        addLogEntry('info', '🚀 Starting DEMO setup...');
        const setupRes = await fetch('/admin/simulator/api/demo/setup', { method: 'POST' });
        const setupData = await setupRes.json();

        if (!setupData.success) {
          throw new Error(setupData.error || 'Setup failed');
        }

        addLogEntry('info', '✅ Demo environment ready: ' + setupData.message);

        // Step 2: Set tenant ID and load data
        document.getElementById('tenantId').value = setupData.demo.tenantId;
        localStorage.setItem('simulatorTenantId', setupData.demo.tenantId);

        // Load data and wait a bit for DB to be ready
        await loadData();

        // Step 3: Auto-select the demo customer
        const customerSelect = document.getElementById('customerId');
        customerSelect.value = setupData.demo.customerId;

        // Verify customer was selected
        if (!customerSelect.value) {
          addLogEntry('info', '⚠️ Customer not found in dropdown, retrying...');
          await new Promise(r => setTimeout(r, 500));
          await loadCustomers();
          customerSelect.value = setupData.demo.customerId;
        }

        // Trigger device loading for demo customer
        if (customerSelect.value) {
          addLogEntry('info', '📦 Loading demo devices...');
          customerSelect.dispatchEvent(new Event('change'));
          await new Promise(r => setTimeout(r, 300)); // Wait for devices to load
        }

        demoBtn.innerHTML = '⏳ Starting session...';

        // Step 4: Start demo session
        const sessionRes = await fetch('/admin/simulator/api/demo/start-session', { method: 'POST' });
        const sessionData = await sessionRes.json();

        if (!sessionData.success) {
          throw new Error(sessionData.error || 'Failed to start session');
        }

        addLogEntry('info', '✅ Demo session started: ' + sessionData.session.name);

        // Step 5: Reload sessions and start monitoring
        await loadSessions();
        startMonitor(sessionData.session.id, sessionData.session.name);

        demoBtn.innerHTML = '✅ DEMO Running';
        setTimeout(() => {
          demoBtn.innerHTML = '🚀 DEMO';
          demoBtn.disabled = false;
          demoRunning = false;
        }, 3000);

      } catch (error) {
        console.error('Demo error:', error);
        addLogEntry('info', '❌ Demo failed: ' + error.message);
        alert('Demo setup failed: ' + error.message);
        demoBtn.innerHTML = '🚀 DEMO';
        demoBtn.disabled = false;
        demoRunning = false;
      }
    }

    // =========================================================================
    // Manual Modal Functions
    // =========================================================================

    function openManual() {
      document.getElementById('manualModal').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeManual() {
      document.getElementById('manualModal').classList.remove('active');
      document.body.style.overflow = '';
    }

    function closeManualOutside(event) {
      if (event.target === document.getElementById('manualModal')) {
        closeManual();
      }
    }

    // Load all data
    async function loadData() {
      const tenantId = document.getElementById('tenantId').value.trim();
      if (!tenantId) {
        alert('Please enter a Tenant ID');
        return;
      }

      localStorage.setItem('simulatorTenantId', tenantId);

      await Promise.all([
        loadSessions(),
        loadQuotas(),
        loadCustomers(),
      ]);
    }

    // Load sessions
    async function loadSessions() {
      const tenantId = document.getElementById('tenantId').value.trim();
      if (!tenantId) return;

      try {
        const res = await fetch(\`/admin/simulator/api/sessions?tenantId=\${tenantId}\`);
        const data = await res.json();

        const container = document.getElementById('sessionsList');
        if (!data.sessions || data.sessions.length === 0) {
          container.innerHTML = \`
            <div class="empty-state">
              <div class="icon">📭</div>
              <p>No sessions found</p>
              <small>Create a new session to get started</small>
            </div>
          \`;
          return;
        }

        container.innerHTML = data.sessions.map(s => \`
          <div class="session-item">
            <div class="session-info">
              <div class="session-status \${s.status.toLowerCase()}"></div>
              <div>
                <div class="session-name">\${s.name}</div>
                <div class="session-meta">\${s.status} • \${formatDuration(s.sessionExpiresIn)}</div>
              </div>
            </div>
            <div class="session-stats">
              <div class="stat">
                <div class="stat-value">\${s.scansCount}</div>
                <div class="stat-label">Scans</div>
              </div>
              <div class="stat">
                <div class="stat-value">\${s.alarmsTriggeredCount}</div>
                <div class="stat-label">Alarms</div>
              </div>
              \${s.status === 'RUNNING' ? \`
                <button class="btn btn-sm btn-primary" onclick="startMonitor('\${s.id}', '\${s.name}')">Monitor</button>
                <button class="btn btn-sm btn-danger" onclick="stopSession('\${s.id}')">Stop</button>
              \` : ''}
            </div>
          </div>
        \`).join('');
      } catch (error) {
        console.error('Failed to load sessions:', error);
      }
    }

    // Load quotas
    async function loadQuotas() {
      const tenantId = document.getElementById('tenantId').value.trim();
      if (!tenantId) return;

      try {
        const res = await fetch(\`/admin/simulator/api/quotas?tenantId=\${tenantId}\`);
        const data = await res.json();

        document.getElementById('quotaSessions').textContent =
          \`\${data.activeSessions}/\${data.quotas.maxConcurrentSessions}\`;
        document.getElementById('quotaDevices').textContent = data.quotas.maxDevicesPerSession;
        document.getElementById('quotaScans').textContent = \`\${data.quotas.maxScansPerHour}/hr\`;

        const sessionPct = (data.activeSessions / data.quotas.maxConcurrentSessions) * 100;
        const bar = document.getElementById('quotaSessionsBar');
        bar.style.width = sessionPct + '%';
        bar.className = 'progress-fill' + (sessionPct > 80 ? ' danger' : sessionPct > 50 ? ' warning' : '');

        document.getElementById('planBadge').textContent = data.isPremium ? 'Premium' : 'Standard';
        document.getElementById('planBadge').className = 'health-status ' + (data.isPremium ? 'healthy' : 'degraded');
      } catch (error) {
        console.error('Failed to load quotas:', error);
      }
    }

    // Load metrics
    async function loadMetrics() {
      try {
        const res = await fetch('/admin/simulator/api/metrics');
        const data = await res.json();

        document.getElementById('metricActive').textContent = data.sessions.active;
        document.getElementById('metricScans').textContent = data.processing.scansPerformed;
        document.getElementById('metricAlarms').textContent = data.processing.alarmsTriggered;
        document.getElementById('metricClients').textContent = data.monitor.connectedClients;

        const healthEl = document.getElementById('healthStatus');
        healthEl.textContent = data.health.status.charAt(0).toUpperCase() + data.health.status.slice(1);
        healthEl.className = 'health-status ' + data.health.status;
      } catch (error) {
        console.error('Failed to load metrics:', error);
      }
    }

    // Load customers
    async function loadCustomers() {
      const tenantId = document.getElementById('tenantId').value.trim();
      if (!tenantId) return;

      try {
        const res = await fetch(\`/admin/simulator/api/customers?tenantId=\${tenantId}\`);
        const data = await res.json();

        if (data.error) {
          console.error('API error loading customers:', data.error);
          return;
        }

        const select = document.getElementById('customerId');
        if (!data.customers || data.customers.length === 0) {
          select.innerHTML = '<option value="">No customers found</option>';
          console.warn('No customers found for tenant:', tenantId);
          return;
        }

        select.innerHTML = '<option value="">Select customer...</option>' +
          data.customers.map(c => \`<option value="\${c.id}">\${c.name}</option>\`).join('');

        console.log('Loaded', data.customers.length, 'customers');
      } catch (error) {
        console.error('Failed to load customers:', error);
      }
    }

    // Load devices for selected customer
    document.getElementById('customerId').addEventListener('change', async (e) => {
      const customerId = e.target.value;
      if (!customerId) return;

      try {
        const res = await fetch(\`/admin/simulator/api/devices?customerId=\${customerId}\`);
        const data = await res.json();

        const select = document.getElementById('deviceSelect');
        select.innerHTML = '<option value="">Add device...</option>' +
          data.devices.map(d => \`<option value="\${d.id}" data-name="\${d.name}" data-type="\${d.type}">\${d.name} (\${d.type})</option>\`).join('');
      } catch (error) {
        console.error('Failed to load devices:', error);
      }
    });

    // Add device to list
    function addDevice() {
      const select = document.getElementById('deviceSelect');
      const option = select.options[select.selectedIndex];
      if (!option.value) return;

      const deviceId = option.value;
      const deviceName = option.dataset.name;
      const deviceType = option.dataset.type;

      if (selectedDevices.find(d => d.deviceId === deviceId)) {
        select.value = '';
        return;
      }

      selectedDevices.push({
        deviceId,
        name: deviceName,
        type: deviceType,
        telemetryProfile: {
          temperature: { min: 20, max: 30, unit: '°C' },
          humidity: { min: 40, max: 70, unit: '%' },
        }
      });

      renderDevices();
      select.value = '';
    }

    // Remove device
    function removeDevice(deviceId) {
      selectedDevices = selectedDevices.filter(d => d.deviceId !== deviceId);
      renderDevices();
    }

    // Render device chips
    function renderDevices() {
      const container = document.getElementById('deviceList');
      if (selectedDevices.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 20px;"><small>No devices selected</small></div>';
        return;
      }

      container.innerHTML = selectedDevices.map(d => \`
        <span class="device-chip">
          📟 \${d.name}
          <span class="remove" onclick="removeDevice('\${d.deviceId}')">✕</span>
        </span>
      \`).join('');
    }

    // Start session
    async function startSession() {
      const tenantId = document.getElementById('tenantId').value.trim();
      const customerId = document.getElementById('customerId').value;
      const name = document.getElementById('sessionName').value.trim();
      const scanInterval = parseInt(document.getElementById('scanInterval').value) || 60;
      const bundleRefresh = parseInt(document.getElementById('bundleRefresh').value) || 300;

      if (!tenantId || !customerId || !name) {
        alert('Please fill in all required fields');
        return;
      }

      if (selectedDevices.length === 0) {
        alert('Please add at least one device');
        return;
      }

      try {
        const res = await fetch('/admin/simulator/api/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            customerId,
            name,
            config: {
              customerId,
              deviceScanIntervalMs: scanInterval * 1000,
              bundleRefreshIntervalMs: bundleRefresh * 1000,
              devices: selectedDevices,
            }
          })
        });

        const data = await res.json();
        if (data.success) {
          // Clear form
          document.getElementById('sessionName').value = '';
          selectedDevices = [];
          renderDevices();

          // Reload data
          await loadData();

          // Start monitoring
          startMonitor(data.session.id, data.session.name);
        } else {
          alert('Error: ' + data.error);
        }
      } catch (error) {
        alert('Failed to start session: ' + error.message);
      }
    }

    // Stop session
    async function stopSession(sessionId) {
      if (!confirm('Stop this simulation session?')) return;

      try {
        await fetch(\`/admin/simulator/api/sessions/\${sessionId}/stop\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'USER_REQUESTED' })
        });

        await loadData();

        if (currentMonitorSession === sessionId) {
          stopMonitor();
        }
      } catch (error) {
        alert('Failed to stop session: ' + error.message);
      }
    }

    // Start monitoring
    function startMonitor(sessionId, sessionName) {
      stopMonitor();

      currentMonitorSession = sessionId;
      document.getElementById('monitorSession').textContent = '- ' + sessionName;
      document.getElementById('monitorStatus').textContent = '🟢';
      document.getElementById('stopMonitorBtn').style.display = 'inline-block';

      const logContainer = document.getElementById('monitorLog');
      logContainer.innerHTML = '';
      addLogEntry('info', 'Connected to session monitor');

      eventSource = new EventSource(\`/admin/simulator/api/sessions/\${sessionId}/monitor\`);

      eventSource.addEventListener('connected', (e) => {
        addLogEntry('info', 'Monitor connected');
      });

      eventSource.addEventListener('bundle:fetched', (e) => {
        const data = JSON.parse(e.data);
        addLogEntry('bundle', \`Bundle \${data.data.isUpdated ? 'updated' : 'unchanged'} - v\${data.data.version}\`);
      });

      eventSource.addEventListener('device:scanned', (e) => {
        const data = JSON.parse(e.data);
        const telemetry = Object.entries(data.data.telemetry)
          .map(([k, v]) => \`\${k}=\${v}\`).join(', ');
        addLogEntry('scan', \`Device scan: \${data.data.deviceId.substring(0, 8)}... (\${telemetry})\`);
      });

      eventSource.addEventListener('alarm:candidate', (e) => {
        const data = JSON.parse(e.data);
        addLogEntry('alarm', \`🔔 ALARM: \${data.data.ruleName} - \${data.data.field}=\${data.data.value} (threshold: \${data.data.threshold})\`);
      });

      eventSource.addEventListener('session:stopped', (e) => {
        addLogEntry('info', 'Session stopped');
        stopMonitor();
      });

      eventSource.addEventListener('session:expired', (e) => {
        addLogEntry('info', 'Session expired');
        stopMonitor();
      });

      eventSource.addEventListener('heartbeat', (e) => {
        // Keep alive
      });

      eventSource.onerror = () => {
        addLogEntry('info', 'Connection lost, reconnecting...');
      };
    }

    // Stop monitoring
    function stopMonitor() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      currentMonitorSession = null;
      document.getElementById('monitorSession').textContent = '';
      document.getElementById('monitorStatus').textContent = '⚪';
      document.getElementById('stopMonitorBtn').style.display = 'none';
    }

    // Add log entry
    function addLogEntry(type, message) {
      const container = document.getElementById('monitorLog');
      const time = new Date().toLocaleTimeString();
      const icons = {
        info: 'ℹ️',
        bundle: '📦',
        scan: '📡',
        alarm: '🔔',
      };

      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.innerHTML = \`
        <span class="log-time">\${time}</span>
        <span class="log-icon">\${icons[type] || 'ℹ️'}</span>
        <span class="log-message">\${message}</span>
      \`;

      container.insertBefore(entry, container.firstChild);

      // Keep max 100 entries
      while (container.children.length > 100) {
        container.removeChild(container.lastChild);
      }
    }

    // Format duration
    function formatDuration(seconds) {
      if (seconds <= 0) return 'Expired';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (hours > 0) return \`\${hours}h \${minutes}m remaining\`;
      return \`\${minutes}m remaining\`;
    }
  </script>
</body>
</html>`;
}

export const simulatorAdminController = router;
