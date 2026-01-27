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
  const allowInProd = process.env.ENABLE_DB_ADMIN === 'true';
  if (process.env.NODE_ENV === 'production' && !allowInProd) {
    return res.status(403).json({ error: 'Not available in production. Set ENABLE_DB_ADMIN=true to enable.' });
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
      name: 'All Customers',
      description: 'List all customers with details',
      query: `SELECT
    id,
    name,
    display_name,
    type,
    status,
    parent_customer_id,
    depth,
    email,
    phone,
    created_at
FROM customers
ORDER BY depth, name;`,
    },
    {
      name: 'Recent Events (50)',
      description: 'Last 50 audit log events with metadata',
      query: `SELECT
    id,
    event_type,
    event_category,
    action,
    description,
    entity_type,
    entity_id,
    user_email,
    actor_type,
    http_method,
    http_path,
    status_code,
    duration_ms,
    ip_address,
    metadata,
    created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 50;`,
    },
    {
      name: 'Event Details (with payload)',
      description: 'Events with old/new values for auditing changes',
      query: `SELECT
    id,
    event_type,
    action,
    description,
    entity_type,
    entity_id,
    user_email,
    metadata,
    old_values,
    new_values,
    error_message,
    created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;`,
    },
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
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
ORDER BY table_name;`,
    },
    {
      name: 'API Keys',
      description: 'List all API keys with usage stats',
      query: `SELECT
    ak.id,
    ak.name,
    ak.key_prefix,
    ak.scopes,
    ak.is_active,
    ak.usage_count,
    ak.last_used_at,
    c.name as customer_name
