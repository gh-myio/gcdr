import { Router } from 'express';
import { defer, requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';

// M6 — Expedição (P3)
const router = Router();

router.get('/expedition-orders', defer('M6', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/expedition-orders', defer('M6', 'P3'));
router.get('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.patch('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.delete('/expedition-orders/:id', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.post('/expedition-orders/:id/status', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/items/:itemId/deliver', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); requireUuid('itemId', req.params.itemId); requireIdempotencyKey(req); }));
router.post('/expedition-orders/:id/ship', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/return', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/lost', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/expedition-orders/:id/found', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.get('/expedition-orders/:id/transit-progress', defer('M6', 'P3', (req) => { requireUuid('id', req.params.id); }));

export default router;
