import { Router, Request, Response, NextFunction } from 'express';
import { annotationService, ActorContext } from '../services/AnnotationService';
import {
  CreateAnnotationSchema,
  UpdateAnnotationSchema,
  CreateResponseSchema,
  CreateMentionSchema,
  CreateAttachmentSchema,
  ListAnnotationsSchema,
} from '../dto/request/annotations/AnnotationDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Build the actor context for the request (tenant + acting user). */
function actorContext(req: Request): ActorContext {
  const { tenantId, userId } = req.context;
  return { tenantId, userId };
}

/**
 * Resolve an optimistic-lock version from the If-Match header (preferred for
 * REST semantics) or a body `version` field. Returns undefined when neither is
 * present; throws on a malformed If-Match.
 */
function resolveVersion(req: Request): number | undefined {
  const ifMatch = req.headers['if-match'];
  if (typeof ifMatch === 'string' && ifMatch.trim() !== '') {
    const cleaned = ifMatch.replace(/^"|"$/g, '').trim();
    const parsed = parseInt(cleaned, 10);
    if (Number.isNaN(parsed)) {
      throw new ValidationError(`If-Match header must be an integer version (got '${ifMatch}')`);
    }
    return parsed;
  }
  if (typeof req.body?.version === 'number') {
    return req.body.version;
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// POST /annotations — create an annotation on a polymorphic target.
// -----------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const data = CreateAnnotationSchema.parse(req.body);
    const annotation = await annotationService.create(actorContext(req), data);
    sendCreated(res, annotation, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// GET /annotations — cross-entity list. Filters: entityType, entityId,
// customerId, type, status, importance, mentionedUserId, mentionedDeviceId,
// hasAttachments, includeArchived + pagination.
// -----------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const params = ListAnnotationsSchema.parse(req.query);
    const result = await annotationService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// GET /annotations/:id — full aggregate (responses + events + mentions + attachments)
// -----------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const annotation = await annotationService.getById(tenantId, id);
    sendSuccess(res, annotation, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// PATCH /annotations/:id — edit text/type/importance/dueDate (optimistic lock).
// -----------------------------------------------------------------------------
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const data = UpdateAnnotationSchema.parse(req.body);
    const headerVersion = resolveVersion(req);
    const updated = await annotationService.update(actorContext(req), id, {
      ...data,
      version: data.version ?? headerVersion,
    });
    sendSuccess(res, updated, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// POST /annotations/:id/archive — archive (finalizes).
// -----------------------------------------------------------------------------
router.post('/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const version = resolveVersion(req);
    const archived = await annotationService.archive(actorContext(req), id, version);
    sendSuccess(res, archived, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// POST /annotations/:id/responses — add a comment or finalizing decision.
// -----------------------------------------------------------------------------
router.post('/:id/responses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const data = CreateResponseSchema.parse(req.body);
    const headerVersion = resolveVersion(req);
    const response = await annotationService.addResponse(actorContext(req), id, {
      ...data,
      version: data.version ?? headerVersion,
    });
    sendCreated(res, response, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// POST /annotations/:id/mentions — mention a user or device.
// -----------------------------------------------------------------------------
router.post('/:id/mentions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const data = CreateMentionSchema.parse(req.body);
    const mention = await annotationService.addMention(actorContext(req), id, data);
    sendCreated(res, mention, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// POST /annotations/:id/attachments — link an existing file asset.
// -----------------------------------------------------------------------------
router.post('/:id/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    const data = CreateAttachmentSchema.parse(req.body);
    const attachment = await annotationService.addAttachment(actorContext(req), id, data);
    sendCreated(res, attachment, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// DELETE /annotations/:id/attachments/:attId — detach (active annotation only).
// -----------------------------------------------------------------------------
router.delete('/:id/attachments/:attId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, attId } = req.params;
    if (!id) throw new ValidationError('Annotation ID is required');
    if (!attId) throw new ValidationError('Attachment ID is required');
    await annotationService.removeAttachment(actorContext(req), id, attId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
