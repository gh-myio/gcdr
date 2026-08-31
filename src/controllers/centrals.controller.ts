import { Router, Request, Response, NextFunction } from 'express';
import { centralRepository } from '../repositories/CentralRepository';
import { deviceRepository } from '../repositories/DeviceRepository';
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
import { centralCommandService } from '../services/CentralCommandService';
import { centralTopologyService } from '../services/CentralTopologyService';
import { CreateCommandSchema } from '../dto/request/CentralCommandDTO';
import {
  StartRestoreSchema,
  UpdateRestoreProgressSchema,
} from '../dto/request/CentralRestoreDTO';
import { centralEnrollmentService } from '../services/CentralEnrollmentService';
import { centralReplacementService } from '../services/CentralReplacementService';
import { ReplaceCentralSchema } from '../dto/request/CentralReplacementDTO';
import { customerIntegrationService } from '../services/CustomerIntegrationService';
import {
  SetMqttPasswordInputSchema,
  MqttIntegrationIdParamSchema,
} from '../dto/request/CustomerIntegrationDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';
import { EventType, ActorType } from '../shared/types';
import { customerApiKeyService } from '../services/CustomerApiKeyService';
import { defaultTenantId } from '../services/CentralInitialKeyService';

const ERR_CENTRAL_ID_REQUIRED = 'Central ID is required';

