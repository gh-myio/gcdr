import { z } from 'zod';

/**
 * RFC-0055 (ED-1080) — Enrichment / batch-resolve request.
 *
 * The Alarms Orchestrator persists incidents referencing only IDs (deviceId,
 * centralId, customerId). This endpoint lets it hydrate those IDs into
 * human-readable names (+ slaveId/centralId for devices) in a single call,
 * scoped to the caller's tenant. All three lists are optional; unknown IDs are
 * simply absent from the response maps.
 */

const MAX_IDS = 500;

const idList = z
  .array(z.string().uuid())
  .max(MAX_IDS, `A maximum of ${MAX_IDS} ids per type is allowed`)
  .optional()
  .default([]);

export const EnrichmentResolveSchema = z
  .object({
    deviceIds: idList,
    centralIds: idList,
    customerIds: idList,
  })
  .refine(
    (data) =>
      data.deviceIds.length > 0 ||
      data.centralIds.length > 0 ||
      data.customerIds.length > 0,
    { message: 'At least one of deviceIds, centralIds or customerIds must be provided' }
  );

export type EnrichmentResolveInput = z.infer<typeof EnrichmentResolveSchema>;
