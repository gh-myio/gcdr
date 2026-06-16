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
import { resolveDeepCustomers } from '../middleware/deepCustomers';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

// Apply deep customer resolution to all list endpoints
router.use('/', resolveDeepCustomers);

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
      deviceProfile, identifier, ingestionId, ingestionGatewayId,
      label, externalId,
      limit, cursor, page, pageSize,
    } = req.query;

    const resolvedLimit = pageSize
      ? parseInt(pageSize as string, 10)
      : limit ? parseInt(limit as string, 10) : 20;

    const resolvedCursor = page
      ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
      : cursor as string | undefined;

    // Hierarchy scoping: allowedCustomerIds (deep) > customerId (SELF from API key) > query param
    const { allowedCustomerIds, customerId: ctxCustomerId } = req.context;
    const resolvedCustomerId = !allowedCustomerIds
      ? (ctxCustomerId ?? customerId as string | undefined)
      : undefined;

    const params: ListDevicesParams = {
      assetId: assetId as string | undefined,
      customerId: resolvedCustomerId,
      customerIds: allowedCustomerIds,
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      centralId: centralId as string | undefined,
      slaveId: slaveId ? parseInt(slaveId as string, 10) : undefined,
      search: (search || name) as string | undefined,
      deviceProfile: deviceProfile as string | undefined,
      identifier: identifier as string | undefined,
      ingestionId: ingestionId as string | undefined,
      ingestionGatewayId: ingestionGatewayId as string | undefined,
      label: label as string | undefined,
      externalId: externalId as string | undefined,
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
 * GET /devices/exists?name=<value>[&caseSensitive=true|false]
 *
 * Tenant-wide existence check for a device name (NOT scoped to a customer).
 * The unique constraint is (tenant_id, customer_id, name), so the same name
 * can repeat across customers — this endpoint reports the global count in
 * the tenant. If the caller is restricted by deepCustomers middleware
 * (allowedCustomerIds set), the count is narrowed to that scope.
 *
 * Query params:
 *   - name           (required, trimmed, max 255 chars)
 *   - customerId     (optional, uuid) — narrow the check to a single customer,
 *                     matching the real unique constraint (tenant, customer,
 *                     name). Honored within any deepCustomers restriction.
 *   - caseSensitive  (optional, default `true` — matches the unique-index
 *                     behavior; pass `false` to treat `Foo` / `FOO` / `foo`
 *                     as the same name)
 *
 * Response: { exists: boolean, count: number, caseSensitive: boolean }
 */
router.get('/exists', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId, allowedCustomerIds } = req.context;
    const name = (req.query.name as string | undefined)?.trim();
    if (!name) {
      throw new ValidationError('Query param "name" is required');
    }
    if (name.length > 255) {
      throw new ValidationError('Query param "name" must be <= 255 chars');
    }

    // Optional explicit customer scope. If the caller is already restricted by
    // deepCustomers, intersect so an explicit id can't widen the scope.
    const explicitCustomerId = (req.query.customerId as string | undefined)?.trim();
    let customerIds = allowedCustomerIds;
    if (explicitCustomerId) {
      customerIds = allowedCustomerIds
        ? allowedCustomerIds.filter((id) => id === explicitCustomerId)
        : [explicitCustomerId];
    }

    // caseSensitive: 'false' or '0' disables; everything else (including
    // missing) defaults to true. Aligned with the unique-index behavior.
    const csRaw = (req.query.caseSensitive as string | undefined)?.toLowerCase();
    const caseSensitive = !(csRaw === 'false' || csRaw === '0');

    const result = await deviceService.existsByName(tenantId, name, {
      customerIds,
      caseSensitive,
    });
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
const updateDeviceHandler = [
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
];

router.put('/:id', ...updateDeviceHandler);
router.patch('/:id', ...updateDeviceHandler);

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
    const { type, status, connectivityStatus, limit, cursor, page, pageSize } = req.query;

    if (!assetId) {
      throw new ValidationError('Asset ID is required');
    }

    const resolvedLimit = pageSize
      ? parseInt(pageSize as string, 10)
      : limit ? parseInt(limit as string, 10) : 20;

    const resolvedCursor = page
      ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
      : cursor as string | undefined;

    const params: ListDevicesParams = {
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      limit: resolvedLimit,
      cursor: resolvedCursor,
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
    const { type, status, connectivityStatus, limit, cursor, page, pageSize } = req.query;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const resolvedLimit = pageSize
      ? parseInt(pageSize as string, 10)
      : limit ? parseInt(limit as string, 10) : 20;

    const resolvedCursor = page
      ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
      : cursor as string | undefined;

    const params: ListDevicesParams = {
      customerId,
      type: type as string | undefined,
      status: status as string | undefined,
      connectivityStatus: connectivityStatus as string | undefined,
      limit: resolvedLimit,
      cursor: resolvedCursor,
    };

    const result = await deviceService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
