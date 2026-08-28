import { Router, Request, Response, NextFunction } from 'express';
import {
  inventoryExternalSyncService,
  ExternalStatesQuerySchema,
  SyncRunQuerySchema,
} from '../../services/inventory/InventoryExternalSyncService';
import { sendSuccess } from '../../middleware/response';

// M8 — Sync externo (P2 shadow → P4 live). Real routes (RFC-0061 §M8):
// the mirror listing, the sync status (lease + run report + outbox counters)
// and the manual pull trigger. The trigger respects the persisted
// single-flight lease (held lease → 409 CONFLICT) and the J4 shadow gate:
// ?live=true is only accepted when env INV_SYNC_LIVE=true; without it the run
// computes and logs the corrections it would make. Auth is the standing
// inventory:read/inventory:write hybrid gate mounted in app.ts (DEC-7 — no
// public anon endpoint; finer admin/M2M role gating arrives with M10, same as
// the sibling modules).
const router = Router();

// GET /external/states — paginated platform mirror (filters: location, status,
// q = substring on code).
router.get('/external/states', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = ExternalStatesQuerySchema.parse(req.query);
    const data = await inventoryExternalSyncService.listStates(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /external/sync/status — inv_external_sync_state (lease, last run report)
// + outbox counters + shadow/live mode.
router.get('/external/sync/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = await inventoryExternalSyncService.getStatus(tenantId);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /external/sync/run — one pull execution, respecting the lease (409 when
// held). 503 when the external client is not configured; 400 on ?live=true
// without INV_SYNC_LIVE=true.
router.post('/external/sync/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = SyncRunQuerySchema.parse(req.query);
    const live = query.live === undefined ? undefined : query.live === 'true';
    const data = await inventoryExternalSyncService.runPull(tenantId, { live });
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
