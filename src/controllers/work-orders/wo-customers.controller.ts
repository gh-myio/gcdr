import { Router, Request, Response, NextFunction } from 'express';
import { workOrdersCustomerSettingsService } from '../../services/work-orders/WorkOrdersCustomerSettingsService';
import { workOrderService } from '../../services/work-orders/WorkOrderService';
import { customerRepository } from '../../repositories/CustomerRepository';
import { deviceRepository } from '../../repositories/DeviceRepository';
import { authService } from '../../services/AuthService';
import {
  EnableWoCustomerSchema,
  UpdateWoCustomerSettingsSchema,
  ViewerLoginSchema,
} from '../../dto/request/work-orders/CustomerSettingsDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../../middleware';
import { authMiddleware } from '../../middleware/auth';
import { NotFoundError, ValidationError, UnauthorizedError } from '../../shared/errors/AppError';
import { toCustomerResponseDTO, toCustomerResponseDTOList } from '../../dto/response/CustomerResponseDTO';

const router = Router();

// =============================================================================
// /wo/customers
//
// Returns ONLY WO-enabled customers (those with a row in
// work_orders_customer_settings). Carried over from the old QR-Checker surface
// (RFC-0037 §API). Observations/installations are replaced by the work-order
// event model + (generalized) annotations.
// =============================================================================

/** GET /wo/customers — list WO-enabled customers (?include=stats for WO counts) */
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const includeStats = req.query.include === 'stats';

    const settings = await workOrdersCustomerSettingsService.listEnabled(tenantId);
    const customers = await Promise.all(
      settings.map((s) => customerRepository.getById(tenantId, s.customerId)),
    );
    const live = customers.filter((c): c is NonNullable<typeof c> => Boolean(c));

    if (!includeStats) {
      sendSuccess(res, { items: toCustomerResponseDTOList(live) }, 200, requestId);
      return;
    }

    const enriched = await Promise.all(
      live.map(async (c) => {
        const wo = await workOrderService.list(tenantId, { customerId: c.id, limit: 1 });
        return { ...toCustomerResponseDTO(c), wo: { total: wo.pagination.total ?? 0 } };
      }),
    );
    sendSuccess(res, { items: enriched }, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/customers/by-code/:code — slug → customerId resolver */
router.get('/by-code/:code', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const customer = await customerRepository.getByCode(tenantId, req.params.code);
    if (!customer) throw new NotFoundError(`Customer with code ${req.params.code} not found`);

    const settings = await workOrdersCustomerSettingsService.getByCustomerId(tenantId, customer.id);
    if (!settings) throw new NotFoundError(`Customer ${customer.id} is not WO-enabled`);

    sendSuccess(res, toCustomerResponseDTO(customer), 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/customers/:customerId/enable */
router.post('/:customerId/enable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = EnableWoCustomerSchema.parse(req.body);
    const settings = await workOrdersCustomerSettingsService.enable(
      tenantId, req.params.customerId,
      {
        defaultCentralId: data.defaultCentralId ?? null,
        viewerPassword:   data.viewerPassword ?? null,
        woMetadata:       data.woMetadata ?? {},
      },
      userId,
    );
    sendCreated(res, settings, requestId);
  } catch (err) { next(err); }
});

/** PATCH /wo/customers/:customerId/settings */
router.patch('/:customerId/settings', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateWoCustomerSettingsSchema.parse(req.body);
    const updated = await workOrdersCustomerSettingsService.update(tenantId, req.params.customerId, data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/customers/:customerId/disable — drops the settings row */
router.post('/:customerId/disable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await workOrdersCustomerSettingsService.disable(tenantId, req.params.customerId);
    sendNoContent(res);
  } catch (err) { next(err); }
});

/**
 * POST /wo/customers/:customerId/viewer-login  (PUBLIC)
 *
 * Viewer password gate. Issues a short-lived JWT with role:wo-viewer scoped to
 * a single customer. No JWT required to call this; the password authenticates
 * the viewer.
 */
router.post('/:customerId/viewer-login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId, ip } = req.context;
    if (!tenantId) throw new ValidationError('X-Tenant-Id header is required');

    const { password } = ViewerLoginSchema.parse(req.body);
    const ok = await workOrdersCustomerSettingsService.verifyViewerPassword(tenantId, req.params.customerId, password);
    if (!ok) throw new UnauthorizedError('Senha de viewer invalida');

    const customer = await customerRepository.getById(tenantId, req.params.customerId);
    if (!customer) throw new NotFoundError(`Customer ${req.params.customerId} not found`);

    const token = authService.signViewerJwt({
      tenantId,
      customerId: customer.id,
      ip: ip || 'unknown',
    });
    sendSuccess(res, {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 3600,
      customer: toCustomerResponseDTO(customer),
    }, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/customers/:customerId/devices — devices for a WO-enabled customer */
router.get('/:customerId/devices', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const devices = await deviceRepository.listByCustomer(tenantId, req.params.customerId, { limit: 1000 });
    sendSuccess(res, { items: devices.items, pagination: devices.pagination }, 200, requestId);
  } catch (err) { next(err); }
});

/**
 * GET /wo/customers/:customerId/observations
 *
 * Observations now reuse the (generalized) RFC-0036 annotations subsystem,
 * owned by the annotations domain. This endpoint lists the customer's work
 * orders so a client can fan out to the annotations API per WO/event. Direct
 * observation CRUD moved to /annotations?entityType=work_order&entityId=:id.
 */
router.get('/:customerId/observations', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const workOrders = await workOrderService.list(tenantId, { customerId: req.params.customerId, limit: 1000 });
    sendSuccess(res, {
      items: [],
      workOrders: workOrders.items,
      note: 'Observations are served by /annotations (entityType=work_order|work_order_event).',
    }, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/customers/:customerId/report — WO summary by status/type (JSON only) */
router.get('/:customerId/report', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const format = (req.query.format as string | undefined) ?? 'json';
    if (format !== 'json') {
      throw new ValidationError(`Format "${format}" not implemented yet (use ?format=json)`);
    }

    const all = await workOrderService.list(tenantId, { customerId: req.params.customerId, limit: 100 });
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const wo of all.items) {
      byStatus[wo.status] = (byStatus[wo.status] ?? 0) + 1;
      byType[wo.type] = (byType[wo.type] ?? 0) + 1;
    }

    sendSuccess(res, {
      customerId: req.params.customerId,
      total: all.pagination.total ?? all.items.length,
      byStatus,
      byType,
    }, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
