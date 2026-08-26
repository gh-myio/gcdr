import { Router } from 'express';
import { defer } from './shared';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';

// M8 — Sync externo (P2 shadow → P4 live)
const router = Router();

router.get('/external/states', defer('M8', 'P2', (req) => { PaginationQuerySchema.parse(req.query); }));
router.get('/external/sync/status', defer('M8', 'P2'));
router.post('/external/sync/run', defer('M8', 'P4'));

export default router;
