// =============================================================================
// orchestrator-devices cockpit — observability + initial Phase-2B controls
// =============================================================================
// A backend-served panel for the orchestrator-devices worker, in the family of
// /admin/db, /admin/simulator, /admin/monitor (mounted before Helmet, relaxed
// CSP). It SHOWS worker/control status, recent runs, per-entity checks (shadow
// proposals) and canonical-vs-proposed divergence, AND exposes a first set of
// Phase-2B write controls:
//   PATCH /api/centrals/:id/monitoring         — per-central monitoring flag
//   PATCH /api/centrals/monitoring/bulk        — bulk enable/disable (ACTIVE only)
//   POST  /api/centrals/:id/recheck            — manual probe (evidence refresh only)
// All writes are confirm()-gated on the client and write audit_logs.
//
// AUTH DECISION (⚠️ pending): these controls are gated by DB_ADMIN_PASSWORD, the
// same shared secret as the sibling /admin/* panels. This is a DELIBERATE,
// TEMPORARY choice for an internal cockpit — NOT the RFC-0062 §7 target, which is
// RBAC `orchestrator_devices.control`. Heavier controls (MASTER / canonical /
// incident flags, kick-scan) intentionally stay OUT of here and live in the
// control table via DB/runbook until the RBAC decision is settled. Do not add
// more write endpoints here under admin-password without revisiting §7.
//
// Access: http://localhost:3015/admin/orchestrator-devices
// =============================================================================

import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { orchestratorDevicesControl, auditLogs } from '../../infrastructure/database/drizzle/schema';
import { probeGateway } from '../../workers/orchestrator-devices/gatewayClient';
import { workerConfig, gatewayUrl } from '../../workers/orchestrator-devices/config';

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

