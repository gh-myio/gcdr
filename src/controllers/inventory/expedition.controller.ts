import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';
import {
  inventoryExpeditionService,
  CreateExpeditionOrderSchema,
  UpdateExpeditionOrderSchema,
  ExpeditionOrderListQuerySchema,
  ExpeditionStatusSchema,
  DeliverItemSchema,
  ShipExpeditionSchema,
  ReturnExpeditionSchema,
  LostExpeditionSchema,
  FoundExpeditionSchema,
} from '../../services/inventory/InventoryExpeditionService';
import { sendSuccess, sendCreated } from '../../middleware/response';

// M6 — Expedição (P3). Real routes (RFC-0061 §M6):
// - CRUD with project required + items by FK (DEC-5); PATCH replaces items
//   only while PENDENTE; DELETE requires a confirmationToken.
// - Server-side state machine (DEC-4): /status for the manual transitions;
//   EM_TRANSITO and PERDIDO are owned by /ship and /lost (mandatory payloads).
// - Baixa (deliver): Idempotency-Key required (S1) — photo + stockOnly QRs
//   (one per manufactured unit, boxes expand) + SAIDA in one transaction.
// - /return, /lost, /found keep the timestamped note stamps; /transit-progress
//   reads inv_external_states per delivered QR ("X de Y em transporte").
const router = Router();

// GET /expedition-orders — paginated listing (status/projectId filters).
router.get('/expedition-orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const query = ExpeditionOrderListQuerySchema.parse(req.query);
    const data = await inventoryExpeditionService.list({ tenantId, userId }, query);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders — project required, items reference inv_items (DEC-5).
router.post('/expedition-orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const dto = CreateExpeditionOrderSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.create({ tenantId, userId }, dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /expedition-orders/:id — detail with items + allowedTransitions (S3).
router.get('/expedition-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const data = await inventoryExpeditionService.getById({ tenantId, userId }, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /expedition-orders/:id — header anywhere; item replace only PENDENTE.
router.patch('/expedition-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = UpdateExpeditionOrderSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.update({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /expedition-orders/:id — destructive (S3): confirmationToken required.
router.delete('/expedition-orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    requireConfirmation(req);
    const data = await inventoryExpeditionService.delete({ tenantId, userId }, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders/:id/status — manual transitions (DEC-4).
router.post('/expedition-orders/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = ExpeditionStatusSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.changeStatus({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders/:id/items/:itemId/deliver — baixa (Idempotency-Key).
router.post(
  '/expedition-orders/:id/items/:itemId/deliver',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      requireUuid('id', req.params.id);
      requireUuid('itemId', req.params.itemId);
      const idempotencyKey = requireIdempotencyKey(req);
      const dto = DeliverItemSchema.parse(req.body ?? {});
      const data = await inventoryExpeditionService.deliverItem(
        { tenantId, userId },
        req.params.id,
        req.params.itemId,
        dto,
        idempotencyKey,
      );
      sendCreated(res, data, requestId);
    } catch (err) {
      next(err);
    }
  },
);

// POST /expedition-orders/:id/ship — mandatory shipment payload → EM_TRANSITO.
router.post('/expedition-orders/:id/ship', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = ShipExpeditionSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.ship({ tenantId, userId }, req.params.id, dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders/:id/return — motivo obrigatório, back to PRONTO_ENTREGA.
router.post('/expedition-orders/:id/return', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = ReturnExpeditionSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.returnToExpedition({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders/:id/lost — motivo obrigatório → PERDIDO.
router.post('/expedition-orders/:id/lost', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = LostExpeditionSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.markLost({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /expedition-orders/:id/found — sector → status mapping (§M6).
router.post('/expedition-orders/:id/found', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = FoundExpeditionSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.markFound({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /expedition-orders/:id/transit-progress — "X de Y em transporte".
router.get('/expedition-orders/:id/transit-progress', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryExpeditionService.transitProgress(
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

export default router;
