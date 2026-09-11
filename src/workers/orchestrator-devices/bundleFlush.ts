// =============================================================================
// orchestrator-devices — best-effort alarm-bundle cache flush (RFC-0062 §11c)
//
// When Monitor D's canonical apply mutates rules.scope_entity_ids, the API keeps
// serving a STALE NO_CONSUMPTION bundle until its per-process in-memory cache TTL
// (300s) expires — the worker's own invalidateCache() only clears the WORKER's map,
// never the API process's. So after a commit we ask the API to flush, cross-process,
// via its authenticated HTTP endpoint:
//     DELETE {bundleFlushApiUrl}/customers/{customerId}/alarm-rules/bundle/cache
//
// Contract (agreed with product):
//   • BEST-EFFORT — a flush failure is LOGGED and NEVER undoes the committed
//     mute/restore. The 300s cache TTL is the guaranteed backstop.
//   • Grouped by customer — one call per affected (tenant,customer), de-duped.
//   • Short timeout + limited retries (config), so a slow/down API can't stall a tick.
//   • Absent URL/key ⇒ TTL-only mode: we skip the call and log it once.
//   • Single-replica only (docker-compose.dokploy.yml replicas=1). A multi-replica API
//     behind a load balancer would need shared/versioned invalidation instead — a
//     targeted flush would reach only one instance. Documented limitation, not handled.
// =============================================================================

import { workerConfig } from './config';

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;

export interface FlushTarget {
  tenantId: string;
  customerId: string;
}

export interface FlushOutcome {
  attempted: number;
  flushed: number;
  failed: number;
  mode: 'http' | 'ttl-only';
}

/** DELETE the bundle cache for one customer, with a bounded timeout. Returns ok/!ok
 *  (and the last error message) — NEVER throws. */
async function flushOne(customerId: string, apiBase: string, apiKey: string, timeoutMs: number): Promise<{ ok: boolean; err?: string }> {
  const url = `${apiBase.replace(/\/$/, '')}/customers/${customerId}/alarm-rules/bundle/cache`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(500, timeoutMs));
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }, // bundles:read (hybridAuth); never logged
      signal: ctl.signal,
    });
    // 200 (flushed) and 404 (nothing cached for this customer) are both "cache is clean".
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, err: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flush the alarm-bundle cache for every affected customer, best-effort.
 * De-dupes targets by customerId, retries each up to config.bundleFlushRetries,
 * logs any residual failure, and always resolves (never throws) so a flush problem
 * cannot roll back or block the canonical apply that already committed.
 */
export async function flushBundleCaches(targets: FlushTarget[], log: Logger): Promise<FlushOutcome> {
  // De-dupe by customer (a MUTE + RESTORE in the same tick can target the same customer).
  const byCustomer = new Map<string, string>(); // customerId -> tenantId (for logging)
  for (const t of targets) {
    if (t.customerId) byCustomer.set(t.customerId, t.tenantId);
  }
  const customerIds = [...byCustomer.keys()];

  const apiBase = workerConfig.bundleFlushApiUrl;
  const apiKey = workerConfig.bundleFlushApiKey;

  if (!apiBase || !apiKey) {
    if (customerIds.length > 0) {
      log('warn', 'bundle flush skipped — GCDR_API_URL/GCDR_BUNDLE_FLUSH_API_KEY unset; relying on 300s cache TTL', {
        customers: customerIds.length,
      });
    }
    return { attempted: customerIds.length, flushed: 0, failed: 0, mode: 'ttl-only' };
  }

  const maxAttempts = 1 + Math.max(0, workerConfig.bundleFlushRetries);
  let flushed = 0;
  const failures: { customerId: string; err?: string }[] = [];

  for (const customerId of customerIds) {
    let last: { ok: boolean; err?: string } = { ok: false };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      last = await flushOne(customerId, apiBase, apiKey, workerConfig.bundleFlushTimeoutMs);
      if (last.ok) break;
    }
    if (last.ok) flushed += 1;
    else failures.push({ customerId, err: last.err });
  }

  if (failures.length > 0) {
    // LOUD but non-fatal: the writes are already committed; TTL will clear these within 300s.
    log('warn', 'bundle flush failed for some customers — mute/restore already committed; 300s TTL is the backstop', {
      failed: failures.length,
      flushed,
      sample: failures.slice(0, 5),
    });
  } else if (flushed > 0) {
    log('info', 'bundle cache flushed', { customers: flushed });
  }

  return { attempted: customerIds.length, flushed, failed: failures.length, mode: 'http' };
}
