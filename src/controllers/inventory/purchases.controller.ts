import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireConfirmation } from './shared';
import {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  PurchaseOrderListQuerySchema,
  PurchaseOrderFilesSchema,
  PaginationQuerySchema,
} from '../../dto/request/InventoryDTO';
import { sendSuccess, sendCreated } from '../../middleware/response';
import { inventoryPurchaseOrderService } from '../../services/inventory/InventoryPurchaseOrderService';

// M3 — Compras (P1). Real routes (RFC-0061 §M3): purchase requests + buyer
// queue. Auth (hybridAuthByMethod inventory:read/inventory:write) is mounted
// in app.ts. The state machine (PURCHASE_ORDER_TRANSITIONS) is enforced in the
// service under a row lock (DEC-4); reads include allowedTransitions (S3);
// RECEBIDO_OK triggers the exactly-once automatic ENTRADA (A1). Fine-grained
// role gating (requester/buyer/admin) arrives with M10.
const router = Router();

// GET /purchase-orders — paginated listing = buyer queue with server-side
// filters (status, projectId, purchaseType via the item, groupByProject).
router.get('/purchase-orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const query = PurchaseOrderListQuerySchema.parse(req.query);
    const data = await inventoryPurchaseOrderService.list({ tenantId, userId }, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /purchase-orders — create; requester = req.context.userId; item/link
// snapshot happens in the service; CUSTOMIZADO deadline requires deadlineDate.
router.post('/purchase-orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const dto = CreatePurchaseOrderSchema.parse(req.body ?? {});
    const data = await inventoryPurchaseOrderService.create({ tenantId, userId }, dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders/:id — detail incl. files + allowedTransitions.
router.get('/purchase-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const data = await inventoryPurchaseOrderService.getById({ tenantId, userId }, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /purchase-orders/:id — requester fields only while PENDENTE
// (INV_EDIT_LOCKED_STATE 409); buyerNotes/passphrase/deliveryForecast anytime.
router.patch('/purchase-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = UpdatePurchaseOrderSchema.parse(req.body ?? {});
    const data = await inventoryPurchaseOrderService.update({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /purchase-orders/:id/status — DEC-4 state machine; illegal transition →
// INV_ILLEGAL_TRANSITION 409 (current + allowedTransitions in the body),
// repeat → INV_ALREADY_IN_STATE 409; RECEBIDO_OK creates the single ENTRADA.
router.post('/purchase-orders/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = PurchaseOrderStatusSchema.parse(req.body ?? {});
    const data = await inventoryPurchaseOrderService.changeStatus({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders/:id/events — paginated WO-style timeline (DEC-9).
router.get('/purchase-orders/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryPurchaseOrderService.listEvents(
      { tenantId, userId },
      req.params.id,
      page,
      pageSize,
    );
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /purchase-orders/:id/files — link existing file_assets by id (two-phase
// upload: the asset is uploaded first via the file_assets flow, DEC-8).
router.post('/purchase-orders/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = PurchaseOrderFilesSchema.parse(req.body ?? {});
    const data = await inventoryPurchaseOrderService.addFiles({ tenantId, userId }, req.params.id, dto.fileIds);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /purchase-orders/:id/files — unlink (the file_asset itself remains).
router.delete('/purchase-orders/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = PurchaseOrderFilesSchema.parse(req.body ?? {});
    const data = await inventoryPurchaseOrderService.removeFiles({ tenantId, userId }, req.params.id, dto.fileIds);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /purchase-orders/:id — destructive; confirmation token (S3).
// TODO(M10): admin-only.
router.delete('/purchase-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    requireConfirmation(req);
    await inventoryPurchaseOrderService.delete({ tenantId, userId }, req.params.id);
    sendSuccess(res, { id: req.params.id, deleted: true }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
