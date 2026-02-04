import { Router, Request, Response, NextFunction } from 'express';
import { partnerService } from '../services/PartnerService';
import {
  RegisterPartnerSchema,
  UpdatePartnerSchema,
  ApprovePartnerSchema,
  RejectPartnerSchema,
  CreateApiKeySchema,
  CreateOAuthClientSchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
} from '../dto/request/PartnerDTO';
import { ListPartnersParams } from '../repositories/interfaces/IPartnerRepository';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';
import { PartnerStatus } from '../shared/types';

const router = Router();

/**
 * POST /partners
 * Register a new partner
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = RegisterPartnerSchema.parse(req.body);
    const partner = await partnerService.register(tenantId, data, userId);
    sendCreated(res, partner, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /partners
 * List partners
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { status, limit, cursor } = req.query;

    const params: ListPartnersParams = {
      status: status as PartnerStatus | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await partnerService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /partners/:id
 * Get partner by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.getById(tenantId, id);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /partners/:id
 * Update partner
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = UpdatePartnerSchema.parse(req.body);
    const partner = await partnerService.update(tenantId, id, data, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /partners/:id/approve
 * Approve a pending partner
 */
router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = ApprovePartnerSchema.parse(req.body);
    const partner = await partnerService.approve(tenantId, id, data, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /partners/:id/reject
 * Reject a pending partner
 */
router.post('/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = RejectPartnerSchema.parse(req.body);
    const partner = await partnerService.reject(tenantId, id, data, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /partners/:id/suspend
 * Suspend an active partner
 */
router.post('/:id/suspend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;
    const { reason } = req.body;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    if (!reason || typeof reason !== 'string') {
      throw new ValidationError('Reason is required');
    }

    const partner = await partnerService.suspend(tenantId, id, reason, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /partners/:id/activate
 * Activate an approved or suspended partner
 */
router.post('/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.activate(tenantId, id, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// ==================== API Keys ====================

/**
 * POST /partners/:id/api-keys
 * Create a new API key for partner
 */
router.post('/:id/api-keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = CreateApiKeySchema.parse(req.body);
    const result = await partnerService.createApiKey(tenantId, id, data, userId);

    // Return partner info plus the raw API key (only shown once)
    sendCreated(res, {
      partner: result.partner,
      apiKey: result.apiKey,
      message: 'Store this API key securely - it will not be shown again',
    }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /partners/:id/api-keys
 * List API keys for partner
 */
router.get('/:id/api-keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.getById(tenantId, id);

    // Return keys without the hash
    const apiKeys = partner.apiKeys.map(key => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      status: key.status,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
    }));

    sendSuccess(res, apiKeys, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /partners/:id/api-keys/:keyId
 * Revoke an API key
 */
router.delete('/:id/api-keys/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id, keyId } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    await partnerService.revokeApiKey(tenantId, id, keyId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /partners/:id/api-keys/:keyId/rotate
 * Rotate an API key (revoke old, create new with same settings)
 */
router.post('/:id/api-keys/:keyId/rotate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id, keyId } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    const result = await partnerService.rotateApiKey(tenantId, id, keyId, userId);

    sendSuccess(res, {
      partner: result.partner,
      newApiKey: result.newApiKey,
      message: 'Store this new API key securely - it will not be shown again',
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// ==================== OAuth Clients ====================

/**
 * POST /partners/:id/oauth-clients
 * Create OAuth client for partner
 */
router.post('/:id/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = CreateOAuthClientSchema.parse(req.body);
    const result = await partnerService.createOAuthClient(tenantId, id, data, userId);

    sendCreated(res, {
      partner: result.partner,
      clientId: result.clientId,
      clientSecret: result.clientSecret,
      message: 'Store the client secret securely - it will not be shown again',
    }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /partners/:id/oauth-clients
 * List OAuth clients for partner
 */
router.get('/:id/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.getById(tenantId, id);

    // Return clients without the secret hash
    const oauthClients = partner.oauthClients.map(client => ({
      clientId: client.clientId,
      name: client.name,
      redirectUris: client.redirectUris,
      scopes: client.scopes,
      grantTypes: client.grantTypes,
      status: client.status,
      createdAt: client.createdAt,
    }));

    sendSuccess(res, oauthClients, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /partners/:id/oauth-clients/:clientId
 * Revoke OAuth client
 */
router.delete('/:id/oauth-clients/:clientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id, clientId } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }
    if (!clientId) {
      throw new ValidationError('Client ID is required');
    }

    await partnerService.revokeOAuthClient(tenantId, id, clientId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// ==================== Webhooks ====================

/**
 * POST /partners/:id/webhooks
 * Create webhook subscription
 */
router.post('/:id/webhooks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = CreateWebhookSchema.parse(req.body);
    const result = await partnerService.createWebhook(tenantId, id, data, userId);

    const response: Record<string, unknown> = {
      webhook: result.webhook,
    };

    if (result.secret) {
      response.secret = result.secret;
      response.message = 'Store this webhook secret securely - it will not be shown again';
    }

    sendCreated(res, response, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /partners/:id/webhooks
 * List webhook subscriptions
 */
router.get('/:id/webhooks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const webhooks = await partnerService.listWebhooks(tenantId, id);

    // Return webhooks without the secret hash
    const sanitizedWebhooks = webhooks.map(webhook => ({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      enabled: webhook.enabled,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      failureCount: webhook.failureCount,
      lastDeliveryAt: webhook.lastDeliveryAt,
      lastDeliveryStatus: webhook.lastDeliveryStatus,
    }));

    sendSuccess(res, sanitizedWebhooks, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /partners/:id/webhooks/:webhookId
 * Update webhook subscription
 */
router.put('/:id/webhooks/:webhookId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id, webhookId } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }
    if (!webhookId) {
      throw new ValidationError('Webhook ID is required');
    }

    const data = UpdateWebhookSchema.parse(req.body);
    const partner = await partnerService.updateWebhook(tenantId, id, webhookId, data, userId);
    sendSuccess(res, partner, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /partners/:id/webhooks/:webhookId
 * Delete webhook subscription
 */
router.delete('/:id/webhooks/:webhookId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id, webhookId } = req.params;

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }
    if (!webhookId) {
      throw new ValidationError('Webhook ID is required');
    }

    await partnerService.deleteWebhook(tenantId, id, webhookId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
