import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../middleware/response';
import { enrichmentService } from '../services/EnrichmentService';
import { EnrichmentResolveSchema } from '../dto/request/EnrichmentDTO';

const router = Router();

/**
 * RFC-0055 (ED-1080) — Batch-resolve entity IDs to display metadata.
 *
 * POST /api/v1/enrichment/resolve
 * Body: { deviceIds?: string[], centralIds?: string[], customerIds?: string[] }
 * Returns: { devices: {id -> {name, slaveId, centralId}},
 *            centrals: {id -> {name}},
 *            customers: {id -> {name}} }
 *
 * Used by the Alarms Orchestrator to hydrate incidents (which store only IDs).
 * Tenant-scoped; unknown or cross-tenant IDs are simply absent from the maps.
 */
router.post('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = EnrichmentResolveSchema.parse(req.body);
    const result = await enrichmentService.resolve(tenantId, data);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
