import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireIdempotencyKey } from './shared';
import {
  inventoryFieldService,
  UnitProductListQuerySchema,
  CreateUnitProductSchema,
  UpdateUnitProductSchema,
  MoveUnitProductSchema,
  TechnicianItemsQuerySchema,
  CreateTechnicianMoveSchema,
  DamagedListQuerySchema,
  CreateDamagedItemSchema,
  RecoverDamagedItemSchema,
} from '../../services/inventory/InventoryFieldService';
import { sendSuccess, sendCreated } from '../../middleware/response';

// M7 — Campo (P3). Real routes (RFC-0061 §M7): unit products at the client
// (install toggle + move-out), technician custody (dispatches = SAIDAs with a
// responsible; per-dispatch remaining) and damaged items (report + recovery).
// ANTI-DOUBLE-COUNT: field moves are tracking-only — only destination
// ALMOXARIFADO writes an ENTRADA (with QR re-link so the M8 sync keeps it);
// the movement-writing POSTs therefore require an Idempotency-Key (S1).
const router = Router();

// GET /unit-products — paginated; default shows active units (moved_to IS NULL).
router.get('/unit-products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = UnitProductListQuerySchema.parse(req.query);
    const data = await inventoryFieldService.listUnitProducts(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /unit-products — create at the client (status PARADO; optional label =
// available homologated QR, validated against the M5 registry).
router.post('/unit-products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const dto = CreateUnitProductSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.createUnitProduct({ tenantId, userId }, dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /unit-products/:id — INSTALADO/PARADO toggle (stamps installed_at).
router.patch('/unit-products/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = UpdateUnitProductSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.updateUnitProduct({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /unit-products/:id/move — destino TECNICO|ALMOXARIFADO|PERDIDO|AVARIADO.
// Only ALMOXARIFADO writes stock (ENTRADA "Devolução do cliente" + QR re-link).
router.post('/unit-products/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = MoveUnitProductSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.moveUnitProduct({ tenantId, userId }, req.params.id, dto, idempotencyKey);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /technician-items — dispatches grouped by technician; zeroed omitted.
router.get('/technician-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = TechnicianItemsQuerySchema.parse(req.query);
    const data = await inventoryFieldService.listTechnicianItems(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /technician-moves — destino UNIDADE|PERDIDO|ALMOXARIFADO|AVARIADO; qty
// 1..restante. Only ALMOXARIFADO writes stock ("Devolução do técnico <nome>").
router.post('/technician-moves', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateTechnicianMoveSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.createTechnicianMove({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /damaged-items — paginated, AVARIADO first.
router.get('/damaged-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = DamagedListQuerySchema.parse(req.query);
    const data = await inventoryFieldService.listDamagedItems(tenantId, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /damaged-items — report damage FROM STOCK (balance-guarded SAIDA
// "Item avariado — <motivo>"); client/technician damage comes via the moves.
router.post('/damaged-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateDamagedItemSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.createDamagedItem({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /damaged-items/:id/recover — destino ESTOQUE|TECNICO|UNIDADE; always an
// ENTRADA "Recuperação de item avariado" (+ QR re-link from source_detail).
router.post('/damaged-items/:id/recover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = RecoverDamagedItemSchema.parse(req.body ?? {});
    const data = await inventoryFieldService.recoverDamagedItem({ tenantId, userId }, req.params.id, dto, idempotencyKey);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
