// =============================================================================
// CENTRAL_OFFLINE episode emission (RFC-0036 / ED-1233) — replaces the old
// /incidents/candidates path (which is the NO_CONSUMPTION contract) with the
// central-scoped /incidents/episodes contract: a down report opens/keeps an
// episode, a recover() closes it when the central is back online.
//
// Durability is the point (per review): recovery must survive HTTP failures and
// worker restarts, so we keep a per-central intent row (0077) and RECONCILE it
// every tick instead of firing only on the down→online edge — a failed recover
// is retried until ALARMS confirms it. `observedAt` for a pending action is
// PRESERVED across retries (never recomputed to "now") so an HTTP retry re-sends
// the same observation. The offline threshold is the caller's (verdict.pastOffline
// over ORCH_DEVICES_CENTRAL_OFFLINE_MIN) — never hard-coded here.
// =============================================================================
import { eq, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/database/drizzle/db';
import { orchestratorDevicesCentralEpisodes as episodes } from '../../infrastructure/database/drizzle/schema';

/** One central's connectivity signal for this tick (derived from the verdict). */
export interface EpisodeSignal {
  centralId: string;
  tenantId: string;
  customerId: string | null;
  pastOffline: boolean; // genuine down AND ≥ the configured offline window
  online: boolean;      // last probe OK (reachable)
  lastSuccessAt: Date | null;
}

export interface EpisodeEmitConfig {
  emissionEnabled: boolean;
  apiUrl?: string;   // ALARMS base incl. /api/v1
  apiToken?: string; // X-API-Key
  source: string;    // attribution, e.g. 'gcdr-orchestrator-devices'
  severity?: 'HIGH' | 'CRITICAL';
}

export interface EpisodeReconcileResult {
  opened: number; reposted: number; recovered: number; failed: number; skipped: number;
}

type Logger = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
type EpisodeRow = typeof episodes.$inferSelect;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const iso = (d: Date): string => d.toISOString(); // ends in 'Z' — a valid ISO offset

// ── HTTP (never throws; the sweep must not fail on a flaky ALARMS) ────────────

interface DownResult { ok: boolean; created?: boolean; episodeId?: string; error?: string }
interface RecoverResult { ok: boolean; notFound?: boolean; alreadyRecovered?: boolean; stale?: boolean; error?: string }

function headers(config: EpisodeEmitConfig): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiToken) h['x-api-key'] = config.apiToken; // M2M key (never logged)
  return h;
}