// Route-level shape check for :id. The topology route forwards the central id
// into a server-to-server URL, so the value is constrained to a UUID before any
// handler runs -- the sanitization sits above the service rather than inside it.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireCentralId(value: string | undefined): string {
  if (!value) throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
  if (!UUID_REGEX.test(value)) throw new ValidationError(`Invalid central id: "${value}"`);
  return value;
}

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

    // Merge live device counts (physical devices / of those ONLINE) into the
    // stats passthrough so CentralDetail shows connected/total from the real
    // device registry instead of the (unpopulated) stats blob.
    // devicesConnected counts REACHABLE devices: the cloud-server's online AND
    // bad radio states both map to ONLINE, only offline is excluded. See the
    // `statistics` field on the Central entity.
    const counts = await deviceRepository.countByCentralIds(tenantId, [id]);
    const row = counts.get(id);
    const deviceCounts = {
      devicesTotal: row?.total ?? 0,
      devicesConnected: row?.connected ?? 0,
    };

    sendSuccess(res, { ...central.stats, ...deviceCounts }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id/device-topology
 * Hub-and-spoke topology of the central's devices + per-device link quality
 * (status + average_retries, joined from the cloud-server) for the CentralDetail
 * topology view. One node per physical device (grouped by slaveId).
 *
 * NOTE: this GET has side effects -- it reconciles the central's connection_status
 * and each device's connectivity_status from the live cloud link (best-effort).
 * As a result the centrals-list connected/total counts are only fresh after a
 * central's topology has been viewed, and a cache/retry/prefetch turns a read
 * into a write. Tracked for migration to a scheduled reconciler in gh-myio/gcdr#26.
 */
router.get('/:id/device-topology', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const centralId = requireCentralId(req.params.id);
    const result = await centralTopologyService.getTopology(tenantId, centralId);
    sendSuccess(res, result, 200, requestId);
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
 * POST /centrals/:oldUuid/replace
 * RFC-0005 — Gateway hardware replacement. ONE database transaction: locks the
 * old central row, validates the new identity (UUID/IPv6 uniqueness), archives
 * the old serial (`archived-<serial>-<epoch>`, status INACTIVE,
 * metadata.replacedBy), creates the new central with the kept (or reissued)
 * serial in the old one's exact place, repoints every device, and appends the
 * authoritative GATEWAY_REPLACED ledger event.
 *
 * Idempotent on body.replacementId: a repeat call with the same id (and same
 * old→new pair) returns the SAME stored result with 200, redoing no work.
 *
 * NOTE: deliberately NOT wrapped in logEvent() — the audit event must be
 * durable atomically with the swap, so the repository writes it INSIDE the
 * transaction; middleware logging here would double-log (and break the
 * replacementId idempotency lookup, which keys on that single ledger row).
 */
router.post('/:oldUuid/replace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { oldUuid } = req.params;

    if (!oldUuid) {
      throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
    }

    const data = ReplaceCentralSchema.parse(req.body);
    const result = await centralReplacementService.replace(tenantId, oldUuid, data, {
      userId,
      userEmail: (req.context as { userEmail?: string }).userEmail,
      requestId,
    });

    // 200 (not 201) so fresh and idempotent-replay responses are identical.
    sendSuccess(res, result, 200, requestId);
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
 * POST /centrals/:id/reset-provisioning
 * RFC-0056 (DEC-9) — operator action that reopens the bootstrap window: the
 * RFC's DEC-4 mentions "an explicit operator reset" without specifying an
 * endpoint; this fills that gap. Best-effort revokes both the INITIAL and
 * full CENTRAL_API_KEY (if bound — they were minted under the fixed
 * INITIAL-key tenant/customer, not this central's own tenant) and resets
 * `provisioningState` back to `awaiting_provisioning`, fully reopening the
 * ladder (a full key left bound while the state says "awaiting" would be
 * inconsistent with DEC-4/DEC-6, which tie `provisioned` to a bound full key).
 */
router.post('/:id/reset-provisioning',
  logEvent({
    eventType: EventType.CENTRAL_PROVISIONING_RESET,
    description: (req) => `Provisioning reset for central ${req.params.id}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(ERR_CENTRAL_ID_REQUIRED);
      }

      // Confirms the central exists in this tenant (throws NotFoundError otherwise).
      const central = await centralService.getById(tenantId, id);
      const config = central.config as unknown as Record<string, unknown>;
      const keyIds = [config.centralInitialApiKeyId, config.centralApiKeyId]
        .filter((v): v is string => typeof v === 'string' && v.length > 0);

      for (const keyId of keyIds) {
        try {
          await customerApiKeyService.revokeApiKey(defaultTenantId(), keyId);
        } catch (err) {
          // Already gone (e.g. manually revoked) — reset should still proceed.
          if (!(err instanceof NotFoundError)) throw err;
        }
      }

      await centralRepository.patchConfig(tenantId, id, {
        provisioningState: 'awaiting_provisioning',
        centralInitialApiKeyId: null,
        centralApiKeyId: null,
      });

      sendSuccess(res, { id, provisioningState: 'awaiting_provisioning' }, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

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
 * POST /centrals/:id/backups/:backupId/upload-url
 * Re-mint the presigned PUT URL for a PENDING backup (CR-S9) — same key, no new
 * row — for a central whose upload outran the previous URL's TTL.
 */
router.post('/:id/backups/:backupId/upload-url',
  logEvent({
    eventType: EventType.CENTRAL_BACKUP_INITIATED,
    description: (req) => `Upload URL reissued for backup ${req.params.backupId} (central ${req.params.id})`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const result = await centralBackupService.reissueUploadUrl(tenantId, req.params.id, req.params.backupId);
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
    const result = await centralBackupService.listBackups(tenantId, req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
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
    const result = await centralRestoreService.listJobs(tenantId, req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
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
 * Operator action on a restore job. This is CANCEL-ONLY: the phase/status
 * progress of a restore is reported by the CENTRAL via
 * PATCH /central-agent/restore/:jobId (authenticated as the central). The
 * operator route must not be able to drive the device state machine, so it
 * accepts only a cancel (round-3 #10).
 */
router.patch('/:id/restore/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const dto = UpdateRestoreProgressSchema.parse(req.body);
    if (dto.status !== 'CANCELED' || dto.currentPhase) {
      throw new ValidationError(
        'Operators may only cancel a restore; phase progress is reported by the central',
      );
    }
    const result = await centralRestoreService.cancelRestore(
      tenantId,
      req.params.id,
      req.params.jobId,
      userId,
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /centrals/:id/commands
 * Send an operational command to this central (REBOOT the box, RESTART_ERLANG the
 * myio-core service, or RESTART_MYIOAPI the myioapi service). Creates a QUEUED
 * command the central's agent picks up on its next poll; the result (exit code +
 * output) is reported back.
 *
 * AUTHORIZATION (trust decision, round-3 #6): this route sits behind plain
 * authMiddleware, so ANY tenant principal with `centrals` access can issue these
 * physically-disruptive actions on a production central — there is no elevated
 * scope today. This is accepted for now, gated in the UI (a confirm dialog);
 * a `centrals:admin`-style scope is the tracked follow-up. Documented here so the
 * accepted risk stays visible at the call site.
 */
router.post('/:id/commands',
  logEvent({
    eventType: EventType.CENTRAL_COMMAND_ISSUED,
    description: (req) => `Command ${req.body?.type} issued for central ${req.params.id}`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const dto = CreateCommandSchema.parse(req.body);
      const result = await centralCommandService.createCommand(tenantId, req.params.id, userId, dto);
      sendCreated(res, result, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /centrals/:id/commands
 * List operational commands for a central (newest first).
 */
router.get('/:id/commands', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const result = await centralCommandService.listCommands(tenantId, req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /centrals/:id/commands/:commandId
 * Command status + result (exit code, stdout, stderr) the central reported.
 */
router.get('/:id/commands/:commandId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const result = await centralCommandService.getCommand(tenantId, req.params.id, req.params.commandId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
