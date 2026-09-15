import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/database/drizzle/db';
import { auditLogs } from '../infrastructure/database/drizzle/schema';

/**
 * Orchestrator-devices worker control (RFC-0062 §7) — JWT-authenticated ops API
 * to read and toggle the `orchestrator_devices_control` scopes from the /centrals
 * settings modal. Until now this table was managed only by direct SQL; these
 * endpoints put it behind auth + audit so ops can enable/disable a monitor
 * without a psql session.
 *
 * Mounted at /api/v1/orchestrator-devices/control behind
 * hybridAuthByMethod(centrals:read, centrals:write): GET needs centrals:read,
 * PATCH needs centrals:write. The FLAGS scope (shadow_mode / canonical_writes /
 * incidents) is READABLE here and PATCHable via `config`, but the UI keeps it
 * read-only — flipping canonical writes is a deliberate ops act, not a toggle.
 */
const router = Router();

// Scopes the worker reads at the top of every tick (control.ts:loadControl).
// RULES has no seeded row and defaults enabled; OS defaults disabled.
const ALL_SCOPES = new Set(['MASTER', 'CENTRALS', 'DEVICES', 'OS', 'RULES', 'FLAGS']);
const SCOPE_DEFAULT_ENABLED: Record<string, boolean> = {
  MASTER: true, CENTRALS: true, DEVICES: true, RULES: true, OS: false, FLAGS: true,
};

type Row = Record<string, unknown>;

