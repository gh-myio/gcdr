import { Router } from 'express';
import { defer, requireUuid, requireIdempotencyKey } from './shared';
import { QrValidateSchema } from '../../dto/request/InventoryDTO';

// M5 — Homologação & QR (P2)
const router = Router();

router.get('/homologations', defer('M5', 'P2'));
router.post('/homologations', defer('M5', 'P2', (req) => { requireIdempotencyKey(req); }));
router.get('/homologations/boxes', defer('M5', 'P2'));
router.post('/homologations/boxes/:id/add-unit', defer('M5', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/homologations/units/:id/remove-from-box', defer('M5', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/qr/generate', defer('M5', 'P2'));
router.get('/qr/trace/:code', defer('M5', 'P2'));
router.post('/qr/validate', defer('M5', 'P2', (req) => { QrValidateSchema.parse(req.body ?? {}); }));

export default router;
