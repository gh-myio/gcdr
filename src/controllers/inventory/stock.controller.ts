import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';
import {
  StockBalancesQuerySchema,
  CreateMovementSchema,
  CreateTransferSchema,
  StockResetSchema,
  PaginationQuerySchema,
} from '../../dto/request/InventoryDTO';
import { inventoryStockService } from '../../services/inventory/InventoryStockService';
import { sendSuccess, sendCreated } from '../../middleware/response';

// M2 — Livro-razão de estoque (P0). Real routes (RFC-0061 §M2):
// balance is derived from inv_stock_movements (DEC-2); mutations run inside a
// service transaction with a FOR UPDATE item lock; POSTs that create movements
// require an Idempotency-Key (S1); /stock/reset is destructive and requires a
// confirmationToken (S3).
const router = Router();

// GET /stock/balances — per-(item, location) derived balances.
router.get('/stock/balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const q = StockBalancesQuerySchema.parse(req.query);
    const data = await inventoryStockService.getBalances(tenantId, q);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /stock/consistency — ledger vs active-QR drift report (W1, AC-10).
router.get('/stock/consistency', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const rows = await inventoryStockService.getConsistency(tenantId);
    sendSuccess(res, { rows, driftCount: rows.filter((r) => r.drift !== 0).length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /stock/movements — paginated ledger history (newest first).
router.get('/stock/movements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryStockService.listMovements(tenantId, page, pageSize);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /stock/movements/:id — one movement with its QR links.
router.get('/stock/movements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const data = await inventoryStockService.getMovement(tenantId, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /stock/movements — ENTRADA | SAIDA | AJUSTE (transfers have their own
// endpoint). Exit guards + W4 matrix live in the service transaction.
router.post('/stock/movements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateMovementSchema.parse(req.body ?? {});
    const data = await inventoryStockService.createMovement({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /stock/transfers — two legs (OUT with guard + IN) in ONE transaction.
router.post('/stock/transfers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateTransferSchema.parse(req.body ?? {});
    const data = await inventoryStockService.createTransfer({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /stock/reset — destructive ledger wipe (whole tenant or one location).
// The confirmation token may come via X-Confirmation-Token header or body.
router.post('/stock/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const confirmationToken = requireConfirmation(req);
    const dto = StockResetSchema.parse({ ...(req.body ?? {}), confirmationToken });
    const data = await inventoryStockService.reset({ tenantId, userId }, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
