import { Router } from 'express';
import { defer, requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';
import {
  StockBalancesQuerySchema,
  CreateMovementSchema,
  CreateTransferSchema,
  StockResetSchema,
  PaginationQuerySchema,
} from '../../dto/request/InventoryDTO';

// M2 — Livro-razão de estoque (P0)
const router = Router();

router.get('/stock/balances', defer('M2', 'P0', (req) => { StockBalancesQuerySchema.parse(req.query); }));
router.get('/stock/consistency', defer('M2', 'P0'));
router.get('/stock/movements', defer('M2', 'P0', (req) => { PaginationQuerySchema.parse(req.query); }));
router.get('/stock/movements/:id', defer('M2', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.post('/stock/movements', defer('M2', 'P0', (req) => { requireIdempotencyKey(req); CreateMovementSchema.parse(req.body ?? {}); }));
router.post('/stock/transfers', defer('M2', 'P0', (req) => { requireIdempotencyKey(req); CreateTransferSchema.parse(req.body ?? {}); }));
router.post('/stock/reset', defer('M2', 'P0', (req) => { requireConfirmation(req); StockResetSchema.parse(req.body ?? {}); }));

export default router;
