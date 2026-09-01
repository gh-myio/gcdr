// =============================================================================
// orchestrator-devices cockpit — READ-ONLY (RFC-0062 Phase 2A)
// =============================================================================
// A backend-served observability panel for the orchestrator-devices worker, in
// the family of /admin/db, /admin/simulator, /admin/monitor (mounted before
// Helmet, relaxed CSP). READ-ONLY: it shows worker/control status, recent runs,
// per-entity checks (the shadow proposals), and canonical-vs-proposed divergence.
//
// NO control actions here — MASTER/gateway/flag toggles and kick-scan are Phase
// 2B and require a real RBAC permission (orchestrator_devices.control) + audit +
// confirmation. The critical flips already exist via DB/runbook.
//
// Access: http://localhost:3015/admin/orchestrator-devices
// =============================================================================

import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { orchestratorDevicesControl } from '../../infrastructure/database/drizzle/schema';

const router = Router();

const ADMIN_PASSWORD = process.env.DB_ADMIN_PASSWORD || 'myio2026';
// The worker's default HEALTHCHECK_MAX_STALE_MS (this is a read-only heuristic;
// the worker container enforces the real value).
const STALE_MS = Number.parseInt(process.env.HEALTHCHECK_MAX_STALE_MS ?? '180000', 10);

type Rows = Array<Record<string, unknown>>;

function verifyPassword(req: Request, res: Response, next: () => void): void {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized. Invalid admin password.' });
    return;
  }
  next();
}

router.use('/api', verifyPassword);

