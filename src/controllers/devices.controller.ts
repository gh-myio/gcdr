import { Router, Request, Response, NextFunction } from 'express';
import { deviceService } from '../services/DeviceService';
import {
  CreateDeviceSchema,
  UpdateDeviceSchema,
  MoveDeviceSchema,
  UpdateConnectivitySchema,
  ListDevicesParams
} from '../dto/request/DeviceDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /devices
 * Create a new device
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateDeviceSchema.parse(req.body);
    const device = await deviceService.create(tenantId, data, userId);
    sendCreated(res, device, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /devices
 * List devices
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { assetId, customerId, type, status, connectivityStatus, limit, cursor } = req.query;

    const params: ListDevicesParams = {
      assetId: assetId as string | undefined,
      customerId: customerId as string | undefined,
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
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * DELETE /devices/:id
 * Delete device
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * POST /devices/:id/move
 * Move device to another asset
 */
router.post('/:id/move', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * PATCH /devices/:id/connectivity
 * Update device connectivity status
 */
router.patch('/:id/connectivity', async (req: Request, res: Response, next: NextFunction) => {
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
});

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

export default router;
