import { Router } from 'express';
import { defer, requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';

// M4 — Produção (P2; demand resolution P3 — A4)
const router = Router();

router.get('/production/demands', defer('M4', 'P2'));
router.post('/production/resolve-demand', defer('M4', 'P3'));
router.get('/production/capacity', defer('M4', 'P2'));
router.post('/production/simulator/preview', defer('M4', 'P2'));

router.get('/assembly-releases', defer('M4', 'P2'));
router.post('/assembly-releases', defer('M4', 'P2', (req) => { requireIdempotencyKey(req); }));
router.post('/assembly-releases/:id/correct', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.delete('/assembly-releases/:id', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));
router.get('/assembly-releases/:id/issues', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/assembly-releases/:id/issues', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));
router.post('/issues/:id/resolve', defer('M4', 'P2', (req) => { requireUuid('id', req.params.id); }));

export default router;
