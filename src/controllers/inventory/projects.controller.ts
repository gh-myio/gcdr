import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireConfirmation } from './shared';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  PaginationQuerySchema,
} from '../../dto/request/InventoryDTO';
import { sendSuccess, sendCreated } from '../../middleware/response';
import { inventoryProjectService } from '../../services/inventory/InventoryProjectService';

// M9 — Projetos (P1). Auth (hybridAuthByMethod inventory:read/inventory:write)
// is mounted in app.ts; this router only validates, delegates and responds.
const router = Router();

/** GET /projects — paginated list (total/totalPages per convention). */
router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = PaginationQuerySchema.parse(req.query);

    const result = await inventoryProjectService.listProjects(tenantId, query);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/** POST /projects — create (customerId, when present, must exist in tenant). */
router.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateProjectSchema.parse(req.body ?? {});

    const project = await inventoryProjectService.createProject(tenantId, data, userId);
    sendCreated(res, project, requestId);
  } catch (err) {
    next(err);
  }
});

/** PATCH /projects/:id — partial update. */
router.patch('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const data = UpdateProjectSchema.parse(req.body ?? {});

    const project = await inventoryProjectService.updateProject(tenantId, req.params.id, data, userId);
    sendSuccess(res, project, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/** DELETE /projects/:id — destructive; requires confirmation token (S3). */
router.delete('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    requireUuid('id', req.params.id);
    requireConfirmation(req);

    await inventoryProjectService.deleteProject(tenantId, req.params.id);
    sendSuccess(res, { id: req.params.id, deleted: true }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
