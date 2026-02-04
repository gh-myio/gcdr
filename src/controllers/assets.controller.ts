import { Router, Request, Response, NextFunction } from 'express';
import { assetService } from '../services/AssetService';
import {
  CreateAssetSchema,
  UpdateAssetSchema,
  MoveAssetSchema,
  ListAssetsParams,
} from '../dto/request/AssetDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /assets
 * Create a new asset
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateAssetSchema.parse(req.body);
    const asset = await assetService.create(tenantId, data, userId);
    sendCreated(res, asset, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets
 * List assets
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, parentAssetId, type, status, limit, cursor } = req.query;

    const params: ListAssetsParams = {
      customerId: customerId as string | undefined,
      parentAssetId: parentAssetId as string | undefined,
      type: type as string | undefined,
      status: status as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await assetService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets/tree
 * Get asset tree structure
 */
router.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, rootAssetId } = req.query;

    const tree = await assetService.getTree(
      tenantId,
      customerId as string | undefined,
      rootAssetId as string | undefined
    );
    sendSuccess(res, tree, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets/:id
 * Get asset by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const asset = await assetService.getById(tenantId, id);
    sendSuccess(res, asset, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /assets/:id
 * Update asset
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const data = UpdateAssetSchema.parse(req.body);
    const asset = await assetService.update(tenantId, id, data, userId);
    sendSuccess(res, asset, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /assets/:id
 * Delete asset
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    await assetService.delete(tenantId, id, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /assets/:id/move
 * Move asset to another parent
 */
router.post('/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const data = MoveAssetSchema.parse(req.body);
    const asset = await assetService.move(tenantId, id, data, userId);
    sendSuccess(res, asset, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets/:id/children
 * Get direct children of an asset
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const children = await assetService.getChildren(tenantId, id);
    sendSuccess(res, children, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets/:id/ancestors
 * Get all ancestors of an asset (path to root)
 */
router.get('/:id/ancestors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const ancestors = await assetService.getAncestors(tenantId, id);
    sendSuccess(res, ancestors, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /assets/:id/descendants
 * Get all descendants of an asset
 */
router.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    const { maxDepth } = req.query;

    if (!id) {
      throw new ValidationError('Asset ID is required');
    }

    const descendants = await assetService.getDescendants(tenantId, id, {
      maxDepth: maxDepth ? parseInt(maxDepth as string, 10) : undefined,
    });
    sendSuccess(res, descendants, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
