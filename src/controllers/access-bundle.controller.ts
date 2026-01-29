import { Router, Request, Response, NextFunction } from 'express';
import { bundleGeneratorService } from '../services/BundleGeneratorService';
import { domainPermissionRepository } from '../repositories/DomainPermissionRepository';
import {
  GetAccessBundleQuerySchema,
  RefreshBundleSchema,
  InvalidateBundleSchema,
  CreateDomainPermissionSchema,
  UpdateDomainPermissionSchema,
  ListDomainPermissionsQuerySchema,
  BulkCreateDomainPermissionsSchema,
  CheckDomainPermissionSchema,
  CheckMultipleDomainPermissionsSchema,
} from '../dto/request/AccessBundleDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

// =============================================================================
// Access Bundle Endpoints
// =============================================================================

/**
 * GET /access-bundle/me
 * Get access bundle for the authenticated user
 */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const params = GetAccessBundleQuerySchema.parse(req.query);

    const bundle = await bundleGeneratorService.generateBundle(tenantId, userId, {
      scope: params.scope,
      includeFeatures: params.includeFeatures,
      includeDomains: params.includeDomains,
      includeFlat: params.includeFlat,
      ttlSeconds: params.ttl,
      useCache: params.useCache,
    });

    sendSuccess(res, bundle, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /access-bundle/users/:userId
 * Get access bundle for a specific user (admin only)
 */
router.get('/users/:targetUserId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { targetUserId } = req.params;
    const params = GetAccessBundleQuerySchema.parse(req.query);

    if (!targetUserId) {
      throw new ValidationError('User ID is required');
    }

    const bundle = await bundleGeneratorService.generateBundle(tenantId, targetUserId, {
      scope: params.scope,
      includeFeatures: params.includeFeatures,
      includeDomains: params.includeDomains,
      includeFlat: params.includeFlat,
      ttlSeconds: params.ttl,
      useCache: params.useCache,
    });

    sendSuccess(res, bundle, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/me/refresh
 * Force refresh the authenticated user's bundle
 */
router.post('/me/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = RefreshBundleSchema.parse(req.body);

    const bundle = await bundleGeneratorService.refreshBundle(
      tenantId,
      userId,
      '*',
      data.reason
    );

    sendSuccess(res, bundle, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/users/:userId/refresh
 * Force refresh a specific user's bundle (admin only)
 */
router.post('/users/:targetUserId/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { targetUserId } = req.params;
    const data = RefreshBundleSchema.parse(req.body);

    if (!targetUserId) {
      throw new ValidationError('User ID is required');
    }

    const bundle = await bundleGeneratorService.refreshBundle(
      tenantId,
      targetUserId,
      '*',
      data.reason
    );

    sendSuccess(res, bundle, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /access-bundle/users/:userId/cache
 * Invalidate a user's cached bundle (admin only)
 */
router.delete('/users/:targetUserId/cache', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { targetUserId } = req.params;
    const data = InvalidateBundleSchema.parse(req.body || {});

    if (!targetUserId) {
      throw new ValidationError('User ID is required');
    }

    await bundleGeneratorService.invalidateBundle(
      tenantId,
      targetUserId,
      data.reason,
      data.scope
    );

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Permission Checking Endpoints
// =============================================================================

/**
 * POST /access-bundle/check
 * Check if authenticated user has a specific domain permission
 */
router.post('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CheckDomainPermissionSchema.parse(req.body);
    const { scope } = req.query;

    const allowed = await bundleGeneratorService.checkDomainPermission(
      tenantId,
      userId,
      data.domain,
      data.equipment,
      data.location,
      data.action,
      scope as string | undefined
    );

    sendSuccess(res, { allowed, permission: data }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/check-batch
 * Check multiple domain permissions at once
 */
router.post('/check-batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CheckMultipleDomainPermissionsSchema.parse(req.body);
    const { scope } = req.query;

    const results: Record<string, boolean> = {};

    for (const perm of data.permissions) {
      const key = `${perm.domain}.${perm.equipment}.${perm.location}:${perm.action}`;
      results[key] = await bundleGeneratorService.checkDomainPermission(
        tenantId,
        userId,
        perm.domain,
        perm.equipment,
        perm.location,
        perm.action,
        scope as string | undefined
      );
    }

    const allowedCount = Object.values(results).filter(Boolean).length;
    const deniedCount = Object.values(results).filter(v => !v).length;

    sendSuccess(res, {
      results,
      summary: {
        total: data.permissions.length,
        allowed: allowedCount,
        denied: deniedCount,
      },
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/check-feature
 * Check if user has access to a specific feature
 */
router.post('/check-feature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { featureKey } = req.body;
    const { scope } = req.query;

    if (!featureKey || typeof featureKey !== 'string') {
      throw new ValidationError('Feature key is required');
    }

    const result = await bundleGeneratorService.checkFeatureAccess(
      tenantId,
      userId,
      featureKey,
      scope as string | undefined
    );

    sendSuccess(res, { featureKey, ...result }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Domain Permissions Registry (Admin)
// =============================================================================

/**
 * GET /access-bundle/domain-permissions
 * List domain permissions
 */
router.get('/domain-permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const params = ListDomainPermissionsQuerySchema.parse(req.query);

    const result = await domainPermissionRepository.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /access-bundle/domain-permissions/domains
 * List available domains
 */
router.get('/domain-permissions/domains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const domains = await domainPermissionRepository.listDomains(tenantId);
    sendSuccess(res, { domains }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /access-bundle/domain-permissions/domains/:domain/equipments
 * List equipments for a domain
 */
router.get('/domain-permissions/domains/:domain/equipments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { domain } = req.params;

    if (!domain) {
      throw new ValidationError('Domain is required');
    }

    const equipments = await domainPermissionRepository.listEquipmentsByDomain(tenantId, domain);
    sendSuccess(res, { domain, equipments }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /access-bundle/domain-permissions/domains/:domain/equipments/:equipment/locations
 * List locations for an equipment
 */
router.get('/domain-permissions/domains/:domain/equipments/:equipment/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { domain, equipment } = req.params;

    if (!domain) {
      throw new ValidationError('Domain is required');
    }
    if (!equipment) {
      throw new ValidationError('Equipment is required');
    }

    const locations = await domainPermissionRepository.listLocationsByEquipment(tenantId, domain, equipment);
    sendSuccess(res, { domain, equipment, locations }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/domain-permissions
 * Create a new domain permission (admin only)
 */
router.post('/domain-permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = CreateDomainPermissionSchema.parse(req.body);

    const permission = await domainPermissionRepository.create(tenantId, data);
    sendCreated(res, permission, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /access-bundle/domain-permissions/bulk
 * Create multiple domain permissions (admin only)
 */
router.post('/domain-permissions/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = BulkCreateDomainPermissionsSchema.parse(req.body);

    const permissions = await domainPermissionRepository.bulkCreate(tenantId, data.permissions);
    sendCreated(res, { created: permissions.length, permissions }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /access-bundle/domain-permissions/:permissionId
 * Update a domain permission (admin only)
 */
router.put('/domain-permissions/:permissionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { permissionId } = req.params;

    if (!permissionId) {
      throw new ValidationError('Permission ID is required');
    }

    const data = UpdateDomainPermissionSchema.parse(req.body);
    const permission = await domainPermissionRepository.update(permissionId, data);
    sendSuccess(res, permission, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /access-bundle/domain-permissions/:permissionId
 * Delete a domain permission (admin only)
 */
router.delete('/domain-permissions/:permissionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { permissionId } = req.params;

    if (!permissionId) {
      throw new ValidationError('Permission ID is required');
    }

    await domainPermissionRepository.delete(permissionId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