async function postDown(
  p: { customerId: string; centralId: string; observedAt: string; lastHeartbeatAt: string | null; episodeId: string | null },
  config: EpisodeEmitConfig,
): Promise<DownResult> {
  try {
    const body: Record<string, unknown> = {
      kind: 'CENTRAL_OFFLINE',
      source: config.source,
      evidence: 'HEARTBEAT_LOSS', // matrix: CENTRAL_OFFLINE only accepts this
      customerId: p.customerId,
      centralId: p.centralId,
      severity: config.severity ?? 'HIGH',
      observedAt: p.observedAt,
    };
    if (p.lastHeartbeatAt) body.lastHeartbeatAt = p.lastHeartbeatAt;
    if (p.episodeId) body.episodeId = p.episodeId;
    const res = await fetch(`${config.apiUrl!.replace(/\/$/, '')}/incidents/episodes`, {
      method: 'POST', headers: headers(config), body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as { episodeId?: string; created?: boolean };
    return { ok: true, created: !!j.created, episodeId: j.episodeId };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

async function postRecover(episodeId: string, observedAt: string, config: EpisodeEmitConfig): Promise<RecoverResult> {
  try {
    const res = await fetch(`${config.apiUrl!.replace(/\/$/, '')}/incidents/episodes/${encodeURIComponent(episodeId)}/recover`, {
      method: 'POST', headers: headers(config), body: JSON.stringify({ source: config.source, observedAt }),
    });
    if (res.status === 404) return { ok: false, notFound: true };       // episode gone → nothing to recover
    if (res.status === 409) return { ok: false, stale: true, error: 'HTTP 409' }; // RECOVERY_STALE — retry newer
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as { alreadyRecovered?: boolean };
    return { ok: true, alreadyRecovered: !!j.alreadyRecovered };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

// ── State machine (per central) ───────────────────────────────────────────────

async function handleDown(sig: EpisodeSignal, row: EpisodeRow | undefined, config: EpisodeEmitConfig, res: EpisodeReconcileResult): Promise<void> {
  if (!sig.customerId) { res.skipped++; return; } // episode requires a customer scope

  // Preserve the observation on an HTTP retry (phase DOWN, last attempt failed);
  // otherwise this is a NEW "still down" observation → stamp now.
  const retrying = !!row && row.phase === 'DOWN' && !row.synced;
  const observedAt = retrying ? iso(row!.observedAt) : iso(new Date());
  // lastHeartbeat is write-once at open; a DOWN→DOWN keeps it, a fresh episode takes lastSuccess.
  const lastHeartbeatAt = row && row.phase === 'DOWN'
    ? (row.lastHeartbeatAt ? iso(row.lastHeartbeatAt) : null)
    : (sig.lastSuccessAt ? iso(sig.lastSuccessAt) : null);
  // Reuse the episode id only inside the same DOWN streak; a DOWN after a RECOVER is a new episode.
  const episodeId = row && row.phase === 'DOWN' ? row.episodeId : null;

  // Durable intent BEFORE the network call.
  await db.insert(episodes).values({
    centralId: sig.centralId, tenantId: sig.tenantId, customerId: sig.customerId,
    kind: 'CENTRAL_OFFLINE', episodeId, phase: 'DOWN',
    observedAt: new Date(observedAt), lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt) : null,
    synced: false,
  }).onConflictDoUpdate({
    target: episodes.centralId,
    set: {
      phase: 'DOWN', observedAt: new Date(observedAt),
      lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt) : null,
      episodeId, synced: false, updatedAt: new Date(),
    },
  });

  const r = await postDown({ customerId: sig.customerId, centralId: sig.centralId, observedAt, lastHeartbeatAt, episodeId }, config);
  if (r.ok) {
    await db.update(episodes).set({ episodeId: r.episodeId ?? episodeId, synced: true, lastError: null, updatedAt: new Date() })
      .where(eq(episodes.centralId, sig.centralId));
    if (r.created) res.opened++; else res.reposted++;
  } else {
    await db.update(episodes).set({ synced: false, attempts: sql`${episodes.attempts} + 1`, lastError: r.error ?? null, updatedAt: new Date() })
      .where(eq(episodes.centralId, sig.centralId));
    res.failed++;
  }
}

async function handleOnline(sig: EpisodeSignal, row: EpisodeRow | undefined, config: EpisodeEmitConfig, res: EpisodeReconcileResult): Promise<void> {
  if (!row) return; // no open episode → nothing to do
  if (!row.episodeId) { // never opened on ALARMS → drop the intent
    await db.delete(episodes).where(eq(episodes.centralId, sig.centralId));
    return;
  }
  // Preserve the recover observation on retry; otherwise stamp the moment we saw it online.
  const retrying = row.phase === 'RECOVER' && !row.synced;
  const observedAt = retrying ? iso(row.observedAt) : iso(new Date());
  if (!retrying) {
    await db.update(episodes).set({ phase: 'RECOVER', observedAt: new Date(observedAt), synced: false, updatedAt: new Date() })
      .where(eq(episodes.centralId, sig.centralId));
  }

  const r = await postRecover(row.episodeId, observedAt, config);
  if (r.ok || r.notFound) {
    await db.delete(episodes).where(eq(episodes.centralId, sig.centralId)); // closed
    res.recovered++;
  } else if (r.stale) {
    // Later evidence said still-down; retry with a fresh (later) online stamp next tick.
    await db.update(episodes).set({ observedAt: new Date(), synced: false, attempts: sql`${episodes.attempts} + 1`, lastError: r.error ?? null, updatedAt: new Date() })
      .where(eq(episodes.centralId, sig.centralId));
    res.failed++;
  } else {
    await db.update(episodes).set({ synced: false, attempts: sql`${episodes.attempts} + 1`, lastError: r.error ?? null, updatedAt: new Date() })
      .where(eq(episodes.centralId, sig.centralId));
    res.failed++;
  }
}

/**
 * Drive CENTRAL_OFFLINE episodes for every central seen this sweep. Gated by the
 * incident-emission flag AND a configured ALARMS URL — when off, intent rows are
 * left untouched so reconciliation resumes cleanly once re-enabled.
 */
export async function reconcileCentralEpisodes(signals: EpisodeSignal[], config: EpisodeEmitConfig, log: Logger): Promise<EpisodeReconcileResult> {
  const res: EpisodeReconcileResult = { opened: 0, reposted: 0, recovered: 0, failed: 0, skipped: 0 };
  if (!config.emissionEnabled || !config.apiUrl) return res;

  const rows = (await db.select().from(episodes)) as EpisodeRow[];
  const byCentral = new Map(rows.map((r) => [r.centralId, r]));

  for (const sig of signals) {
    const row = byCentral.get(sig.centralId);
    try {
      if (sig.pastOffline) await handleDown(sig, row, config, res);
      else if (sig.online) await handleOnline(sig, row, config, res);
      else if (row) res.skipped++; // DEGRADED / indeterminate — leave the row as-is
    } catch (err) {
      res.failed++;
      log('warn', 'central episode reconcile error (sweep continues)', { centralId: sig.centralId, error: msg(err) });
    }
  }
  return res;
}
