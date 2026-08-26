import { Router } from 'express';
import { defer, requireUuid } from './shared';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';

// M7 — Campo (P3)
const router = Router();

router.get('/unit-products', defer('M7', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/unit-products', defer('M7', 'P3'));
router.patch('/unit-products/:id', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.post('/unit-products/:id/move', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));
router.get('/technician-items', defer('M7', 'P3'));
router.post('/technician-moves', defer('M7', 'P3'));
router.get('/damaged-items', defer('M7', 'P3', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/damaged-items', defer('M7', 'P3'));
router.post('/damaged-items/:id/recover', defer('M7', 'P3', (req) => { requireUuid('id', req.params.id); }));

export default router;
