import { Router, Request, Response, NextFunction } from 'express';
import { requireUuid, requireIdempotencyKey, requireConfirmation } from './shared';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';
import {
  inventoryProductionService,
  CreateAssemblyReleaseSchema,
  CreateReleaseIssueSchema,
  ResolveIssueSchema,
  CorrectAssemblyReleaseSchema,
  SimulatorPreviewSchema,
} from '../../services/inventory/InventoryProductionService';
import {
  inventoryExpeditionService,
  ResolveDemandSchema,
} from '../../services/inventory/InventoryExpeditionService';
import { sendSuccess, sendCreated } from '../../middleware/response';

// M4 — Produção (P2). Real routes (RFC-0061 §M4):
// - Fila de Produção grouped by product with the ALMOXARIFADO balance.
// - Liberação de Montagem: photo + responsibles, FIFO demand consumption and
//   BOM explosion into component SAIDAs — one service transaction.
// - Divergências (issues) + correction with the homologated floor.
// - Capacity and the preview-only simulator (DEC-13).
// Demand resolution ships with M6 (P3, A4) — served by the expedition service.
const router = Router();

// GET /production/demands — pending demands grouped by product (paginated).
router.get('/production/demands', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryProductionService.listDemands(tenantId, page, pageSize);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /production/resolve-demand — §M4 demand resolution (P3, with M6/A4):
// expedition items short on ALMOXARIFADO stock → production demand
// (manufactured) or automatic purchase order + purchase demand (purchasable);
// idempotent per expedition_order_item_id (UNIQUE).
router.post('/production/resolve-demand', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const dto = ResolveDemandSchema.parse(req.body ?? {});
    const data = await inventoryExpeditionService.resolveDemand({ tenantId, userId }, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /production/capacity — min over BOM components; limiting flagged.
router.get('/production/capacity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryProductionService.getCapacity(tenantId, page, pageSize);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /production/simulator/preview — DEC-13: preview-only, NO writes.
router.post('/production/simulator/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const dto = SimulatorPreviewSchema.parse(req.body ?? {});
    const data = await inventoryProductionService.previewSimulation(tenantId, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /assembly-releases — paginated, newest first, with items.
router.get('/assembly-releases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryProductionService.listReleases(tenantId, page, pageSize);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /assembly-releases — release + FIFO demand consumption + BOM SAIDAs in
// one transaction. Creates movements → Idempotency-Key required (S1).
router.post('/assembly-releases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const idempotencyKey = requireIdempotencyKey(req);
    const dto = CreateAssemblyReleaseSchema.parse(req.body ?? {});
    const data = await inventoryProductionService.createRelease({ tenantId, userId }, dto, idempotencyKey);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /assembly-releases/:id/correct — floor at homologated units; delta
// movements (SAIDA/ENTRADA) with loss factor; resolves open issues.
router.post('/assembly-releases/:id/correct', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = CorrectAssemblyReleaseSchema.parse(req.body ?? {});
    const data = await inventoryProductionService.correctRelease({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /assembly-releases/:id — destructive (S3): confirmationToken
// required. Cascades items/issues/homologations; movements NOT reversed.
router.delete('/assembly-releases/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    requireConfirmation(req);
    const data = await inventoryProductionService.deleteRelease({ tenantId, userId }, req.params.id);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// GET /assembly-releases/:id/issues — paginated issue list for one release.
router.get('/assembly-releases/:id/issues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const data = await inventoryProductionService.listIssues(tenantId, req.params.id, page, pageSize);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /assembly-releases/:id/issues — report a divergence (status ABERTA).
router.post('/assembly-releases/:id/issues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = CreateReleaseIssueSchema.parse(req.body ?? {});
    const data = await inventoryProductionService.reportIssue({ tenantId, userId }, req.params.id, dto);
    sendCreated(res, data, requestId);
  } catch (err) {
    next(err);
  }
});

// POST /issues/:id/resolve — resolve one issue (resolved_by/at + note).
router.post('/issues/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    requireUuid('id', req.params.id);
    const dto = ResolveIssueSchema.parse(req.body ?? {});
    const data = await inventoryProductionService.resolveIssue({ tenantId, userId }, req.params.id, dto);
    sendSuccess(res, data, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
