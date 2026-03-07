import { Router, Request, Response, NextFunction } from 'express';
import { lookAndFeelRepository } from '../repositories/LookAndFeelRepository';
import {
  CreateLookAndFeelSchema,
  UpdateLookAndFeelSchema,
} from '../dto/request/LookAndFeelDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

/**
 * POST /themes
 * Create a new theme
 */
router.post('/',
  logEvent({
    eventType: EventType.THEME_CREATED,
    description: (req) => `Theme "${req.body.name}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getCustomerId: (req) => req.body.customerId,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateLookAndFeelSchema.parse(req.body);
      const theme = await lookAndFeelRepository.create(tenantId, data, userId);
      sendCreated(res, theme, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /themes
 * List all themes with optional filters and hybrid pagination (page or cursor)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor, page, pageSize, customerId, templateType } = req.query;

    const resolvedLimit = pageSize
      ? parseInt(pageSize as string, 10)
      : limit ? parseInt(limit as string, 10) : 20;

    const resolvedCursor = page
      ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
      : cursor as string | undefined;

    const result = await lookAndFeelRepository.list(tenantId, {
      limit: resolvedLimit,
      cursor: resolvedCursor,
      customerId: customerId as string | undefined,
      templateType: templateType as string | undefined,
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
router.put('/:id',
  logEvent({
    eventType: EventType.THEME_UPDATED,
    description: (req) => `Theme ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

/**
 * DELETE /themes/:id
 * Delete theme
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.THEME_DELETED,
    description: (req) => `Theme ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

/**
 * POST /themes/:id/set-default
 * Set theme as default for its customer
 */
router.post('/:id/set-default',
  logEvent({
    eventType: EventType.THEME_SET_DEFAULT,
    description: (req) => `Theme ${req.params.id} set as default`,
    getEntityId: (req) => req.params.id,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
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
  }
);

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