// ── Centrals list (CENTRAIS tab) — status + probe evidence + device count ────
router.get('/api/centrals', async (_req: Request, res: Response) => {
  try {
    const centrals = (await db.execute(sql`
      select c.id, c.name, c.connection_status, c.monitoring_enabled,
             c.last_gateway_check_at, c.last_gateway_success_check_at, c.last_gateway_check_latency_ms, c.probe_result,
             (select count(*)::int from devices d where d.central_id = c.id and d.deleted_at is null and d.status = 'ACTIVE' and d.slave_id is not null) as device_count,
             (select count(*)::int from devices d where d.central_id = c.id and d.deleted_at is null and d.status = 'ACTIVE' and d.slave_id is not null and d.connectivity_status = 'ONLINE') as device_online,
             (select count(*)::int from devices d where d.central_id = c.id and d.deleted_at is null and d.status = 'ACTIVE' and d.slave_id is not null and d.connectivity_status = 'OFFLINE') as device_offline
      from centrals c
      where c.status <> 'DELETED'
      order by c.monitoring_enabled desc, c.name asc`)) as unknown as Rows;
    res.json({ centrals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Devices of a central (for the DEVICES info tooltip) — alphabetical ────────
router.get('/api/centrals/:id/devices', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const devices = (await db.execute(sql`
      select id, name, connectivity_status
      from devices where central_id = ${id} and deleted_at is null and status = 'ACTIVE' and slave_id is not null
      order by lower(name) asc nulls last`)) as unknown as Rows;
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Control: toggle per-central monitoring_enabled (Phase 2B, guarded) ────────
// Auth: admin-password gate (verifyPassword) + audit_logs. The client requires an
// explicit confirm() before calling this.

// Bulk: enable/disable monitoring on ALL centrals (guarded + audited). Declared
// before the :id route so 'monitoring/bulk' is not captured as an id. One audit
// row per affected tenant (centrals may span tenants).
router.patch('/api/centrals/monitoring/bulk', async (req: Request, res: Response) => {
  try {
    const enabled = String(req.query.enabled) === 'true';
    // Scope to ACTIVE, non-deleted centrals only — never touch archived/test/deleted
    // gateways or ones outside the monitoring rollout.
    const rows = (await db.execute(sql`
      update centrals set monitoring_enabled = ${enabled}, updated_at = now()
      where monitoring_enabled is distinct from ${enabled}
        and status = 'ACTIVE'
      returning tenant_id`)) as unknown as Rows;
    const byTenant = new Map<string, number>();
    for (const r of rows) { const tid = String(r.tenant_id); byTenant.set(tid, (byTenant.get(tid) ?? 0) + 1); }
    const ip = String((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 45);
    for (const [tenantId, count] of byTenant) {
      await db.insert(auditLogs).values({
        tenantId,
        eventType: 'orchestrator_devices.central.monitoring_bulk',
        eventCategory: 'ENTITY_CHANGE',
        auditLevel: 'STANDARD',
        description: `Bulk monitoring ${enabled ? 'ENABLED' : 'DISABLED'} for ${count} central(s) via cockpit`.slice(0, 500),
        action: 'UPDATE',
        entityType: 'central',
        entityId: null,
        actorType: 'USER',
        userEmail: 'cockpit-admin',
        newValues: { monitoringEnabled: enabled, count },
        ipAddress: ip || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        httpMethod: 'PATCH',
        httpPath: String(req.originalUrl || '').slice(0, 500),
        statusCode: 200,
        metadata: { source: 'orchestrator-devices-cockpit', auth: 'admin-password', action: 'bulk' },
      });
    }
    res.json({ ok: true, enabled, affected: rows.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.patch('/api/centrals/:id/monitoring', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const enabled = String(req.query.enabled) === 'true';
    // Atomic: capture prev value + tenant/customer, then apply.
    const rows = (await db.execute(sql`
      with prev as (
        select monitoring_enabled as old_val, tenant_id, customer_id, name
        from centrals where id = ${id}
      ), upd as (
        update centrals set monitoring_enabled = ${enabled}, updated_at = now()
        where id = ${id} returning id
      )
      select prev.old_val, prev.tenant_id, prev.customer_id, prev.name from prev`)) as unknown as Rows;
    if (!rows.length) { res.status(404).json({ error: 'central not found' }); return; }
    const r = rows[0];
    const ip = String((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 45);
    await db.insert(auditLogs).values({
      tenantId: String(r.tenant_id),
      eventType: 'orchestrator_devices.central.monitoring_toggle',
      eventCategory: 'ENTITY_CHANGE',
      auditLevel: 'STANDARD',
      description: `Monitoring ${enabled ? 'ENABLED' : 'DISABLED'} for central ${String(r.name)} via cockpit`.slice(0, 500),
      action: 'UPDATE',
      entityType: 'central',
      entityId: id,
      customerId: r.customer_id ? String(r.customer_id) : null,
      actorType: 'USER',
      userEmail: 'cockpit-admin',
      oldValues: { monitoringEnabled: Boolean(r.old_val) },
      newValues: { monitoringEnabled: enabled },
      ipAddress: ip || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      httpMethod: 'PATCH',
      httpPath: String(req.originalUrl || '').slice(0, 500),
      statusCode: 200,
      metadata: { source: 'orchestrator-devices-cockpit', auth: 'admin-password', panel: '/admin/orchestrator-devices' },
    });
    res.json({ ok: true, id, monitoringEnabled: enabled });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Control: force an immediate gateway probe (FORCE SYNC NOW) ────────────────
// Single-attempt probe reusing the worker's gatewayClient. Writes ONLY the probe
// EVIDENCE (last_gateway_check_*/probe_result) — never connection_status, so the
// worker stays the single writer of canonical status. Admin-password + audit.
router.post('/api/centrals/:id/recheck', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const rows = (await db.execute(sql`
      select id, name, tenant_id, customer_id, monitoring_enabled from centrals where id = ${id}`)) as unknown as Rows;
    if (!rows.length) { res.status(404).json({ error: 'central not found' }); return; }
    const c = rows[0];
    const policy = { name: 'manual-recheck', attempts: [{ delay_ms: 0, timeout_ms: workerConfig.probeTimeoutMs }] };
    const opts = { timeoutMs: workerConfig.probeTimeoutMs, maxTotalMs: workerConfig.probeTimeoutMs, statusToken: workerConfig.statusToken };
    const outcome = await probeGateway(gatewayUrl(id), policy, opts);
    const probeResult = outcome.ok ? 'OK' : outcome.kind;
    const latencyMs = outcome.latencyMs ?? null;
    // last_gateway_check_at = attempt (always); last_gateway_success_check_at only on OK.
    if (outcome.ok) {
      await db.execute(sql`
        update centrals set last_gateway_check_at = now(), last_gateway_success_check_at = now(),
          last_gateway_check_latency_ms = ${latencyMs}, probe_result = ${probeResult}, updated_at = now() where id = ${id}`);
    } else {
      await db.execute(sql`
        update centrals set last_gateway_check_at = now(),
          last_gateway_check_latency_ms = ${latencyMs}, probe_result = ${probeResult}, updated_at = now() where id = ${id}`);
    }
    const ip = String((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 45);
    await db.insert(auditLogs).values({
      tenantId: String(c.tenant_id),
      eventType: 'orchestrator_devices.central.manual_recheck',
      eventCategory: 'SYSTEM_EVENT',
      auditLevel: 'STANDARD',
      description: `Manual gateway recheck for ${String(c.name)} → ${probeResult}`.slice(0, 500),
      action: 'EXECUTE',
      entityType: 'central',
      entityId: id,
      customerId: c.customer_id ? String(c.customer_id) : null,
      actorType: 'USER',
      userEmail: 'cockpit-admin',
      newValues: { probeResult, latencyMs },
      ipAddress: ip || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      httpMethod: 'POST',
      httpPath: String(req.originalUrl || '').slice(0, 500),
      statusCode: 200,
      metadata: { source: 'orchestrator-devices-cockpit', auth: 'admin-password', action: 'force-sync-now' },
    });
    res.json({ ok: true, id, probeResult, latencyMs, reachable: outcome.ok });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── The page ─────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.type('html').send(PAGE_HTML.replace('__OFFLINE_GRACE_MIN__', String(workerConfig.offlineGraceMin)));
});

const PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>orchestrator-devices cockpit (read-only)</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Ccircle%20cx='8'%20cy='8'%20r='6'%20fill='%2316a34a'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<!-- myio-js-library UMD (vanilla JS, global window.MyIOLibrary). Same pattern as a
     ThingsBoard widget: one script tag, zero build. PINNED to an exact version +
     Subresource Integrity (SRI): this page has admin-gated write endpoints, so a
     floating @latest or a tampered CDN file must NOT be able to run here. If the bytes
     do not match the hash the browser refuses the script and every use below degrades
     to native confirm()/alert() + fallback cards. To bump: change the version AND
     recompute integrity (curl … | openssl dgst -sha384 -binary | openssl base64 -A). -->
<script defer src="https://unpkg.com/myio-js-library@0.1.535/dist/myio-js-library.umd.min.js"
        integrity="sha384-ld3SCZg60n8f3mJtSsnkpW+rubzizJ+Mw39CGpv2PnZethv+EBjx5S6I/xtHSnqD"
        crossorigin="anonymous"></script>
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
  input,button,select { font:inherit; background:var(--input); color:var(--text); border:1px solid var(--inbd); border-radius:4px; padding:5px 8px; }
  select { cursor:pointer; }
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
  .filters { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
  code { color:var(--code); white-space:pre-wrap; word-break:break-all; font-family:ui-monospace,Menlo,Consolas,monospace; }
  .mode-shadow{color:var(--mode-shadow)}.mode-canonical{color:var(--mode-canonical)}.mode-held{color:var(--mode-held)}
  /* Blocks / panels */
  .strip { display:flex; flex-wrap:wrap; gap:14px 20px; align-items:center; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 18px; margin-bottom:22px; }
  .posture { font-size:15px; font-weight:800; padding:4px 14px; border-radius:8px; letter-spacing:.02em; }
  .posture.ok{ background:var(--ok-bg); color:var(--ok-fg); } .posture.info{ background:var(--ro-bg); color:var(--accent); } .posture.warn{ background:var(--warn-bg); color:var(--warn-fg); }
  .strip-pills { display:flex; gap:6px; flex-wrap:wrap; }
  .pill { font-size:11px; padding:2px 9px; border-radius:11px; border:1px solid var(--border); white-space:nowrap; }
  .pill-on{ background:var(--ok-bg); color:var(--ok-fg); border-color:transparent; } .pill-off{ background:transparent; color:var(--muted); } .pill-warn{ background:var(--warn-bg); color:var(--warn-fg); border-color:transparent; }
  .strip-right { margin-left:auto; font-size:12px; text-align:right; }
  .panels { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .panel h4 { margin:0 0 10px; font-size:13px; color:var(--accent); }
  .panel .row { display:flex; justify-content:space-between; gap:12px; padding:4px 0; border-bottom:1px dashed var(--rowb); }
  .panel .row:last-child{ border-bottom:0; } .panel .row .k{ color:var(--muted); } .panel .row .v{ text-align:right; font-weight:600; }
  .cbody .row { display:flex; justify-content:space-between; gap:12px; padding:4px 0; border-bottom:1px dashed var(--rowb); }
  .cbody .row:last-child{ border-bottom:0; } .cbody .row .k{ color:var(--muted); text-transform:uppercase; letter-spacing:.03em; display:flex; align-items:center; gap:6px; } .cbody .row .k .ic{ font-style:normal; } .cbody .row .v{ text-align:right; font-weight:600; }
  .alert { border:1px solid var(--border); border-left:4px solid var(--bad-fg); background:var(--bad-bg); border-radius:8px; padding:12px 16px; }
  .alert.calm { border-left-color:var(--ok-fg); background:var(--ok-bg); }
  .alert .big { font-size:14px; font-weight:800; margin-bottom:6px; }
  .alert .drow { display:flex; gap:10px; align-items:center; padding:3px 0; flex-wrap:wrap; }
  .arrow { color:var(--muted); }
  tr.grp { cursor:pointer; } tr.grp:hover td { background:var(--th); }
  tr.grp .caret { color:var(--muted); display:inline-block; width:12px; }
  tr.grp-detail td { background:var(--bg); font-size:11px; }
  .chips .b { margin-right:4px; }
  .morebtn { margin-top:8px; }
  /* Tabs (segmented slider) */
  .tabs { display:inline-flex; gap:2px; background:var(--th); border:1px solid var(--border); border-radius:10px; padding:3px; margin-bottom:22px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); padding:7px 16px; border-radius:8px; font-weight:700; font-size:12px; letter-spacing:.04em; text-transform:uppercase; cursor:pointer; }
  .tab:hover { color:var(--text); }
  .tab.active { background:var(--panel); color:var(--accent); box-shadow:0 1px 3px rgba(0,0,0,.18); }
  .tab .tico { margin-right:6px; }
  .tab .tbadge { margin-left:7px; background:var(--th); border:1px solid var(--border); color:var(--muted); border-radius:9px; padding:0 6px; font-size:10px; font-weight:700; }
  .tab.active .tbadge { background:var(--ro-bg); color:var(--accent); border-color:var(--ro-bd); }
  .tabpanel { display:none; } .tabpanel.active { display:block; }
  /* Centrals cards */
  .cgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:12px; }
  .ccard { background:var(--panel); border:1px solid var(--border); border-left:4px solid var(--muted); border-radius:10px; padding:12px 14px; }
  .ccard.on { border-left-color:var(--ok-fg); } .ccard.off { border-left-color:var(--bad-fg); } .ccard.unk { border-left-color:var(--muted); } .ccard.warn { border-left-color:var(--warn-fg); }
  .ccard .cname { font-weight:700; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cbody .crow { display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:3px 0; border-bottom:1px dashed var(--rowb); }
  .cbody .crow:last-child { border-bottom:0; } .cbody .crow .k { color:var(--muted); text-transform:uppercase; letter-spacing:.03em; display:flex; align-items:center; gap:6px; }
  .cbody .crow .k .ic { font-style:normal; }
  .dev-stat .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin:0 4px 0 0; vertical-align:middle; }
  .dev-stat .dot.on { background:#16a34a; } .dev-stat .dot.off { background:#dc2626; } .dev-stat .dot.unk { background:var(--muted); }
  .dev-stat .vsep { display:inline-block; width:1px; height:11px; background:var(--border); margin:0 7px; vertical-align:middle; }
  .syncbtn { border:0; background:transparent; cursor:pointer; font-size:13px; line-height:1; padding:0 2px; }
  .syncbtn:hover { filter:brightness(1.15); }
  .syncbtn.spin { animation:odspin .8s linear infinite; display:inline-block; }
  @keyframes odspin { to { transform:rotate(360deg); } }
  .ind-group { margin-bottom:14px; } .ind-group:last-child { margin-bottom:0; }
  .ind-title { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:700; margin-bottom:8px; }
  .kpi-actions { cursor:default; display:flex; flex-direction:column; gap:6px; justify-content:center; }
  .kpi-actions .acts { display:flex; gap:6px; justify-content:center; flex-wrap:wrap; }
  .kpi-actions .btn-on, .kpi-actions .btn-off { font-weight:700; color:#fff; padding:4px 9px; font-size:11px; }
  .kpi-actions .btn-on { background:#16a34a; border-color:#16a34a; } .kpi-actions .btn-off { background:#dc2626; border-color:#dc2626; }
  .kpi-actions .btn-on:hover, .kpi-actions .btn-off:hover { filter:brightness(1.08); }
  .devinfo { cursor:help; color:var(--muted); font-size:11px; }
  .devtip { max-height:360px; overflow:auto; }
  .devtip-row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dashed var(--rowb); }
  .devtip-row:last-child { border-bottom:0; } .devtip-row .nm { word-break:break-word; }
  .cbody hr.csep { border:0; border-top:1px solid var(--rowb); margin:8px 0; }
  .cbody .mon-row { padding:2px 0; }
  .cbody .nodata { font-size:12px; padding:6px 0 2px; font-style:italic; }
  .switch { position:relative; display:inline-flex; align-items:center; cursor:pointer; }
  .switch input { position:absolute; opacity:0; width:0; height:0; }
  .switch .track { width:44px; height:22px; border-radius:11px; background:#dc2626; transition:background .15s; display:inline-block; position:relative; }
  .switch input:checked + .track { background:#16a34a; }
  .switch input:disabled + .track { opacity:.5; }
  .switch .knob { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .switch input:checked + .track .knob { left:24px; }
  .soon { color:var(--muted); font-size:14px; padding:48px 20px; text-align:center; border:1px dashed var(--border); border-radius:10px; }
  .strip-detail { font-size:12px; }
  .kpis { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
  .kpi { flex:1 1 110px; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:8px 16px; text-align:center; min-width:100px; cursor:pointer; }
  .kpi:hover { border-color:var(--accent); } .kpi.active { outline:2px solid var(--accent); outline-offset:-1px; }
  .kpi .n { font-size:18px; font-weight:800; } .kpi .l { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .kpi.k-on .n{ color:var(--ok-fg); } .kpi.k-off .n{ color:var(--bad-fg); } .kpi.k-unk .n{ color:var(--muted); }
  .pager { display:flex; gap:10px; align-items:center; justify-content:center; margin-top:16px; }
  .pager button[disabled]{ opacity:.45; cursor:default; }
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
  .kpi.k-warn .n{ color:#d97706; }
  #filtersBtn.has { border-color:var(--accent); font-weight:700; }
  #filtersBtn .fic{ opacity:.85; }
  .grace-info { cursor:pointer; } .grace-info b { color:var(--accent); }
  .flt-modal { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; justify-content:center; align-items:center; z-index:9997; }
  .flt-modal.hidden { display:none; }
  .flt-box { background:var(--panel); border:1px solid var(--border); border-radius:12px; max-width:560px; width:92%; max-height:88vh; display:flex; flex-direction:column; }
  .flt-head { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-bottom:1px solid var(--border); font-weight:700; }
  .flt-body { padding:6px 18px 12px; overflow-y:auto; }
  .flt-row { margin:12px 0; }
  .flt-row label.lbl { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:5px; }
  .flt-row select, .flt-row input[type=text], .flt-row input[type=number] { width:100%; box-sizing:border-box; }
  .flt-chk { display:flex; gap:14px; flex-wrap:wrap; }
  .flt-chk label { display:flex; align-items:center; gap:5px; font-size:12.5px; text-transform:none; letter-spacing:0; color:var(--text); }
  .flt-two { display:flex; gap:10px; } .flt-two > div { flex:1; }
  .flt-foot { display:flex; justify-content:space-between; gap:10px; padding:12px 18px; border-top:1px solid var(--border); }
  .flt-foot .right { display:flex; gap:8px; }
  .flt-hint { font-size:11.5px; color:var(--muted); margin-top:6px; }
</style></head>
<body>
<header>
  <h1>orchestrator-devices</h1><span class="ro" data-i18n="ro">READ-ONLY · Phase 2A</span>
  <span id="connBadge" style="display:none"><span class="dot">●</span> <span data-i18n="connected">connected</span> <button onclick="logout()" data-i18n="logout">Logout</button></span>
  <label class="mut"><input type="checkbox" id="auto" checked> <span data-i18n="auto">auto</span> <span id="autoCount" class="mut"></span></label>
  <span id="err" class="warn" style="display:none"></span>
  <span class="spacer"></span>
  <button id="langBtn" onclick="toggleLang()" title="idioma / language"></button>
  <button onclick="showHelp()" title="help" data-i18n="help">? Help</button>
  <button onclick="openSettings()" title="settings / configurações">⚙</button>
  <button id="themeBtn" onclick="toggleTheme()" title="toggle light/dark">🌙</button>
</header>

<div id="login-modal" class="login-modal">
  <div class="login-box">
    <h2>orchestrator-devices</h2>
    <p data-i18n="login_sub">Enter the admin password to view the cockpit.</p>
    <form onsubmit="checkPassword();return false;">
      <input type="text" name="username" autocomplete="username" value="admin" hidden>
      <input type="password" id="pw" name="admin-password" autocomplete="current-password" data-i18n-ph="login_ph" placeholder="Password">
      <div id="loginErr" class="login-error" data-i18n="login_err">Invalid password. Try again.</div>
      <button type="submit" style="width:100%" data-i18n="unlock">Unlock</button>
    </form>
  </div>
</div>

<div id="help-modal" class="help-modal hidden" onclick="if(event.target===this)hideHelp()">
  <div class="help-box">
    <div class="help-head"><b data-i18n="help_title">orchestrator-devices — cockpit help</b><button onclick="hideHelp()" data-i18n="close">✕ close</button></div>
    <div class="help-body" id="helpBody"></div>
  </div>
</div>

<div id="filters-modal" class="flt-modal hidden" onclick="if(event.target===this)closeFilters()">
  <div class="flt-box">
    <div class="flt-head"><span data-i18n="filters_title">Filters &amp; sorting</span><button onclick="closeFilters()" data-i18n="close">✕ close</button></div>
    <div class="flt-body">
      <div class="flt-row"><label class="lbl" data-i18n="f_sort">Sort by</label>
        <select id="mSort">
          <option value="name_asc" data-i18n="sort_name_asc">Name A→Z</option>
          <option value="name_desc" data-i18n="sort_name_desc">Name Z→A</option>
          <option value="offline_desc" data-i18n="sort_offline_desc">Offline longest first</option>
          <option value="offline_asc" data-i18n="sort_offline_asc">Offline shortest first</option>
          <option value="sync_desc" data-i18n="sort_sync_desc">Last sync: newest</option>
          <option value="sync_asc" data-i18n="sort_sync_asc">Last sync: oldest</option>
          <option value="dev_desc" data-i18n="sort_dev_desc">Most devices</option>
          <option value="dev_asc" data-i18n="sort_dev_asc">Fewest devices</option>
        </select>
      </div>
      <div class="flt-row"><label class="lbl" data-i18n="f_scope">Scope</label>
        <select id="mScope">
          <option value="monitored" data-i18n="scope_monitored">Monitored</option>
          <option value="all" data-i18n="scope_all">All</option>
          <option value="unmonitored" data-i18n="scope_unmonitored">Not monitored</option>
        </select>
      </div>
      <div class="flt-row"><label class="lbl" data-i18n="f_name">Name contains</label>
        <input type="text" id="mQ" data-i18n-ph="f_name_ph" placeholder="name or UUID (ignore case)">
      </div>
      <div class="flt-row"><label class="lbl" data-i18n="f_status">Status</label>
        <div class="flt-chk">
          <label><input type="checkbox" id="mSt_ONLINE"> <span data-i18n="st_online">ONLINE</span></label>
          <label><input type="checkbox" id="mSt_OFFLINE"> <span data-i18n="st_offline">OFFLINE</span></label>
          <label><input type="checkbox" id="mSt_WARNING"> <span data-i18n="st_warning">WARNING</span></label>
          <label><input type="checkbox" id="mSt_UNKNOWN"> <span data-i18n="st_unknown">UNKNOWN</span></label>
        </div>
      </div>
      <div class="flt-row"><label class="lbl" data-i18n="f_lastsync">Last sync</label>
        <select id="mLastSync">
          <option value="any" data-i18n="ls_any">Any</option>
          <option value="1h" data-i18n="ls_1h">Within 1h</option>
          <option value="24h" data-i18n="ls_24h">Within 24h</option>
          <option value="over24h" data-i18n="ls_over24h">Over 24h ago</option>
          <option value="never" data-i18n="ls_never">Never synced</option>
        </select>
      </div>
      <div class="flt-row flt-two">
        <div><label class="lbl" data-i18n="f_devices">Devices (min–max)</label>
          <div class="flt-two"><div><input type="number" id="mMinDev" min="0" placeholder="min"></div><div><input type="number" id="mMaxDev" min="0" placeholder="max"></div></div>
        </div>
      </div>
      <div class="flt-row flt-chk">
        <label><input type="checkbox" id="mDiv"> <span data-i18n="f_divergent">Only with divergence</span></label>
      </div>
    </div>
    <div class="flt-foot">
      <button onclick="clearFilters()" data-i18n="f_clear">Clear</button>
      <div class="right"><button onclick="closeFilters()" data-i18n="btn_cancel">Cancel</button><button onclick="applyFilters()" data-i18n="f_apply">Apply</button></div>
    </div>
  </div>
</div>

<div id="settings-modal" class="flt-modal hidden" onclick="if(event.target===this)closeSettings()">
  <div class="flt-box">
    <div class="flt-head"><span data-i18n="settings_title">Settings</span><button onclick="closeSettings()" data-i18n="close">✕ close</button></div>
    <div class="flt-body">
      <div class="flt-row"><label class="lbl" data-i18n="f_grace">Offline grace window (min)</label>
        <input type="number" id="sGrace" min="1" step="1">
        <div class="flt-hint" id="graceHint"></div>
      </div>
    </div>
    <div class="flt-foot">
      <button onclick="resetSettings()" data-i18n="f_reset_default">Reset to default</button>
      <div class="right"><button onclick="closeSettings()" data-i18n="btn_cancel">Cancel</button><button onclick="applySettings()" data-i18n="f_save">Save</button></div>
    </div>
  </div>
</div>
<main>
  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="dashboard" onclick="setTab('dashboard')"><span class="tico">📊</span><span data-i18n="tab_dashboard">Dashboard</span></button>
    <button class="tab" data-tab="centrals" onclick="setTab('centrals')"><span class="tico">📡</span><span data-i18n="tab_centrals">Centrals</span><span class="tbadge" id="badge-centrals"></span></button>
    <button class="tab" data-tab="devices" onclick="setTab('devices')"><span class="tico">📟</span><span data-i18n="tab_devices">Devices</span><span class="tbadge" id="badge-devices"></span></button>
    <button class="tab" data-tab="os" onclick="setTab('os')"><span class="tico">🧾</span><span data-i18n="tab_os">Work orders</span></button>
    <button class="tab" data-tab="scans" onclick="setTab('scans')"><span class="tico">🔍</span><span data-i18n="tab_scans">Scans</span><span class="tbadge" id="badge-scans"></span></button>
  </div>

  <div class="tabpanel active" id="tab-dashboard">
    <section class="strip" id="strip"></section>
    <section><div id="dashIndBody">
      <div id="dashCentralsKpis" class="kpis"></div>
    </div></section>
    <section>
      <div id="lastSyncs" class="cgrid"></div>
      <div id="syncSummary" style="margin-top:14px"></div>
    </section>
  </div>

  <div class="tabpanel" id="tab-centrals">
    <section><h2 data-i18n="tab_centrals">Centrals</h2>
      <div id="cKpis" class="kpis"></div>
      <div id="cFilters" class="filters">
        <input id="cSearch" data-i18n-ph="ph_search" placeholder="search name or UUID" oninput="cFilter.q=this.value;cPage=0;saveFilter();renderCentrals()" style="width:300px;max-width:100%">
        <button id="filtersBtn" onclick="openFilters()"><span class="fic">⇅</span> <span data-i18n="filters_btn">Filters</span> <span id="fBadge" class="mut"></span></button>
        <span id="cCount" class="mut"></span>
        <span id="graceInfo" class="mut grace-info" onclick="openSettings()"></span>
        <span class="mut" data-i18n="filter_hint">click a KPI to filter · total = all</span>
      </div>
      <div id="centralsGrid" class="cgrid"></div>
      <div class="pager" id="cPager"></div>
    </section>
  </div>

  <div class="tabpanel" id="tab-devices">
    <section><h2 data-i18n="tab_devices">Devices</h2>
      <div class="mut" data-i18n="devices_hint" style="margin-bottom:10px">Device states from the latest scan (Phase 2 telemetry pending)</div>
      <div id="devicesGrid" class="cgrid"></div>
    </section>
  </div>

  <div class="tabpanel" id="tab-os">
    <section><div class="soon"><span data-i18n="soon">Coming soon</span> · work orders</div></section>
  </div>

  <div class="tabpanel" id="tab-scans">
    <section><h2 data-i18n="runs">Recent runs</h2>
      <div class="wrap"><table id="runs"></table></div>
      <button class="morebtn" id="runsMore" onclick="toggleRuns()"></button>
    </section>
    <section><h2 data-i18n="checks">Checks (shadow ledger)</h2>
      <div class="filters">
        <input id="fCentral" data-i18n-ph="ph_central" placeholder="centralId (uuid)" style="width:260px">
        <input id="fCustomer" data-i18n-ph="ph_customer" placeholder="customerId (uuid)" style="width:260px">
        <input id="fReason" data-i18n-ph="ph_reason" placeholder="unknown_reason">
        <input id="fState" data-i18n-ph="ph_state" placeholder="state (e.g. OFFLINE)">
        <button onclick="loadChecks()" data-i18n="filter">Filter</button>
        <label class="mut"><input type="checkbox" id="fHistory" onchange="loadChecks()"> <span data-i18n="include_history">include history</span></label>
      </div>
      <div class="wrap"><table id="checks"></table></div>
    </section>
  </div>
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
    'en': {ro:'CONTROLS · admin password',connected:'connected',logout:'Logout',auto:'auto',auto_in:'refresh in {s}s',fetch_err:'Cockpit server unreachable — retrying',help:'? Help',dark:'dark',light:'light',login_sub:'Enter the admin password to view the cockpit.',login_ph:'Password',login_err:'Invalid password. Try again.',unlock:'Unlock',help_title:'orchestrator-devices — cockpit help',close:'✕ close',summary:'Worker summary',runs:'Recent runs',divergence:'Divergence — canonical vs proposed (latest run)',checks:'Checks (shadow ledger)',ph_central:'centralId (uuid)',ph_customer:'customerId (uuid)',ph_reason:'unknown_reason',ph_state:'state (e.g. OFFLINE)',filter:'Filter',lbl_heartbeat:'Heartbeat',lbl_monitors:'Monitors',lbl_gateways:'Enabled gateways',val_healthy:'healthy',val_stale:'stale',div_empty:'no divergence in the latest run — canonical matches proposed',yes:'yes',no:'no',col_started:'started',col_monitor:'monitor',col_mode:'mode',col_scanned:'scanned',col_changed:'changed',col_failures:'failures',col_applied:'applied',col_audited:'audited',col_incidents:'incidents',col_type:'type',col_name:'name',col_current:'current',col_proposed:'proposed',col_current_health:'current_health',col_proposed_health:'proposed_health',col_created:'created',col_state:'state',col_reason:'reason',col_transition:'transition',col_latency:'latency',col_signal:'signal',latest:'Latest scan',divergence_h:'Divergence',safe_idle:'SAFE MODE',worker:'Worker',last_tick:'last tick',gateways_enabled:'gateway(s) enabled',no_runs:'no runs yet',no_div:'no divergence — canonical matches proposed',div_one:'divergence',probe:'connectivity test',suppressed:'devices suppressed as',canon_writes:'canonical writes',inc_candidates:'incident candidates',devices:'devices',more:'show more',less:'show less',grp_hint:'click a row to expand its devices',include_history:'include history',recheck_now:'Recheck now',enable_canonical:'Enable canonical',last_observed:'last observed',phase2b:'Phase 2B — coming',tab_dashboard:'Dashboard',tab_centrals:'Centrals',tab_devices:'Devices',tab_os:'Work orders',tab_scans:'Scans',soon:'Coming soon',monitoring:'monitoring',last_sync:'last sync',ph_search:'search name',show_all:'show all',kpi_total:'total',page:'page',devices_hint:'Device states from the latest scan (Phase 2 telemetry pending)',filter_hint:'click a KPI to filter · total = all',no_data_off:'monitoring off · no probe data yet',confirm_mon_on:'Enable monitoring for "{name}"? The worker will start probing this gateway. This action is audited.',confirm_mon_off:'Disable monitoring for "{name}"? The worker will stop probing this gateway. This action is audited.',toggle_err:'Failed to change monitoring:',mon_on_title:'Enable monitoring',mon_off_title:'Disable monitoring',btn_cancel:'Cancel',btn_on:'Enable',btn_off:'Disable',kpi_card_title:'Status indicators',last_syncs:'Last syncs',sync_summary:'Sync summary',dash_ind_centrals:'Central status indicators',probe_ok:'Responding',probe_ok_slow:'Responding (slow)',probe_timeout:'No response',probe_conn:'No connection',probe_http:'Server error',probe_parse:'Bad response',probe_auth:'Auth error',probe_config:'Config error',probe_never:'Never tested',force_sync:'Refresh evidence',confirm_sync:'Run a manual probe for "{name}"? It updates ONLY the last check / probe result — it does NOT recompute the ledger, divergence or canonical status. Audited.',sync_done:'Evidence updated: {result}. Wait for the next sweep to refresh proposed_write / divergence.',sync_err:'Recheck failed:',st_online:'ONLINE',st_offline:'OFFLINE',st_unknown:'UNKNOWN',st_warning:'WARNING',last_attempt:'last attempt',last_success:'last success',div_help:'Stored status (canonical) differs from what the worker would write (proposed)',mon_card_title:'Monitoring',mon_all_on:'Enable all',mon_all_off:'Disable all',confirm_all_on:'Enable monitoring on ALL centrals? The worker will start probing every gateway. This action is audited.',confirm_all_off:'Disable monitoring on ALL centrals? The worker will stop probing every gateway. This action is audited.',bulk_done:'{n} central(s) updated',devices_list:'Devices',loading:'Loading',filters_btn:'Filters',filters_title:'Filters & sorting',filters_active:'{n} active',settings_title:'Settings',f_sort:'Sort by',sort_name_asc:'Name A→Z',sort_name_desc:'Name Z→A',sort_offline_desc:'Offline longest first',sort_offline_asc:'Offline shortest first',sort_sync_desc:'Last sync: newest',sort_sync_asc:'Last sync: oldest',sort_dev_desc:'Most devices',sort_dev_asc:'Fewest devices',f_scope:'Scope',scope_monitored:'Monitored',scope_all:'All',scope_unmonitored:'Not monitored',f_name:'Name contains',f_name_ph:'name or UUID (ignore case)',f_status:'Status',f_lastsync:'Last sync',ls_any:'Any',ls_1h:'Within 1h',ls_24h:'Within 24h',ls_over24h:'Over 24h ago',ls_never:'Never synced',f_devices:'Devices (min–max)',f_divergent:'Only with divergence',f_apply:'Apply',f_clear:'Clear',f_grace:'Offline grace window (min)',f_grace_hint:'Display-only override stored in this browser. The worker keeps using its ORCH_DEVICES_OFFLINE_GRACE_MIN env (default {d} min). Changes how this cockpit derives ONLINE/WARNING/OFFLINE.',f_save:'Save',f_reset_default:'Reset to default',uuid:'UUID',grace_lbl:'OFFLINE grace'},
    'pt-BR': {ro:'CONTROLES · senha admin',connected:'conectado',logout:'Sair',auto:'auto',auto_in:'atualiza em {s}s',fetch_err:'Servidor do cockpit indisponível — tentando de novo',help:'? Ajuda',dark:'escuro',light:'claro',login_sub:'Digite a senha de admin para ver o cockpit.',login_ph:'Senha',login_err:'Senha inválida. Tente de novo.',unlock:'Entrar',help_title:'orchestrator-devices — ajuda do cockpit',close:'✕ fechar',summary:'Resumo do worker',runs:'Execuções recentes',divergence:'Divergência — canônico vs proposto (última execução)',checks:'Verificações (shadow ledger)',ph_central:'centralId (uuid)',ph_customer:'customerId (uuid)',ph_reason:'unknown_reason',ph_state:'estado (ex.: OFFLINE)',filter:'Filtrar',lbl_heartbeat:'Heartbeat',lbl_monitors:'Monitores',lbl_gateways:'Gateways habilitados',val_healthy:'saudável',val_stale:'defasado',div_empty:'sem divergência na última execução — canônico bate com o proposto',yes:'sim',no:'não',col_started:'início',col_monitor:'monitor',col_mode:'modo',col_scanned:'varridos',col_changed:'mudados',col_failures:'falhas',col_applied:'aplicados',col_audited:'auditados',col_incidents:'incidentes',col_type:'tipo',col_name:'nome',col_current:'atual',col_proposed:'proposto',col_current_health:'saúde atual',col_proposed_health:'saúde proposta',col_created:'criado',col_state:'estado',col_reason:'motivo',col_transition:'transição',col_latency:'latência',col_signal:'sinal',latest:'Última varredura',divergence_h:'Divergência',safe_idle:'MODO SEGURO',worker:'Worker',last_tick:'último tick',gateways_enabled:'gateway(s) habilitado(s)',no_runs:'sem execuções ainda',no_div:'sem divergência — canônico bate com o proposto',div_one:'divergência',probe:'teste de conexão',suppressed:'devices suprimidos como',canon_writes:'escritas canônicas',inc_candidates:'candidatos a incidente',devices:'devices',more:'ver mais',less:'ver menos',grp_hint:'clique numa linha para expandir os devices',include_history:'incluir histórico',recheck_now:'Rechecar agora',enable_canonical:'Ligar canonical',last_observed:'visto por último',phase2b:'Phase 2B — em breve',tab_dashboard:'Dashboard',tab_centrals:'Centrais',tab_devices:'Dispositivos',tab_os:'Ordem de serviço',tab_scans:'Varreduras',soon:'Em breve',monitoring:'monitoramento',last_sync:'último sync',ph_search:'buscar nome',show_all:'mostrar todas',kpi_total:'total',page:'página',devices_hint:'Estados dos devices do último sweep (telemetria Phase 2 pendente)',filter_hint:'clique num KPI para filtrar · total = todas',no_data_off:'monitoramento desligado · sem dados de sondagem ainda',confirm_mon_on:'Ligar monitoramento de "{name}"? O worker passará a sondar esse gateway. Esta ação é auditada.',confirm_mon_off:'Desligar monitoramento de "{name}"? O worker deixará de sondar esse gateway. Esta ação é auditada.',toggle_err:'Falha ao alterar monitoramento:',mon_on_title:'Ligar monitoramento',mon_off_title:'Desligar monitoramento',btn_cancel:'Cancelar',btn_on:'Ligar',btn_off:'Desligar',kpi_card_title:'Indicadores de Status',last_syncs:'Últimos Syncs',sync_summary:'Resumo do Sync',dash_ind_centrals:'Indicadores de Status das Centrais',probe_ok:'Respondendo',probe_ok_slow:'Respondendo (lento)',probe_timeout:'Sem resposta',probe_conn:'Sem conexão',probe_http:'Erro no servidor',probe_parse:'Resposta inválida',probe_auth:'Erro de autenticação',probe_config:'Erro de configuração',probe_never:'Nunca testado',force_sync:'Atualizar evidência',confirm_sync:'Executar um probe manual em "{name}"? Atualiza APENAS a última verificação / resultado do probe — NÃO recalcula ledger, divergência nem status canônico. Auditado.',sync_done:'Evidência atualizada: {result}. Aguarde o próximo sweep para atualizar o proposed_write / divergência.',sync_err:'Falha ao rechecar:',st_online:'ONLINE',st_offline:'OFFLINE',st_unknown:'DESCONHECIDO',st_warning:'ATENÇÃO',last_attempt:'última tentativa',last_success:'último sucesso',div_help:'O status gravado (canônico) difere do que o worker gravaria (proposto)',mon_card_title:'Monitoramento',mon_all_on:'Ativar todos',mon_all_off:'Desativar todos',confirm_all_on:'Ativar monitoramento em TODAS as centrais? O worker passará a sondar todos os gateways. Esta ação é auditada.',confirm_all_off:'Desativar monitoramento em TODAS as centrais? O worker deixará de sondar todos os gateways. Esta ação é auditada.',bulk_done:'{n} central(is) atualizada(s)',devices_list:'Dispositivos',loading:'Carregando',filters_btn:'Filtros',filters_title:'Filtros e ordenação',filters_active:'{n} ativo(s)',settings_title:'Configurações',f_sort:'Ordenar por',sort_name_asc:'Nome A→Z',sort_name_desc:'Nome Z→A',sort_offline_desc:'Offline há mais tempo',sort_offline_asc:'Offline há menos tempo',sort_sync_desc:'Último sync: mais recente',sort_sync_asc:'Último sync: mais antigo',sort_dev_desc:'Mais dispositivos',sort_dev_asc:'Menos dispositivos',f_scope:'Escopo',scope_monitored:'Monitoradas',scope_all:'Todas',scope_unmonitored:'Não monitoradas',f_name:'Nome contém',f_name_ph:'nome ou UUID (ignora maiúsc.)',f_status:'Status',f_lastsync:'Último sync',ls_any:'Qualquer',ls_1h:'Na última 1h',ls_24h:'Nas últimas 24h',ls_over24h:'Há mais de 24h',ls_never:'Nunca sincronizou',f_devices:'Dispositivos (mín–máx)',f_divergent:'Só com divergência',f_apply:'Aplicar',f_clear:'Limpar',f_grace:'Janela de graça p/ OFFLINE (min)',f_grace_hint:'Override apenas de exibição, salvo neste navegador. O worker continua usando o env ORCH_DEVICES_OFFLINE_GRACE_MIN (default {d} min). Muda como este cockpit deriva ONLINE/ATENÇÃO/OFFLINE.',f_save:'Salvar',f_reset_default:'Voltar ao padrão',uuid:'UUID',grace_lbl:'graça OFFLINE'},
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
  function applyTheme(mode){ if(mode==='dark'){document.documentElement.setAttribute('data-theme','dark'); $('themeBtn').textContent='☀️'; $('themeBtn').title=t('light');}
    else{document.documentElement.removeAttribute('data-theme'); $('themeBtn').textContent='🌙'; $('themeBtn').title=t('dark');} }
  function toggleTheme(){ const next = document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    try{ localStorage.setItem('od-theme',next); }catch(e){} applyTheme(next); }
  try{ applyTheme(localStorage.getItem('od-theme')||'light'); }catch(e){ applyTheme('light'); }
  function showHelp(){ $('help-modal').classList.remove('hidden'); }
  function hideHelp(){ $('help-modal').classList.add('hidden'); }
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ hideHelp(); closeFilters(); closeSettings(); } });
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
    if(await validate(val)){ pw=val; sessionStorage.setItem('odpw',pw); $('loginErr').classList.remove('show'); setConnected(true); ensureLibThen(load); }
    else { $('loginErr').classList.add('show'); $('pw').value=''; $('pw').focus(); }
  }
  function logout(){ pw=''; sessionStorage.removeItem('odpw'); $('pw').value=''; $('loginErr').classList.remove('show'); $('err').style.display='none'; setConnected(false); $('pw').focus(); }
  async function api(path){
    const r = await fetch('/admin/orchestrator-devices/api/'+path,{headers:{'x-admin-password':pw}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));
    return r.json();
  }
  async function apiSend(path,method){
    const r = await fetch('/admin/orchestrator-devices/api/'+path,{method:method,headers:{'x-admin-password':pw}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));
    return r.json();
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function ageStr(ms){ if(ms==null)return '—'; const s=Math.round(ms/1000); if(s<90)return s+'s'; const m=Math.round(s/60); if(m<90)return m+'m'; const h=Math.round(m/60); return h<48?h+'h':Math.round(h/24)+'d'; }
  function ago(iso){ if(!iso)return '—'; return ageStr(Date.now()-new Date(iso).getTime()); }
  function dt(iso){ if(!iso)return '—'; const d=new Date(iso); if(isNaN(d.getTime()))return String(iso); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  function onoff(v){ return v?'on':'off'; }
  // total · online · offline · unknown — offline is the REAL OFFLINE count (device down);
  // unknown is the remainder (mostly CENTRAL_UNREACHABLE cascade suppression), NOT offline.
  function devStat(c){ var tot=c.device_count||0, on=c.device_online||0, off=c.device_offline||0; var unk=Math.max(0,tot-on-off);
    var sep='<span class="vsep"></span>';
    return '<b>'+tot+'</b>'+sep+
      '<span class="dot on" title="online"></span>'+on+sep+
      '<span class="dot off" title="offline"></span>'+off+sep+
      '<span class="dot unk" title="unknown"></span>'+unk; }
  function tbl(el, cols, rows, cell){ el.innerHTML='<tr>'+cols.map(c=>'<th>'+t('col_'+c)+'</th>').join('')+'</tr>'+
    rows.map(r=>'<tr>'+cols.map(c=>'<td>'+cell(r,c)+'</td>').join('')+'</tr>').join(''); }
  // Grace window: server env default (injected) + optional per-browser display override.
  // The override only changes how THIS cockpit derives ONLINE/WARNING/OFFLINE; the worker
  // keeps using its ORCH_DEVICES_OFFLINE_GRACE_MIN env for the canonical decision.
  var OFFLINE_GRACE_DEFAULT_MIN=(__OFFLINE_GRACE_MIN__);
  var graceMin=OFFLINE_GRACE_DEFAULT_MIN;
  var OFFLINE_GRACE_MS=graceMin*60000;
  function loadSettings(){ try{ var v=parseInt(localStorage.getItem('od-grace-min'),10); if(!isNaN(v)&&v>0) graceMin=v; }catch(e){} OFFLINE_GRACE_MS=graceMin*60000; }
  function saveSettings(v){ graceMin=(v&&v>0)?v:OFFLINE_GRACE_DEFAULT_MIN; OFFLINE_GRACE_MS=graceMin*60000;
    try{ if(graceMin===OFFLINE_GRACE_DEFAULT_MIN) localStorage.removeItem('od-grace-min'); else localStorage.setItem('od-grace-min',String(graceMin)); }catch(e){} updateGraceInfo(); }
  function updateGraceInfo(){ var el=$('graceInfo'); if(el){ var ov=(graceMin!==OFFLINE_GRACE_DEFAULT_MIN)?' *':''; el.innerHTML='<b>'+t('grace_lbl')+':</b> '+graceMin+' min'+ov+' ⚙'; }
    var h=$('graceHint'); if(h) h.textContent=t('f_grace_hint').replace('{d}',OFFLINE_GRACE_DEFAULT_MIN); }
  let allRuns=[], runsExpanded=false, lastDiv={centrals:[],devices:[]}, allCentrals=[], cPage=0, kpiCardDone=false, centralsCardDone=false, monCardDone=false, dashIndCardDone=false, lastSyncsCardDone=false, autoLeft=10, cDivMap={}, devCache={};
  let cPageSize=10;
  // Unified centrals filter/sort state (persisted). statuses=[] ⇒ "all in scope";
  // a single status is what the KPI tiles toggle. Default scope = monitored centrals.
  var cSort='name_asc';
  var cFilter={ scope:'monitored', statuses:[], q:'', divergent:false, lastSync:'any', minDev:null, maxDev:null };
  function saveFilter(){ try{ localStorage.setItem('od-filter', JSON.stringify({ sort:cSort, filter:cFilter })); }catch(e){} }
  function loadFilter(){ try{ var s=JSON.parse(localStorage.getItem('od-filter')||'null'); if(s&&s.filter){ if(s.sort) cSort=s.sort; for(var k in cFilter){ if(s.filter[k]!==undefined) cFilter[k]=s.filter[k]; } } }catch(e){} }
  function setKpiFilter(f){
    if(f===''||f==='all'){ cFilter.statuses=[]; }
    else { cFilter.statuses = (cFilter.statuses.length===1 && cFilter.statuses[0]===f) ? [] : [f]; }
    cPage=0; saveFilter(); renderCentrals();
  }
  function setPageSize(v){ cPageSize=parseInt(v,10)||10; cPage=0; renderCentrals(); }
  function setTab(name){
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-tab')===name));
    document.querySelectorAll('.tabpanel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+name));
    try{ localStorage.setItem('od-tab',name); }catch(e){}
  }
  function statusCls(st){ return st==='ONLINE'?'on':(st==='OFFLINE'?'off':(st==='WARNING'?'warn':'unk')); }
  function kpiActive(fk){ if(fk===''||fk==='all') return cFilter.statuses.length===0; return cFilter.statuses.length===1 && cFilter.statuses[0]===fk; }
  function kpi(n,l,cls,fk){ fk=fk||''; const act=kpiActive(fk)?' active':'';
    return '<div class="kpi '+(cls||'')+act+'" onclick="setKpiFilter(\\''+fk+'\\')"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
  // Derived operational status from probe evidence (mirrors the worker's grace rule):
  //   never probed ⇒ UNKNOWN; last probe OK ⇒ ONLINE; a failing probe ⇒ WARNING until
  //   there has been no successful sync for OFFLINE_GRACE_MS, then OFFLINE.
  function effStatus(c){
    if(!c.monitoring_enabled && !c.last_gateway_check_at) return 'UNKNOWN';
    var r=c.probe_result;
    if(!r) return c.connection_status||'UNKNOWN';
    if(r==='OK') return 'ONLINE';
    var okAt=c.last_gateway_success_check_at?new Date(c.last_gateway_success_check_at).getTime():null;
    var since=okAt?(Date.now()-okAt):Infinity;
    return since>=OFFLINE_GRACE_MS ? 'OFFLINE' : 'WARNING';
  }
  function statusLabel(st){ return st==='ONLINE'?t('st_online'):st==='OFFLINE'?t('st_offline'):st==='WARNING'?t('st_warning'):t('st_unknown'); }
  function hasData(c){ return !!(c.monitoring_enabled || c.last_gateway_check_at || c.probe_result); }
  // Premium modals via MyIOLibrary UMD; degrade to native confirm()/alert() if the
  // CDN global is missing (it loads with defer and @latest floats — never assume it).
  async function confirmAction(o){
    var L=window.MyIOLibrary;
    if(L && typeof L.openConfirmDialog==='function'){
      try{
        var r=await L.openConfirmDialog({ title:o.title, message:o.message, buttons:[
          {label:t('btn_cancel'), variant:'secondary', value:'cancel'},
          {label:(o.danger?t('btn_off'):t('btn_on')), variant:(o.danger?'danger':'primary'), value:'ok', autoFocus:true}
        ]});
        return r==='ok';
      }catch(e){ /* fall back */ }
    }
    return confirm(o.message);
  }
  async function msgDialog(title,message){
    var L=window.MyIOLibrary;
    if(L && typeof L.openMessageDialog==='function'){
      try{ await L.openMessageDialog({ title:title, message:message }); return; }catch(e){}
    }
    alert(title+' '+message);
  }
  async function toggleMonitoring(id,inp){
    var c=allCentrals.find(function(x){return x.id===id;}); var name=c?(c.name||id):id;
    var next=inp.checked;
    var msg=(next?t('confirm_mon_on'):t('confirm_mon_off')).replace('{name}',name);
    var ok=await confirmAction({ title:(next?t('mon_on_title'):t('mon_off_title')), message:msg, danger:!next });
    if(!ok){ inp.checked=!next; return; }
    inp.disabled=true;
    try{
      await apiSend('centrals/'+encodeURIComponent(id)+'/monitoring?enabled='+next,'PATCH');
      if(c) c.monitoring_enabled=next;
      renderCentrals();
    }catch(e){ await msgDialog(t('toggle_err'), e.message); inp.checked=!next; inp.disabled=false; }
  }
  async function forceSync(id,btn){
    var c=allCentrals.find(function(x){return x.id===id;}); var name=c?(c.name||id):id;
    var ok=await confirmAction({ title:t('force_sync'), message:t('confirm_sync').replace('{name}',name), danger:false });
    if(!ok) return;
    btn.disabled=true; btn.classList.add('spin');
    try{
      var r=await apiSend('centrals/'+encodeURIComponent(id)+'/recheck','POST');
      var cc=allCentrals.find(function(x){return x.id===id;});
      if(cc){ var iso=(new Date()).toISOString(); cc.probe_result=r.probeResult; cc.last_gateway_check_latency_ms=r.latencyMs; cc.last_gateway_check_at=iso; if(r.reachable) cc.last_gateway_success_check_at=iso; }
      renderCentrals();
      // Evidence-only refresh: proposed_write/ledger/divergence/canonical are NOT recomputed here.
      await msgDialog(t('force_sync'), t('sync_done').replace('{result}', r.probeResult));
    }catch(e){ btn.classList.remove('spin'); btn.disabled=false; await msgDialog(t('sync_err'), e.message); }
  }
  function accentFor(c){ var s=effStatus(c); return s==='ONLINE'?'emerald':(s==='OFFLINE'?'rose':(s==='WARNING'?'amber':'slate')); }
  // Human verdict for the raw probe_result enum (OK/TIMEOUT/CONN_REFUSED/AUTH_ERROR/
  // CONFIG_ERROR/HTTP_5XX/PARSE_FAIL) — a user shouldn't have to decode enums.
  function probeVerdict(c){
    var r=c.probe_result, ms=c.last_gateway_check_latency_ms;
    if(!r) return {label:t('probe_never'), cls:'mut', ms:null};
    if(r==='OK'){ var slow=(ms!=null && ms>=3000); return {label:(slow?t('probe_ok_slow'):t('probe_ok')), cls:(slow?'warn':'ok'), ms:ms}; }
    var map={ TIMEOUT:['probe_timeout','bad'], CONN_REFUSED:['probe_conn','bad'], HTTP_5XX:['probe_http','bad'], PARSE_FAIL:['probe_parse','warn'], AUTH_ERROR:['probe_auth','warn'], CONFIG_ERROR:['probe_config','warn'] };
    var m=map[r]; if(m) return {label:t(m[0]), cls:m[1], ms:null};
    return {label:r, cls:'warn', ms:null};
  }
  function centralInfoHtml(c){
    var parts=['<b>'+t('uuid')+'</b> '+esc(c.id),'<b>status</b> '+effStatus(c),'<b>'+t('monitoring')+'</b> '+(c.monitoring_enabled?'on':'off')];
    if(hasData(c)){ parts.push('<b>'+t('probe')+'</b> '+esc(probeVerdict(c).label)); parts.push('<b>'+t('devices')+'</b> '+(c.device_count||0)); }
    return parts.join(' · ');
  }
  // Shared inner content — used by both the MyIOLibrary card body and the fallback.
  function centralBodyHtml(c){ var st=effStatus(c); var k=statusCls(st);
    var mon='<label class="switch" title="'+t('monitoring')+'"><input type="checkbox"'+(c.monitoring_enabled?' checked':'')+' onchange="toggleMonitoring(\\''+c.id+'\\',this)"><span class="track"><span class="knob"></span></span></label>';
    var sync=c.monitoring_enabled?' <button class="syncbtn" title="'+t('force_sync')+'" onclick="forceSync(\\''+c.id+'\\',this)">🔄</button>':'';
    var body='<div class="crow mon-row"><span class="k"><span class="ic">👁</span>'+t('monitoring')+sync+'</span>'+mon+'</div><hr class="csep">';
    if(!hasData(c)) return body+'<div class="nodata mut">'+t('no_data_off')+'</div>';
    var pv=probeVerdict(c);
    var probeTitle=esc((c.probe_result||'')+(c.last_gateway_check_latency_ms!=null?' · '+c.last_gateway_check_latency_ms+'ms':''));
    var dv=cDivMap[c.id];
    var divRow=dv?('<div class="crow" title="'+t('div_help')+'"><span class="k"><span class="ic">⚠️</span>'+t('div_one')+'</span>'+chip(esc(dv.current||'?')+' → '+esc(dv.proposed||'?'),'warn')+'</div>'):'';
    return body+
      '<div class="crow"><span class="k"><span class="ic">📡</span>status</span>'+chip(statusLabel(st),k==='on'?'ok':(k==='off'?'bad':(k==='warn'?'warn':'mut')))+'</div>'+
      divRow+
      '<div class="crow"><span class="k"><span class="ic">🕒</span>'+t('last_attempt')+'</span><span>'+dt(c.last_gateway_check_at)+' <span class="mut">('+ago(c.last_gateway_check_at)+')</span></span></div>'+
      '<div class="crow"><span class="k"><span class="ic">✅</span>'+t('last_success')+'</span><span>'+dt(c.last_gateway_success_check_at)+' <span class="mut">('+ago(c.last_gateway_success_check_at)+')</span></span></div>'+
      '<div class="crow"><span class="k"><span class="ic">📶</span>'+t('probe')+'</span><span title="'+probeTitle+'">'+chip(pv.label,pv.cls)+(pv.ms!=null?' <span class="mut">'+pv.ms+'ms</span>':'')+'</span></div>'+
      '<div class="crow"><span class="k"><span class="ic">📟</span>'+t('devices')+' <span class="devinfo" data-cid="'+c.id+'" title="'+t('devices_list')+'">ⓘ</span></span><span class="dev-stat">'+devStat(c)+'</span></div>';
  }
  // Fallback string card (when MyIOLibrary.createDivCard is unavailable).
  function centralCard(c){ var st=effStatus(c); var k=statusCls(st);
    return '<div class="ccard '+k+'"><div class="cname" title="'+esc(c.name||c.id)+'">'+esc(c.name||c.id)+'</div><hr class="csep"><div class="cbody">'+centralBodyHtml(c)+'</div></div>';
  }
  function renderCentralsGrid(el, items){
    var L=window.MyIOLibrary;
    if(!items.length){ el.innerHTML='<div class="soon">—</div>'; return; }
    if(L && typeof L.createDivCard==='function'){
      el.innerHTML='';
      items.forEach(function(c){
        try{
          var card=L.createDivCard({ title:(c.name||c.id), accent:accentFor(c), infoHtml:centralInfoHtml(c), collapsible:false, maximizable:false });
          card.body.innerHTML='<div class="cbody">'+centralBodyHtml(c)+'</div>';
          el.appendChild(card.element);
        }catch(e){ el.insertAdjacentHTML('beforeend', centralCard(c)); }
      });
    } else {
      el.innerHTML = items.map(centralCard).join('');
    }
    attachDevTips();
  }
  // InfoTooltip (RFC-0105) on the DEVICES (i) — lists all devices A→Z with status.
  function devTipRow(x){ var s=x.connectivity_status||'UNKNOWN'; var cls=s==='ONLINE'?'ok':(s==='OFFLINE'?'bad':'mut');
    return '<div class="devtip-row"><span class="nm">'+esc(x.name||x.id)+'</span>'+chip(s,cls)+'</div>'; }
  function devTipOptions(id){
    var d=devCache[id]; var body, cnt='…';
    if(d===undefined||d==='loading') body='<div class="mut">'+t('loading')+'…</div>';
    else if(d==='error') body='<div class="mut">'+t('fetch_err')+'</div>';
    else if(Array.isArray(d)){ cnt=d.length; body=d.length?('<div class="devtip">'+d.map(devTipRow).join('')+'</div>'):'<div class="mut">—</div>'; }
    return { icon:'🖥️', title:t('devices_list')+' ('+cnt+')', content:body };
  }
  function attachDevTips(){
    var IT=window.MyIOLibrary && window.MyIOLibrary.InfoTooltip;
    if(!IT) return;
    document.querySelectorAll('.devinfo').forEach(function(el){
      if(el.__tip) return; el.__tip=true;
      var id=el.getAttribute('data-cid');
      IT.attach(el, function(){ return devTipOptions(id); });
      el.addEventListener('mouseenter', function(){
        if(id in devCache) return;
        devCache[id]='loading';
        api('centrals/'+encodeURIComponent(id)+'/devices')
          .then(function(r){ devCache[id]=r.devices||[]; try{ IT.show(el, devTipOptions(id)); }catch(e){} })
          .catch(function(){ devCache[id]='error'; try{ IT.show(el, devTipOptions(id)); }catch(e){} });
      });
    });
  }
  function cPageDelta(d){ cPage+=d; renderCentrals(); }
  function goCentrals(fk){ cFilter.statuses=(fk===''||fk==='all')?[]:[fk]; cPage=0; saveFilter(); setTab('centrals'); renderCentrals(); }
  // Dashboard "Indicadores de Status" card — wraps the indicator groups (Centrais now;
  // Dispositivos / OS to come), mirroring the CENTRAIS tab. Wrapped once.
  function ensureDashIndCard(){
    if(dashIndCardDone) return;
    var L=window.MyIOLibrary; var host=$('dashIndBody');
    if(!L || typeof L.createDivCard!=='function' || !host || !host.parentNode){ return; }
    try{
      var card=L.createDivCard({ title:t('dash_ind_centrals'), accent:'blue', collapsible:true, maximizable:false });
      host.parentNode.insertBefore(card.element, host);
      card.body.appendChild(host);
      dashIndCardDone=true;
    }catch(e){ /* keep bare groups */ }
  }
  function renderDashCentrals(){
    ensureDashIndCard();
    var el=$('dashCentralsKpis'); if(!el) return;
    var total=allCentrals.length;
    var on=allCentrals.filter(function(c){return effStatus(c)==='ONLINE';}).length;
    var off=allCentrals.filter(function(c){return effStatus(c)==='OFFLINE';}).length;
    var unk=allCentrals.filter(function(c){return effStatus(c)==='UNKNOWN';}).length;
    function dk(n,l,cls,fk){ return '<div class="kpi '+(cls||'')+'" onclick="goCentrals(\\''+fk+'\\')"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
    el.innerHTML = dk(total,t('kpi_total'),'','all')+dk(on,t('st_online'),'k-on','ONLINE')+dk(off,t('st_offline'),'k-off','OFFLINE')+dk(unk,t('st_unknown'),'k-unk','UNKNOWN');
  }
  function updateTabBadges(){
    var bc=$('badge-centrals'); if(bc) bc.textContent=allCentrals.length||'';
    var totalDev=allCentrals.reduce(function(s,c){return s+(c.device_count||0);},0);
    var bd=$('badge-devices'); if(bd) bd.textContent=totalDev||'';
    var bs=$('badge-scans'); if(bs) bs.textContent=(allRuns&&allRuns.length)||'';
  }
  // Wrap the KPI tile row in a MyIOLibrary card container (once). Tiles stay the
  // interactive filter; the card just gives them the same chrome as the grid cards.
  function ensureKpiCard(){
    if(kpiCardDone) return;
    var L=window.MyIOLibrary; var host=$('cKpis');
    if(!L || typeof L.createDivCard!=='function' || !host || !host.parentNode){ return; }
    try{
      var card=L.createDivCard({ title:t('kpi_card_title'), accent:'blue', collapsible:true, maximizable:false });
      host.parentNode.insertBefore(card.element, host);
      card.body.appendChild(host);
      kpiCardDone=true;
    }catch(e){ /* keep bare tiles */ }
  }
  // Wrap the centrals grid in a MyIOLibrary card container (once), like the KPIs.
  function ensureCentralsCard(){
    if(centralsCardDone) return;
    var L=window.MyIOLibrary; var host=$('centralsGrid'); var filt=$('cFilters');
    if(!L || typeof L.createDivCard!=='function' || !host || !host.parentNode){ return; }
    try{
      var card=L.createDivCard({ title:t('tab_centrals'), accent:'slate', collapsible:true, maximizable:false });
      var anchor=filt||host;
      anchor.parentNode.insertBefore(card.element, anchor);
      if(filt) card.body.appendChild(filt);   // search + count + hint inside the card
      card.body.appendChild(host);
      centralsCardDone=true;
    }catch(e){ /* keep bare grid */ }
  }
  function kpiActionsTile(){
    return '<div class="kpi kpi-actions"><div class="l">'+t('mon_card_title')+'</div>'+
      '<div class="acts"><button class="btn-on" onclick="bulkMonitoring(true)">'+t('mon_all_on')+'</button>'+
      '<button class="btn-off" onclick="bulkMonitoring(false)">'+t('mon_all_off')+'</button></div></div>';
  }
  async function bulkMonitoring(enabled){
    var msg=(enabled?t('confirm_all_on'):t('confirm_all_off'));
    var ok=await confirmAction({ title:(enabled?t('mon_all_on'):t('mon_all_off')), message:msg, danger:!enabled });
    if(!ok) return;
    try{
      var r=await apiSend('centrals/monitoring/bulk?enabled='+enabled,'PATCH');
      allCentrals.forEach(function(c){ c.monitoring_enabled=enabled; });
      renderCentrals();
      await msgDialog((enabled?t('mon_all_on'):t('mon_all_off')), t('bulk_done').replace('{n}', r.affected));
    }catch(e){ await msgDialog(t('toggle_err'), e.message); }
  }
  // ── Filters & sorting modal ──────────────────────────────────────────────────
  function updateFilterBadge(){
    var n=0;
    if(cFilter.scope!=='monitored') n++;
    if(cFilter.statuses.length) n++;
    if((cFilter.q||'').trim()) n++;
    if(cFilter.divergent) n++;
    if(cFilter.lastSync && cFilter.lastSync!=='any') n++;
    if(cFilter.minDev!=null || cFilter.maxDev!=null) n++;
    if(cSort!=='name_asc') n++;
    var b=$('fBadge'); if(b) b.textContent = n?('('+t('filters_active').replace('{n}',n)+')'):'';
    var btn=$('filtersBtn'); if(btn) btn.classList.toggle('has', n>0);
  }
  function openFilters(){
    $('mSort').value=cSort; $('mScope').value=cFilter.scope; $('mQ').value=cFilter.q||'';
    ['ONLINE','OFFLINE','WARNING','UNKNOWN'].forEach(function(s){ var e=$('mSt_'+s); if(e) e.checked=cFilter.statuses.indexOf(s)>=0; });
    $('mDiv').checked=!!cFilter.divergent; $('mLastSync').value=cFilter.lastSync||'any';
    $('mMinDev').value=(cFilter.minDev!=null?cFilter.minDev:''); $('mMaxDev').value=(cFilter.maxDev!=null?cFilter.maxDev:'');
    $('filters-modal').classList.remove('hidden');
  }
  function closeFilters(){ $('filters-modal').classList.add('hidden'); }
  function applyFilters(){
    cSort=$('mSort').value; cFilter.scope=$('mScope').value; cFilter.q=$('mQ').value;
    var sts=[]; ['ONLINE','OFFLINE','WARNING','UNKNOWN'].forEach(function(s){ if($('mSt_'+s).checked) sts.push(s); }); cFilter.statuses=sts;
    cFilter.divergent=$('mDiv').checked; cFilter.lastSync=$('mLastSync').value;
    var mn=parseInt($('mMinDev').value,10), mx=parseInt($('mMaxDev').value,10);
    cFilter.minDev=isNaN(mn)?null:mn; cFilter.maxDev=isNaN(mx)?null:mx;
    if($('cSearch')) $('cSearch').value=cFilter.q;
    cPage=0; saveFilter(); closeFilters(); renderCentrals();
  }
  function clearFilters(){
    cSort='name_asc'; cFilter={ scope:'monitored', statuses:[], q:'', divergent:false, lastSync:'any', minDev:null, maxDev:null };
    if($('cSearch')) $('cSearch').value=''; cPage=0; saveFilter(); openFilters(); renderCentrals();
  }
  // ── Settings modal (display-only grace override) ─────────────────────────────
  function openSettings(){ $('sGrace').value=graceMin; updateGraceInfo(); $('settings-modal').classList.remove('hidden'); }
  function closeSettings(){ $('settings-modal').classList.add('hidden'); }
  function applySettings(){ var v=parseInt($('sGrace').value,10); saveSettings(isNaN(v)?OFFLINE_GRACE_DEFAULT_MIN:v); closeSettings(); renderCentrals(); renderDashCentrals(); }
  function resetSettings(){ saveSettings(OFFLINE_GRACE_DEFAULT_MIN); $('sGrace').value=graceMin; renderCentrals(); renderDashCentrals(); }
  // Scope base = the fleet the KPIs and list operate over. Default: monitored centrals.
  function baseCentrals(){ var sc=cFilter.scope;
    return allCentrals.filter(function(c){ if(sc==='monitored') return !!c.monitoring_enabled; if(sc==='unmonitored') return !c.monitoring_enabled; return true; }); }
  function sinceSuccessMs(c){ var okAt=c.last_gateway_success_check_at?new Date(c.last_gateway_success_check_at).getTime():null; return okAt?(Date.now()-okAt):Infinity; }
  function lastSyncMs(c){ var s=c.last_gateway_success_check_at||c.last_gateway_check_at; return s?new Date(s).getTime():0; }
  function passLastSync(c){ var w=cFilter.lastSync; if(!w||w==='any') return true;
    if(w==='never') return !c.last_gateway_success_check_at;
    var s=lastSyncMs(c); var age=s?(Date.now()-s):Infinity;
    if(w==='1h') return age<=3600000; if(w==='24h') return age<=86400000; if(w==='over24h') return age>86400000; return true; }
  function sortCentrals(arr){ var BIG=8640000000000000; // never-synced OFFLINE ⇒ top of "offline longest"
    function nm(c){ return String(c.name||c.id||'').toLowerCase(); }
    function offMs(c){ if(effStatus(c)!=='OFFLINE') return -1; var s=sinceSuccessMs(c); return s===Infinity?BIG:s; }
    var f={ name_asc:function(a,b){return nm(a).localeCompare(nm(b));}, name_desc:function(a,b){return nm(b).localeCompare(nm(a));},
      offline_desc:function(a,b){return offMs(b)-offMs(a);}, offline_asc:function(a,b){return offMs(a)-offMs(b);},
      sync_desc:function(a,b){return lastSyncMs(b)-lastSyncMs(a);}, sync_asc:function(a,b){return lastSyncMs(a)-lastSyncMs(b);},
      dev_desc:function(a,b){return (b.device_count||0)-(a.device_count||0);}, dev_asc:function(a,b){return (a.device_count||0)-(b.device_count||0);} };
    return arr.slice().sort(f[cSort]||f.name_asc); }
  function renderCentrals(){
    const el=$('centralsGrid'); if(!el)return;
    ensureKpiCard(); ensureCentralsCard();
    const base=baseCentrals();
    const total=base.length;
    const on=base.filter(c=>effStatus(c)==='ONLINE').length;
    const off=base.filter(c=>effStatus(c)==='OFFLINE').length;
    const warn=base.filter(c=>effStatus(c)==='WARNING').length;
    const unk=base.filter(c=>effStatus(c)==='UNKNOWN').length;
    const divIds=new Set((lastDiv.centrals||[]).map(x=>x.id));
    cDivMap={}; (lastDiv.centrals||[]).forEach(function(x){ cDivMap[x.id]={current:x.current, proposed:x.proposed}; });
    if($('cKpis')) $('cKpis').innerHTML = kpi(total,t('kpi_total'),'','all')+kpi(on,t('st_online'),'k-on','ONLINE')+kpi(off,t('st_offline'),'k-off','OFFLINE')+kpi(warn,t('st_warning'),'k-warn','WARNING')+kpi(unk,t('st_unknown'),'k-unk','UNKNOWN')+kpiActionsTile();
    const q=(cFilter.q||'').trim().toLowerCase();
    const sts=cFilter.statuses;
    var list=base.filter(function(c){
      if(sts.length && sts.indexOf(effStatus(c))<0) return false;
      if(cFilter.divergent && !divIds.has(c.id)) return false;
      if(!passLastSync(c)) return false;
      var dc=c.device_count||0;
      if(cFilter.minDev!=null && dc<cFilter.minDev) return false;
      if(cFilter.maxDev!=null && dc>cFilter.maxDev) return false;
      if(q){ var hay=(String(c.name||'')+' '+String(c.id||'')).toLowerCase(); if(hay.indexOf(q)<0) return false; }
      return true;
    });
    list=sortCentrals(list);
    updateFilterBadge(); updateGraceInfo();
    if($('cCount')) $('cCount').textContent = list.length+' / '+total;
    const pages=Math.max(1, Math.ceil(list.length/cPageSize));
    if(cPage>=pages) cPage=pages-1; if(cPage<0) cPage=0;
    const items=list.slice(cPage*cPageSize,(cPage+1)*cPageSize);
    renderCentralsGrid(el, items);
    if($('cPager')){
      const nav = pages>1 ? '<button onclick="cPageDelta(-1)"'+(cPage===0?' disabled':'')+'>‹</button> <span class="mut">'+t('page')+' '+(cPage+1)+' / '+pages+'</span> <button onclick="cPageDelta(1)"'+(cPage>=pages-1?' disabled':'')+'>›</button> ' : '';
      const sizeSel='<select id="cPageSize" name="cPageSize" onchange="setPageSize(this.value)">'+[10,20,50,100].map(n=>'<option value="'+n+'"'+(n===cPageSize?' selected':'')+'>'+n+' / '+t('page')+'</option>').join('')+'</select>';
      $('cPager').innerHTML = nav + sizeSel;
    }
  }
  function renderDevices(checks){
    const el=$('devicesGrid'); if(!el)return;
    const devs=(checks||[]).filter(c=>c.entity_type==='device');
    if(!devs.length){ el.innerHTML='<div class="soon">'+t('no_runs')+'</div>'; return; }
    const groups=new Map();
    devs.forEach(c=>{ const pw=c.proposed_write||{}; const key=(pw.connectivityStatus||'?')+' / '+(pw.healthStatus||'?')+(pw.unknownReason?' · '+pw.unknownReason:''); groups.set(key,(groups.get(key)||0)+1); });
    const arr=[...groups.entries()].sort((a,b)=>b[1]-a[1]);
    el.innerHTML=arr.map(function(e){ const k=statusCls(String(e[0]).split(' / ')[0]);
      return '<div class="ccard '+k+'"><div class="cname">'+esc(e[0])+'</div><div class="crow"><span class="k">'+t('devices')+'</span><span>'+e[1]+'</span></div></div>';
    }).join('');
  }
  function chip(txt,cls){ return '<span class="b '+(cls||'')+'">'+esc(txt)+'</span>'; }
  function prow(k,v){ return '<div class="row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }
  function posture(s){ const f=s.flags||{};
    if(!s.master) return {label:t('safe_idle'), cls:'ok'};
    if(f.canonical_writes_enabled && !f.shadow_mode) return {label:'CANONICAL', cls:'warn'};
    if(f.shadow_mode) return {label:'SHADOW', cls:'info'};
    return {label:'ACTIVE', cls:'info'};
  }
  function pill(label,on,goodWhenOff){ const cls=on?(goodWhenOff?'pill-warn':'pill-on'):'pill-off';
    return '<span class="pill '+cls+'">'+label+': '+(on?'on':'off')+'</span>'; }
  function renderStrip(s){ const f=s.flags||{}; const p=posture(s);
    $('strip').innerHTML =
      '<span class="posture '+p.cls+'">'+p.label+'</span>'+
      '<span class="strip-detail mut">MASTER '+(s.master?'on':'off')+' · shadow '+onoff(f.shadow_mode)+' · canonical '+onoff(f.canonical_writes_enabled)+' · incidents '+onoff(f.incident_emission_enabled)+'</span>'+
      '<span class="strip-right"><span class="'+(s.healthy?'ok':'bad')+'">'+t('worker')+' '+(s.healthy?t('val_healthy'):t('val_stale'))+'</span> <span class="mut">· '+t('last_tick')+' '+ageStr(s.ageMs)+'</span><br>'+
      '<span class="mut">'+s.enabledGateways+' '+t('gateways_enabled')+' · sanity '+(f.sanity_max_fleet_flip_pct==null?'?':f.sanity_max_fleet_flip_pct)+'% · debounce '+(f.incident_open_after_ticks==null?'?':f.incident_open_after_ticks)+'</span></span>';
  }
  function latestPanel(title, rows, accent){
    var L=window.MyIOLibrary;
    if(L && typeof L.createDivCard==='function'){
      var card=L.createDivCard({ title:title, accent:accent||'slate', collapsible:false, maximizable:false });
      card.body.innerHTML='<div class="cbody">'+rows+'</div>';
      return card.element;
    }
    var d=document.createElement('div'); d.className='panel';
    d.innerHTML='<h4>'+esc(title)+'</h4>'+rows;
    return d;
  }
  // Wrap the "Last syncs" grid in a MyIOLibrary card (once), like CENTRAIS.
  function ensureLastSyncsCard(){
    if(lastSyncsCardDone) return;
    var L=window.MyIOLibrary; var host=$('lastSyncs');
    if(!L || typeof L.createDivCard!=='function' || !host || !host.parentNode){ return; }
    try{
      var card=L.createDivCard({ title:t('last_syncs'), accent:'blue', collapsible:true, maximizable:false });
      host.parentNode.insertBefore(card.element, host);
      card.body.appendChild(host);
      lastSyncsCardDone=true;
    }catch(e){ /* keep bare grid */ }
  }
  // Top group: the 5 most-recently-synced centrals, rendered exactly like CENTRAIS.
  function renderLastSyncs(){
    ensureLastSyncsCard();
    var el=$('lastSyncs'); if(!el) return;
    var items=allCentrals.filter(function(c){return c.last_gateway_check_at;})
      .slice().sort(function(a,b){ return new Date(b.last_gateway_check_at).getTime()-new Date(a.last_gateway_check_at).getTime(); })
      .slice(0,5);
    renderCentralsGrid(el, items);
  }
  // Bottom group: one "Sync summary" card from the latest run.
  function renderSyncSummary(run){
    var el=$('syncSummary'); if(!el) return;
    if(!run){ el.innerHTML=''; return; }
    var n=run.notes||{}; var inc=n.incidents||{};
    var rows=prow('<span class="ic">⚙️</span>'+t('col_mode'), '<span class="mode-'+(n.mode||'shadow')+'">'+esc(n.mode||'—')+'</span>')+
      prow('<span class="ic">📟</span>'+t('suppressed'), esc(n.deviceTotal==null?'—':n.deviceTotal)+' <span class="mut">CENTRAL_UNREACHABLE</span>')+
      prow('<span class="ic">💾</span>'+t('canon_writes'), esc(n.applied==null?0:n.applied))+
      prow('<span class="ic">🚨</span>'+t('inc_candidates'), esc(inc.candidates==null?0:inc.candidates)+' <span class="mut">('+(inc.disabled||0)+' disabled / '+(inc.dryRun||0)+' dry / '+(inc.posted||0)+' posted)</span>')+
      prow('<span class="ic">🛡️</span>sanity', (n.sanity&&n.sanity.held)?chip('HELD','bad'):chip('ok','ok'));
    el.innerHTML='';
    el.appendChild(latestPanel(t('sync_summary'), rows, 'slate'));
  }
  function renderDivergence(d, checks){
    d=d||{}; checks=checks||[];
    const cs=(d.centrals||[]), dv=(d.devices||[]); const total=cs.length+dv.length;
    if(total===0){ $('divPanel').innerHTML='<div class="alert calm">'+t('no_div')+'</div>'; return; }
    const info={}; // per-central probe + last observed, from the most recent check
    checks.forEach(c=>{ const id=c.central_id; if(!id||info[id])return; const inp=c.input||{}; info[id]={probe:inp.gatewayStatus||inp.kind||'', at:c.created_at}; });
    const ph2b=' disabled title="'+t('phase2b')+'"';
    let h='<div class="alert"><div class="big">'+total+' '+t('div_one')+'</div>';
    cs.forEach(c=>{ const nfo=info[c.id]||{};
      h+='<div class="drow"><b>'+esc(c.name||c.id)+'</b> <span class="mut">central</span> '+chip(c.current,'ok')+' <span class="arrow">→</span> '+chip(c.proposed,'bad')+
        (nfo.probe?' '+chip(String(nfo.probe).replace('probe:',''),'mut'):'')+
        (nfo.at?' <span class="mut">· '+t('last_observed')+' '+ago(nfo.at)+'</span>':'')+
        ' <button'+ph2b+'>'+t('recheck_now')+'</button> <button'+ph2b+'>'+t('enable_canonical')+'</button></div>';
    });
    dv.forEach(x=>{ h+='<div class="drow"><b>'+esc(x.name||x.id)+'</b> <span class="mut">device</span> '+chip(x.current,'ok')+' <span class="arrow">→</span> '+chip(x.proposed,'bad')+'</div>'; });
    $('divPanel').innerHTML=h+'</div>';
  }
  function renderRuns(){
    const rows = runsExpanded ? allRuns : allRuns.slice(0,5);
    tbl($('runs'),['started','monitor','mode','scanned','changed','failures','applied','audited','incidents'],rows,(r,c)=>{
      const n=r.notes||{}; const inc=n.incidents||{};
      if(c==='started')return esc((r.started_at||'').toString().slice(0,19).replace('T',' '));
      if(c==='mode'){const m=n.mode||'—';return '<span class="mode-'+m+'">'+esc(m)+'</span>';}
      if(c==='applied')return esc(n.applied==null?0:n.applied);
      if(c==='audited')return esc(n.audited==null?0:n.audited);
      if(c==='incidents')return esc(inc.candidates==null?0:inc.candidates);
      if(c==='monitor')return esc(r.monitor);
      return esc(r[c]);
    });
    const b=$('runsMore');
    if(allRuns.length>5){ b.style.display='inline-block'; b.textContent = runsExpanded ? t('less') : t('more')+' ('+allRuns.length+')'; }
    else b.style.display='none';
  }
  function toggleRuns(){ runsExpanded=!runsExpanded; renderRuns(); }
  function toggleGrp(i){ const d=$('gd'+i), c=$('ca'+i); if(!d)return; const open=d.style.display==='none'; d.style.display=open?'':'none'; if(c)c.textContent=open?'▾':'▸'; }
  function renderGroupedChecks(checks){
    const groups=new Map();
    checks.forEach(c=>{ const pw=c.proposed_write||{}, inp=c.input||{};
      const reason=pw.unknownReason||''; const signal=inp.gatewayStatus||inp.kind||(inp.ok===false?'probe-fail':'');
      const key=(c.central_name||c.central_id)+'|'+c.computed_state+'|'+reason+'|'+signal;
      let g=groups.get(key); if(!g){ g={central:c.central_name||c.central_id||'—',state:c.computed_state,reason:reason,signal:signal,items:[]}; groups.set(key,g); }
      g.items.push(c);
    });
    const arr=[...groups.values()].sort((a,b)=>b.items.length-a.items.length);
    const el=$('checks');
    if(arr.length===0){ el.innerHTML='<tr><td class="mut">—</td></tr>'; return; }
    el.innerHTML='<tr><th></th><th>Central</th><th>'+t('devices')+'</th><th>'+t('col_state')+'</th><th>'+t('col_reason')+'</th><th>'+t('col_signal')+'</th></tr>'+
      arr.map((g,i)=>{
        const head='<tr class="grp" onclick="toggleGrp('+i+')"><td><span class="caret" id="ca'+i+'">▸</span></td><td>'+esc(g.central)+'</td><td>'+g.items.length+'</td><td>'+esc(g.state)+'</td><td>'+(g.reason?chip(g.reason,'mut'):'')+'</td><td>'+esc(g.signal)+'</td></tr>';
        const detail='<tr class="grp-detail" id="gd'+i+'" style="display:none"><td colspan="6">'+
          g.items.slice(0,200).map(c=>{ const pw=c.proposed_write||{};
            return '<div class="chips">'+esc(c.device_name||c.entity_id)+' — '+chip('conn '+(pw.connectivityStatus||'?'))+chip('health '+(pw.healthStatus||'?'))+(pw.unknownReason?chip(pw.unknownReason,'mut'):'')+(c.latency_ms!=null?' <span class="mut">'+c.latency_ms+'ms</span>':'')+' <details style="display:inline-block;vertical-align:middle"><summary class="mut">raw</summary><code>'+esc(JSON.stringify(pw))+'</code></details></div>';
          }).join('')+(g.items.length>200?'<div class="mut">… +'+(g.items.length-200)+'</div>':'')+'</td></tr>';
        return head+detail;
      }).join('');
  }
  // The myio lib loads deferred, so it may not be ready for the very first render
  // (would flash the fallback layout). Wait up to ~3s for it before the first load.
  var libWaited=false;
  function ensureLibThen(cb){
    if(libWaited || (window.MyIOLibrary && window.MyIOLibrary.createDivCard)){ libWaited=true; cb(); return; }
    var tries=30;
    (function w(){
      if((window.MyIOLibrary && window.MyIOLibrary.createDivCard) || tries<=0){ libWaited=true; cb(); return; }
      tries--; setTimeout(w,100);
    })();
  }
  async function load(){
    $('err').style.display='none';
    devCache={}; // refresh device-tooltip lists each cycle
    try{
      const s=await api('summary'); renderStrip(s);
      allRuns=(await api('runs?limit=50')).runs||[]; renderRuns();
      lastDiv = await api('divergence');
      allCentrals=(await api('centrals')).centrals||[]; renderCentrals();
      renderDashCentrals(); updateTabBadges();
      await loadChecks(); // renders latest scan + grouped checks + divergence + devices
      autoLeft=10; // realign the countdown to the last successful load
    }catch(e){ $('err').textContent=t('fetch_err'); $('err').style.display='inline'; }
  }
  async function loadChecks(){
    const q=new URLSearchParams();
    if($('fCentral').value)q.set('centralId',$('fCentral').value.trim());
    if($('fCustomer').value)q.set('customerId',$('fCustomer').value.trim());
    if($('fReason').value)q.set('reason',$('fReason').value.trim());
    if($('fState').value)q.set('state',$('fState').value.trim());
    q.set('limit','500');
    let checks=(await api('checks?'+q.toString())).checks||[];
    // Default: latest run only. "include history" keeps the full recent window.
    if(!$('fHistory').checked && allRuns[0] && allRuns[0].started_at){
      const t0=new Date(allRuns[0].started_at).getTime();
      checks=checks.filter(c=>new Date(c.created_at).getTime()>=t0);
    }
    renderLastSyncs();
    renderSyncSummary(allRuns[0]);
    renderGroupedChecks(checks);
    renderDevices(checks);
  }
  loadSettings(); loadFilter();
  try{ if($('cSearch')) $('cSearch').value=cFilter.q||''; }catch(e){}
  updateGraceInfo();
  applyLang();
  try{ setTab(localStorage.getItem('od-tab')||'dashboard'); }catch(e){ setTab('dashboard'); }
  (async function initAuth(){
    const stored = sessionStorage.getItem('odpw')||'';
    if(stored && await validate(stored)){ pw=stored; setConnected(true); ensureLibThen(load); }
    else { setConnected(false); $('pw').focus(); }
  })();
  setInterval(()=>{
    var el=$('autoCount');
    if(!(pw && $('auto').checked)){ if(el) el.textContent=''; return; }
    autoLeft--;
    if(autoLeft<=0){ autoLeft=10; load(); }
    if(el) el.textContent=t('auto_in').replace('{s}',autoLeft);
  },1000);
  // Fix transient narrow layout: the Nunito web-font swaps in after the first
  // layout and can leave CSS-grid tracks stale until a reflow (a manual window
  // resize is what "fixes" it). Force one reflow once the fonts finish loading.
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(function(){ document.body.style.display='none'; void document.body.offsetHeight; document.body.style.display=''; }); }
</script>
</body></html>`;

export { router as orchestratorDevicesAdminController };
