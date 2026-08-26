import { Router } from 'express';
import { defer, requireUuid, requireConfirmation } from './shared';
import {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  PurchaseOrderListQuerySchema,
  PurchaseOrderFilesSchema,
} from '../../dto/request/InventoryDTO';

// M3 — Compras (P1)
const router = Router();

router.get('/purchase-orders', defer('M3', 'P1', (req) => { PurchaseOrderListQuerySchema.parse(req.query); }));
router.post('/purchase-orders', defer('M3', 'P1', (req) => { CreatePurchaseOrderSchema.parse(req.body ?? {}); }));
router.get('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.patch('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); UpdatePurchaseOrderSchema.parse(req.body ?? {}); }));
router.post('/purchase-orders/:id/status', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); PurchaseOrderStatusSchema.parse(req.body ?? {}); }));
router.get('/purchase-orders/:id/events', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.post('/purchase-orders/:id/files', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); PurchaseOrderFilesSchema.parse(req.body ?? {}); }));
router.delete('/purchase-orders/:id/files', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); }));
router.delete('/purchase-orders/:id', defer('M3', 'P1', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));

export default router;
