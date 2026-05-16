import { Router, Request, Response, NextFunction } from 'express';
import { centralRepository } from '../repositories/CentralRepository';
import { centralService } from '../services/CentralService';
import {
  CreateCentralSchema,
  UpdateCentralSchema,
  UpdateCentralStatusSchema,
  UpdateConnectionStatusSchema,
  ListCentralsDTO,
} from '../dto/request/CentralDTO';
import { customerIntegrationService } from '../services/CustomerIntegrationService';
import {
  SetMqttPasswordInputSchema,
  MqttIntegrationIdParamSchema,
} from '../dto/request/CustomerIntegrationDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';
import { EventType, ActorType } from '../shared/types';

const router = Router();

/**
 * POST /centrals
 * Create a new central
 */
router.post('/',
  logEvent({
    eventType: EventType.CENTRAL_CREATED,
    description: (req) => `Central "${req.body.name}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getCustomerId: (req) => req.body.customerId,
    getMetadata: (req) => ({ serialNumber: req.body.serialNumber, type: req.body.type }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateCentralSchema.parse(req.body);
      const central = await centralRepository.create(tenantId, data, userId);
      sendCreated(res, central, requestId);
    } catch (err) {
      next(err);
    }
  }
);

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

    const result = await centralService.list(tenantId, params);
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

    const central = await centralService.getById(tenantId, id);
    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id/statistics
 * Get central runtime statistics (passthrough of stats JSONB column)
 */
router.get('/:id/statistics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Central ID is required');
    }

    const central = await centralRepository.getById(tenantId, id);
    if (!central) {
      throw new NotFoundError('Central not found');
    }

    sendSuccess(res, central.stats, 200, requestId);
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

    const central = await centralService.getBySerialNumber(tenantId, serialNumber);
    sendSuccess(res, central, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /centrals/:id
 * Update central
 */
router.put('/:id',
  logEvent({
    eventType: EventType.CENTRAL_UPDATED,
    description: (req) => `Central ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ updatedFields: Object.keys(req.body) }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Central ID is required');
      }

      const data = UpdateCentralSchema.parse(req.body);
      const central = await centralService.update(tenantId, id, data, userId);
      sendSuccess(res, central, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /centrals/:id/status
 * Update central status
 */
router.patch('/:id/status',
  logEvent({
    eventType: EventType.CENTRAL_STATUS_CHANGED,
    description: (req) => `Central ${req.params.id} status changed to ${req.body.status}`,
    getEntityId: (req) => req.params.id,
    getMetadata: (req) => ({ status: req.body.status }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

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
 * PUT /centrals/:id/mqtt-passwords/:integrationId
 * Set the MQTT password for one (central, integration) pair (RFC-0035).
 * Body: { password: string }. Writes to
 * customers.metadata.integrations.centrals.items[uuid].mqttPasswords[integrationId].
 * Creates the items[] entry if absent for the uuid.
 */
router.put('/:id/mqtt-passwords/:integrationId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Central ID is required');
      }

      const central = await centralService.getById(tenantId, id);
      const { integrationId } = MqttIntegrationIdParamSchema.parse({ integrationId: req.params.integrationId });
      const { password } = SetMqttPasswordInputSchema.parse(req.body ?? {});

      await customerIntegrationService.upsertCentralPassword(
        tenantId,
        central.customerId,
        id,
        integrationId,
        password,
        {
          userId,
          userEmail:  (req.context as { userEmail?: string }).userEmail,
          actorType:  ActorType.USER,
          actorLabel: userId,
          requestId,
        },
      );

      const updated = await centralService.getById(tenantId, id);
      sendSuccess(res, updated, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /centrals/:id/mqtt-passwords/:integrationId
 * Clear the MQTT password for one (central, integration) pair.
 */
router.delete('/:id/mqtt-passwords/:integrationId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Central ID is required');
      }

      const central = await centralService.getById(tenantId, id);
      const { integrationId } = MqttIntegrationIdParamSchema.parse({ integrationId: req.params.integrationId });

      await customerIntegrationService.upsertCentralPassword(
        tenantId,
        central.customerId,
        id,
        integrationId,
        undefined,
        {
          userId,
          userEmail:  (req.context as { userEmail?: string }).userEmail,
          actorType:  ActorType.USER,
          actorLabel: userId,
          requestId,
        },
      );

      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /centrals/:id/mqtt-passwords/:integrationId/reveal
 * Return the plaintext MQTT password for one (central, integration) pair.
 * Audit-logged on every successful call (CUSTOMER_INTEGRATION_CREDENTIALS_REVEALED
 * with metadata.integrationId). POST (not GET) so caches and shareable URLs
 * cannot capture the response. Auth at mount time gates this with the same
 * scope as the rest of /centrals — promote to a credentials-read scope when
 * the RBAC layer surfaces one.
 */
router.post('/:id/mqtt-passwords/:integrationId/reveal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Central ID is required');
      }

      const central = await centralService.getById(tenantId, id);
      const { integrationId } = MqttIntegrationIdParamSchema.parse({ integrationId: req.params.integrationId });

      const result = await customerIntegrationService.revealCentralPassword(
        tenantId,
        central.customerId,
        id,
        integrationId,
        {
          userId,
          userEmail:  (req.context as { userEmail?: string }).userEmail,
          actorType:  ActorType.USER,
          actorLabel: userId,
          requestId,
        },
      );
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /centrals/:id
 * Delete central
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.CENTRAL_DELETED,
    description: (req) => `Central ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

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

    const centrals = await centralService.listByCustomer(tenantId, customerId);
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

    const centrals = await centralService.listByAsset(tenantId, assetId);
    sendSuccess(res, { items: centrals }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