FROM customer_api_keys ak
JOIN customers c ON ak.customer_id = c.id
ORDER BY ak.created_at DESC;`,
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
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GCDR Database Admin</title>
  <!-- CodeMirror CSS -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/dracula.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/eclipse.min.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Dark Theme (default) */
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
      --cm-theme: dracula;
    }

    /* Light Theme */
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
      --cm-theme: eclipse;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      transition: background 0.3s, color 0.3s;
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

    .header-left {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 15px;
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

    .theme-toggle {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1rem;
      transition: all 0.2s;
    }

    .theme-toggle:hover {
      border-color: var(--primary);
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
      justify-content: space-between;
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
    .btn-secondary { background: var(--bg-tertiary); color: var(--text); border: 1px solid var(--border); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm { padding: 4px 10px; font-size: 0.8rem; }

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

    /* CodeMirror customization */
    .CodeMirror {
      height: 200px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.9rem;
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
      display: flex;
      justify-content: space-between;
      align-items: center;
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

    /* Query History */
    .history-list {
      max-height: 200px;
      overflow-y: auto;
    }

    .history-item {
      padding: 8px 12px;
      background: var(--bg);
      border-radius: 4px;
      margin-bottom: 6px;
      cursor: pointer;
      border: 1px solid var(--border);
      font-family: monospace;
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.2s;
    }

    .history-item:hover {
      border-color: var(--primary);
    }

    .history-time {
      color: var(--text-secondary);
      font-size: 0.7rem;
      margin-right: 8px;
    }

    /* JSON Value Click */
    .json-value {
      cursor: pointer;
      padding: 2px 6px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.8rem;
      display: inline-block;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
      transition: all 0.2s;
    }

    .json-value:hover {
      background: var(--primary);
      color: white;
    }

    .json-value::after {
      content: ' 👁';
      font-size: 0.7rem;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal {
      background: var(--bg-secondary);
      border-radius: 12px;
      max-width: 800px;
      max-height: 80vh;
      width: 90%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid var(--border);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      border-bottom: 1px solid var(--border);
    }

    .modal-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--primary);
    }

    .modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 0 5px;
      line-height: 1;
    }

    .modal-close:hover {
      color: var(--error);
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }

    .modal-body pre {
      background: var(--bg);
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 15px 20px;
      border-top: 1px solid var(--border);
    }

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

    .collapsible {
      cursor: pointer;
      user-select: none;
    }

    .collapsible::before {
      content: '\\25BC';
      display: inline-block;
      margin-right: 6px;
      transition: transform 0.2s;
    }

    .collapsible.collapsed::before {
      transform: rotate(-90deg);
    }

    .collapsible-content {
      max-height: 1000px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .collapsible-content.collapsed {
      max-height: 0;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>GCDR Database Admin</h1>
      <span class="dev-badge">DEV ONLY</span>
    </div>
    <div class="header-right">
      <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
        <span id="theme-icon">&#9790;</span>
      </button>
    </div>
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
            <div class="card-title">
              <span>SQL Query</span>
              <span style="font-size: 0.8rem; color: var(--text-secondary);">Ctrl+Enter to execute</span>
            </div>
            <textarea id="query-input"></textarea>
            <div class="mt-10 flex gap-10" style="align-items: center; flex-wrap: wrap;">
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
            <div class="card-title">
              <span>Results</span>
              <button class="btn btn-secondary btn-sm" onclick="exportCSV()" id="btn-export" style="display: none;">
                Export CSV
              </button>
            </div>
            <div id="query-results">
              <p style="color: var(--text-secondary);">Execute a query to see results</p>
            </div>
          </div>
        </div>

        <div style="width: 350px;">
          <div class="card">
            <div class="card-title collapsible" onclick="toggleCollapse(this)">Query History</div>
            <div class="collapsible-content">
              <div id="history-list" class="history-list">
                <p style="color: var(--text-secondary); font-size: 0.85rem;">No queries yet</p>
              </div>
              <button class="btn btn-secondary btn-sm mt-10" onclick="clearHistory()">Clear History</button>
            </div>
          </div>

          <div class="card">
            <div class="card-title collapsible" onclick="toggleCollapse(this)">Example Queries</div>
            <div class="collapsible-content">
              <div id="examples-list" class="examples-list">
                Loading...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- JSON Modal -->
  <div id="json-modal" class="modal-overlay" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title" id="modal-title">JSON Data</span>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <pre id="modal-content"></pre>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="copyModalContent()">Copy to Clipboard</button>
        <button class="btn btn-primary" onclick="closeModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- CodeMirror JS -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js"></script>

  <script>
    const API_BASE = '/admin/db/api';
    let editor = null;
    let lastQueryResults = null;

    // ==========================================================================
    // Theme Management
    // ==========================================================================
    function getStoredTheme() {
      return localStorage.getItem('gcdr-admin-theme') || 'dark';
    }

    function setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('gcdr-admin-theme', theme);
      document.getElementById('theme-icon').innerHTML = theme === 'dark' ? '&#9790;' : '&#9728;';
      if (editor) {
        editor.setOption('theme', theme === 'dark' ? 'dracula' : 'eclipse');
      }
    }

    function toggleTheme() {
      const current = getStoredTheme();
      setTheme(current === 'dark' ? 'light' : 'dark');
    }

    // ==========================================================================
    // Query History Management
    // ==========================================================================
    function getQueryHistory() {
      try {
        return JSON.parse(localStorage.getItem('gcdr-query-history') || '[]');
      } catch {
        return [];
      }
    }

    function saveQueryToHistory(query) {
      const history = getQueryHistory();
      const entry = {
        query: query.trim(),
        timestamp: new Date().toISOString()
      };
      // Remove duplicates
      const filtered = history.filter(h => h.query !== entry.query);
      filtered.unshift(entry);
      // Keep only last 20 queries
      const trimmed = filtered.slice(0, 20);
      localStorage.setItem('gcdr-query-history', JSON.stringify(trimmed));
      renderHistory();
    }

    function renderHistory() {
      const history = getQueryHistory();
      const container = document.getElementById('history-list');

      if (history.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">No queries yet</p>';
        return;
      }

      container.innerHTML = history.map((h, i) => {
        const time = new Date(h.timestamp).toLocaleTimeString();
        const preview = h.query.substring(0, 50) + (h.query.length > 50 ? '...' : '');
        return \`<div class="history-item" onclick="loadFromHistory(\${i})" title="\${h.query.replace(/"/g, '&quot;')}">
          <span class="history-time">\${time}</span>\${preview}
        </div>\`;
      }).join('');
    }

    function loadFromHistory(index) {
      const history = getQueryHistory();
      if (history[index]) {
        editor.setValue(history[index].query);
      }
    }

    function clearHistory() {
      localStorage.removeItem('gcdr-query-history');
      renderHistory();
    }

    // ==========================================================================
    // CSV Export
    // ==========================================================================
    function exportCSV() {
      if (!lastQueryResults || !lastQueryResults.rows || lastQueryResults.rows.length === 0) {
        alert('No data to export');
        return;
      }

      const { columns, rows } = lastQueryResults;

      // Build CSV content
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      const header = columns.map(escapeCSV).join(',');
      const body = rows.map(row => columns.map(c => escapeCSV(row[c])).join(',')).join('\\n');
      const csv = header + '\\n' + body;

      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', \`query-results-\${Date.now()}.csv\`);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    // ==========================================================================
    // Collapsible Sections
    // ==========================================================================
    function toggleCollapse(element) {
      element.classList.toggle('collapsed');
      const content = element.nextElementSibling;
      content.classList.toggle('collapsed');
    }

    // ==========================================================================
    // Tab Navigation
    // ==========================================================================
    function showTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelector(\`.tab[onclick*="\${tabId}"]\`).classList.add('active');
      document.getElementById(\`\${tabId}-panel\`).classList.add('active');

      if (tabId === 'logs') refreshLogs();
      if (tabId === 'query') {
        loadExamples();
        renderHistory();
        if (editor) editor.refresh();
      }
    }

    // ==========================================================================
    // Scripts Management
    // ==========================================================================
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

    // ==========================================================================
    // Log Management
    // ==========================================================================
    function addLogEntry(type, message) {
      const container = document.getElementById('execution-log');
      const time = new Date().toLocaleTimeString();
      const icon = { success: '\\u2713', error: '\\u2717', warning: '\\u26A0', info: '\\u2139' }[type] || '';

      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${type}\`;
      entry.innerHTML = \`<span class="log-time">\${time}</span><span>\${icon} \${message}</span>\`;

      container.insertBefore(entry, container.firstChild);
    }

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

    async function clearLogs() {
      await fetch(\`\${API_BASE}/logs\`, { method: 'DELETE' });
      refreshLogs();
    }

    // ==========================================================================
    // Query Execution
    // ==========================================================================
    async function loadExamples() {
      try {
        const res = await fetch(\`\${API_BASE}/query/examples\`);
        const data = await res.json();

        const container = document.getElementById('examples-list');
        container.innerHTML = data.examples.map((ex, i) => \`
          <div class="example-item" onclick="loadExample(\${i})">
            <div class="example-name">\${ex.name}</div>
            <div class="example-desc">\${ex.description}</div>
          </div>
        \`).join('');

        window._examples = data.examples;
      } catch (err) {
        console.error('Failed to load examples:', err);
      }
    }

    function loadExample(index) {
      if (window._examples && window._examples[index]) {
        editor.setValue(window._examples[index].query);
      }
    }

    function clearQuery() {
      editor.setValue('');
      document.getElementById('query-results').innerHTML = '<p style="color: var(--text-secondary);">Execute a query to see results</p>';
      document.getElementById('btn-export').style.display = 'none';
      lastQueryResults = null;
    }

    async function executeQuery() {
      const query = editor.getValue().trim();
      if (!query) return;

      saveQueryToHistory(query);

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
        const exportBtn = document.getElementById('btn-export');

        if (data.success) {
          lastQueryResults = data;

          if (data.rows.length === 0) {
            resultsDiv.innerHTML = '<p style="color: var(--text-secondary);">Query executed successfully. No rows returned.</p>';
            exportBtn.style.display = 'none';
          } else {
            const columns = data.columns;
            resultsDiv.innerHTML = \`
              <div class="results-info">
                <span>\${data.rowCount} rows (\${data.duration}ms)</span>
              </div>
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
            exportBtn.style.display = 'inline-flex';
          }
        } else {
          resultsDiv.innerHTML = \`<pre style="color: var(--error);">\${data.error}</pre>\`;
          exportBtn.style.display = 'none';
          lastQueryResults = null;
        }
      } catch (err) {
        document.getElementById('query-results').innerHTML = \`<pre style="color: var(--error);">Error: \${err.message}</pre>\`;
        document.getElementById('btn-export').style.display = 'none';
        lastQueryResults = null;
      }

      btn.disabled = false;
      btn.innerHTML = '<span>&#9654;</span> Execute';
    }

    function formatValue(val) {
      if (val === null) return '<span style="color: var(--text-secondary);">NULL</span>';
      if (typeof val === 'object') {
        const json = JSON.stringify(val, null, 2);
        const preview = JSON.stringify(val).substring(0, 40);
        const escaped = json.replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
        return \`<span class="json-value" onclick="showModal('JSON Data', '\${escaped}')">\${preview}\${preview.length >= 40 ? '...' : ''}</span>\`;
      }
      if (typeof val === 'string' && val.length > 50) {
        const escaped = val.replace(/'/g, "\\\\'").replace(/"/g, '&quot;').replace(/\\n/g, '\\\\n');
        return \`<span class="json-value" onclick="showModal('Text Data', '\${escaped}')">\${val.substring(0, 40)}...</span>\`;
      }
      return String(val);
    }

    // ==========================================================================
    // Modal Functions
    // ==========================================================================
    function showModal(title, content) {
      document.getElementById('modal-title').textContent = title;
      // Decode escaped content
      const decoded = content.replace(/&quot;/g, '"').replace(/\\\\'/g, "'").replace(/\\\\n/g, '\\n');
      document.getElementById('modal-content').textContent = decoded;
      document.getElementById('json-modal').classList.add('active');
    }

    function closeModal(event) {
      if (event && event.target !== event.currentTarget) return;
      document.getElementById('json-modal').classList.remove('active');
    }

    function copyModalContent() {
      const content = document.getElementById('modal-content').textContent;
      navigator.clipboard.writeText(content).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-success');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('btn-success');
          btn.classList.add('btn-secondary');
        }, 1500);
      });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // ==========================================================================
    // Initialization
    // ==========================================================================
    document.addEventListener('DOMContentLoaded', () => {
      // Apply stored theme
      setTheme(getStoredTheme());

      // Initialize CodeMirror
      editor = CodeMirror.fromTextArea(document.getElementById('query-input'), {
        mode: 'text/x-sql',
        theme: getStoredTheme() === 'dark' ? 'dracula' : 'eclipse',
        lineNumbers: true,
        indentWithTabs: true,
        smartIndent: true,
        lineWrapping: true,
        matchBrackets: true,
        autofocus: false,
        extraKeys: {
          'Ctrl-Enter': executeQuery,
          'Cmd-Enter': executeQuery,
        },
        placeholder: 'SELECT * FROM customers LIMIT 10;'
      });

      // Load initial data
      loadScripts();
      loadExamples();
      renderHistory();
    });
  </script>
</body>
</html>`;
}

export const dbAdminController = router;
