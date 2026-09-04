// =============================================================================
// orchestrator-devices — ALARMS daily-count reader (RFC-0062 §11c / ALARMS RFC-0035)
//
// The rules-monitor's ONLY read dependency. Behind an interface so the monitor is
// agnostic to where the count comes from:
//   - MockAlarmsReader — deterministic counts for localhost/shadow (no ALARMS needed).
//   - HttpAlarmsReader — POST {base}/incidents/counts/daily with a dedicated read key.
//
// `todayCount` is CANONICAL BUCKETS in the local day (not incidents/episodes/slot_count).
// Fail-safe is the CALLER's job: on throw / missing device, the monitor makes NO CHANGE.
// =============================================================================

export interface DailyCountRequest {
  customerId: string;
  kind: 'NO_CONSUMPTION';
  timezone: string;
  day?: string;          // omitted ⇒ ALARMS uses "today" in `timezone`
  deviceIds: string[];   // 1..500 (caller chunks above 500)
}

export interface DailyCountRow {
  deviceId: string;
  todayCount: number;
  lastOccurrenceAt: string | null;
}

export interface DailyCountResponse {
  kind: 'NO_CONSUMPTION';
  timezone: string;
  day: string;
  windowStart: string;
  windowEnd: string;
  asOf: string;
  counts: DailyCountRow[];
}

export interface AlarmsReader {
  readonly kind: 'mock' | 'http';
  dailyCounts(req: DailyCountRequest): Promise<DailyCountResponse>;
}

const isoNow = (): string => new Date().toISOString();

/** Deterministic reader for localhost/shadow. Returns the configured count per device
 *  (0 when absent) and echoes EVERY requested deviceId (the contract's fail-safe shape). */
export class MockAlarmsReader implements AlarmsReader {
  readonly kind = 'mock' as const;
  constructor(private readonly countsByDevice: Map<string, number> = new Map()) {}

  async dailyCounts(req: DailyCountRequest): Promise<DailyCountResponse> {
    const day = req.day ?? isoNow().slice(0, 10);
    const counts: DailyCountRow[] = req.deviceIds.map((deviceId) => ({
      deviceId,
      todayCount: this.countsByDevice.get(deviceId) ?? 0,
      lastOccurrenceAt: (this.countsByDevice.get(deviceId) ?? 0) > 0 ? isoNow() : null,
    }));
    return { kind: 'NO_CONSUMPTION', timezone: req.timezone, day, windowStart: '', windowEnd: '', asOf: isoNow(), counts };
  }
}

/** Real reader: POST {base}/incidents/counts/daily. `base` must include /api/v1.
 *  Throws on non-2xx or a malformed body — the monitor's fail-safe turns that into NO CHANGE. */
export class HttpAlarmsReader implements AlarmsReader {
  readonly kind = 'http' as const;
  constructor(private readonly baseUrl: string, private readonly apiKey: string | undefined) {}

  async dailyCounts(req: DailyCountRequest): Promise<DailyCountResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey; // dedicated READ key (never logged)
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/incidents/counts/daily`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`ALARMS counts/daily HTTP ${res.status}`);
    const body = (await res.json()) as DailyCountResponse;
    if (!body || !Array.isArray(body.counts)) throw new Error('ALARMS counts/daily malformed body');
    return body;
  }
}

/** Build a Map<deviceId, count> from a JSON env value ('{ "<uuid>": 3 }'); empty on any error. */
export function parseMockCounts(raw: string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!raw) return m;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) m.set(k, Math.floor(n));
    }
  } catch { /* ignore — empty map (all zero) */ }
  return m;
}
