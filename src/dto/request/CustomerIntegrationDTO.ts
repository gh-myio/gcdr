import { z } from 'zod';
import { INTEGRATION_KEYS, INTEGRATION_STATUS } from '../../domain/integrations/IntegrationKey';
import {
  CENTRAL_MQTT_INTEGRATION_IDS,
  CentralMqttIntegrationId,
} from '../../domain/integrations/CentralMqttIntegrationId';

// =============================================================================
// RFC-0033 — Customer Integration Sync State (DTOs)
//   centrals.items[] shape partially superseded by RFC-0035 — see header.
// =============================================================================
// One IntegrationStateSchema covers ingestion, thingsboard, alarms,
// workorders, freshdesk. The `centrals` key extends it with an `items[]`
// array carrying per-central MQTT credentials only (one password per
// integration destination). Identity (ipv6) and broker config moved to
// centrals.config in RFC-0035.

const REDACTED = '<redacted>';

// -----------------------------------------------------------------------------
// Per-central entry under integrations.centrals.items[] (RFC-0035 shape)
// -----------------------------------------------------------------------------

const MqttPasswordsSchema = z.record(
  z.enum(CENTRAL_MQTT_INTEGRATION_IDS),
  z.string().min(1).max(2000),
);

export const CentralEntrySchema = z.object({
  uuid:          z.string().uuid(),
  mqttPasswords: MqttPasswordsSchema.default({}),
});

export type CentralEntry = z.infer<typeof CentralEntrySchema>;

// -----------------------------------------------------------------------------
// IntegrationState — common shape for every integration key.
// `centrals` adds the `items` array; everything else is plain.
// -----------------------------------------------------------------------------

export const IntegrationStateSchema = z.object({
  status:        z.enum(INTEGRATION_STATUS),
  version:       z.string().max(255).nullable().default(null),
  lastSyncAt:    z.string().datetime().nullable().default(null),
  lastSuccessAt: z.string().datetime().nullable().default(null),
  lastError:     z.string().max(2000).nullable().default(null),
  syncCount:     z.number().int().nonnegative().default(0),
  failureCount:  z.number().int().nonnegative().default(0),
  payload:       z.record(z.unknown()).default({}),
});

export type IntegrationState = z.infer<typeof IntegrationStateSchema>;

export const CentralsIntegrationStateSchema = IntegrationStateSchema.extend({
  items: z.array(CentralEntrySchema).default([]),
});

export type CentralsIntegrationState = z.infer<typeof CentralsIntegrationStateSchema>;

// -----------------------------------------------------------------------------
// Full integrations map — every key is optional, `centrals` is the
// one with the extended shape.
// -----------------------------------------------------------------------------

export const CustomerIntegrationsSchema = z.object({
  ingestion:   IntegrationStateSchema.optional(),
  centrals:    CentralsIntegrationStateSchema.optional(),
  thingsboard: IntegrationStateSchema.optional(),
  alarms:      IntegrationStateSchema.optional(),
  workorders:  IntegrationStateSchema.optional(),
  freshdesk:   IntegrationStateSchema.optional(),
});

export type CustomerIntegrations = z.infer<typeof CustomerIntegrationsSchema>;

// -----------------------------------------------------------------------------
// Request DTOs
// -----------------------------------------------------------------------------

export const RecordSyncInputSchema = z.object({
  status:  z.enum(INTEGRATION_STATUS),
  version: z.string().max(255).optional(),
  actor:   z.string().min(1).max(255),
  note:    z.string().max(500).optional(),
  payload: z.record(z.unknown()).optional(),
  error:   z.string().max(2000).optional(),
  // For the `centrals` key: full replacement of the items[] list.
  // Other keys ignore this field.
  items:   z.array(CentralEntrySchema).optional(),
});

export type RecordSyncInput = z.infer<typeof RecordSyncInputSchema>;

export const DisableInputSchema = z.object({
  actor: z.string().min(1).max(255),
  note:  z.string().max(500).optional(),
});

export const ResetInputSchema = z.object({
  actor: z.string().min(1).max(255),
});

export const IntegrationKeyParamSchema = z.object({
  key: z.enum(INTEGRATION_KEYS),
});

// Admin replacement of centrals.items[] via the UI. The full array is sent
// each call (the controller refuses partial PATCH semantics for predictability
// — the operator sees exactly what they're persisting). Per-integration
// password merge rule: empty string for an existing integration id keeps the
// stored value; missing integration id keeps the stored value; setting to
// "" cannot be expressed (use DELETE on the dedicated route to clear).
export const ReplaceCentralsItemsInputSchema = z.object({
  actor: z.string().min(1).max(255),
  note:  z.string().max(500).optional(),
  items: z.array(
    z.object({
      uuid:          z.string().uuid(),
      mqttPasswords: z
        .record(z.enum(CENTRAL_MQTT_INTEGRATION_IDS), z.string().max(2000))
        .default({}),
    }),
  ).max(200),
});

export type ReplaceCentralsItemsInput = z.infer<typeof ReplaceCentralsItemsInputSchema>;

// Per-integration password upsert (PUT /centrals/:id/mqtt-passwords/:integrationId)
export const SetMqttPasswordInputSchema = z.object({
  password: z.string().min(1).max(2000),
});

export type SetMqttPasswordInput = z.infer<typeof SetMqttPasswordInputSchema>;

export const MqttIntegrationIdParamSchema = z.object({
  integrationId: z.enum(CENTRAL_MQTT_INTEGRATION_IDS),
});

export const ItemUuidParamSchema = z.object({
  itemUuid: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// Response shaping — masks every MQTT password on read (RFC-0035).
//
// Default reads replace mqttPasswords (Record<id,string>) with
// mqttPasswordsSet (Record<id,boolean>) — same key set, boolean indicator
// only. Plaintext is only available via the dedicated reveal endpoint.
// -----------------------------------------------------------------------------

export interface CentralEntryRead {
  uuid:              string;
  mqttPasswordsSet:  Partial<Record<CentralMqttIntegrationId, boolean>>;
}

export function maskCentralEntry(e: CentralEntry): CentralEntryRead {
  const set: Partial<Record<CentralMqttIntegrationId, boolean>> = {};
  for (const id of CENTRAL_MQTT_INTEGRATION_IDS) {
    const v = e.mqttPasswords?.[id];
    if (typeof v === 'string' && v.length > 0) {
      set[id] = true;
    }
  }
  return { uuid: e.uuid, mqttPasswordsSet: set };
}

export function maskIntegrationStateForRead(
  key: string,
  state: unknown,
): unknown {
  if (key !== 'centrals' || !state || typeof state !== 'object') return state;
  const s = state as CentralsIntegrationState;
  if (!Array.isArray(s.items)) return s;
  return { ...s, items: s.items.map(maskCentralEntry) };
}

export function maskIntegrationsMapForRead(
  map: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!map) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = maskIntegrationStateForRead(k, v);
  }
  return out;
}

// Strip every MQTT password when state is going into an audit log row.
// Audit metadata MUST never carry plaintext credentials.
export function stripCredentialsForAudit(
  key: string,
  state: unknown,
): unknown {
  if (key !== 'centrals' || !state || typeof state !== 'object') return state;
  const s = state as CentralsIntegrationState;
  if (!Array.isArray(s.items)) return s;
  return {
    ...s,
    items: s.items.map((e) => maskCentralEntry(e)),
  };
}

// `REDACTED` is no longer used externally but kept for backward compatibility
// with any caller that still references the constant. Safe to remove later.
export { REDACTED };
