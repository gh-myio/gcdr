import { Router, Request, Response, NextFunction } from 'express';
import { templateService } from '../services/TemplateService';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  PreviewTemplateSchema,
  ListTemplatesQuerySchema,
  RenderTemplateQuerySchema,
  RenderTemplateBodySchema,
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
 * GET /templates/tag-catalog?type=EMAIL_ALARM
 * Tag catalog for a given template type — used by the frontend editor
 * Must be declared BEFORE /:slug to avoid route collision
 */
router.get('/tag-catalog', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { type } = req.query as { type?: string };

    const validTypes: TemplateType[] = [
      'EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME', 'RELEASE_NOTE', 'NOTIFICATION', 'INSIGHT',
      'TELEGRAM_ALARM_OPENED', 'TELEGRAM_ALARM_CLOSED', 'TELEGRAM_ALARM_ESCALATED',
      'TELEGRAM_ALARM_ACKNOWLEDGED', 'TELEGRAM_ALARM_SNOOZED', 'TELEGRAM_ALARM_DIGEST',
    ];
    if (!type || !validTypes.includes(type as TemplateType)) {
      throw new ValidationError(
        `Query param "type" is required. Valid values: ${validTypes.join(', ')}`,
      );
    }

    const tags = templateService.getTagCatalog(type as TemplateType);
    sendSuccess(res, tags, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /templates/render
 * Full render: theme injection + Handlebars data in one call.
 * Used by EMAIL_SENDER to get final HTML ready for SMTP.
 * Body: { type, customerId, data, version? }
 */
router.post('/render', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const body = RenderTemplateBodySchema.parse(req.body);

    const result = await templateService.renderFull(
      tenantId,
      body.type,
      body.customerId,
      body.data as Record<string, unknown>,
      body.version,
    );

    res.setHeader('X-Template-Version', String(result.template.version));
    res.setHeader('X-Template-Source', result.templateSource);
    res.setHeader('X-Theme-Source', result.themeSource);

    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /templates/render?type=EMAIL_ALARM&customerId=uuid[&version=3]
 * Returns template HTML merged with customer theme — used by EMAIL_SENDER (M2M)
 * Must be declared BEFORE /:slug to avoid route collision
 */
router.get('/render', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = RenderTemplateQuerySchema.parse(req.query);

    const result = await templateService.renderForEmailSender(
      tenantId,
      query.type,
      query.customerId,
      query.version,
    );

    res.setHeader('X-Template-Version', String(result.template.version));
    res.setHeader('X-Template-Source', result.templateSource);
    res.setHeader('X-Theme-Source', result.themeSource);

    sendSuccess(res, result, 200, requestId);
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
    const { data, customerId: bodyCustomerId } = PreviewTemplateSchema.parse(req.body);
    const customerId = bodyCustomerId ?? (req.query.customerId as string | undefined);
    const html = await templateService.preview(tenantId, slug, data as Record<string, unknown>, customerId);
    sendSuccess(res, { html }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
