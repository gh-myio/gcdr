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
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:13px/1.45 ui-monospace,Menlo,Consolas,monospace; background:#0f1720; color:#d7e0ea; }
  header { padding:12px 16px; background:#111c28; border-bottom:1px solid #22303f; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:14px; margin:0; color:#8fd6ff; font-weight:600; }
  .ro { font-size:11px; color:#f0b429; border:1px solid #6b5312; background:#2a2109; padding:1px 6px; border-radius:3px; }
  main { padding:16px; max-width:1400px; }
  section { margin-bottom:22px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:#7b8ba0; border-bottom:1px solid #22303f; padding-bottom:5px; }
  input,button { font:inherit; background:#0b131b; color:#d7e0ea; border:1px solid #2a3a4b; border-radius:4px; padding:5px 8px; }
  button { cursor:pointer; background:#16324a; } button:hover { background:#1d4b6e; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th,td { text-align:left; padding:4px 8px; border-bottom:1px solid #1a2733; vertical-align:top; }
  th { color:#7b8ba0; font-weight:600; position:sticky; top:0; background:#0f1720; }
  .wrap { overflow-x:auto; border:1px solid #1a2733; border-radius:6px; max-height:420px; overflow-y:auto; }
  .kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:8px; }
  .card { background:#111c28; border:1px solid #22303f; border-radius:6px; padding:10px 12px; }
  .card .lbl { color:#7b8ba0; font-size:11px; } .card .val { font-size:15px; margin-top:2px; }
  .b { padding:1px 7px; border-radius:10px; font-size:11px; font-weight:600; }
  .ok { background:#0d3320; color:#4ade80; } .bad { background:#3a1414; color:#f87171; }
  .warn { background:#3a2c0c; color:#fbbf24; } .mut { color:#5f7387; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
  code { color:#9fd0ff; white-space:pre-wrap; word-break:break-all; }
  .mode-shadow{color:#8fd6ff}.mode-canonical{color:#4ade80}.mode-held{color:#f87171}
</style></head>
<body>
<header>
  <h1>orchestrator-devices</h1><span class="ro">READ-ONLY · Phase 2A</span>
  <input id="pw" type="password" placeholder="admin password" style="width:160px">
  <button onclick="connect()">Connect</button>
  <label class="mut"><input type="checkbox" id="auto" checked> auto 10s</label>
  <span id="err" class="bad" style="display:none"></span>
</header>
<main>
  <section><h2>Worker summary</h2><div id="summary" class="kv"></div></section>
  <section><h2>Recent runs</h2><div class="wrap"><table id="runs"></table></div></section>
  <section><h2>Divergence — canonical vs proposed (latest run)</h2><div class="wrap"><table id="div"></table></div></section>
  <section><h2>Checks (shadow ledger)</h2>
    <div class="filters">
      <input id="fCentral" placeholder="centralId (uuid)" style="width:280px">
      <input id="fCustomer" placeholder="customerId (uuid)" style="width:280px">
      <input id="fReason" placeholder="unknown_reason">
      <input id="fState" placeholder="state (e.g. OFFLINE)">
      <button onclick="load()">Filter</button>
    </div>
    <div class="wrap"><table id="checks"></table></div>
  </section>
</main>
<script>
  const $=id=>document.getElementById(id);
  let pw = sessionStorage.getItem('odpw')||'';
  if(pw) $('pw').value=pw;
  function connect(){ pw=$('pw').value; sessionStorage.setItem('odpw',pw); load(); }
  async function api(path){
    const r = await fetch('/admin/orchestrator-devices/api/'+path,{headers:{'x-admin-password':pw}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));
    return r.json();
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function ageStr(ms){ if(ms==null)return '—'; const s=Math.round(ms/1000); return s<90?s+'s':Math.round(s/60)+'m'; }
  function tbl(el, cols, rows, cell){ el.innerHTML='<tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+
    rows.map(r=>'<tr>'+cols.map(c=>'<td>'+cell(r,c)+'</td>').join('')+'</tr>').join(''); }
  async function load(){
    $('err').style.display='none';
    try{
      const s=await api('summary');
      const flags=s.flags||{};
      $('summary').innerHTML=[
        card('MASTER', s.master? '<span class="b ok">ON</span>':'<span class="b bad">OFF</span>'),
        card('Heartbeat', (s.healthy?'<span class="b ok">healthy</span>':'<span class="b bad">stale</span>')+' <span class="mut">'+ageStr(s.ageMs)+'</span>'),
        card('shadow_mode', badBool(flags.shadow_mode,true)),
        card('canonical_writes', badBool(flags.canonical_writes_enabled,false)),
        card('incident_emission', badBool(flags.incident_emission_enabled,false)),
        card('Monitors', (s.monitors||[]).map(m=>m.scope+':'+(m.enabled?'on':'off')).join('  ')),
        card('Enabled gateways', s.enabledGateways),
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
      if(dv.length===0) $('div').innerHTML='<tr><td class="mut">no divergence in the latest run — canonical matches proposed</td></tr>';

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
      if(c==='transition')return r.caused_transition?'<span class="b warn">yes</span>':'<span class="mut">no</span>';
      if(c==='latency')return esc(r.latency_ms!=null?r.latency_ms+'ms':'');
      if(c==='signal')return esc(inp.gatewayStatus||inp.kind||(inp.ok===false?'probe-fail':''));
      return esc(r[c]);
    });
  }
  function card(l,v){ return '<div class="card"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>'; }
  function badBool(v,safeWhenFalse){ const on=v===true||v==='true'; const cls=(on!==!!safeWhenFalse)?(safeWhenFalse?'bad':'ok'):'ok';
    return '<span class="b '+(on?(safeWhenFalse?'warn':'ok'):(safeWhenFalse?'ok':'mut'))+'">'+(on?'ON':'off')+'</span>'; }
  if(pw) load();
  setInterval(()=>{ if($('auto').checked && pw) load(); },10000);
</script>
</body></html>`;

export { router as orchestratorDevicesAdminController };
