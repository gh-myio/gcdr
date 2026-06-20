import { Router, Request, Response, NextFunction } from 'express';
import { centralRepository } from '../repositories/CentralRepository';
import { centralService } from '../services/CentralService';
import { centralBackupService } from '../services/CentralBackupService';
import {
  CreateCentralSchema,
  UpdateCentralSchema,
  UpdateCentralStatusSchema,
  UpdateConnectionStatusSchema,
  ListCentralsDTO,
} from '../dto/request/CentralDTO';
import {
  CreateCentralBackupSchema,
  ConfirmCentralBackupSchema,
} from '../dto/request/CentralBackupDTO';
import { centralRestoreService } from '../services/CentralRestoreService';
import {
  StartRestoreSchema,
  UpdateRestoreProgressSchema,
} from '../dto/request/CentralRestoreDTO';
import { centralEnrollmentService } from '../services/CentralEnrollmentService';
import { customerIntegrationService } from '../services/CustomerIntegrationService';
import {
  SetMqttPasswordInputSchema,
  MqttIntegrationIdParamSchema,
} from '../dto/request/CustomerIntegrationDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';
import { EventType, ActorType } from '../shared/types';

const ERR_CENTRAL_ID_REQUIRED = 'Central ID is required';

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
      throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
      throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
 * POST /centrals/:id/enroll-token
 * Issue a one-time enroll token for zero-touch provisioning (Slice 1.5). Stores
 * only sha256(token) + a 24h expiry on the central; returns the PLAINTEXT token
 * once (operator burns it into the central's .bootstrap at flash time). The
 * central later exchanges it for its agent_secret via POST /central-agent/enroll.
 */
router.post('/:id/enroll-token',
  logEvent({
    eventType: EventType.CENTRAL_ENROLL_TOKEN_ISSUED,
    description: (req) => `Enroll token issued for central ${req.params.id}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
      }

      const result = await centralEnrollmentService.issueEnrollToken(tenantId, id);
      sendCreated(res, result, requestId);
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
      throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
      throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
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

/**
 * GET /centrals/serial/available?value=S1.S2.S3.S4   (PUBLIC, no auth)
 * Checks a specific central_id: validates format + global collision.
 */
export const serialAvailableHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = req.context?.requestId;
    const value = String(req.query.value ?? '').trim();
    if (!value) {
      throw new ValidationError('Query param "value" is required');
    }
    const valid = centralService.isValidSerial(value);
    const available = valid ? await centralService.isSerialAvailable(value) : false;
    sendSuccess(res, { value, valid, available }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /centrals/serial/next   (PUBLIC, no auth)
 * Returns a collision-free central_id (S1.S2.S3.S4, each slot 1..254).
 */
export const serialNextHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = req.context?.requestId;
    const centralId = await centralService.findAvailableSerial();
    sendSuccess(res, { centralId }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Backup / Restore (field-swap). The CENTRAL runs pg_dump/pg_restore on its own
// embedded Postgres; these endpoints only broker presigned S3 URLs + track
// central_backups. Phase 1: standalone backup + download.
// ---------------------------------------------------------------------------

/**
 * POST /centrals/:id/backup
 * Request a backup slot — returns a presigned PUT URL the central uploads to.
 */
router.post('/:id/backup',
  logEvent({
    eventType: EventType.CENTRAL_BACKUP_INITIATED,
    description: (req) => `Backup requested for central ${req.params.id}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const dto = CreateCentralBackupSchema.parse(req.body ?? {});
      const result = await centralBackupService.createBackup(tenantId, req.params.id, userId, dto);
      sendCreated(res, result, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /centrals/:id/backups/:backupId/confirm
 * Central confirms the upload finished (sha256 + byteSize) → status AVAILABLE.
 */
router.post('/:id/backups/:backupId/confirm',
  logEvent({
    eventType: EventType.CENTRAL_BACKUP_CONFIRMED,
    description: (req) => `Backup ${req.params.backupId} confirmed for central ${req.params.id}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const dto = ConfirmCentralBackupSchema.parse(req.body);
      const result = await centralBackupService.confirmBackup(tenantId, req.params.id, req.params.backupId, dto);
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /centrals/:id/backups
 * List backups for a central (newest first).
 */
router.get('/:id/backups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const result = await centralBackupService.listBackups(tenantId, req.params.id);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id/backups/:backupId/download-url
 * Presigned GET URL for an AVAILABLE backup (analysis or restore/swap).
 */
router.get('/:id/backups/:backupId/download-url',
  logEvent({
    eventType: EventType.CENTRAL_BACKUP_DOWNLOADED,
    description: (req) => `Download URL issued for backup ${req.params.backupId} (central ${req.params.id})`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const result = await centralBackupService.getDownloadUrl(tenantId, req.params.id, req.params.backupId);
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Restore (field-swap). gcdr creates + tracks the job; the CENTRAL runs the
// pg_restore on its own Postgres and reports progress back. Phase 2.
// ---------------------------------------------------------------------------

/**
 * POST /centrals/:id/restore
 * Start a restore of this central from one of its AVAILABLE backups. Returns
 * the job + a presigned download URL for the dump.
 */
router.post('/:id/restore',
  logEvent({
    eventType: EventType.CENTRAL_RESTORE_INITIATED,
    description: (req) => `Restore started for central ${req.params.id} from backup ${req.body?.sourceBackupId}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const dto = StartRestoreSchema.parse(req.body);
      const result = await centralRestoreService.startRestore(tenantId, req.params.id, userId, dto);
      sendCreated(res, result, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /centrals/:id/restore
 * List restore jobs for a central (newest first).
 */
router.get('/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const result = await centralRestoreService.listJobs(tenantId, req.params.id);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id/restore/:jobId
 * Restore job status / progress.
 */
router.get('/:id/restore/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const result = await centralRestoreService.getJob(tenantId, req.params.id, req.params.jobId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /centrals/:id/restore/:jobId
 * Progress report from the central as it runs the restore.
 */
router.patch('/:id/restore/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const dto = UpdateRestoreProgressSchema.parse(req.body);
    const result = await centralRestoreService.updateProgress(tenantId, req.params.id, req.params.jobId, dto);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
