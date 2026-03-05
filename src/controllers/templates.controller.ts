import { Router, Request, Response, NextFunction } from 'express';
import { templateService } from '../services/TemplateService';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  PreviewTemplateSchema,
  ListTemplatesQuerySchema,
} from '../dto/request/TemplateDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';
import { TemplateType } from '../domain/entities/Template';

const router = Router();

/**
 * POST /templates
 * Create a new template
 */
router.post('/',
  logEvent({
    eventType: EventType.TEMPLATE_CREATED,
    description: (req) => `Template "${req.body.slug}" created`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ type: req.body.type, slug: req.body.slug }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateTemplateSchema.parse(req.body);
      const template = await templateService.create(tenantId, data, userId);
      res.locals.data = template;
      sendCreated(res, template, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /templates
 * List templates (without htmlContent)
 * ?type=EMAIL_ALARM&status=ACTIVE
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = ListTemplatesQuerySchema.parse(req.query);
    const items = await templateService.list(tenantId, query);
    sendSuccess(res, { items, count: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /templates/tags/:type
 * Tag catalog for a given template type — used by the frontend editor
 * Must be declared BEFORE /:slug to avoid route collision
 */
router.get('/tags/:type', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { type } = req.params;

    const validTypes: TemplateType[] = ['EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME'];
    if (!validTypes.includes(type as TemplateType)) {
      throw new ValidationError(`Invalid template type "${type}". Valid: ${validTypes.join(', ')}`);
    }

    const tags = templateService.getTagCatalog(type as TemplateType);
    sendSuccess(res, tags, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /templates/:slug
 * Get template by slug (includes htmlContent)
 */
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { slug } = req.params;
    const template = await templateService.getBySlug(tenantId, slug);
    sendSuccess(res, template, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /templates/:slug
 * Update template — increments version
 */
router.put('/:slug',
  logEvent({
    eventType: EventType.TEMPLATE_UPDATED,
    description: (req) => `Template "${req.params.slug}" updated`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { slug } = req.params;

      const previous = await templateService.getBySlug(tenantId, slug);
      res.locals.previousData = { version: previous.version, status: previous.status };

      const data = UpdateTemplateSchema.parse(req.body);
      const template = await templateService.update(tenantId, slug, data);
      res.locals.data = template;
      sendSuccess(res, template, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /templates/:slug
 * Soft delete — sets status to ARCHIVED
 */
router.delete('/:slug',
  logEvent({
    eventType: EventType.TEMPLATE_ARCHIVED,
    description: (req) => `Template "${req.params.slug}" archived`,
    getEntityId: (_req, res) => res.locals.previousData?.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.context;
      const { slug } = req.params;

      const previous = await templateService.getBySlug(tenantId, slug);
      res.locals.previousData = previous;

      await templateService.archive(tenantId, slug);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /templates/:slug/preview
 * Render the template with provided data and return the HTML
 */
router.post('/:slug/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { slug } = req.params;
    const { data } = PreviewTemplateSchema.parse(req.body);
    const html = await templateService.preview(tenantId, slug, data as Record<string, unknown>);
    sendSuccess(res, { html }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
