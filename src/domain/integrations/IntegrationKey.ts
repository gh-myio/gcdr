// RFC-0033 — Customer Integration Sync State.
// Closed enum of supported integrations and their state lifecycle.
// New integrations require a code change here + a Zod schema entry,
// not a database migration.

export const INTEGRATION_KEYS = [
  'ingestion',
  'centrals',
  'thingsboard',
  'alarms',
  'workorders',
  'freshdesk',
] as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export function isIntegrationKey(value: unknown): value is IntegrationKey {
  return typeof value === 'string' && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

export const INTEGRATION_STATUS = [
  'IDLE',
  'RUNNING',
  'OK',
  'DEGRADED',
  'FAILED',
  'DISABLED',
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];
