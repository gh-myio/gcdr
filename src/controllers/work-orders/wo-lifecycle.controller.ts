import { Router, Request, Response, NextFunction } from 'express';
import { workOrderService } from '../../services/work-orders/WorkOrderService';
import { ReplaceLifecycleRulesSchema } from '../../dto/request/work-orders/LifecycleRuleDTO';
import { sendSuccess } from '../../middleware';

const router = Router();

// =============================================================================
// /wo/lifecycle-rules  — RFC-0041 Phase 3: edit a tenant's WO flow.
// =============================================================================

/** GET /wo/lifecycle-rules — the tenant's full rule set (incl. inactive). */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const rules = await workOrderService.listLifecycleRules(tenantId);
    sendSuccess(res, { items: rules }, 200, requestId);
  } catch (err) { next(err); }
});

/** PUT /wo/lifecycle-rules — replace the tenant's whole flow (validated). */
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { rules } = ReplaceLifecycleRulesSchema.parse(req.body);
    await workOrderService.replaceLifecycleRules(tenantId, rules);
    const saved = await workOrderService.listLifecycleRules(tenantId);
    sendSuccess(res, { items: saved }, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
