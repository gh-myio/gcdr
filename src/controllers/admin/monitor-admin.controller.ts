// =============================================================================
// GCDR API Monitor Controller
// =============================================================================
// Real-time API request monitoring with stats, filtering, and log entries
// Access: http://localhost:3015/admin/monitor
// =============================================================================

import { Router, Request, Response } from 'express';
import {
  getMonitorLogs,
  clearMonitorLogs,
  isMonitorEnabled,
  setMonitorEnabled,
  getPathFilters,
  setPathFilters,
  MonitorLogEntry,
} from '../../middleware/requestMonitor';

const router = Router();

// =============================================================================
// Configuration
// =============================================================================

const ADMIN_PASSWORD = process.env.DB_ADMIN_PASSWORD || 'myio2026';

// =============================================================================
// Middleware: Password Verification for API routes
// =============================================================================

function verifyPasswordMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers['x-admin-password'];
  if (authHeader !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized. Invalid admin password.' });
  }
  next();
}

router.use('/api', verifyPasswordMiddleware);

// =============================================================================
// API Routes
// =============================================================================

/**
 * GET /api/logs
 * Returns logs with computed stats
 */
router.get('/api/logs', (req: Request, res: Response) => {
  const logs = getMonitorLogs();

  // Client-side filter (query param)
  const filter = req.query.filter as string | undefined;
  const filteredLogs = filter
    ? logs.filter(l => l.path.includes(filter) || l.route.includes(filter))
    : logs;

  // Compute stats
  const total = filteredLogs.length;
  const success = filteredLogs.filter(l => l.statusCode >= 200 && l.statusCode < 300).length;
  const notModified = filteredLogs.filter(l => l.statusCode === 304).length;
  const clientErrors = filteredLogs.filter(l => l.statusCode >= 400 && l.statusCode < 500).length;
  const serverErrors = filteredLogs.filter(l => l.statusCode >= 500).length;
  const avgDuration = total > 0
    ? Math.round(filteredLogs.reduce((sum, l) => sum + l.duration, 0) / total)
    : 0;

  res.json({
    logs: filteredLogs,
    count: total,
    stats: {
      total,
      success,
      notModified,
      clientErrors,
      serverErrors,
      avgDuration,
    },
  });
});

/**
 * DELETE /api/logs
 * Clear all logs
 */
router.delete('/api/logs', (req: Request, res: Response) => {
  clearMonitorLogs();
  res.json({ message: 'Logs cleared' });
});

/**
 * GET /api/status
 * Get monitor status
 */
router.get('/api/status', (req: Request, res: Response) => {
  res.json({
    enabled: isMonitorEnabled(),
    filters: getPathFilters(),
  });
});

/**
 * POST /api/status
 * Update monitor status (enable/disable, set filters)
 */
router.post('/api/status', (req: Request, res: Response) => {
  const { enabled, filters } = req.body;

  if (typeof enabled === 'boolean') {
    setMonitorEnabled(enabled);
  }

  if (Array.isArray(filters)) {
    setPathFilters(filters);
  }

  res.json({
    enabled: isMonitorEnabled(),
    filters: getPathFilters(),
  });
});

// =============================================================================
// HTML UI
// =============================================================================

router.get('/', (req: Request, res: Response) => {
  res.send(getHtmlPage());
});

