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

    const session = await simulatorEngine.startSession(
      tenantId,
      customerId,
      userId || 'admin-cockpit',
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
    const { eq } = await import('drizzle-orm');

    const result = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.tenantId, tenantId))
      .limit(100);

    res.json({ customers: result });
  } catch (error: any) {
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
      <div class="tenant-selector">
        <label>Tenant ID:</label>
        <input type="text" id="tenantId" placeholder="Enter tenant UUID..." />
        <button class="btn btn-primary" onclick="loadData()">Load</button>
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

  <script>
    // State
    let selectedDevices = [];
    let eventSource = null;
    let currentMonitorSession = null;

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
    });

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

        const select = document.getElementById('customerId');
        select.innerHTML = '<option value="">Select customer...</option>' +
          data.customers.map(c => \`<option value="\${c.id}">\${c.name}</option>\`).join('');
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
