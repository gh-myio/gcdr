// =============================================================================
// RFC-0053 — One-Store Dash: telemetry read-through client (interface + stub)
//
// GCDR is a registry: it stores each device's ingestion identity
// (`device.ingestionId` / `device.externalId`) but NOT live values. The store
// dashboard reads telemetry through this client, server-side, so ingestion
// credentials never reach the browser (RFC-0053 §4.2).
//
// The concrete HTTP client is BLOCKED on RFC-0053 Unresolved Question 1 (the
// ingestion API contract for instantaneous + period + series queries). Until
// that lands, the Null client makes the dashboard degrade gracefully: every
// group renders its registry data with an explicit "telemetry unavailable"
// reason instead of failing the whole endpoint.
// =============================================================================

/** Date window requested by the dashboard (ISO strings, inclusive). */
export interface TelemetryRange {
  from?: string;
  to?: string;
}

/** Per-device period figures the dashboard cards render. */
export interface DeviceTelemetry {
  /** Latest instantaneous reading (kW, m³/h, °C, % level — unit per group). */
  instant?: number;
  /** Total for the requested range (kWh, m³). */
  periodTotal?: number;
  /** Current-month total. */
  monthTotal?: number;
  /** Small series for the card sparkline (newest-last). */
  sparkline?: number[];
}

export interface GroupTelemetryResult {
  available: boolean;
  /** Machine-readable reason when unavailable. */
  reason?: 'INGESTION_CONTRACT_PENDING' | 'UPSTREAM_ERROR' | 'NO_INGESTION_ID';
  /** Keyed by GCDR device id. */
  byDevice: Record<string, DeviceTelemetry>;
}

export interface IngestionTelemetryClient {
  /**
   * Fetches telemetry for a batch of devices in one upstream round-trip.
   * `ingestionIds` maps GCDR device id → ingestion identity (devices without
   * one are simply absent from the result).
   */
  fetchBatch(ingestionIds: Record<string, string>, range: TelemetryRange): Promise<GroupTelemetryResult>;
}

/**
 * Stub used until the ingestion API contract is ratified (RFC-0053 Q1).
 * Always reports telemetry as unavailable — the dashboard renders registry
 * data with per-card "no data" states.
 */
export class NullIngestionTelemetryClient implements IngestionTelemetryClient {
  async fetchBatch(): Promise<GroupTelemetryResult> {
    return { available: false, reason: 'INGESTION_CONTRACT_PENDING', byDevice: {} };
  }
}

export const ingestionTelemetryClient: IngestionTelemetryClient = new NullIngestionTelemetryClient();