function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GCDR API Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root, [data-theme="dark"] {
      --bg: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-tertiary: #0f3460;
      --text: #eaeaea;
      --text-secondary: #a0a0a0;
      --primary: #e94560;
      --success: #00d26a;
      --warning: #ffc107;
      --error: #ff6b6b;
      --info: #4dabf7;
      --border: #2a2a4a;
      --badge-2xx: #00d26a;
      --badge-304: #4dabf7;
      --badge-4xx: #ffc107;
      --badge-5xx: #ff6b6b;
    }

    [data-theme="light"] {
      --bg: #f5f5f5;
      --bg-secondary: #ffffff;
      --bg-tertiary: #e8e8e8;
      --text: #1a1a2e;
      --text-secondary: #666666;
      --primary: #e94560;
      --success: #00a854;
      --warning: #faad14;
      --error: #f5222d;
      --info: #1890ff;
      --border: #d9d9d9;
      --badge-2xx: #00a854;
      --badge-304: #1890ff;
      --badge-4xx: #faad14;
      --badge-5xx: #f5222d;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      transition: background 0.3s, color 0.3s;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
    }

    .header-left { display: flex; align-items: center; gap: 15px; }
    .header-right { display: flex; align-items: center; gap: 15px; }

    header h1 { font-size: 1.5rem; color: var(--primary); }

    .nav-link {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 4px 10px;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); background: var(--bg-tertiary); }

    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
    }

    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    /* Stats Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }

    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      line-height: 1.2;
    }

    .stat-card .stat-label {
      font-size: 0.8rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-total .stat-value { color: var(--info); }
    .stat-success .stat-value { color: var(--success); }
    .stat-304 .stat-value { color: var(--info); }
    .stat-4xx .stat-value { color: var(--warning); }
    .stat-5xx .stat-value { color: var(--error); }
    .stat-duration .stat-value { color: var(--primary); }

    /* Controls Bar */
    .controls-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary { background: var(--bg-tertiary); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: var(--border); }
    .btn-danger { background: var(--error); color: #fff; }
    .btn-danger:hover { opacity: 0.9; }
    .btn-success { background: var(--success); color: #fff; }
    .btn-success:hover { opacity: 0.9; }

    .btn-toggle {
      position: relative;
      width: 48px;
      height: 26px;
      border-radius: 13px;
      border: none;
      cursor: pointer;
      background: var(--border);
      transition: background 0.3s;
    }
    .btn-toggle.active { background: var(--success); }
    .btn-toggle::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.3s;
    }
    .btn-toggle.active::after { transform: translateX(22px); }

    .filter-input {
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-secondary);
      color: var(--text);
      font-size: 0.85rem;
      min-width: 250px;
    }
    .filter-input:focus { outline: none; border-color: var(--primary); }

    .control-label {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .spacer { flex: 1; }

    /* Server Filter Chips */
    .filter-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .filter-chip {
      padding: 4px 12px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
      user-select: none;
    }
    .filter-chip.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .filter-chip:hover { border-color: var(--primary); }

    /* Log List */
    .log-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .log-entry {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: grid;
      grid-template-columns: 70px 60px 1fr 80px 170px 30px;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: background 0.15s;
      font-size: 0.85rem;
    }
    .log-entry:hover { background: var(--bg-tertiary); }

    .log-details {
      display: none;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      padding: 12px 16px;
      margin-top: -7px;
      font-size: 0.8rem;
      font-family: 'Consolas', 'Monaco', monospace;
    }
    .log-details.open { display: block; }

    .log-details .detail-row {
      display: flex;
      gap: 12px;
      padding: 3px 0;
    }
    .log-details .detail-label {
      color: var(--text-secondary);
      min-width: 100px;
    }

    .status-badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.8rem;
      text-align: center;
      min-width: 50px;
      display: inline-block;
    }
    .status-2xx { background: var(--badge-2xx); color: #fff; }
    .status-304 { background: var(--badge-304); color: #fff; }
    .status-4xx { background: var(--badge-4xx); color: #000; }
    .status-5xx { background: var(--badge-5xx); color: #fff; }

    .method-badge {
      font-weight: 700;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 4px;
      text-align: center;
    }
    .method-GET { color: var(--success); }
    .method-POST { color: var(--info); }
    .method-PUT { color: var(--warning); }
    .method-PATCH { color: var(--warning); }
    .method-DELETE { color: var(--error); }

    .log-path { font-family: 'Consolas', 'Monaco', monospace; font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-duration { color: var(--text-secondary); text-align: right; }
    .log-time { color: var(--text-secondary); font-size: 0.78rem; }
    .log-expand { color: var(--text-secondary); text-align: center; }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }
    .empty-state h3 { font-size: 1.2rem; margin-bottom: 8px; }

    /* Password Modal */
    .password-modal {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    }
    .password-modal.hidden { display: none; }

    .password-box {
      background: var(--bg-secondary);
      padding: 40px;
      border-radius: 12px;
      text-align: center;
      max-width: 400px;
      width: 90%;
    }
    .password-box h2 { margin-bottom: 10px; color: var(--primary); }
    .password-box p { color: var(--text-secondary); margin-bottom: 20px; font-size: 0.9rem; }
    .password-box input {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
      font-size: 1rem;
      margin-bottom: 15px;
    }
    .password-box input:focus { outline: none; border-color: var(--primary); }
    .password-error { color: var(--error); font-size: 0.85rem; display: none; }
    .password-error.show { display: block; }

    .locked { filter: blur(5px); pointer-events: none; }

    /* Live indicator */
    .live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-secondary);
    }
    .live-dot.active {
      background: var(--success);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Monitor toggle */
    .monitor-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
  </style>
</head>
<body>
  <!-- Password Modal -->
  <div id="password-modal" class="password-modal">
    <div class="password-box">
      <h2>API Monitor</h2>
      <p>Enter the admin password to access the API Monitor.</p>
      <input type="password" id="admin-password" placeholder="Password" onkeypress="if(event.key==='Enter')checkPassword()">
      <div id="password-error" class="password-error">Invalid password. Try again.</div>
      <button class="btn btn-primary" onclick="checkPassword()" style="width:100%;margin-top:5px">Unlock</button>
    </div>
  </div>

  <!-- Main Content -->
  <div id="main-content" class="locked">
    <header>
      <div class="header-left">
        <h1>GCDR API Monitor</h1>
        <div class="monitor-status">
          <span>Capture:</span>
          <button id="monitor-toggle" class="btn-toggle active" onclick="toggleMonitor()"></button>
        </div>
        <div class="live-indicator">
          <span class="live-dot" id="live-dot"></span>
          <span id="live-label">Auto-refresh OFF</span>
        </div>
      </div>
      <div class="header-right">
        <a href="/admin/db" class="nav-link">DB Admin</a>
        <a href="/admin/simulator" class="nav-link">Simulator</a>
        <button class="theme-toggle" onclick="toggleTheme()">Toggle Theme</button>
      </div>
    </header>

    <div class="container">
      <!-- Stats -->
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card stat-total"><div class="stat-value" id="stat-total">0</div><div class="stat-label">Total</div></div>
        <div class="stat-card stat-success"><div class="stat-value" id="stat-success">0</div><div class="stat-label">Success (2xx)</div></div>
        <div class="stat-card stat-304"><div class="stat-value" id="stat-304">0</div><div class="stat-label">Not Modified</div></div>
        <div class="stat-card stat-4xx"><div class="stat-value" id="stat-4xx">0</div><div class="stat-label">Client Errors</div></div>
        <div class="stat-card stat-5xx"><div class="stat-value" id="stat-5xx">0</div><div class="stat-label">Server Errors</div></div>
        <div class="stat-card stat-duration"><div class="stat-value" id="stat-duration">0ms</div><div class="stat-label">Avg Duration</div></div>
      </div>

      <!-- Controls -->
      <div class="controls-bar">
        <button class="btn btn-secondary" onclick="refreshLogs()">Refresh</button>
        <button id="auto-refresh-btn" class="btn btn-secondary" onclick="toggleAutoRefresh()">Auto-refresh: OFF</button>
        <button class="btn btn-danger" onclick="clearLogs()">Clear Logs</button>
        <div class="spacer"></div>
        <input type="text" id="filter-input" class="filter-input" placeholder="Filter by path (e.g. /bundle, /rules)" oninput="onFilterChange()">
      </div>

      <!-- Server-side Filter Chips -->
      <div id="filter-chips" class="filter-chips">
        <span class="control-label" style="align-self:center;margin-right:4px">Server filters:</span>
      </div>

      <!-- Log List -->
      <div id="log-list" class="log-list">
        <div class="empty-state">
          <h3>No requests captured yet</h3>
          <p>Make some API calls and they will appear here.</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    let adminPassword = '';
    let autoRefreshInterval = null;
    let clientFilter = '';
    const PREDEFINED_FILTERS = [
      '/bundle/simple', '/bundle/versions', '/bundle',
      '/rules', '/devices', '/customers', '/centrals',
      '/auth', '/health', '/users', '/audit-logs'
    ];
    let activeServerFilters = [];

    // =========================================================================
    // Auth
    // =========================================================================

    function checkPassword() {
      const input = document.getElementById('admin-password');
      const errorEl = document.getElementById('password-error');
      const password = input.value;

      fetch('/admin/monitor/api/status', {
        headers: { 'X-Admin-Password': password }
      })
      .then(res => {
        if (res.ok) {
          adminPassword = password;
          sessionStorage.setItem('monitorAdminAuth', password);
          document.getElementById('password-modal').classList.add('hidden');
          document.getElementById('main-content').classList.remove('locked');
          initializeApp();
        } else {
          errorEl.classList.add('show');
          input.value = '';
          input.focus();
        }
      })
      .catch(() => {
        errorEl.classList.add('show');
        input.value = '';
        input.focus();
      });
    }

    function apiHeaders() {
      return { 'X-Admin-Password': adminPassword, 'Content-Type': 'application/json' };
    }

    // =========================================================================
    // Init
    // =========================================================================

    function initializeApp() {
      renderFilterChips();
      loadStatus();
      refreshLogs();
    }

    // Try stored password
    (function() {
      const stored = sessionStorage.getItem('monitorAdminAuth');
      if (stored) {
        fetch('/admin/monitor/api/status', {
          headers: { 'X-Admin-Password': stored }
        })
        .then(res => {
          if (res.ok) {
            adminPassword = stored;
            document.getElementById('password-modal').classList.add('hidden');
            document.getElementById('main-content').classList.remove('locked');
            initializeApp();
          } else {
            sessionStorage.removeItem('monitorAdminAuth');
            document.getElementById('admin-password').focus();
          }
        })
        .catch(() => {
          document.getElementById('admin-password').focus();
        });
      } else {
        document.getElementById('admin-password').focus();
      }
    })();

    // =========================================================================
    // Status
    // =========================================================================

    function loadStatus() {
      fetch('/admin/monitor/api/status', { headers: apiHeaders() })
        .then(r => r.json())
        .then(data => {
          const toggle = document.getElementById('monitor-toggle');
          if (data.enabled) {
            toggle.classList.add('active');
          } else {
            toggle.classList.remove('active');
          }
          activeServerFilters = data.filters || [];
          updateChipStates();
        });
    }

    function toggleMonitor() {
      const toggle = document.getElementById('monitor-toggle');
      const nowEnabled = !toggle.classList.contains('active');

      fetch('/admin/monitor/api/status', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ enabled: nowEnabled })
      })
      .then(r => r.json())
      .then(data => {
        if (data.enabled) {
          toggle.classList.add('active');
        } else {
          toggle.classList.remove('active');
        }
      });
    }

    // =========================================================================
    // Filter Chips
    // =========================================================================

    function renderFilterChips() {
      const container = document.getElementById('filter-chips');
      let html = '<span class="control-label" style="align-self:center;margin-right:4px">Server filters:</span>';
      PREDEFINED_FILTERS.forEach(f => {
        html += '<span class="filter-chip" data-filter="' + f + '" onclick="toggleServerFilter(this)">' + f + '</span>';
      });
      container.innerHTML = html;
    }

    function updateChipStates() {
      document.querySelectorAll('.filter-chip').forEach(chip => {
        const f = chip.getAttribute('data-filter');
        if (activeServerFilters.includes(f)) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }

    function toggleServerFilter(chip) {
      const f = chip.getAttribute('data-filter');
      const idx = activeServerFilters.indexOf(f);
      if (idx >= 0) {
        activeServerFilters.splice(idx, 1);
      } else {
        activeServerFilters.push(f);
      }
      chip.classList.toggle('active');

      fetch('/admin/monitor/api/status', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ filters: activeServerFilters })
      });
    }

    // =========================================================================
    // Logs
    // =========================================================================

    function refreshLogs() {
      const filterParam = clientFilter ? '?filter=' + encodeURIComponent(clientFilter) : '';
      fetch('/admin/monitor/api/logs' + filterParam, { headers: apiHeaders() })
        .then(r => r.json())
        .then(data => {
          updateStats(data.stats);
          renderLogs(data.logs);
        })
        .catch(err => console.error('Failed to fetch logs:', err));
    }

    function clearLogs() {
      fetch('/admin/monitor/api/logs', { method: 'DELETE', headers: apiHeaders() })
        .then(() => refreshLogs());
    }

    function updateStats(stats) {
      document.getElementById('stat-total').textContent = stats.total;
      document.getElementById('stat-success').textContent = stats.success;
      document.getElementById('stat-304').textContent = stats.notModified;
      document.getElementById('stat-4xx').textContent = stats.clientErrors;
      document.getElementById('stat-5xx').textContent = stats.serverErrors;
      document.getElementById('stat-duration').textContent = stats.avgDuration + 'ms';
    }

    function renderLogs(logs) {
      const container = document.getElementById('log-list');

      if (!logs.length) {
        container.innerHTML = '<div class="empty-state"><h3>No requests captured yet</h3><p>Make some API calls and they will appear here.</p></div>';
        return;
      }

      let html = '';
      logs.forEach(log => {
        const statusClass = getStatusClass(log.statusCode);
        const time = new Date(log.timestamp).toLocaleTimeString();
        const duration = log.duration < 1000 ? log.duration + 'ms' : (log.duration / 1000).toFixed(1) + 's';

        html += '<div class="log-entry" onclick="toggleDetails(this)">'
          + '<span class="status-badge ' + statusClass + '">' + log.statusCode + '</span>'
          + '<span class="method-badge method-' + log.method + '">' + log.method + '</span>'
          + '<span class="log-path" title="' + escapeHtml(log.path) + '">' + escapeHtml(log.path) + '</span>'
          + '<span class="log-duration">' + duration + '</span>'
          + '<span class="log-time">' + time + '</span>'
          + '<span class="log-expand">&#9660;</span>'
          + '</div>';

        html += '<div class="log-details">'
          + '<div class="detail-row"><span class="detail-label">Route:</span><span>' + escapeHtml(log.route) + '</span></div>'
          + '<div class="detail-row"><span class="detail-label">Full Path:</span><span>' + escapeHtml(log.path) + '</span></div>'
          + '<div class="detail-row"><span class="detail-label">Status:</span><span>' + log.statusCode + '</span></div>'
          + '<div class="detail-row"><span class="detail-label">Duration:</span><span>' + log.duration + 'ms</span></div>'
          + '<div class="detail-row"><span class="detail-label">Request Size:</span><span>' + formatBytes(log.requestSize) + '</span></div>'
          + '<div class="detail-row"><span class="detail-label">Response Size:</span><span>' + formatBytes(log.responseSize) + '</span></div>'
          + (log.tenantId ? '<div class="detail-row"><span class="detail-label">Tenant:</span><span>' + escapeHtml(log.tenantId) + '</span></div>' : '')
          + (log.userId ? '<div class="detail-row"><span class="detail-label">User:</span><span>' + escapeHtml(log.userId) + '</span></div>' : '')
          + (log.ip ? '<div class="detail-row"><span class="detail-label">IP:</span><span>' + escapeHtml(log.ip) + '</span></div>' : '')
          + (log.userAgent ? '<div class="detail-row"><span class="detail-label">User-Agent:</span><span>' + escapeHtml(log.userAgent) + '</span></div>' : '')
          + (log.error ? '<div class="detail-row"><span class="detail-label">Error:</span><span style="color:var(--error)">' + escapeHtml(log.error) + '</span></div>' : '')
          + '<div class="detail-row"><span class="detail-label">Timestamp:</span><span>' + log.timestamp + '</span></div>'
          + '</div>';
      });

      container.innerHTML = html;
    }

    function toggleDetails(entry) {
      const details = entry.nextElementSibling;
      if (details) details.classList.toggle('open');
    }

    function getStatusClass(code) {
      if (code === 304) return 'status-304';
      if (code >= 200 && code < 300) return 'status-2xx';
      if (code >= 400 && code < 500) return 'status-4xx';
      if (code >= 500) return 'status-5xx';
      return '';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // =========================================================================
    // Auto-refresh
    // =========================================================================

    function toggleAutoRefresh() {
      const btn = document.getElementById('auto-refresh-btn');
      const dot = document.getElementById('live-dot');
      const label = document.getElementById('live-label');

      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        btn.textContent = 'Auto-refresh: OFF';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-secondary');
        dot.classList.remove('active');
        label.textContent = 'Auto-refresh OFF';
      } else {
        autoRefreshInterval = setInterval(refreshLogs, 5000);
        btn.textContent = 'Auto-refresh: ON (5s)';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-success');
        dot.classList.add('active');
        label.textContent = 'Live';
      }
    }

    // =========================================================================
    // Client-side filter
    // =========================================================================

    let filterTimeout;
    function onFilterChange() {
      clearTimeout(filterTimeout);
      filterTimeout = setTimeout(() => {
        clientFilter = document.getElementById('filter-input').value.trim();
        refreshLogs();
      }, 300);
    }

    // =========================================================================
    // Theme
    // =========================================================================

    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('monitor-theme', next);
    }

    (function() {
      const saved = localStorage.getItem('monitor-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    })();
  </script>
</body>
</html>`;
}

export { router as monitorAdminController };
