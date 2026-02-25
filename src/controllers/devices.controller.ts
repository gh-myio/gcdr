import { Router, Request, Response, NextFunction } from 'express';
import { deviceService } from '../services/DeviceService';
import { ruleService } from '../services/RuleService';
import {
  CreateDeviceSchema,
  UpdateDeviceSchema,
  MoveDeviceSchema,
  UpdateConnectivitySchema,
  ListDevicesParams
} from '../dto/request/DeviceDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

/**
 * POST /devices
 * Create a new device
 */
router.post('/',
  logEvent({
    eventType: EventType.DEVICE_CREATED,
    description: (req) => `Device "${req.body.name}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getCustomerId: (req) => req.body.customerId,
    getMetadata: (req) => ({
      serialNumber: req.body.serialNumber,
      type: req.body.type,
      assetId: req.body.assetId,
    }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateDeviceSchema.parse(req.body);
      const device = await deviceService.create(tenantId, data, userId);
      sendCreated(res, device, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /devices
 * List devices
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const {
      assetId, customerId, type, status, connectivityStatus,
      centralId, slaveId,
      search, name,
      limit, cursor, page, pageSize,
    } = req.query;

    const resolvedLimit = pageSize
      ? parseInt(pageSize as string, 10)
      : limit ? parseInt(limit as string, 10) : 20;

    const resolvedCursor = page
      ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
      : cursor as string | undefined;

    const params: ListDevicesParams = {
      assetId: assetId as string | undefined,
      customerId: customerId as string | undefined,
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      centralId: centralId as string | undefined,
      slaveId: slaveId ? parseInt(slaveId as string, 10) : undefined,
      search: (search || name) as string | undefined,
      limit: resolvedLimit,
      cursor: resolvedCursor,
    };

    const result = await deviceService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /devices/external/:externalId
 * Get device by ThingsBoard / external ID — returns enriched payload with asset, customer and rules
 */
router.get('/external/:externalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { externalId } = req.params;

    if (!externalId) {
      throw new ValidationError('External ID is required');
    }

    const { device, asset, customer, rules } = await deviceService.getEnrichedByExternalId(tenantId, externalId);

    const payload = {
      device,
      asset: asset ? {
        id: asset.id,
        name: asset.name,
        displayName: asset.displayName,
        code: asset.code,
        type: asset.type,
        status: asset.status,
      } : null,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        displayName: customer.displayName,
        code: customer.code,
        type: customer.type,
        status: customer.status,
      } : null,
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        priority: r.priority,
        enabled: r.enabled,
        status: r.status,
        scope: r.scope,
        alarmConfig: r.alarmConfig,
        slaConfig: r.slaConfig,
        escalationConfig: r.escalationConfig,
        maintenanceConfig: r.maintenanceConfig,
        notificationChannels: r.notificationChannels,
        tags: r.tags,
        lastTriggeredAt: r.lastTriggeredAt,
        triggerCount: r.triggerCount,
      })),
    };

    sendSuccess(res, payload, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /devices/:id/rules
 * List rules applicable to a device (GLOBAL + CUSTOMER + ASSET + DEVICE scope)
 */
router.get('/:id/rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    const device = await deviceService.getById(tenantId, id);
    const items = await ruleService.getApplicableForDevice(
      tenantId,
      device.id,
      device.customerId,
      device.assetId
    );

    sendSuccess(res, { items, count: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /devices/:id
 * Get device by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Device ID is required');
    }

    const device = await deviceService.getById(tenantId, id);
    sendSuccess(res, device, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /devices/:id
 * Update device
 */
router.put('/:id',
  logEvent({
    eventType: EventType.DEVICE_UPDATED,
    description: (req) => `Device ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ updatedFields: Object.keys(req.body) }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Device ID is required');
      }

      const data = UpdateDeviceSchema.parse(req.body);
      const device = await deviceService.update(tenantId, id, data, userId);
      sendSuccess(res, device, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /devices/:id
 * Delete device
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.DEVICE_DELETED,
    description: (req) => `Device ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Device ID is required');
      }

      await deviceService.delete(tenantId, id, userId);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /devices/:id/move
 * Move device to another asset
 */
router.post('/:id/move',
  logEvent({
    eventType: EventType.DEVICE_MOVED,
    description: (req) => `Device ${req.params.id} moved to asset ${req.body.newAssetId}`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req, res) => res.locals.responseBody?.data?.customerId,
    getMetadata: (req) => ({ newAssetId: req.body.newAssetId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Device ID is required');
      }

      const data = MoveDeviceSchema.parse(req.body);
      const device = await deviceService.move(tenantId, id, data, userId);
      sendSuccess(res, device, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /devices/:id/connectivity
 * Update device connectivity status
 */
router.patch('/:id/connectivity',
  logEvent({
    eventType: EventType.DEVICE_CONNECTIVITY_CHANGED,
    description: (req) => `Device ${req.params.id} connectivity changed to ${req.body.connectivityStatus}`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ connectivityStatus: req.body.connectivityStatus }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Device ID is required');
      }

      const data = UpdateConnectivitySchema.parse(req.body);
      const device = await deviceService.updateConnectivityStatus(tenantId, id, data.connectivityStatus);
      sendSuccess(res, device, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /assets/:assetId/devices
 * List devices by asset (mounted in app.ts)
 */
export const listByAssetHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { assetId } = req.params;
    const { type, status, connectivityStatus, limit, cursor } = req.query;

    if (!assetId) {
      throw new ValidationError('Asset ID is required');
    }

    const params: ListDevicesParams = {
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await deviceService.listByAsset(tenantId, assetId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /customers/:customerId/devices
 * List devices by customer (mounted in app.ts)
 */
export const listByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    const { type, status, connectivityStatus, limit, cursor } = req.query;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const params: ListDevicesParams = {
      customerId,
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await deviceService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