function clientIp(req: Request): string {
  return String((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 45);
}

/**
 * GET /orchestrator-devices/control
 * Full scope table + a derived summary mirroring control.ts:loadControl.
 */
router.get('/control', async (_req: Request, res: Response) => {
  try {
    const rows = (await db.execute(sql`
      select scope, enabled, config, last_run_at, updated_at, updated_by
      from orchestrator_devices_control
      order by scope`)) as unknown as Row[];
    const byScope = new Map(rows.map((r) => [String(r.scope), r]));
    const enabledOf = (s: string) => {
      const r = byScope.get(s);
      return r ? Boolean(r.enabled) : SCOPE_DEFAULT_ENABLED[s] ?? true;
    };
    const flags = (byScope.get('FLAGS')?.config ?? {}) as Record<string, unknown>;
    res.json({
      scopes: rows.map((r) => ({
        scope: r.scope,
        enabled: Boolean(r.enabled),
        config: r.config ?? {},
        lastRunAt: r.last_run_at,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      })),
      summary: {
        masterEnabled: enabledOf('MASTER'),
        monitors: {
          centrals: enabledOf('CENTRALS'),
          devices: enabledOf('DEVICES'),
          os: enabledOf('OS'),
          rules: enabledOf('RULES'),
        },
        flags,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * PATCH /orchestrator-devices/control/:scope
 * Body: { enabled?: boolean, config?: object }  (config only on FLAGS; shallow-merged)
 * Upserts the row (so an unseeded scope like RULES can be materialized), captures
 * prev→new, and writes one audit row under the actor's tenant.
 */
type PatchBody = { enabled?: unknown; config?: unknown };
type ParsedPatch =
  | { ok: false; error: string }
  | { ok: true; hasEnabled: boolean; hasConfig: boolean };

/** Validate the PATCH body against the scope (extracted to keep the handler
 *  flat — see sonarjs/cognitive-complexity). */
function parsePatchBody(scope: string, body: PatchBody): ParsedPatch {
  const hasEnabled = typeof body.enabled === 'boolean';
  const hasConfig = typeof body.config === 'object' && body.config !== null && !Array.isArray(body.config);
  if (!hasEnabled && !hasConfig) {
    return { ok: false, error: 'nothing to update: provide `enabled` (boolean) and/or `config` (object)' };
  }
  if (hasConfig && scope !== 'FLAGS') {
    return { ok: false, error: '`config` can only be set on the FLAGS scope' };
  }
  return { ok: true, hasEnabled, hasConfig };
}

interface ControlChange {
  scope: string;
  hasConfig: boolean;
  configKeys: string[];
  nextEnabled: boolean;
  prevEnabled: boolean | null;
  prevConfig: Record<string, unknown>;
  nextConfig: Record<string, unknown>;
}

/** One audit row per control change (old→new) under the actor's tenant. */
async function writeControlAudit(req: Request, c: ControlChange): Promise<void> {
  const { tenantId, userId, requestId } = req.context;
  const description = c.hasConfig
    ? `Orchestrator-devices FLAGS updated (${c.configKeys.join(', ')}) via /centrals`.slice(0, 500)
    : `Orchestrator-devices monitor ${c.scope} ${c.nextEnabled ? 'ENABLED' : 'DISABLED'} via /centrals`.slice(0, 500);
  await db.insert(auditLogs).values({
    tenantId,
    eventType: c.hasConfig
      ? 'orchestrator_devices.control.flags_update'
      : 'orchestrator_devices.control.scope_toggle',
    eventCategory: 'ENTITY_CHANGE',
    auditLevel: 'STANDARD',
    description,
    action: 'UPDATE',
    entityType: 'orchestrator_devices_control',
    entityId: null,
    userId: userId ?? null,
    userEmail: req.user?.email ?? null,
    actorType: 'USER',
    oldValues: { enabled: c.prevEnabled, config: c.hasConfig ? c.prevConfig : undefined },
    newValues: { enabled: c.nextEnabled, config: c.hasConfig ? c.nextConfig : undefined },
    requestId: requestId ?? null,
    ipAddress: clientIp(req) || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    httpMethod: 'PATCH',
    httpPath: String(req.originalUrl || '').slice(0, 500),
    statusCode: 200,
    metadata: { source: 'centrals-settings', scope: c.scope },
  });
}

router.patch('/control/:scope', async (req: Request, res: Response) => {
  try {
    const scope = String(req.params.scope || '').toUpperCase();
    if (!ALL_SCOPES.has(scope)) {
      res.status(400).json({ error: `unknown scope '${scope}'` });
      return;
    }

    const body = (req.body ?? {}) as PatchBody;
    const parsed = parsePatchBody(scope, body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { hasEnabled, hasConfig } = parsed;
    const { userId } = req.context;

    // Read prev (for the audit old→new + config merge base).
    const prevRows = (await db.execute(sql`
      select enabled, config from orchestrator_devices_control where scope = ${scope}`)) as unknown as Row[];
    const prev = prevRows[0];
    const prevEnabled = prev ? Boolean(prev.enabled) : null;
    const prevConfig = (prev?.config ?? {}) as Record<string, unknown>;

    const nextEnabled = hasEnabled ? Boolean(body.enabled) : prevEnabled ?? SCOPE_DEFAULT_ENABLED[scope] ?? true;
    const nextConfig = hasConfig ? { ...prevConfig, ...(body.config as Record<string, unknown>) } : prevConfig;

    await db.execute(sql`
      insert into orchestrator_devices_control (scope, enabled, config, updated_at, updated_by)
      values (
        ${scope},
        ${nextEnabled},
        ${JSON.stringify(nextConfig)}::jsonb,
        now(),
        ${userId ? sql`${userId}::uuid` : sql`null`}
      )
      on conflict (scope) do update set
        enabled = excluded.enabled,
        config = excluded.config,
        updated_at = now(),
        updated_by = excluded.updated_by`);

    await writeControlAudit(req, {
      scope,
      hasConfig,
      configKeys: hasConfig ? Object.keys(body.config as object) : [],
      nextEnabled,
      prevEnabled,
      prevConfig,
      nextConfig,
    });

    res.json({ scope, enabled: nextEnabled, config: nextConfig });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /orchestrator-devices/runs?limit=25
 * Recent monitor sweeps (Varreduras tab) — the run ledger with its notes
 * (mode/applied/incidents/centralEpisodes/timeline). JWT centrals:read.
 */
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    const fromTsQ = Number(req.query.fromTs);
    const toTsQ = Number(req.query.toTs);
    const from = Number.isFinite(fromTsQ) ? new Date(fromTsQ).toISOString() : null;
    const to = Number.isFinite(toTsQ) ? new Date(toTsQ).toISOString() : null;
    const runs = (await db.execute(sql`
      select id, monitor, started_at, finished_at, scanned, changed, skipped, deferred, failures, notes
      from orchestrator_devices_runs
      where (${from}::timestamptz is null or started_at >= ${from}::timestamptz)
        and (${to}::timestamptz is null or started_at <= ${to}::timestamptz)
      order by started_at desc limit ${limit}`)) as unknown as Row[];
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /orchestrator-devices/divergence
 * Where the stored canonical status differs from what the last sweep proposed
 * (shadow ledger). Centrals + devices. JWT centrals:read.
 */
router.get('/divergence', async (_req: Request, res: Response) => {
  try {
    const centrals = (await db.execute(sql`
      select c.id, c.name, c.connection_status as current, k.proposed_write->>'connectionStatus' as proposed
      from orchestrator_devices_checks k join centrals c on c.id = k.entity_id
      where k.entity_type = 'central'
        and k.run_id = (select id from orchestrator_devices_runs where monitor='centrals' order by started_at desc limit 1)
        and c.connection_status::text is distinct from k.proposed_write->>'connectionStatus'
      limit 200`)) as unknown as Row[];
    const devices = (await db.execute(sql`
      select d.id, d.name, d.connectivity_status as current, k.proposed_write->>'connectivityStatus' as proposed,
             d.health_status as current_health, k.proposed_write->>'healthStatus' as proposed_health
      from orchestrator_devices_checks k join devices d on d.id = k.entity_id
      where k.entity_type = 'device'
        and k.run_id = (select id from orchestrator_devices_runs where monitor='centrals' order by started_at desc limit 1)
        and (d.connectivity_status::text is distinct from k.proposed_write->>'connectivityStatus'
             or d.health_status::text is distinct from k.proposed_write->>'healthStatus')
      limit 500`)) as unknown as Row[];
    res.json({ centrals, devices });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /orchestrator-devices/rule-mutes?limit=100
 * The NO_CONSUMPTION auto-mute ledger (Regras tab) — what the worker actually
 * muted/restored (active + recently restored). JWT centrals:read.
 */
router.get('/rule-mutes', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = (await db.execute(sql`
      select m.rule_id, m.device_id, m.reason, m.mode, m.today_count, m.max_daily, m.local_day, m.muted_at, m.restored_at,
             r.name as rule_name, d.name as device_name
      from orchestrator_rule_mutes m
      left join rules r on r.id = m.rule_id
      left join devices d on d.id = m.device_id
      order by m.muted_at desc limit ${limit}`)) as unknown as Row[];
    const mutes = rows.map((m) => ({
      ruleId: String(m.rule_id), ruleName: (m.rule_name as string) || null,
      deviceId: String(m.device_id), deviceName: (m.device_name as string) || null,
      reason: m.reason, mode: m.mode, todayCount: m.today_count, maxDaily: m.max_daily,
      localDay: m.local_day, mutedAt: m.muted_at, restoredAt: m.restored_at,
      active: m.restored_at === null || m.restored_at === undefined,
    }));
    res.json({ activeMutes: mutes.filter((m) => m.active).length, mutes });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /orchestrator-devices/checks?entityType=device&limit=200&centralId=&state=
 * Recent per-check states from the shadow ledger (Dispositivos tab) — the latest
 * computed connectivity/health per device (or central). JWT centrals:read.
 */
router.get('/checks', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const entityType = req.query.entityType === 'central' || req.query.entityType === 'device' ? String(req.query.entityType) : null;
    const centralId = (req.query.centralId as string) || null;
    const statePattern = req.query.state ? `%${String(req.query.state)}%` : null;
    // Only the LATEST check per entity from the most recent centrals run.
    const checks = (await db.execute(sql`
      select distinct on (k.entity_type, k.entity_id)
             k.entity_type, k.entity_id, k.central_id, c.name as central_name,
             d.name as device_name, d.slave_id, coalesce(c.customer_id, d.customer_id) as customer_id,
             k.computed_state, k.proposed_write->>'unknownReason' as unknown_reason,
             k.caused_transition, k.latency_ms, k.created_at
      from orchestrator_devices_checks k
      left join centrals c on c.id = k.central_id
      left join devices d on (k.entity_type = 'device' and d.id = k.entity_id)
      where (${entityType}::text is null or k.entity_type = ${entityType})
        and (${centralId}::uuid is null or k.central_id = ${centralId}::uuid)
        and (${statePattern}::text is null or k.computed_state ilike ${statePattern})
      order by k.entity_type, k.entity_id, k.created_at desc
      limit ${limit}`)) as unknown as Row[];
    res.json({ checks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
