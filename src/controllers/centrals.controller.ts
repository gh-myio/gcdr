import { Router, Request, Response, NextFunction } from 'express';
import { centralRepository } from '../repositories/CentralRepository';
import {
  CreateCentralSchema,
  UpdateCentralSchema,
  UpdateCentralStatusSchema,
  UpdateConnectionStatusSchema,
  ListCentralsDTO,
} from '../dto/request/CentralDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /centrals
 * Create a new central
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateCentralSchema.parse(req.body);
    const central = await centralRepository.create(tenantId, data, userId);
    sendCreated(res, central, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals
 * List centrals
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, assetId, type, status, connectionStatus, limit, cursor } = req.query;

    const params: ListCentralsDTO = {
      customerId: customerId as string | undefined,
      assetId: assetId as string | undefined,
      type: type as ListCentralsDTO['type'],
      status: status as ListCentralsDTO['status'],
      connectionStatus: connectionStatus as ListCentralsDTO['connectionStatus'],
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await centralRepository.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id
 * Get central by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const central = await centralRepository.getById(tenantId, id);
    if (!central) {
      throw new ValidationError('Central not found');
    }

    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/serial/:serialNumber
 * Get central by serial number
 */
router.get('/serial/:serialNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { serialNumber } = req.params;

    if (!serialNumber) {
      throw new ValidationError('Serial number is required');
    }

    const central = await centralRepository.getBySerialNumber(tenantId, serialNumber);
    if (!central) {
      throw new ValidationError('Central not found');
    }

    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /centrals/:id
 * Update central
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const data = UpdateCentralSchema.parse(req.body);
    const central = await centralRepository.update(tenantId, id, data, userId);
    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /centrals/:id/status
 * Update central status
 */
router.patch('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const data = UpdateCentralStatusSchema.parse(req.body);
    const central = await centralRepository.updateStatus(tenantId, id, data.status, userId);
    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /centrals/:id/connection
 * Update central connection status (from heartbeat)
 */
router.patch('/:id/connection', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const data = UpdateConnectionStatusSchema.parse(req.body);
    const central = await centralRepository.updateConnectionStatus(tenantId, id, data.connectionStatus, data.stats);
    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /centrals/:id/heartbeat
 * Record central heartbeat
 */
router.post('/:id/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const stats = req.body.stats || {};
    await centralRepository.recordHeartbeat(tenantId, id, stats);
    sendSuccess(res, { message: 'Heartbeat recorded' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /centrals/:id
 * Delete central
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    await centralRepository.delete(tenantId, id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/centrals
 * List centrals by customer (mounted in app.ts)
 */
export const listByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const centrals = await centralRepository.listByCustomer(tenantId, customerId);
    sendSuccess(res, { items: centrals }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /assets/:assetId/centrals
 * List centrals by asset (mounted in app.ts)
 */
export const listByAssetHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { assetId } = req.params;

    if (!assetId) {
      throw new ValidationError('Asset ID is required');
    }

    const centrals = await centralRepository.listByAsset(tenantId, assetId);
    sendSuccess(res, { items: centrals }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
