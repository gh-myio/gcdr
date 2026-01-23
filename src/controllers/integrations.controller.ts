import { Router, Request, Response, NextFunction } from 'express';
import { integrationService } from '../services/IntegrationService';
import {
  CreatePackageSchema,
  UpdatePackageSchema,
  SearchPackagesSchema,
  PublishVersionSchema,
  SubscribePackageSchema
} from '../dto/request/IntegrationDTO';
import {
  toPackageDetailDTO,
  toPackageSummaryDTO,
  toSubscriptionDTO
} from '../dto/response/IntegrationResponseDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /integrations
 * Create a new integration package
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreatePackageSchema.parse(req.body);
    const pkg = await integrationService.createPackage(tenantId, data, userId);
    sendCreated(res, toPackageDetailDTO(pkg), requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations
 * Search integration packages
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { query: searchQuery, category, type, status, pricing, verified, tags, sortBy, sortOrder, limit, cursor } = req.query;

    const params = SearchPackagesSchema.parse({
      query: searchQuery,
      category,
      type,
      status,
      pricing,
      verified: verified === 'true' ? true : verified === 'false' ? false : undefined,
      tags: tags ? (tags as string).split(',') : undefined,
      sortBy,
      sortOrder,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor,
    });

    const result = await integrationService.searchPackages(tenantId, params);
    sendSuccess(res, {
      items: result.items.map(toPackageSummaryDTO),
      pagination: result.pagination,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/me
 * List packages published by current user
 */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const packages = await integrationService.listPublisherPackages(tenantId, userId);
    sendSuccess(res, {
      items: packages.map(toPackageSummaryDTO),
      count: packages.length,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/subscriptions
 * List subscriptions for current user
 */
router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const subscriptions = await integrationService.listSubscriberSubscriptions(tenantId, userId);

    const items = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const pkg = await integrationService.getPackageById(tenantId, sub.packageId);
          return toSubscriptionDTO(sub, pkg.name);
        } catch {
          return toSubscriptionDTO(sub, 'Unknown Package');
        }
      })
    );

    sendSuccess(res, { items, count: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /integrations/subscribe
 * Subscribe to a package
 */
router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = SubscribePackageSchema.parse(req.body);
    const subscriberType = 'partner' as const;

    const subscription = await integrationService.subscribe(
      tenantId,
      data.packageId,
      userId,
      subscriberType,
      data.version,
      data.config
    );

    const pkg = await integrationService.getPackageById(tenantId, data.packageId);

    sendCreated(res, {
      message: 'Successfully subscribed to package',
      subscription: toSubscriptionDTO(subscription, pkg.name),
    }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /integrations/subscriptions/:subscriptionId
 * Unsubscribe from a package
 */
router.delete('/subscriptions/:subscriptionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { subscriptionId } = req.params;

    if (!subscriptionId) {
      throw new ValidationError('Subscription ID is required');
    }

    await integrationService.unsubscribe(tenantId, subscriptionId, userId);
    sendSuccess(res, { message: 'Successfully unsubscribed from package' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/:id
 * Get integration package by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    const pkg = await integrationService.getPackageById(tenantId, id);
    sendSuccess(res, toPackageDetailDTO(pkg), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /integrations/:id
 * Update integration package
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    const data = UpdatePackageSchema.parse(req.body);
    const pkg = await integrationService.updatePackage(tenantId, id, data, userId);
    sendSuccess(res, toPackageDetailDTO(pkg), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /integrations/:id
 * Delete integration package
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    await integrationService.deletePackage(tenantId, id, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /integrations/:id/publish
 * Publish a new version
 */
router.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    const data = PublishVersionSchema.parse(req.body);
    const pkg = await integrationService.publishVersion(tenantId, id, data, userId);

    sendSuccess(res, {
      message: `Version ${data.version} published successfully`,
      package: toPackageDetailDTO(pkg),
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
