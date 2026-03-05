import { Router, Request, Response, NextFunction } from 'express';
import { publicSingleAppService } from '../services/PublicSingleAppService';
import {
  CreatePublicSingleAppSchema,
  UpdatePublicSingleAppSchema,
  SubmitResponseSchema,
  ReviseResponseSchema,
  UpdateResponseStatusSchema,
  ListResponsesParamsSchema,
} from '../dto/request/PublicSingleAppDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

// =============================================================================
// APPS — management (protected at app.ts level via authMiddleware)
// =============================================================================

/**
 * POST /public-apps
 * Create a new single-page app definition
 */
router.post('/',
  logEvent({
    eventType: EventType.PUBLIC_APP_CREATED,
    description: (req) => `Public app "${req.body.slug}" created`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getNewValue: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, requestId } = req.context;
      const data = CreatePublicSingleAppSchema.parse(req.body);
      const app = await publicSingleAppService.createApp(data, userId);
      res.locals.data = app;
      sendCreated(res, app, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /public-apps
 * List all apps (optionally filter by status)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { status } = req.query;
    const apps = await publicSingleAppService.listApps(status as string | undefined);
    sendSuccess(res, { items: apps, count: apps.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public-apps/:slug
 * Get a single app by slug
 */
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const app = await publicSingleAppService.getAppBySlug(req.params.slug);
    sendSuccess(res, app, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /public-apps/:slug
 * Update app metadata
 */
router.put('/:slug',
  logEvent({
    eventType: EventType.PUBLIC_APP_UPDATED,
    description: (req) => `Public app "${req.params.slug}" updated`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.context;
      const previous = await publicSingleAppService.getAppBySlug(req.params.slug);
      res.locals.previousData = previous;
      const data = UpdatePublicSingleAppSchema.parse(req.body);
      const app = await publicSingleAppService.updateApp(req.params.slug, data);
      res.locals.data = app;
      sendSuccess(res, app, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /public-apps/:slug
 * Archive app (soft delete)
 */
router.delete('/:slug',
  logEvent({
    eventType: EventType.PUBLIC_APP_ARCHIVED,
    description: (req) => `Public app "${req.params.slug}" archived`,
    getEntityId: (_req, res) => res.locals.previousData?.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const previous = await publicSingleAppService.getAppBySlug(req.params.slug);
      res.locals.previousData = previous;
      await publicSingleAppService.archiveApp(req.params.slug);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
);

// =============================================================================
// RESPONSES — submissions (public: no auth required)
// =============================================================================

/**
 * POST /public-apps/:slug/responses
 * Submit a new response (first version, creates a new response_group_id)
 */
router.post('/:slug/responses',
  logEvent({
    eventType: EventType.PUBLIC_APP_RESPONSE_SUBMITTED,
    description: (req) => `Response submitted for app "${req.params.slug}"`,
    getEntityId: (_req, res) => res.locals.data?.responseGroupId,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ email: req.body.submittedBy?.email, company: req.body.submittedBy?.company }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.context;
      const data = SubmitResponseSchema.parse(req.body);
      const response = await publicSingleAppService.submitResponse(req.params.slug, data);
      res.locals.data = response;
      sendCreated(res, response, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /public-apps/:slug/responses/:groupId/revise
 * Create a new revision of an existing response (increments version)
 */
router.post('/:slug/responses/:groupId/revise',
  logEvent({
    eventType: EventType.PUBLIC_APP_RESPONSE_REVISED,
    description: (req) => `Response "${req.params.groupId}" revised for app "${req.params.slug}"`,
    getEntityId: (req) => req.params.groupId,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (_req, res) => ({
      version: res.locals.data?.responseVersion,
      changedFields: Object.keys(res.locals.data?.changesFromPrevious ?? {}).length,
    }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.context;
      const { slug, groupId } = req.params;
      const data = ReviseResponseSchema.parse(req.body);
      const response = await publicSingleAppService.reviseResponse(slug, groupId, data);
      res.locals.data = response;
      sendCreated(res, response, requestId);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /public-apps/:slug/responses
 * List latest versions of all responses for an app
 */
router.get('/:slug/responses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const params = ListResponsesParamsSchema.parse(req.query);
    const result = await publicSingleAppService.listLatestResponses(req.params.slug, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public-apps/:slug/responses/:groupId
 * Get the latest version of a specific response group
 */
router.get('/:slug/responses/:groupId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const response = await publicSingleAppService.getLatestResponse(req.params.slug, req.params.groupId);
    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public-apps/:slug/responses/:groupId/history
 * Get all versions (full history) of a response group
 */
router.get('/:slug/responses/:groupId/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const history = await publicSingleAppService.getResponseHistory(req.params.slug, req.params.groupId);
    sendSuccess(res, { items: history, count: history.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public-apps/:slug/responses/:groupId/version/:v
 * Get a specific version of a response
 */
router.get('/:slug/responses/:groupId/version/:v', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const version = parseInt(req.params.v, 10);
    if (isNaN(version) || version < 1) {
      throw new ValidationError('Version must be a positive integer');
    }
    const response = await publicSingleAppService.getResponseByVersion(req.params.slug, req.params.groupId, version);
    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /public-apps/:slug/responses/:groupId/status
 * Update the status of the latest version of a response
 */
router.patch('/:slug/responses/:groupId/status',
  logEvent({
    eventType: EventType.PUBLIC_APP_RESPONSE_STATUS_CHANGED,
    description: (req) => `Response "${req.params.groupId}" status changed to "${req.body.status}"`,
    getEntityId: (req) => req.params.groupId,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ status: req.body.status }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.context;
      const { slug, groupId } = req.params;
      const previous = await publicSingleAppService.getLatestResponse(slug, groupId);
      res.locals.previousData = previous;
      const data = UpdateResponseStatusSchema.parse(req.body);
      const response = await publicSingleAppService.updateResponseStatus(slug, groupId, data);
      res.locals.data = response;
      sendSuccess(res, response, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
