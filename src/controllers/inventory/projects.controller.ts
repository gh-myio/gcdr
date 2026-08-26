import { Router } from 'express';
import { defer, requireUuid, requireConfirmation } from './shared';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  PaginationQuerySchema,
} from '../../dto/request/InventoryDTO';

// M9 — Projetos (P1)
const router = Router();

router.get('/projects', defer('M9', 'P1', (req) => { PaginationQuerySchema.parse(req.query); }));
router.post('/projects', defer('M9', 'P1', (req) => { CreateProjectSchema.parse(req.body ?? {}); }));
router.patch('/projects/:id', defer('M9', 'P1', (req) => { requireUuid('id', req.params.id); UpdateProjectSchema.parse(req.body ?? {}); }));
router.delete('/projects/:id', defer('M9', 'P1', (req) => { requireUuid('id', req.params.id); requireConfirmation(req); }));

export default router;
