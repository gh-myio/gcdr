import { z } from 'zod';
import { INTEGRATION_KEYS, INTEGRATION_STATUS } from '../../domain/integrations/IntegrationKey';

// =============================================================================
// RFC-0033 — Customer Integration Sync State (DTOs)
// =============================================================================
// One IntegrationStateSchema covers ingestion, thingsboard, alarms,
// workorders, freshdesk. The `centrals` key extends it with an `items[]`
// array carrying per-central connection params (incl. plaintext MQTT
// password — see RFC-0033 Security section).

const REDACTED = '<redacted>';

// -----------------------------------------------------------------------------
// Per-central entry under integrations.centrals.items[]
// -----------------------------------------------------------------------------

export const CentralEntrySchema = z.object({
  uuid:               z.string().uuid(),
  ingestionGatewayId: z.string().uuid().nullable().default(null),
  mqttUserName:       z.string().min(1).max(255),
  mqttClientId:       z.string().min(1).max(255),
  mqttPassword:       z.string().min(1).max(2000),
  ipv6Yggdrasil:      z.string().min(1).max(64),
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
// — the operator sees exactly what they're persisting). `mqttPassword` may be
// left empty on an existing entry to keep the stored value; the service
// merges per-uuid when so.
export const ReplaceCentralsItemsInputSchema = z.object({
  actor: z.string().min(1).max(255),
  note:  z.string().max(500).optional(),
  items: z.array(
    CentralEntrySchema.extend({
      // Override password — allow empty string to signal "keep existing".
      mqttPassword: z.string().max(2000),
    }),
  ).max(200),
});

export type ReplaceCentralsItemsInput = z.infer<typeof ReplaceCentralsItemsInputSchema>;

export const ItemUuidParamSchema = z.object({
  itemUuid: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// Response shaping — masks mqttPassword on read.
//
// Every read path passes the state through `maskIntegrationStateForRead`
// before serialising. Callers without the (future) credential-read scope
// see "<redacted>" + a sibling `mqttPasswordSet: boolean` so the UI can
// distinguish "missing" from "present-but-hidden".
// -----------------------------------------------------------------------------

export interface CentralEntryRead extends Omit<CentralEntry, 'mqttPassword'> {
  mqttPassword:    string;   // always "<redacted>" on read
  mqttPasswordSet: boolean;  // true iff the stored value is non-empty
}

export function maskCentralEntry(e: CentralEntry): CentralEntryRead {
  return {
    uuid:               e.uuid,
    ingestionGatewayId: e.ingestionGatewayId,
    mqttUserName:       e.mqttUserName,
    mqttClientId:       e.mqttClientId,
    ipv6Yggdrasil:      e.ipv6Yggdrasil,
    mqttPassword:       REDACTED,
    mqttPasswordSet:    typeof e.mqttPassword === 'string' && e.mqttPassword.length > 0,
  };
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

// Strip the password when the state is going into an audit log row.
// Audit metadata MUST never carry the plaintext credential.
export function stripCredentialsForAudit(
  key: string,
  state: unknown,
): unknown {
  if (key !== 'centrals' || !state || typeof state !== 'object') return state;
  const s = state as CentralsIntegrationState;
  if (!Array.isArray(s.items)) return s;
  return {
    ...s,
    items: s.items.map((e) => {
      const { mqttPassword: _omit, ...rest } = e;
      return { ...rest, mqttPasswordSet: typeof e.mqttPassword === 'string' && e.mqttPassword.length > 0 };
    }),
  };
}
