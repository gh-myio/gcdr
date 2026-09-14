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
router.get('/', async (_req: Request, res: Response) => {
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
router.patch('/:scope', async (req: Request, res: Response) => {
  try {
    const scope = String(req.params.scope || '').toUpperCase();
    if (!ALL_SCOPES.has(scope)) {
      res.status(400).json({ error: `unknown scope '${scope}'` });
      return;
    }

    const body = (req.body ?? {}) as { enabled?: unknown; config?: unknown };
    const hasEnabled = typeof body.enabled === 'boolean';
    const hasConfig = body.config != null && typeof body.config === 'object' && !Array.isArray(body.config);
    if (!hasEnabled && !hasConfig) {
      res.status(400).json({ error: 'nothing to update: provide `enabled` (boolean) and/or `config` (object)' });
      return;
    }
    if (hasConfig && scope !== 'FLAGS') {
      res.status(400).json({ error: '`config` can only be set on the FLAGS scope' });
      return;
    }

    const { tenantId, userId, requestId } = req.context;
    const actorEmail = req.user?.email ?? null;

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

    await db.insert(auditLogs).values({
      tenantId,
      eventType: hasConfig
        ? 'orchestrator_devices.control.flags_update'
        : 'orchestrator_devices.control.scope_toggle',
      eventCategory: 'ENTITY_CHANGE',
      auditLevel: 'STANDARD',
      description: hasConfig
        ? `Orchestrator-devices FLAGS updated (${Object.keys(body.config as object).join(', ')}) via /centrals`.slice(0, 500)
        : `Orchestrator-devices monitor ${scope} ${nextEnabled ? 'ENABLED' : 'DISABLED'} via /centrals`.slice(0, 500),
      action: 'UPDATE',
      entityType: 'orchestrator_devices_control',
      entityId: null,
      userId: userId ?? null,
      userEmail: actorEmail,
      actorType: 'USER',
      oldValues: { enabled: prevEnabled, config: hasConfig ? prevConfig : undefined },
      newValues: { enabled: nextEnabled, config: hasConfig ? nextConfig : undefined },
      requestId: requestId ?? null,
      ipAddress: clientIp(req) || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      httpMethod: 'PATCH',
      httpPath: String(req.originalUrl || '').slice(0, 500),
      statusCode: 200,
      metadata: { source: 'centrals-settings', scope },
    });

    res.json({ scope, enabled: nextEnabled, config: nextConfig });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
