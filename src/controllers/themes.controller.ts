import { Router, Request, Response, NextFunction } from 'express';
import { lookAndFeelRepository } from '../repositories/LookAndFeelRepository';
import {
  CreateLookAndFeelSchema,
  UpdateLookAndFeelSchema,
} from '../dto/request/LookAndFeelDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /themes
 * Create a new theme
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateLookAndFeelSchema.parse(req.body);
    const theme = await lookAndFeelRepository.create(tenantId, data, userId);
    sendCreated(res, theme, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /themes
 * List all themes
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor } = req.query;

    const result = await lookAndFeelRepository.list(tenantId, {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /themes/:id
 * Get theme by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Theme ID is required');
    }

    const theme = await lookAndFeelRepository.getById(tenantId, id);
    if (!theme) {
      throw new ValidationError('Theme not found');
    }

    sendSuccess(res, theme, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /themes/:id
 * Update theme
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Theme ID is required');
    }

    const data = UpdateLookAndFeelSchema.parse(req.body);
    const theme = await lookAndFeelRepository.update(tenantId, id, data, userId);
    sendSuccess(res, theme, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /themes/:id
 * Delete theme
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Theme ID is required');
    }

    await lookAndFeelRepository.delete(tenantId, id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /themes/:id/set-default
 * Set theme as default for its customer
 */
router.post('/:id/set-default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Theme ID is required');
    }

    // Get theme to find customerId
    const theme = await lookAndFeelRepository.getById(tenantId, id);
    if (!theme) {
      throw new ValidationError('Theme not found');
    }

    const updatedTheme = await lookAndFeelRepository.setDefault(tenantId, theme.customerId, id);
    sendSuccess(res, updatedTheme, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /themes/:id/children
 * Get themes that inherit from this theme
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Theme ID is required');
    }

    const children = await lookAndFeelRepository.getByParentTheme(tenantId, id);
    sendSuccess(res, { items: children }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/themes
 * List themes by customer (mounted in app.ts)
 */
export const listByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const themes = await lookAndFeelRepository.listByCustomer(tenantId, customerId);
    sendSuccess(res, { items: themes }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /customers/:customerId/themes/default
 * Get default theme for customer (mounted in app.ts)
 */
export const getDefaultByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const theme = await lookAndFeelRepository.getDefaultByCustomer(tenantId, customerId);
    if (!theme) {
      throw new ValidationError('No default theme found for this customer');
    }

    sendSuccess(res, theme, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
