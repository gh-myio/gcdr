// =============================================================================
// orchestrator-devices — rules-monitor cap resolution (pure, no DB/IO)
//
// RFC-0062 Monitor D (NO_CONSUMPTION auto-mute). The daily allowance for a
// NO_CONSUMPTION rule MUST be in the SAME unit as ALARMS `todayCount` (RFC-0035):
// canonical buckets/slots, NOT "episodes". This module resolves the effective daily
// cap from a rule's NoConsumptionConfig and decides the over-cap predicate.
//
// Fail-open by design: an absent/invalid cap resolves to "no cap" so the monitor
// NEVER mutes on a missing or malformed configuration (matches the §11c fail-safe).
// Kept side-effect-free so it is unit-testable without a DB.
// =============================================================================

import type { NoConsumptionConfig } from '../../domain/entities/Rule';

export type CapReason = 'CONFIGURED' | 'NO_CAP' | 'INVALID';

export interface DailyCap {
  buckets: number | null; // null = no cap => fail-open (never mute)
  reason: CapReason;
}

/**
 * Effective daily cap, in canonical buckets, for a NO_CONSUMPTION rule config.
 * Absent => NO_CAP; present-but-not-a-positive-integer => INVALID. Both yield
 * `buckets: null` (fail-open). A valid positive integer yields CONFIGURED.
 */
export function resolveDailyBucketCap(
  config: Pick<NoConsumptionConfig, 'maxDailyBucketsPerDay'> | null | undefined,
): DailyCap {
  const v = config?.maxDailyBucketsPerDay;
  if (v === undefined || v === null) return { buckets: null, reason: 'NO_CAP' };
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return { buckets: null, reason: 'INVALID' };
  return { buckets: v, reason: 'CONFIGURED' };
}

/**
 * The mute predicate: true iff a cap is set AND today's canonical bucket count has
 * reached it. No cap => always false (fail-open). `todayCount` comes from ALARMS
 * (RFC-0035, buckets — never episodes/incident rows).
 */
export function isOverDailyCap(todayCount: number, cap: DailyCap): boolean {
  return cap.buckets !== null && todayCount >= cap.buckets;
}
