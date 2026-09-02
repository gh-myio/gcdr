// =============================================================================
// orchestrator-devices worker — /v2/slaves gateway client (RFC-0062 §4/§5)
//
// A 2xx is NOT truth. This client returns a discriminated ProbeOutcome across
// four layers (reached / valid payload / declared status / — freshness is the
// devices-monitor's job). It:
//   * validates the array with a TOLERANT Zod schema (required: id, status);
//     a bad slave row is skipped+counted, never aborts the array;
//   * whitelists nothing here — it passes `status` through verbatim (the
//     devices-monitor whitelists "online", §6);
//   * runs under a retry policy "book" and caps total wall-time;
//   * classifies failures into a taxonomy (§5): AUTH_ERROR (401/403) and
//     CONFIG_ERROR (NXDOMAIN) are deterministic and NOT retried; TIMEOUT /
//     CONN_REFUSED / HTTP_5XX / PARSE_FAIL are transient and retried.
// =============================================================================

import { z } from 'zod';

// Tolerant: only the fields the monitors decide on are required; everything else
// is optional and passes through (the central firmware owns this vocabulary).
export const SlaveSchema = z
  .object({
    id: z.number(),
    status: z.string(), // 'online' | 'offline' | 'bad' | (unknown → not online, §6)
    type: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
    last_consumption: z.number().optional(),
    channels: z.array(z.unknown()).optional(),
    config: z.unknown().optional(),
  })
  .passthrough();

export type Slave = z.infer<typeof SlaveSchema>;

export type ProbeErrorKind =
  | 'CONN_REFUSED'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'CONFIG_ERROR'
  | 'HTTP_5XX'
  | 'PARSE_FAIL';

export type ProbeOutcome =
  | { ok: true; slaves: Slave[]; skipped: number; latencyMs: number; attempts: number }
  | { ok: false; kind: ProbeErrorKind; httpStatus?: number; latencyMs: number; attempts: number; message: string };

export interface RetryAttempt {
  delay_ms: number;
  timeout_ms?: number;
}
export interface RetryPolicy {
  name: string;
  attempts: RetryAttempt[];
}

export interface ProbeOptions {
  timeoutMs: number; // per-attempt default when the policy attempt omits timeout_ms
  maxTotalMs: number; // hard cap on total wall-time across all attempts
  statusToken?: string; // optional X-Status-Token
}

// Deterministic failures — retrying cannot change the answer, so stop early.
const NON_RETRYABLE: ReadonlySet<ProbeErrorKind> = new Set(['AUTH_ERROR', 'CONFIG_ERROR']);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyNetworkError(err: unknown): ProbeErrorKind {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError') return 'TIMEOUT';
  const code = e?.code ?? e?.cause?.code ?? '';
  // NXDOMAIN — the host genuinely does not exist: permanent config error, no retry.
  if (code === 'ENOTFOUND') return 'CONFIG_ERROR';
  // EAI_AGAIN — TEMPORARY DNS failure ("try again"): transient, so retry it.
  if (code === 'EAI_AGAIN') return 'CONN_REFUSED';
  if (code === 'ECONNREFUSED') return 'CONN_REFUSED';
  if (code.includes('TIMEOUT') || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'TIMEOUT';
  return 'CONN_REFUSED'; // generic unreached — transient, retry
}

/** One HTTP attempt; resolves to a partial outcome (no retry logic here). */
async function attemptOnce(
  url: string,
  timeoutMs: number,
  statusToken: string | undefined,
): Promise<{ ok: true; slaves: Slave[]; skipped: number } | { ok: false; kind: ProbeErrorKind; httpStatus?: number; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (statusToken) headers['x-status-token'] = statusToken;

    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });

    // Layer: declared HTTP outcome — auth vs down vs server error are distinct.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: 'AUTH_ERROR', httpStatus: res.status, message: 'probe unauthorized (our credential)' };
    }
    if (res.status >= 500) {
      return { ok: false, kind: 'HTTP_5XX', httpStatus: res.status, message: `gateway ${res.status}` };
    }
    if (!res.ok) {
      // A non-auth 4xx (404/400/…) is deterministic — retrying won't help, and it
      // is NOT a "central down" verdict; treat it as a config/contract error.
      return { ok: false, kind: 'CONFIG_ERROR', httpStatus: res.status, message: `unexpected status ${res.status}` };
    }

    // Layer: valid payload — a 200 + HTML from a proxy is PARSE_FAIL, not healthy.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, kind: 'PARSE_FAIL', httpStatus: res.status, message: 'response body is not JSON' };
    }
    if (!Array.isArray(body)) {
      return { ok: false, kind: 'PARSE_FAIL', httpStatus: res.status, message: 'response is not a slaves array' };
    }

    // Tolerant per-row validation: skip+count bad rows, never abort the array.
    const slaves: Slave[] = [];
    let skipped = 0;
    for (const raw of body) {
      const parsed = SlaveSchema.safeParse(raw);
      if (parsed.success) slaves.push(parsed.data);
      else skipped += 1;
    }
    return { ok: true, slaves, skipped };
  } catch (err) {
    return { ok: false, kind: classifyNetworkError(err), message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a gateway's /v2/slaves under a retry policy. A 2xx-valid on ANY attempt
 * ⇒ ok; the central is OFFLINE only after the whole retryable sequence fails.
 * Bounded by maxTotalMs so retries never stall a scan.
 */
export async function probeGateway(url: string, policy: RetryPolicy, opts: ProbeOptions): Promise<ProbeOutcome> {
  const start = Date.now();
  let attempts = 0;
  let last: { kind: ProbeErrorKind; httpStatus?: number; message: string } = {
    kind: 'CONN_REFUSED',
    message: 'no attempts made',
  };

  for (const step of policy.attempts) {
    // Backoff before this attempt (the book's delay is "before each attempt").
    if (step.delay_ms > 0) {
      if (Date.now() - start + step.delay_ms > opts.maxTotalMs) break;
      await sleep(step.delay_ms);
    }
    if (Date.now() - start >= opts.maxTotalMs) break;

    attempts += 1;
    const perAttemptTimeout = Math.min(step.timeout_ms ?? opts.timeoutMs, Math.max(1, opts.maxTotalMs - (Date.now() - start)));
    const r = await attemptOnce(url, perAttemptTimeout, opts.statusToken);

    if (r.ok) {
      return { ok: true, slaves: r.slaves, skipped: r.skipped, latencyMs: Date.now() - start, attempts };
    }
    last = { kind: r.kind, httpStatus: r.httpStatus, message: r.message };
    // Deterministic failure — retrying cannot help.
    if (NON_RETRYABLE.has(r.kind)) break;
  }

  return { ok: false, kind: last.kind, httpStatus: last.httpStatus, latencyMs: Date.now() - start, attempts, message: last.message };
}
