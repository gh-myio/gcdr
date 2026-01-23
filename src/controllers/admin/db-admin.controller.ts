// =============================================================================
// GCDR Database Admin Controller
// =============================================================================
// Development-only UI for managing database seeds and running queries
// Access: http://localhost:3015/admin/db
// =============================================================================

import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../infrastructure/database/drizzle/db';
import { sql } from 'drizzle-orm';

const router = Router();

// =============================================================================
// Configuration
// =============================================================================

const SEEDS_DIR = path.join(process.cwd(), 'scripts', 'db', 'seeds');
const DB_USER = process.env.DB_USER || 'postgres';
const DB_NAME = process.env.DB_NAME || 'db_gcdr';

// In-memory log storage
const executionLogs: Array<{
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}> = [];

const MAX_LOGS = 500;

function addLog(type: 'info' | 'success' | 'error' | 'warning', message: string, details?: string) {
  executionLogs.unshift({
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  });
  if (executionLogs.length > MAX_LOGS) {
    executionLogs.pop();
  }
}

// =============================================================================
// Middleware: Development Only
// =============================================================================

function devOnlyMiddleware(req: Request, res: Response, next: Function) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  next();
}

router.use(devOnlyMiddleware);

// =============================================================================
// API Routes
// =============================================================================

// List available scripts
router.get('/api/scripts', (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(SEEDS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(file => {
        const filepath = path.join(SEEDS_DIR, file);
        const stats = fs.statSync(filepath);
        return {
          name: file,
          size: stats.size,
          sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
          isSetup: file.startsWith('00-'),
          isVerify: file.startsWith('99-'),
        };
      });
    res.json({ scripts: files });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Run a specific script
router.post('/api/scripts/:name/run', async (req: Request, res: Response) => {
  const { name } = req.params;
  const filepath = path.join(SEEDS_DIR, name);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: `Script not found: ${name}` });
  }

  addLog('info', `Running script: ${name}`);
  const startTime = Date.now();

  try {
    const sqlContent = fs.readFileSync(filepath, 'utf-8');
    const command = `docker exec -i gcdr-postgres psql -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=1`;

    const output = execSync(command, {
      input: sqlContent,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    addLog('success', `${name} - Done (${duration}ms)`, output);

    res.json({
      success: true,
      script: name,
      duration,
      output,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    addLog('error', `${name} - Failed (${duration}ms)`, error.stderr || error.message);

    res.status(500).json({
      success: false,
      script: name,
      duration,
      error: error.stderr || error.message,
    });
  }
});

// Run all seed scripts
router.post('/api/seed-all', async (req: Request, res: Response) => {
  addLog('info', 'Starting full seed...');
  const startTime = Date.now();

  try {
    const files = fs.readdirSync(SEEDS_DIR)
      .filter(f => f.endsWith('.sql') && !f.startsWith('00-') && !f.startsWith('99-'))
      .sort();

    const results: Array<{ script: string; success: boolean; duration: number; error?: string }> = [];

    for (const file of files) {
      const filepath = path.join(SEEDS_DIR, file);
      const scriptStart = Date.now();

      try {
        const sqlContent = fs.readFileSync(filepath, 'utf-8');
        const command = `docker exec -i gcdr-postgres psql -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=1`;

        execSync(command, {
          input: sqlContent,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });

        const duration = Date.now() - scriptStart;
        addLog('success', `${file} - Done (${duration}ms)`);
        results.push({ script: file, success: true, duration });
      } catch (error: any) {
        const duration = Date.now() - scriptStart;
        addLog('error', `${file} - Failed (${duration}ms)`, error.stderr || error.message);
        results.push({ script: file, success: false, duration, error: error.stderr || error.message });
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    addLog('info', `Seed complete: ${successCount} success, ${failCount} failed (${totalDuration}ms)`);

    res.json({
      success: failCount === 0,
      totalDuration,
      successCount,
      failCount,
      results,
    });
  } catch (error: any) {
    addLog('error', 'Seed failed', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Clear all data
router.post('/api/clear', async (req: Request, res: Response) => {
  addLog('warning', 'Clearing all data...');
  const startTime = Date.now();

  try {
    const filepath = path.join(SEEDS_DIR, '00-clear-all.sql');
    const sqlContent = fs.readFileSync(filepath, 'utf-8');
    const command = `docker exec -i gcdr-postgres psql -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=1`;

    const output = execSync(command, {
      input: sqlContent,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    addLog('success', `Data cleared (${duration}ms)`);

    res.json({ success: true, duration, output });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    addLog('error', `Clear failed (${duration}ms)`, error.stderr || error.message);
    res.status(500).json({ success: false, error: error.stderr || error.message });
  }
});

// Verify data
router.post('/api/verify', async (req: Request, res: Response) => {
  addLog('info', 'Running verification...');
  const startTime = Date.now();

  try {
    const filepath = path.join(SEEDS_DIR, '99-verify-all.sql');
    const sqlContent = fs.readFileSync(filepath, 'utf-8');
    const command = `docker exec -i gcdr-postgres psql -U ${DB_USER} -d ${DB_NAME}`;

    const output = execSync(command, {
      input: sqlContent,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    addLog('success', `Verification complete (${duration}ms)`);

    res.json({ success: true, duration, output });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    addLog('error', `Verification failed (${duration}ms)`, error.stderr || error.message);
    res.status(500).json({ success: false, error: error.stderr || error.message });
  }
});

// Get logs
router.get('/api/logs', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, MAX_LOGS);
  res.json({ logs: executionLogs.slice(0, limit) });
});

// Clear logs
router.delete('/api/logs', (req: Request, res: Response) => {
  executionLogs.length = 0;
  res.json({ success: true });
});

// Execute SQL query (read-only by default)
router.post('/api/query', async (req: Request, res: Response) => {
  const { query, allowWrite } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Security: block write operations unless explicitly allowed
  const upperQuery = query.toUpperCase().trim();
  const isWriteOperation = /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/.test(upperQuery);

  if (isWriteOperation && !allowWrite) {
    return res.status(403).json({
      error: 'Write operations are disabled. Use allowWrite: true to enable.',
      hint: 'For safety, only SELECT queries are allowed by default.',
    });
  }

  addLog('info', `Executing query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`);
  const startTime = Date.now();

  try {
    const result = await db.execute(sql.raw(query));
    const duration = Date.now() - startTime;

    addLog('success', `Query executed (${duration}ms, ${Array.isArray(result) ? result.length : 0} rows)`);

    res.json({
      success: true,
      duration,
      rowCount: Array.isArray(result) ? result.length : 0,
      rows: result,
      columns: Array.isArray(result) && result.length > 0 ? Object.keys(result[0]) : [],
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    addLog('error', `Query failed (${duration}ms)`, error.message);
    res.status(500).json({
      success: false,
      duration,
      error: error.message,
    });
  }
});

// Get example queries
router.get('/api/query/examples', (req: Request, res: Response) => {
  const examples = [
    {
      name: 'Customer Hierarchy',
      description: 'List customers with hierarchy visualization',
      query: `SELECT
    REPEAT('  ', depth) || name as hierarchy,
    code, type, status
FROM customers
ORDER BY path;`,
    },
    {
      name: 'Devices by Asset',
      description: 'List devices grouped by asset with status',
      query: `SELECT
    a.name as asset,
    d.name as device,
    d.type,
    d.status,
    d.connectivity_status
FROM devices d
JOIN assets a ON d.asset_id = a.id
ORDER BY a.name, d.name;`,
    },
    {
      name: 'Rules by Type',
      description: 'Count rules by type with enabled status',
      query: `SELECT
    type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE enabled = true) as enabled
FROM rules
GROUP BY type
ORDER BY type;`,
    },
    {
      name: 'Users and Roles',
      description: 'List users with their role assignments',
      query: `SELECT
    u.email,
    u.status as user_status,
    ra.role_key,
    ra.status as assignment_status
FROM users u
LEFT JOIN role_assignments ra ON u.id = ra.user_id
ORDER BY u.email;`,
    },
    {
      name: 'Data Summary',
      description: 'Count records in all main tables',
      query: `SELECT 'customers' as table_name, COUNT(*) as count FROM customers
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'rules', COUNT(*) FROM rules
UNION ALL SELECT 'centrals', COUNT(*) FROM centrals
UNION ALL SELECT 'groups', COUNT(*) FROM groups
ORDER BY table_name;`,
    },
  ];

  res.json({ examples });
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
  <title>GCDR Database Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
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
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
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
      padding: 15px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
    }

    header h1 {
      font-size: 1.5rem;
      color: var(--primary);
    }

    .dev-badge {
      background: var(--warning);
      color: #000;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: bold;
    }

    .tabs {
      display: flex;
      gap: 2px;
      background: var(--bg-secondary);
      padding: 10px 20px 0;
    }

    .tab {
      padding: 10px 20px;
      background: var(--bg-tertiary);
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: 8px 8px 0 0;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .tab:hover { color: var(--text); }
    .tab.active { background: var(--bg); color: var(--primary); }

    .panel { display: none; padding: 20px; }
    .panel.active { display: block; }

    .card {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid var(--border);
    }

    .card-title {
      font-size: 1rem;
      margin-bottom: 15px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
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

    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-success { background: var(--success); color: white; }
    .btn-warning { background: var(--warning); color: black; }
    .btn-danger { background: var(--error); color: white; }
    .btn-secondary { background: var(--bg-tertiary); color: var(--text); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .script-list {
      display: grid;
      gap: 8px;
    }

    .script-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      background: var(--bg);
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    .script-item.setup { border-left: 3px solid var(--error); }
    .script-item.verify { border-left: 3px solid var(--info); }

    .script-name { font-family: monospace; font-size: 0.9rem; }
    .script-size { color: var(--text-secondary); font-size: 0.8rem; }

    .log-container {
      background: var(--bg);
      border-radius: 6px;
      padding: 15px;
      max-height: 400px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.85rem;
      border: 1px solid var(--border);
    }

    .log-entry {
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 10px;
    }

    .log-entry:last-child { border-bottom: none; }
    .log-time { color: var(--text-secondary); white-space: nowrap; }
    .log-success { color: var(--success); }
    .log-error { color: var(--error); }
    .log-warning { color: var(--warning); }
    .log-info { color: var(--info); }

    .query-editor {
      width: 100%;
      min-height: 150px;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 15px;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.9rem;
      resize: vertical;
    }

    .query-editor:focus {
      outline: none;
      border-color: var(--primary);
    }

    .results-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-top: 15px;
    }

    .results-table th,
    .results-table td {
      padding: 8px 12px;
      text-align: left;
      border: 1px solid var(--border);
    }

    .results-table th {
      background: var(--bg-tertiary);
      font-weight: 600;
      white-space: nowrap;
    }

    .results-table tr:nth-child(even) {
      background: var(--bg);
    }

    .results-info {
      margin-top: 10px;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .examples-list {
      display: grid;
      gap: 10px;
    }

    .example-item {
      padding: 12px;
      background: var(--bg);
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid var(--border);
      transition: all 0.2s;
    }

    .example-item:hover {
      border-color: var(--primary);
    }

    .example-name { font-weight: 600; margin-bottom: 4px; }
    .example-desc { font-size: 0.85rem; color: var(--text-secondary); }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .status-running { background: var(--warning); color: black; }
    .status-success { background: var(--success); color: white; }
    .status-error { background: var(--error); color: white; }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .flex { display: flex; }
    .gap-10 { gap: 10px; }
    .gap-20 { gap: 20px; }
    .flex-1 { flex: 1; }
    .mt-10 { margin-top: 10px; }
    .mt-20 { margin-top: 20px; }

    pre {
      background: var(--bg);
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      font-size: 0.85rem;
      max-height: 300px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <header>
    <h1>GCDR Database Admin</h1>
    <span class="dev-badge">DEV ONLY</span>
  </header>

  <div class="tabs">
    <button class="tab active" onclick="showTab('scripts')">Scripts</button>
    <button class="tab" onclick="showTab('logs')">Logs</button>
    <button class="tab" onclick="showTab('query')">Query Console</button>
  </div>

  <div class="container">
    <!-- Scripts Panel -->
    <div id="scripts-panel" class="panel active">
      <div class="card">
        <div class="card-title">Quick Actions</div>
        <div class="btn-group">
          <button class="btn btn-success" onclick="runAllSeeds()" id="btn-seed-all">
            <span>&#9654;</span> Run All Seeds
          </button>
          <button class="btn btn-danger" onclick="clearAll()" id="btn-clear">
            <span>&#128465;</span> Clear All
          </button>
          <button class="btn btn-warning" onclick="quickReset()" id="btn-reset">
            <span>&#8635;</span> Quick Reset
          </button>
          <button class="btn btn-primary" onclick="verify()" id="btn-verify">
            <span>&#10003;</span> Verify
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Available Scripts</div>
        <div id="scripts-list" class="script-list">
          Loading...
        </div>
      </div>

      <div class="card">
        <div class="card-title">Execution Log</div>
        <div id="execution-log" class="log-container">
          <div class="log-entry log-info">Waiting for actions...</div>
        </div>
      </div>
    </div>

    <!-- Logs Panel -->
    <div id="logs-panel" class="panel">
      <div class="card">
        <div class="flex gap-10" style="justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <div class="card-title" style="margin: 0;">Execution History</div>
          <div>
            <button class="btn btn-secondary" onclick="refreshLogs()">Refresh</button>
            <button class="btn btn-danger" onclick="clearLogs()">Clear Logs</button>
          </div>
        </div>
        <div id="logs-history" class="log-container" style="max-height: 600px;">
          Loading...
        </div>
      </div>
    </div>

    <!-- Query Panel -->
    <div id="query-panel" class="panel">
      <div class="flex gap-20">
        <div class="flex-1">
          <div class="card">
            <div class="card-title">SQL Query</div>
            <textarea id="query-input" class="query-editor" placeholder="SELECT * FROM customers LIMIT 10;"></textarea>
            <div class="mt-10 flex gap-10">
              <button class="btn btn-success" onclick="executeQuery()" id="btn-execute">
                <span>&#9654;</span> Execute
              </button>
              <button class="btn btn-secondary" onclick="clearQuery()">Clear</button>
              <label style="display: flex; align-items: center; gap: 5px; font-size: 0.85rem; color: var(--text-secondary);">
                <input type="checkbox" id="allow-write"> Allow write operations
              </label>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Results</div>
            <div id="query-results">
              <p style="color: var(--text-secondary);">Execute a query to see results</p>
            </div>
          </div>
        </div>

        <div style="width: 350px;">
          <div class="card">
            <div class="card-title">Example Queries</div>
            <div id="examples-list" class="examples-list">
              Loading...
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '/admin/db/api';

    // Tab navigation
    function showTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelector(\`.tab[onclick*="\${tabId}"]\`).classList.add('active');
      document.getElementById(\`\${tabId}-panel\`).classList.add('active');

      if (tabId === 'logs') refreshLogs();
      if (tabId === 'query') loadExamples();
    }

    // Load scripts list
    async function loadScripts() {
      try {
        const res = await fetch(\`\${API_BASE}/scripts\`);
        const data = await res.json();

        const container = document.getElementById('scripts-list');
        container.innerHTML = data.scripts.map(s => \`
          <div class="script-item \${s.isSetup ? 'setup' : ''} \${s.isVerify ? 'verify' : ''}">
            <div>
              <span class="script-name">\${s.name}</span>
              <span class="script-size">(\${s.sizeFormatted})</span>
            </div>
            <button class="btn btn-secondary" onclick="runScript('\${s.name}')"
                    id="btn-\${s.name}" \${s.isSetup || s.isVerify ? 'disabled' : ''}>
              Run
            </button>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Failed to load scripts:', err);
      }
    }

    // Run single script
    async function runScript(name) {
      const btn = document.getElementById(\`btn-\${name}\`);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running...';
      addLogEntry('info', \`Running \${name}...\`);

      try {
        const res = await fetch(\`\${API_BASE}/scripts/\${name}/run\`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          addLogEntry('success', \`\${name} - Done (\${data.duration}ms)\`);
        } else {
          addLogEntry('error', \`\${name} - Failed: \${data.error}\`);
        }
      } catch (err) {
        addLogEntry('error', \`\${name} - Error: \${err.message}\`);
      }

      btn.disabled = false;
      btn.innerHTML = 'Run';
    }

    // Run all seeds
    async function runAllSeeds() {
      const btn = document.getElementById('btn-seed-all');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running...';
      addLogEntry('info', 'Starting full seed...');

      try {
        const res = await fetch(\`\${API_BASE}/seed-all\`, { method: 'POST' });
        const data = await res.json();

        data.results.forEach(r => {
          if (r.success) {
            addLogEntry('success', \`\${r.script} - Done (\${r.duration}ms)\`);
          } else {
            addLogEntry('error', \`\${r.script} - Failed\`);
          }
        });

        addLogEntry('info', \`Complete: \${data.successCount} success, \${data.failCount} failed (\${data.totalDuration}ms)\`);
      } catch (err) {
        addLogEntry('error', \`Seed failed: \${err.message}\`);
      }

      btn.disabled = false;
      btn.innerHTML = '<span>&#9654;</span> Run All Seeds';
    }

    // Clear all data
    async function clearAll() {
      if (!confirm('This will DELETE ALL DATA. Are you sure?')) return;

      const btn = document.getElementById('btn-clear');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Clearing...';
      addLogEntry('warning', 'Clearing all data...');

      try {
        const res = await fetch(\`\${API_BASE}/clear\`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          addLogEntry('success', \`Data cleared (\${data.duration}ms)\`);
        } else {
          addLogEntry('error', \`Clear failed: \${data.error}\`);
        }
      } catch (err) {
        addLogEntry('error', \`Clear error: \${err.message}\`);
      }

      btn.disabled = false;
      btn.innerHTML = '<span>&#128465;</span> Clear All';
    }

    // Quick reset
    async function quickReset() {
      if (!confirm('This will CLEAR and RESEED all data. Continue?')) return;

      const btn = document.getElementById('btn-reset');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Resetting...';

      await fetch(\`\${API_BASE}/clear\`, { method: 'POST' });
      addLogEntry('success', 'Data cleared');

      await runAllSeeds();

      btn.disabled = false;
      btn.innerHTML = '<span>&#8635;</span> Quick Reset';
    }

    // Verify data
    async function verify() {
      const btn = document.getElementById('btn-verify');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Verifying...';
      addLogEntry('info', 'Running verification...');

      try {
        const res = await fetch(\`\${API_BASE}/verify\`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          addLogEntry('success', \`Verification complete (\${data.duration}ms)\`);
          // Show output in a modal or separate area
          console.log(data.output);
        } else {
          addLogEntry('error', \`Verification failed: \${data.error}\`);
        }
      } catch (err) {
        addLogEntry('error', \`Verify error: \${err.message}\`);
      }

      btn.disabled = false;
      btn.innerHTML = '<span>&#10003;</span> Verify';
    }

    // Add log entry to UI
    function addLogEntry(type, message) {
      const container = document.getElementById('execution-log');
      const time = new Date().toLocaleTimeString();
      const icon = { success: '\\u2713', error: '\\u2717', warning: '\\u26A0', info: '\\u2139' }[type] || '';

      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${type}\`;
      entry.innerHTML = \`<span class="log-time">\${time}</span><span>\${icon} \${message}</span>\`;

      container.insertBefore(entry, container.firstChild);
    }

    // Refresh logs from server
    async function refreshLogs() {
      try {
        const res = await fetch(\`\${API_BASE}/logs\`);
        const data = await res.json();

        const container = document.getElementById('logs-history');
        if (data.logs.length === 0) {
          container.innerHTML = '<p style="color: var(--text-secondary);">No logs yet</p>';
          return;
        }

        container.innerHTML = data.logs.map(log => {
          const time = new Date(log.timestamp).toLocaleString();
          const icon = { success: '\\u2713', error: '\\u2717', warning: '\\u26A0', info: '\\u2139' }[log.type] || '';
          return \`<div class="log-entry log-\${log.type}">
            <span class="log-time">\${time}</span>
            <span>\${icon} \${log.message}</span>
          </div>\`;
        }).join('');
      } catch (err) {
        console.error('Failed to load logs:', err);
      }
    }

    // Clear logs
    async function clearLogs() {
      await fetch(\`\${API_BASE}/logs\`, { method: 'DELETE' });
      refreshLogs();
    }

    // Load example queries
    async function loadExamples() {
      try {
        const res = await fetch(\`\${API_BASE}/query/examples\`);
        const data = await res.json();

        const container = document.getElementById('examples-list');
        container.innerHTML = data.examples.map(ex => {
          const escapedQuery = ex.query.replace(/'/g, "\\'").replace(/\\n/g, '\\\\n');
          return '<div class="example-item" onclick="setQuery(\\''+escapedQuery+'\\')">' +
            '<div class="example-name">'+ex.name+'</div>' +
            '<div class="example-desc">'+ex.description+'</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        console.error('Failed to load examples:', err);
      }
    }

    // Set query in editor
    function setQuery(query) {
      document.getElementById('query-input').value = query;
    }

    // Clear query
    function clearQuery() {
      document.getElementById('query-input').value = '';
      document.getElementById('query-results').innerHTML = '<p style="color: var(--text-secondary);">Execute a query to see results</p>';
    }

    // Execute query
    async function executeQuery() {
      const query = document.getElementById('query-input').value.trim();
      if (!query) return;

      const allowWrite = document.getElementById('allow-write').checked;
      const btn = document.getElementById('btn-execute');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running...';

      try {
        const res = await fetch(\`\${API_BASE}/query\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, allowWrite }),
        });
        const data = await res.json();

        const resultsDiv = document.getElementById('query-results');

        if (data.success) {
          if (data.rows.length === 0) {
            resultsDiv.innerHTML = '<p style="color: var(--text-secondary);">Query executed successfully. No rows returned.</p>';
          } else {
            const columns = data.columns;
            resultsDiv.innerHTML = \`
              <div class="results-info">\${data.rowCount} rows (\${data.duration}ms)</div>
              <div style="overflow-x: auto;">
                <table class="results-table">
                  <thead>
                    <tr>\${columns.map(c => \`<th>\${c}</th>\`).join('')}</tr>
                  </thead>
                  <tbody>
                    \${data.rows.map(row => \`
                      <tr>\${columns.map(c => \`<td>\${formatValue(row[c])}</td>\`).join('')}</tr>
                    \`).join('')}
                  </tbody>
                </table>
              </div>
            \`;
          }
        } else {
          resultsDiv.innerHTML = \`<pre style="color: var(--error);">\${data.error}</pre>\`;
        }
      } catch (err) {
        document.getElementById('query-results').innerHTML = \`<pre style="color: var(--error);">Error: \${err.message}</pre>\`;
      }

      btn.disabled = false;
      btn.innerHTML = '<span>&#9654;</span> Execute';
    }

    // Format cell value
    function formatValue(val) {
      if (val === null) return '<span style="color: var(--text-secondary);">NULL</span>';
      if (typeof val === 'object') return JSON.stringify(val).substring(0, 50) + '...';
      if (typeof val === 'string' && val.length > 50) return val.substring(0, 50) + '...';
      return String(val);
    }

    // Keyboard shortcut for query execution
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (document.getElementById('query-panel').classList.contains('active')) {
          executeQuery();
        }
      }
    });

    // Initialize
    loadScripts();
    loadExamples();
  </script>
</body>
</html>`;
}

export const dbAdminController = router;
