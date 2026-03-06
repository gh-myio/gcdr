import { Router, Request, Response, NextFunction } from 'express';
import { templateTypeRepository } from '../repositories/TemplateTypeRepository';
import { UpdateTemplateTypeSchema } from '../dto/request/TemplateTypeDTO';
import { sendSuccess } from '../middleware';
import { AppError } from '../shared/errors/AppError';

const router = Router();

/**
 * GET /template-types
 * List all template types with label, description, icon and sort order.
 * Used by the frontend to display type options and allow editing metadata.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const types = await templateTypeRepository.getAll();
    sendSuccess(res, { items: types, total: types.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /template-types/:type
 * Get a single template type by its key (e.g. EMAIL_ALARM).
 */
router.get('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { type } = req.params;

    const record = await templateTypeRepository.getByType(type.toUpperCase());
    if (!record) {
      throw new AppError('TEMPLATE_TYPE_NOT_FOUND', `Template type '${type}' not found`, 404);
    }

    sendSuccess(res, record, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /template-types/:type
 * Update label, description, icon, sort_order or active flag of a template type.
 * The type key itself is immutable.
 */
router.patch('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { type } = req.params;

    const data = UpdateTemplateTypeSchema.parse(req.body);
    const updated = await templateTypeRepository.update(type.toUpperCase(), data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
