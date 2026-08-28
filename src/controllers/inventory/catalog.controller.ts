import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireConfirmation } from './shared';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import {
  CreateItemSchema,
  UpdateItemSchema,
  ItemListQuerySchema,
  PutBomSchema,
} from '../../dto/request/InventoryDTO';
import { inventoryItemService } from '../../services/inventory/InventoryItemService';

// =============================================================================
// M1 — Catálogo & BOM (P0). Zod validation at the boundary, business rules in
// InventoryItemService, data access in InventoryItemRepository. Auth is mounted
// in app.ts (hybridAuthByMethod inventory:read/inventory:write).
// =============================================================================

const router = Router();

router.get('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ItemListQuerySchema.parse(req.query);
    const data = await inventoryItemService.listItems(req.context.tenantId, query);
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.post('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateItemSchema.parse(req.body ?? {});
    const data = await inventoryItemService.createItem(req.context.tenantId, dto, req.context.userId);
    sendCreated(res, data, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    const data = await inventoryItemService.getItem(req.context.tenantId, req.params.id);
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    const dto = UpdateItemSchema.parse(req.body ?? {});
    const data = await inventoryItemService.updateItem(
      req.context.tenantId,
      req.params.id,
      dto,
      req.context.userId,
    );
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    requireConfirmation(req); // destructive verb — server-side token (S3)
    await inventoryItemService.deleteItem(req.context.tenantId, req.params.id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id/stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    const data = await inventoryItemService.getItemStock(req.context.tenantId, req.params.id);
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id/bom', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    const data = await inventoryItemService.getBom(req.context.tenantId, req.params.id);
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

router.put('/items/:id/bom', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireUuid('id', req.params.id);
    const dto = PutBomSchema.parse(req.body ?? {});
    const data = await inventoryItemService.putBom(
      req.context.tenantId,
      req.params.id,
      dto,
      req.context.userId,
    );
    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