// ── Summary: control rows, flags, heartbeat health, enabled gateways ─────────
router.get('/api/summary', async (_req: Request, res: Response) => {
  try {
    const control = await db.select().from(orchestratorDevicesControl);
    const master = control.find((c) => c.scope === 'MASTER');
    const flags = (control.find((c) => c.scope === 'FLAGS')?.config ?? {}) as Record<string, unknown>;
    const monitors = ['CENTRALS', 'DEVICES', 'OS'].map((s) => ({ scope: s, enabled: control.find((c) => c.scope === s)?.enabled ?? null }));
    const lastRunAt = master?.lastRunAt ? new Date(master.lastRunAt as unknown as string).toISOString() : null;
    const ageMs = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() : null;
    const gw = (await db.execute(sql`select count(*)::int as n from centrals where monitoring_enabled = true`)) as unknown as Rows;
    res.json({
      master: master?.enabled ?? null,
      monitors,
      flags,
      lastRunAt,
      ageMs,
      healthy: ageMs !== null && ageMs < STALE_MS,
      staleThresholdMs: STALE_MS,
      enabledGateways: Number(gw[0]?.n ?? 0),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Recent runs ──────────────────────────────────────────────────────────────
router.get('/api/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 200);
    const runs = (await db.execute(sql`
      select id, monitor, started_at, finished_at, scanned, changed, skipped, deferred, failures, notes
      from orchestrator_devices_runs order by started_at desc limit ${limit}`)) as unknown as Rows;
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Recent checks (the shadow ledger) with filters ───────────────────────────
router.get('/api/checks', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const centralId = (req.query.centralId as string) || null;
    const customerId = (req.query.customerId as string) || null;
    const reason = (req.query.reason as string) || null;
    const statePattern = req.query.state ? `%${req.query.state as string}%` : null;
    const checks = (await db.execute(sql`
      select k.entity_type, k.entity_id, k.central_id, c.name as central_name,
             d.name as device_name, coalesce(c.customer_id, d.customer_id) as customer_id,
             k.computed_state, k.proposed_write, k.caused_transition, k.latency_ms, k.policy, k.input, k.created_at
      from orchestrator_devices_checks k
      left join centrals c on c.id = k.central_id
      left join devices d on (k.entity_type = 'device' and d.id = k.entity_id)
      where (${centralId}::uuid is null or k.central_id = ${centralId}::uuid)
        and (${customerId}::uuid is null or c.customer_id = ${customerId}::uuid or d.customer_id = ${customerId}::uuid)
        and (${reason}::text is null or k.proposed_write->>'unknownReason' = ${reason})
        and (${statePattern}::text is null or k.computed_state ilike ${statePattern})
      order by k.created_at desc limit ${limit}`)) as unknown as Rows;
    res.json({ checks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Divergence: current canonical vs latest proposed (shadow) ────────────────
router.get('/api/divergence', async (_req: Request, res: Response) => {
  try {
    const centrals = (await db.execute(sql`
      select c.id, c.name, c.connection_status as current, k.proposed_write->>'connectionStatus' as proposed
      from orchestrator_devices_checks k join centrals c on c.id = k.entity_id
      where k.entity_type = 'central'
        and k.run_id = (select id from orchestrator_devices_runs where monitor='centrals' order by started_at desc limit 1)
        and c.connection_status::text is distinct from k.proposed_write->>'connectionStatus'
      limit 200`)) as unknown as Rows;
    const devices = (await db.execute(sql`
      select d.id, d.name, d.connectivity_status as current, k.proposed_write->>'connectivityStatus' as proposed,
             d.health_status as current_health, k.proposed_write->>'healthStatus' as proposed_health
      from orchestrator_devices_checks k join devices d on d.id = k.entity_id
      where k.entity_type = 'device'
        and k.run_id = (select id from orchestrator_devices_runs where monitor='centrals' order by started_at desc limit 1)
        and (d.connectivity_status::text is distinct from k.proposed_write->>'connectivityStatus'
             or d.health_status::text is distinct from k.proposed_write->>'healthStatus')
      limit 500`)) as unknown as Rows;
    res.json({ centrals, devices });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── The page ─────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.type('html').send(PAGE_HTML);
});

const PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>orchestrator-devices cockpit (read-only)</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  /* Light is the default; dark is opt-in via data-theme="dark" on <html>. */
  :root {
    --bg:#f6f8fa; --panel:#ffffff; --text:#1f2937; --muted:#6b7280; --border:#e5e7eb;
    --th:#f3f4f6; --rowb:#eef0f2; --accent:#0369a1; --ro-fg:#92400e; --ro-bg:#fef3c7; --ro-bd:#fcd34d;
    --input:#ffffff; --inbd:#cbd5e1; --btn:#e8eef4; --btnh:#dbe6f0;
    --code:#0f766e; --ok-bg:#dcfce7; --ok-fg:#15803d; --bad-bg:#fee2e2; --bad-fg:#b91c1c;
    --warn-bg:#fef3c7; --warn-fg:#92400e; --mode-shadow:#0369a1; --mode-canonical:#15803d; --mode-held:#b91c1c;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg:#0f1720; --panel:#111c28; --text:#d7e0ea; --muted:#5f7387; --border:#22303f;
    --th:#0f1720; --rowb:#1a2733; --accent:#8fd6ff; --ro-fg:#f0b429; --ro-bg:#2a2109; --ro-bd:#6b5312;
    --input:#0b131b; --inbd:#2a3a4b; --btn:#16324a; --btnh:#1d4b6e;
    --code:#9fd0ff; --ok-bg:#0d3320; --ok-fg:#4ade80; --bad-bg:#3a1414; --bad-fg:#f87171;
    --warn-bg:#3a2c0c; --warn-fg:#fbbf24; --mode-shadow:#8fd6ff; --mode-canonical:#4ade80; --mode-held:#f87171;
    color-scheme: dark;
  }
  body { margin:0; font:13px/1.45 'Nunito',system-ui,-apple-system,'Segoe UI',sans-serif; background:var(--bg); color:var(--text); }
  header { padding:12px 16px; background:var(--panel); border-bottom:1px solid var(--border); display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:14px; margin:0; color:var(--accent); font-weight:600; }
  .ro { font-size:11px; color:var(--ro-fg); border:1px solid var(--ro-bd); background:var(--ro-bg); padding:1px 6px; border-radius:3px; }
  .spacer { flex:1; }
  main { padding:16px; width:100%; box-sizing:border-box; }
  section { margin-bottom:22px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:5px; }
  input,button { font:inherit; background:var(--input); color:var(--text); border:1px solid var(--inbd); border-radius:4px; padding:5px 8px; }
  button { cursor:pointer; background:var(--btn); border-color:var(--border); } button:hover { background:var(--btnh); }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th,td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--rowb); vertical-align:top; }
  th { color:var(--muted); font-weight:600; position:sticky; top:0; background:var(--th); }
  .wrap { overflow-x:auto; border:1px solid var(--border); border-radius:6px; max-height:420px; overflow-y:auto; }
  .kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:8px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:10px 12px; }
  .card .lbl { color:var(--muted); font-size:11px; } .card .val { font-size:15px; margin-top:2px; }
  .b { padding:1px 7px; border-radius:10px; font-size:11px; font-weight:600; }
  .ok { background:var(--ok-bg); color:var(--ok-fg); } .bad { background:var(--bad-bg); color:var(--bad-fg); }
  .warn { background:var(--warn-bg); color:var(--warn-fg); } .mut { color:var(--muted); }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
  code { color:var(--code); white-space:pre-wrap; word-break:break-all; font-family:ui-monospace,Menlo,Consolas,monospace; }
  .mode-shadow{color:var(--mode-shadow)}.mode-canonical{color:var(--mode-canonical)}.mode-held{color:var(--mode-held)}
  .login-modal { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; justify-content:center; align-items:center; z-index:9999; }
  .login-modal.hidden { display:none; }
  .login-box { background:var(--panel); padding:32px; border-radius:12px; border:1px solid var(--border); text-align:center; max-width:380px; width:90%; }
  .login-box h2 { color:var(--accent); margin:0 0 8px; font-size:16px; }
  .login-box p { color:var(--muted); margin:0 0 16px; font-size:12px; }
  .login-box input { width:100%; padding:10px 12px; margin-bottom:12px; box-sizing:border-box; }
  .login-error { color:var(--bad-fg); font-size:12px; margin-bottom:10px; display:none; }
  .login-error.show { display:block; }
  .dot { color:#16a34a; } #connBadge button { margin-left:6px; }
  .help-modal { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; justify-content:center; align-items:center; z-index:9998; }
  .help-modal.hidden { display:none; }
  .help-box { background:var(--panel); border:1px solid var(--border); border-radius:12px; max-width:820px; width:92%; max-height:86vh; display:flex; flex-direction:column; }
  .help-head { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-bottom:1px solid var(--border); }
  .help-body { padding:6px 18px 18px; overflow-y:auto; font-size:12.5px; }
  .help-body h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:16px 0 6px; }
  .help-body ul { margin:6px 0; padding-left:18px; } .help-body li { margin:4px 0; }
  .help-tbl { width:100%; border-collapse:collapse; } .help-tbl td { border-bottom:1px solid var(--rowb); padding:5px 8px; vertical-align:top; }
  .help-tbl td:first-child { white-space:nowrap; color:var(--accent); width:200px; }
</style></head>
<body>
<header>
  <h1>orchestrator-devices</h1><span class="ro" data-i18n="ro">READ-ONLY · Phase 2A</span>
  <span id="connBadge" style="display:none"><span class="dot">●</span> <span data-i18n="connected">connected</span> <button onclick="logout()" data-i18n="logout">Logout</button></span>
  <label class="mut"><input type="checkbox" id="auto" checked> <span data-i18n="auto">auto 10s</span></label>
  <span id="err" class="bad" style="display:none"></span>
  <span class="spacer"></span>
  <button id="langBtn" onclick="toggleLang()" title="idioma / language"></button>
  <button onclick="showHelp()" title="help" data-i18n="help">? Help</button>
  <button id="themeBtn" onclick="toggleTheme()" title="toggle light/dark">🌙 dark</button>
</header>

<div id="login-modal" class="login-modal">
  <div class="login-box">
    <h2>orchestrator-devices</h2>
    <p data-i18n="login_sub">Enter the admin password to view the cockpit.</p>
    <input type="password" id="pw" data-i18n-ph="login_ph" placeholder="Password" onkeypress="if(event.key==='Enter')checkPassword()">
    <div id="loginErr" class="login-error" data-i18n="login_err">Invalid password. Try again.</div>
    <button onclick="checkPassword()" style="width:100%" data-i18n="unlock">Unlock</button>
  </div>
</div>

<div id="help-modal" class="help-modal hidden" onclick="if(event.target===this)hideHelp()">
  <div class="help-box">
    <div class="help-head"><b data-i18n="help_title">orchestrator-devices — cockpit help</b><button onclick="hideHelp()" data-i18n="close">✕ close</button></div>
    <div class="help-body" id="helpBody"></div>
  </div>
</div>
<main>
  <section><h2 data-i18n="summary">Worker summary</h2><div id="summary" class="kv"></div></section>
  <section><h2 data-i18n="runs">Recent runs</h2><div class="wrap"><table id="runs"></table></div></section>
  <section><h2 data-i18n="divergence">Divergence — canonical vs proposed (latest run)</h2><div class="wrap"><table id="div"></table></div></section>
  <section><h2 data-i18n="checks">Checks (shadow ledger)</h2>
    <div class="filters">
      <input id="fCentral" data-i18n-ph="ph_central" placeholder="centralId (uuid)" style="width:280px">
      <input id="fCustomer" data-i18n-ph="ph_customer" placeholder="customerId (uuid)" style="width:280px">
      <input id="fReason" data-i18n-ph="ph_reason" placeholder="unknown_reason">
      <input id="fState" data-i18n-ph="ph_state" placeholder="state (e.g. OFFLINE)">
      <button onclick="load()" data-i18n="filter">Filter</button>
    </div>
    <div class="wrap"><table id="checks"></table></div>
  </section>
</main>
<script>
  const $=id=>document.getElementById(id);
  // ── i18n (in-page): UI labels/columns/Help translated; enums/states/kinds stay English. ──
  const HELP = {
    'en':
      '<p>Read-only view of the RFC-0062 worker (Phase 1). It <b>only reads</b> — all flips (enable a gateway, turn on canonical writes / incidents) happen in the DB control table or via the runbook (<code>docs/ops/RFC-0062-orchestrator-devices-runbook.md</code>). Control buttons are Phase 2B.</p>'+
      '<h3>Sections</h3><ul>'+
      '<li><b>Summary</b> — worker state: MASTER on/off, heartbeat freshness (healthy = a recent tick), the live FLAGS, and how many gateways are enabled.</li>'+
      '<li><b>Recent runs</b> — one row per scan. <b>mode</b>: <span class="mode-shadow">shadow</span> (computes proposals, writes nothing canonical) · <span class="mode-canonical">canonical</span> (writes status) · <span class="mode-held">held</span> (sanity gate blocked the write). <b>applied/audited</b> = canonical writes/audit rows. <b>incidents</b> = candidates (posted/dry/disabled).</li>'+
      '<li><b>Divergence</b> — where the current canonical status differs from what the latest scan proposed; empty = canonical already matches.</li>'+
      '<li><b>Checks (shadow ledger)</b> — per-entity detail: computed state, <code>proposed_write</code>, unknown_reason, latency, causing signal. Filter by central / customer / reason / state.</li>'+
      '</ul><h3>Flags (live in the DB, seeded SAFE)</h3><table class="help-tbl">'+
      '<tr><td><code>shadow_mode</code></td><td>on ⇒ computes proposals, never touches canonical columns.</td></tr>'+
      '<tr><td><code>canonical_writes_enabled</code></td><td>off ⇒ status columns are not written.</td></tr>'+
      '<tr><td><code>incident_emission_enabled</code></td><td>off ⇒ incidents are built but not posted to ALARMS.</td></tr>'+
      '<tr><td><code>sanity_max_fleet_flip_pct</code></td><td>mass-transition circuit breaker: too many down-flips in one tick ⇒ canonical writes are held.</td></tr>'+
      '<tr><td><code>incident_open_after_ticks</code></td><td>debounce — consecutive down checks before an incident opens.</td></tr>'+
      '</table><h3>States</h3><table class="help-tbl">'+
      '<tr><td>connectivity</td><td><b>ONLINE</b> / <b>OFFLINE</b> / <b>UNKNOWN</b></td></tr>'+
      '<tr><td>health</td><td><b>HEALTHY</b> / <b>DEGRADED</b> / <b>CRITICAL</b> / <b>UNKNOWN</b></td></tr>'+
      '<tr><td>unknown_reason</td><td><code>AWAITING_FIRST_SCAN</code> · <code>NEVER_OBSERVED</code> · <code>SCAN_FAILED</code> · <code>CENTRAL_UNREACHABLE</code> (parent central down — cascade) · <code>AUTH_ERROR</code> · <code>CONFIG_ERROR</code></td></tr>'+
      '</table><p class="mut">Probe: genuine down (timeout/conn/5xx) ⇒ central OFFLINE + devices UNKNOWN/CENTRAL_UNREACHABLE. 401/403 ⇒ AUTH_ERROR. NXDOMAIN/4xx ⇒ CONFIG_ERROR. Password is <code>DB_ADMIN_PASSWORD</code>.</p>',
    'pt-BR':
      '<p>Visão somente leitura do worker do RFC-0062 (Phase 1). Ela <b>só lê</b> — todas as mudanças (habilitar um gateway, ligar escrita canônica / incidentes) são feitas na tabela de controle do banco ou pelo runbook (<code>docs/ops/RFC-0062-orchestrator-devices-runbook.md</code>). Botões de controle são Phase 2B.</p>'+
      '<h3>Seções</h3><ul>'+
      '<li><b>Resumo</b> — estado do worker: MASTER on/off, frescor do heartbeat (saudável = tick recente), as FLAGS ao vivo, e quantos gateways estão habilitados.</li>'+
      '<li><b>Execuções recentes</b> — uma linha por scan. <b>modo</b>: <span class="mode-shadow">shadow</span> (só calcula, não escreve canônico) · <span class="mode-canonical">canonical</span> (escreve status) · <span class="mode-held">held</span> (o sanity gate bloqueou). <b>applied/audited</b> = escritas/linhas de auditoria. <b>incidents</b> = candidatos (posted/dry/disabled).</li>'+
      '<li><b>Divergência</b> — onde o status canônico atual difere do que o último scan propôs; vazio = canônico já bate.</li>'+
      '<li><b>Verificações (shadow ledger)</b> — detalhe por entidade: estado computado, <code>proposed_write</code>, unknown_reason, latência, sinal causador. Filtre por central / customer / reason / state.</li>'+
      '</ul><h3>Flags (vivem no banco, seed SAFE)</h3><table class="help-tbl">'+
      '<tr><td><code>shadow_mode</code></td><td>on ⇒ só calcula propostas, nunca toca colunas canônicas.</td></tr>'+
      '<tr><td><code>canonical_writes_enabled</code></td><td>off ⇒ colunas de status não são escritas.</td></tr>'+
      '<tr><td><code>incident_emission_enabled</code></td><td>off ⇒ incidentes são construídos mas não postados no ALARMS.</td></tr>'+
      '<tr><td><code>sanity_max_fleet_flip_pct</code></td><td>disjuntor de transição em massa: quedas demais num tick ⇒ escrita canônica é segurada (held).</td></tr>'+
      '<tr><td><code>incident_open_after_ticks</code></td><td>debounce — checks consecutivos em queda antes de abrir incidente.</td></tr>'+
      '</table><h3>Estados</h3><table class="help-tbl">'+
      '<tr><td>connectivity</td><td><b>ONLINE</b> / <b>OFFLINE</b> / <b>UNKNOWN</b></td></tr>'+
      '<tr><td>health</td><td><b>HEALTHY</b> / <b>DEGRADED</b> / <b>CRITICAL</b> / <b>UNKNOWN</b></td></tr>'+
      '<tr><td>unknown_reason</td><td><code>AWAITING_FIRST_SCAN</code> · <code>NEVER_OBSERVED</code> · <code>SCAN_FAILED</code> · <code>CENTRAL_UNREACHABLE</code> (central pai caído — cascata) · <code>AUTH_ERROR</code> · <code>CONFIG_ERROR</code></td></tr>'+
      '</table><p class="mut">Probe: queda genuína (timeout/conn/5xx) ⇒ central OFFLINE + devices UNKNOWN/CENTRAL_UNREACHABLE. 401/403 ⇒ AUTH_ERROR. NXDOMAIN/4xx ⇒ CONFIG_ERROR. A senha é <code>DB_ADMIN_PASSWORD</code>.</p>',
  };
  const I18N = {
    'en': {ro:'READ-ONLY · Phase 2A',connected:'connected',logout:'Logout',auto:'auto 10s',help:'? Help',dark:'dark',light:'light',login_sub:'Enter the admin password to view the cockpit.',login_ph:'Password',login_err:'Invalid password. Try again.',unlock:'Unlock',help_title:'orchestrator-devices — cockpit help',close:'✕ close',summary:'Worker summary',runs:'Recent runs',divergence:'Divergence — canonical vs proposed (latest run)',checks:'Checks (shadow ledger)',ph_central:'centralId (uuid)',ph_customer:'customerId (uuid)',ph_reason:'unknown_reason',ph_state:'state (e.g. OFFLINE)',filter:'Filter',lbl_heartbeat:'Heartbeat',lbl_monitors:'Monitors',lbl_gateways:'Enabled gateways',val_healthy:'healthy',val_stale:'stale',div_empty:'no divergence in the latest run — canonical matches proposed',yes:'yes',no:'no',col_started:'started',col_monitor:'monitor',col_mode:'mode',col_scanned:'scanned',col_changed:'changed',col_failures:'failures',col_applied:'applied',col_audited:'audited',col_incidents:'incidents',col_type:'type',col_name:'name',col_current:'current',col_proposed:'proposed',col_current_health:'current_health',col_proposed_health:'proposed_health',col_created:'created',col_state:'state',col_reason:'reason',col_transition:'transition',col_latency:'latency',col_signal:'signal'},
    'pt-BR': {ro:'SOMENTE LEITURA · Phase 2A',connected:'conectado',logout:'Sair',auto:'auto 10s',help:'? Ajuda',dark:'escuro',light:'claro',login_sub:'Digite a senha de admin para ver o cockpit.',login_ph:'Senha',login_err:'Senha inválida. Tente de novo.',unlock:'Entrar',help_title:'orchestrator-devices — ajuda do cockpit',close:'✕ fechar',summary:'Resumo do worker',runs:'Execuções recentes',divergence:'Divergência — canônico vs proposto (última execução)',checks:'Verificações (shadow ledger)',ph_central:'centralId (uuid)',ph_customer:'customerId (uuid)',ph_reason:'unknown_reason',ph_state:'estado (ex.: OFFLINE)',filter:'Filtrar',lbl_heartbeat:'Heartbeat',lbl_monitors:'Monitores',lbl_gateways:'Gateways habilitados',val_healthy:'saudável',val_stale:'defasado',div_empty:'sem divergência na última execução — canônico bate com o proposto',yes:'sim',no:'não',col_started:'início',col_monitor:'monitor',col_mode:'modo',col_scanned:'varridos',col_changed:'mudados',col_failures:'falhas',col_applied:'aplicados',col_audited:'auditados',col_incidents:'incidentes',col_type:'tipo',col_name:'nome',col_current:'atual',col_proposed:'proposto',col_current_health:'saúde atual',col_proposed_health:'saúde proposta',col_created:'criado',col_state:'estado',col_reason:'motivo',col_transition:'transição',col_latency:'latência',col_signal:'sinal'},
  };
  let lang = 'en';
  try { lang = localStorage.getItem('od-lang') || (((navigator.language||'').toLowerCase().indexOf('pt')===0) ? 'pt-BR' : 'en'); } catch(e){}
  function t(k){ return (I18N[lang] && I18N[lang][k]) || I18N['en'][k] || k; }
  function helpHTML(){ return HELP[lang] || HELP['en']; }
  function applyLang(){
    document.querySelectorAll('[data-i18n]').forEach(function(el){ el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el){ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    $('langBtn').textContent = (lang==='pt-BR') ? 'EN' : 'PT';
    $('helpBody').innerHTML = helpHTML();
    applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light');
    if(pw) load();
  }
  function toggleLang(){ lang = (lang==='pt-BR') ? 'en' : 'pt-BR'; try{ localStorage.setItem('od-lang',lang); }catch(e){} applyLang(); }
  // Theme: light by default; dark is opt-in and persisted.
  function applyTheme(mode){ if(mode==='dark'){document.documentElement.setAttribute('data-theme','dark'); $('themeBtn').textContent='☀️ '+t('light');}
    else{document.documentElement.removeAttribute('data-theme'); $('themeBtn').textContent='🌙 '+t('dark');} }
  function toggleTheme(){ const next = document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    try{ localStorage.setItem('od-theme',next); }catch(e){} applyTheme(next); }
  try{ applyTheme(localStorage.getItem('od-theme')||'light'); }catch(e){ applyTheme('light'); }
  function showHelp(){ $('help-modal').classList.remove('hidden'); }
  function hideHelp(){ $('help-modal').classList.add('hidden'); }
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideHelp(); });
  let pw = '';
  function setConnected(on){
    $('login-modal').classList.toggle('hidden', on);
    $('connBadge').style.display = on ? 'inline' : 'none';
  }
  async function validate(candidate){
    try{ const r = await fetch('/admin/orchestrator-devices/api/summary',{headers:{'x-admin-password':candidate}}); return r.ok; }
    catch(e){ return false; }
  }
  async function checkPassword(){
    const val = $('pw').value;
    if(await validate(val)){ pw=val; sessionStorage.setItem('odpw',pw); $('loginErr').classList.remove('show'); setConnected(true); load(); }
    else { $('loginErr').classList.add('show'); $('pw').value=''; $('pw').focus(); }
  }
  function logout(){ pw=''; sessionStorage.removeItem('odpw'); $('pw').value=''; $('loginErr').classList.remove('show'); $('err').style.display='none'; setConnected(false); $('pw').focus(); }
  async function api(path){
    const r = await fetch('/admin/orchestrator-devices/api/'+path,{headers:{'x-admin-password':pw}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));
    return r.json();
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function ageStr(ms){ if(ms==null)return '—'; const s=Math.round(ms/1000); return s<90?s+'s':Math.round(s/60)+'m'; }
  function tbl(el, cols, rows, cell){ el.innerHTML='<tr>'+cols.map(c=>'<th>'+t('col_'+c)+'</th>').join('')+'</tr>'+
    rows.map(r=>'<tr>'+cols.map(c=>'<td>'+cell(r,c)+'</td>').join('')+'</tr>').join(''); }
  async function load(){
    $('err').style.display='none';
    try{
      const s=await api('summary');
      const flags=s.flags||{};
      $('summary').innerHTML=[
        card('MASTER', s.master? '<span class="b ok">ON</span>':'<span class="b bad">OFF</span>'),
        card(t('lbl_heartbeat'), (s.healthy?'<span class="b ok">'+t('val_healthy')+'</span>':'<span class="b bad">'+t('val_stale')+'</span>')+' <span class="mut">'+ageStr(s.ageMs)+'</span>'),
        card('shadow_mode', badBool(flags.shadow_mode,true)),
        card('canonical_writes', badBool(flags.canonical_writes_enabled,false)),
        card('incident_emission', badBool(flags.incident_emission_enabled,false)),
        card(t('lbl_monitors'), (s.monitors||[]).map(m=>m.scope+':'+(m.enabled?'on':'off')).join('  ')),
        card(t('lbl_gateways'), s.enabledGateways),
        card('sanity/debounce', 'flip '+(flags.sanity_max_fleet_flip_pct??'?')+'% · '+(flags.incident_open_after_ticks??'?')+' ticks'),
      ].join('');

      const runs=(await api('runs?limit=25')).runs;
      tbl($('runs'),['started','monitor','mode','scanned','changed','failures','applied','audited','incidents'],runs,(r,c)=>{
        const n=r.notes||{}; const inc=n.incidents||{};
        if(c==='started')return esc((r.started_at||'').toString().slice(0,19).replace('T',' '));
        if(c==='mode'){const m=n.mode||'—';return '<span class="mode-'+m+'">'+m+'</span>';}
        if(c==='applied')return esc(n.applied??0);
        if(c==='audited')return esc(n.audited??0);
        if(c==='incidents')return esc((inc.candidates??0)+' (post '+(inc.posted??0)+'/dry '+(inc.dryRun??0)+'/dis '+(inc.disabled??0)+')');
        if(c==='monitor')return esc(r.monitor);
        return esc(r[c]);
      });

      const d=await api('divergence');
      const dv=[...d.centrals.map(x=>({t:'central',...x})),...d.devices.map(x=>({t:'device',...x}))];
      tbl($('div'),['type','name','current','proposed','current_health','proposed_health'],dv,(r,c)=>{
        if(c==='type')return esc(r.t); return esc(r[c]);
      });
      if(dv.length===0) $('div').innerHTML='<tr><td class="mut">'+t('div_empty')+'</td></tr>';

      await loadChecks();
    }catch(e){ $('err').textContent=e.message; $('err').style.display='inline'; }
  }
  async function loadChecks(){
    const q=new URLSearchParams();
    if($('fCentral').value)q.set('centralId',$('fCentral').value.trim());
    if($('fCustomer').value)q.set('customerId',$('fCustomer').value.trim());
    if($('fReason').value)q.set('reason',$('fReason').value.trim());
    if($('fState').value)q.set('state',$('fState').value.trim());
    q.set('limit','150');
    const checks=(await api('checks?'+q.toString())).checks;
    tbl($('checks'),['created','type','name','state','proposed','reason','transition','latency','signal'],checks,(r,c)=>{
      const pw=r.proposed_write||{}; const inp=r.input||{};
      if(c==='created')return esc((r.created_at||'').toString().slice(11,19));
      if(c==='type')return esc(r.entity_type);
      if(c==='name')return esc(r.central_name||r.device_name||r.entity_id);
      if(c==='state')return esc(r.computed_state);
      if(c==='proposed')return '<code>'+esc(JSON.stringify(pw))+'</code>';
      if(c==='reason')return esc(pw.unknownReason||'');
      if(c==='transition')return r.caused_transition?'<span class="b warn">'+t('yes')+'</span>':'<span class="mut">'+t('no')+'</span>';
      if(c==='latency')return esc(r.latency_ms!=null?r.latency_ms+'ms':'');
      if(c==='signal')return esc(inp.gatewayStatus||inp.kind||(inp.ok===false?'probe-fail':''));
      return esc(r[c]);
    });
  }
  function card(l,v){ return '<div class="card"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>'; }
  function badBool(v,safeWhenFalse){ const on=v===true||v==='true'; const cls=(on!==!!safeWhenFalse)?(safeWhenFalse?'bad':'ok'):'ok';
    return '<span class="b '+(on?(safeWhenFalse?'warn':'ok'):(safeWhenFalse?'ok':'mut'))+'">'+(on?'ON':'off')+'</span>'; }
  applyLang();
  (async function initAuth(){
    const stored = sessionStorage.getItem('odpw')||'';
    if(stored && await validate(stored)){ pw=stored; setConnected(true); load(); }
    else { setConnected(false); $('pw').focus(); }
  })();
  setInterval(()=>{ if($('auto').checked && pw) load(); },10000);
</script>
</body></html>`;

export { router as orchestratorDevicesAdminController };
