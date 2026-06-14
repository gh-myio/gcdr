import { Router, Request, Response, NextFunction } from 'express';
import { workOrderService } from '../../services/work-orders/WorkOrderService';
import {
  CreateWorkOrderSchema,
  UpdateWorkOrderSchema,
  ListWorkOrdersSchema,
  AppendWorkOrderEventSchema,
  AddWorkOrderDeviceSchema,
  AddWorkOrderFileSchema,
  ListWorkOrdersDTO,
} from '../../dto/request/work-orders/WorkOrderDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import { ValidationError } from '../../shared/errors/AppError';
import type { ActorContext } from '../../services/work-orders/WorkOrderService';

const router = Router();

// Build the actor context from req.context. API-Key callers (customerId set,
// no userId) record actorType API_KEY; otherwise USER.
function actorOf(req: Request): ActorContext {
  const ctx = req.context as typeof req.context & { userEmail?: string };
  // Customer API key seta ctx.apiKeyId; master key / dev bypass autenticam
  // como SERVICE_ACCOUNT com userId sentinela (00000000-…-0001/0002) que NÃO
  // existe na tabela users — precisa virar API_KEY para o actorEvent gravar
  // actor_user_id = null (FK work_orders_events_actor_user_id_fkey).
  const isApiKey = Boolean(ctx.apiKeyId) || req.user?.type === 'SERVICE_ACCOUNT';
  return {
    userId: ctx.userId,
    actorType: isApiKey ? 'API_KEY' : 'USER',
    actor: {
      id:    ctx.userId,
      email: req.user?.email ?? ctx.userEmail,
    },
  };
}

// =============================================================================
// /wo/work-orders
// =============================================================================

/** GET /wo/work-orders — list (filter: customer, status, type, assignee, device, createdAt range; sortable) */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const {
      customerId, status, type, assignedTo, deviceId,
      createdFrom, createdTo, sort, limit, cursor,
    } = req.query;

    const params: ListWorkOrdersDTO = ListWorkOrdersSchema.parse({
      customerId:  customerId as string | undefined,
      status:      status as string | undefined,
      type:        type as string | undefined,
      assignedTo:  assignedTo as string | undefined,
      deviceId:    deviceId as string | undefined,
      createdFrom: createdFrom as string | undefined,
      createdTo:   createdTo as string | undefined,
      sort:        sort as string | undefined,
      limit:       limit ? parseInt(limit as string, 10) : undefined,
      cursor:      cursor as string | undefined,
    });

    const result = await workOrderService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/work-orders — create */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = CreateWorkOrderSchema.parse(req.body);
    const wo = await workOrderService.create(tenantId, data, actorOf(req));
    sendCreated(res, wo, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/work-orders/:id — detail (+ status, scope, events) */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Work order ID is required');
    const wo = await workOrderService.detail(tenantId, req.params.id);
    sendSuccess(res, wo, 200, requestId);
  } catch (err) { next(err); }
});

/** PATCH /wo/work-orders/:id — update (assignee, schedule, root asset, code) */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Work order ID is required');
    const data = UpdateWorkOrderSchema.parse(req.body);
    const wo = await workOrderService.update(tenantId, req.params.id, data, actorOf(req));
    sendSuccess(res, wo, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/work-orders/:id/transitions — RFC-0041 rules engine: allowed/blocked event-types */
router.get('/:id/transitions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Work order ID is required');
    const result = await workOrderService.getTransitions(tenantId, req.params.id);
    sendSuccess(res, result, 200, requestId);
  } catch (err) { next(err); }
});

/** DELETE /wo/work-orders/:id — soft delete */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    if (!req.params.id) throw new ValidationError('Work order ID is required');
    await workOrderService.delete(tenantId, req.params.id);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// Events
// =============================================================================

/** GET /wo/work-orders/:id/events — timeline */
router.get('/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const events = await workOrderService.listEvents(tenantId, req.params.id);
    sendSuccess(res, { items: events }, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/work-orders/:id/events — append an event */
router.post('/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = AppendWorkOrderEventSchema.parse(req.body);
    const event = await workOrderService.appendEvent(tenantId, req.params.id, data, actorOf(req));
    sendCreated(res, event, requestId);
  } catch (err) { next(err); }
});

// =============================================================================
// Device scope
// =============================================================================

/** GET /wo/work-orders/:id/devices — list scope */
router.get('/:id/devices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const devices = await workOrderService.listDevices(tenantId, req.params.id);
    sendSuccess(res, { items: devices }, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/work-orders/:id/devices — add to scope */
router.post('/:id/devices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = AddWorkOrderDeviceSchema.parse(req.body);
    const device = await workOrderService.addDevice(tenantId, req.params.id, data.deviceId, actorOf(req));
    sendCreated(res, device, requestId);
  } catch (err) { next(err); }
});

/** DELETE /wo/work-orders/:id/devices/:deviceId — remove from scope */
router.delete('/:id/devices/:deviceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await workOrderService.removeDevice(tenantId, req.params.id, req.params.deviceId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// Files
// =============================================================================

/** GET /wo/work-orders/:id/files — list files */
router.get('/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const files = await workOrderService.listFiles(tenantId, req.params.id);
    sendSuccess(res, { items: files }, 200, requestId);
  } catch (err) { next(err); }
});

/**
 * POST /wo/work-orders/:id/files — link a file_asset to the WO.
 * Multipart upload (→ file_assets via FileAssetService) is wired in a follow-up;
 * v1 links an existing fileAssetId.
 */
router.post('/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = AddWorkOrderFileSchema.parse(req.body);
    const file = await workOrderService.addFile(tenantId, req.params.id, data);
    sendCreated(res, file, requestId);
  } catch (err) { next(err); }
});

/** DELETE /wo/work-orders/:id/files/:fileId */
router.delete('/:id/files/:fileId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await workOrderService.deleteFile(tenantId, req.params.id, req.params.fileId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

// =============================================================================
// GET /wo/event-types — active event-type catalog (mounted standalone in app.ts,
// NOT under /wo/work-orders/:id, so it is not shadowed by the /:id matcher).
// =============================================================================
export async function listEventTypesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { requestId } = req.context;
    const types = await workOrderService.listEventTypes();
    sendSuccess(res, types, 200, requestId);
  } catch (err) { next(err); }
}

export default router;
