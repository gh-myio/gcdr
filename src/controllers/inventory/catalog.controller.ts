import { Router } from 'express';
import { defer, requireUuid, requireConfirmation } from './shared';
import {
  CreateItemSchema,
  UpdateItemSchema,
  ItemListQuerySchema,
  PutBomSchema,
} from '../../dto/request/InventoryDTO';

// M1 — Catálogo & BOM (P0)
const router = Router();

router.get('/items', defer('M1', 'P0', (req) => { ItemListQuerySchema.parse(req.query); }));
router.post('/items', defer('M1', 'P0', (req) => { CreateItemSchema.parse(req.body ?? {}); }));
router.get('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.patch('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); UpdateItemSchema.parse(req.body ?? {}); }));
router.delete('/items/:id', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.get('/items/:id/stock', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.get('/items/:id/bom', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); }));
router.put('/items/:id/bom', defer('M1', 'P0', (req) => { requireUuid('id', req.params.id); PutBomSchema.parse(req.body ?? {}); }));

export default router;
