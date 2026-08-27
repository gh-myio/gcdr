import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireIdempotencyKey } from './shared';
import { QrValidateSchema } from '../../dto/request/InventoryDTO';
import {
  inventoryHomologationService,
  CreateHomologationSchema,
  AddUnitToBoxSchema,
  HomologationListQuerySchema,
} from '../../services/inventory/InventoryHomologationService';
import { inventoryQrService } from '../../services/inventory/InventoryQrService';
import {
  inventoryExternalSyncService,
  GenerateQrSchema,
} from '../../services/inventory/InventoryExternalSyncService';
import { sendSuccess, sendCreated } from '../../middleware/response';

// M5 — Homologação & QR (P2). Real routes (RFC-0061 §M5):
// homologations create QR identities in inv_qr_registry (A2 — global cross
// box×unit uniqueness) and finish with an ENTRADA into ALMOXARIFADO; box ops
// re-shuffle units between boxes; /qr/validate (S2) gives per-code verdicts
// for handheld scanners; /qr/trace/:code (S5) returns the current-state
// header + normalized timeline; /qr/generate delegates QR generation to the
// external platform through the M8 client — v1 keeps external-only
// generation (source parity).
const router = Router();

// GET /homologations — paginated listing (optional itemId/releaseId filters).
router.get('/homologations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = HomologationListQuerySchema.parse(req.query);
    const data = await inventoryHomologationService.listHomologations(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /homologations — homologate units (unitário or caixa de N). Creates
// stock (ENTRADA into ALMOXARIFADO), so the Idempotency-Key is required (S1).
router.post('/homologations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateHomologationSchema.parse(req.body ?? {});
    const data = await inventoryHomologationService.createHomologation({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /homologations/boxes — paginated box listing with fill state.
router.get('/homologations/boxes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = HomologationListQuerySchema.parse(req.query);
    const data = await inventoryHomologationService.listBoxes(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /homologations/boxes/:id/add-unit — move a homologated unit into an
// incomplete box of the same material (no ledger movement — same location).
router.post('/homologations/boxes/:id/add-unit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = AddUnitToBoxSchema.parse(req.body ?? {});
    const data = await inventoryHomologationService.addUnitToBox({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /homologations/units/:id/remove-from-box — the unit becomes its own
// box_size=1 homologation; an emptied box is deleted.
router.post('/homologations/units/:id/remove-from-box', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const data = await inventoryHomologationService.removeFromBox({ tenantId, userId }, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /qr/generate — delegates to the external platform (M8 client): POST
// /api/public/products {product_type, location:'estoque', status:'parado'} →
// {code, qrUrl}. v1 keeps generation external-only (source parity — RFC
// Unresolved q. 3); 503 INV_EXTERNAL_NOT_CONFIGURED without the client env.
router.post('/qr/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const dto = GenerateQrSchema.parse(req.body ?? {});
    const data = await inventoryExternalSyncService.generateQr(dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /qr/trace/:code — S5 traceability. `:code` accepts the bare code or the
// URL-encoded full https://produto.myio.com.br/<code> URL.
router.get('/qr/trace/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const raw = decodeURIComponent(req.params.code ?? '');
    const data = await inventoryQrService.trace(tenantId, raw);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /qr/validate — S2 per-beep batch validation; 200 with one verdict per
// code, never failing the batch as a whole.
router.post('/qr/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const dto = QrValidateSchema.parse(req.body ?? {});
    const data = await inventoryQrService.validate(tenantId, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
