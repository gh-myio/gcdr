import { Router, Request, Response, NextFunction } from 'express';
import { ticketService } from '../../services/work-orders/TicketService';
import {
  OpenTicketSchema,
  DeriveWorkOrderSchema,
  TicketTransitionSchema,
  ListTicketsSchema,
} from '../../dto/request/work-orders/TicketDTO';
import { sendSuccess, sendCreated } from '../../middleware';
import { ValidationError } from '../../shared/errors/AppError';
import { emailIngestionRepository } from '../../repositories/work-orders/EmailIngestionRepository';
import type { ActorContext } from '../../services/work-orders/WorkOrderService';

const router = Router();

// Mirror of the work-orders controller actor resolution (SERVICE_ACCOUNT/API key
// must record actor_user_id = null; otherwise USER).
function actorOf(req: Request): ActorContext {
  const ctx = req.context as typeof req.context & { userEmail?: string };
  const isApiKey = Boolean(ctx.apiKeyId) || req.user?.type === 'SERVICE_ACCOUNT';
  return {
    userId: ctx.userId,
    actorType: isApiKey ? 'API_KEY' : 'USER',
    actor: { id: ctx.userId, email: req.user?.email ?? ctx.userEmail },
  };
}

// =============================================================================
// /wo/tickets — RFC-0044 Chamados (Work Order type CHAMADO)
// =============================================================================

/** GET /wo/tickets?status=&view=&limit= — list (scoped by view) + status board. */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { status, view, limit } = ListTicketsSchema.parse({
      status: req.query.status as string | undefined,
      view: req.query.view as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    const result = await ticketService.list(tenantId, { status, view, viewerUserId: userId, limit });
    sendSuccess(res, result, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/tickets/team — the chamados team (deduped) for assignment pickers. */
router.get('/team', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await ticketService.team(tenantId);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/tickets/email-log?limit= — recent inbound-email ingestion (RFC-0045). */
router.get('/email-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10) || 50, 200) : 50;
    const items = await emailIngestionRepository.listRecent(tenantId, limit);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/tickets — open a chamado. */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = OpenTicketSchema.parse(req.body);
    const ticket = await ticketService.open(tenantId, data, actorOf(req));
    sendCreated(res, ticket, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/tickets/:id — detail (meta, watchers, derived OS, progress). */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Ticket ID is required');
    const ticket = await ticketService.get(tenantId, req.params.id);
    sendSuccess(res, ticket, 200, requestId);
  } catch (err) { next(err); }
});

/** GET /wo/tickets/:id/timeline — aggregated feed (own + derived OS events). */
router.get('/:id/timeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Ticket ID is required');
    const events = await ticketService.timeline(tenantId, req.params.id);
    sendSuccess(res, { events }, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/tickets/:id/work-orders — derive a new execution OS from the chamado. */
router.post('/:id/work-orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Ticket ID is required');
    const data = DeriveWorkOrderSchema.parse(req.body);
    const wo = await ticketService.derive(tenantId, req.params.id, data, actorOf(req));
    sendCreated(res, wo, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/tickets/:id/links/:woId — attach an existing OS to the chamado. */
router.post('/:id/links/:woId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id, woId } = req.params;
    if (!id || !woId) throw new ValidationError('Ticket ID and Work Order ID are required');
    const ticket = await ticketService.attach(tenantId, woId, id, actorOf(req));
    sendSuccess(res, ticket, 200, requestId);
  } catch (err) { next(err); }
});

/** DELETE /wo/tickets/:id/links/:woId — detach an OS from the chamado. */
router.delete('/:id/links/:woId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { woId } = req.params;
    if (!woId) throw new ValidationError('Work Order ID is required');
    await ticketService.detach(tenantId, woId, actorOf(req));
    sendSuccess(res, { detached: true }, 200, requestId);
  } catch (err) { next(err); }
});

/** POST /wo/tickets/:id/transition — { action, note } (pending/awaiting/resolve/close/reopen/cancel). */
router.post('/:id/transition', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    if (!req.params.id) throw new ValidationError('Ticket ID is required');
    const { action, note } = TicketTransitionSchema.parse(req.body);
    const ticket = await ticketService.transition(tenantId, req.params.id, action, actorOf(req), note);
    sendSuccess(res, ticket, 200, requestId);
  } catch (err) { next(err); }
});

export default router;
