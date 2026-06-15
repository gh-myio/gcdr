import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runAssistant, isAssistantConfigured } from '../services/assistant/AssistantService';
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  type ConversationScope,
} from '../services/assistant/conversationStore';
import { sendSuccess, sendCreated } from '../middleware';

const router = Router();

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
  tools: z.array(z.string()).optional(),
});
const ConversationBody = z.object({
  title: z.string().max(200).optional(),
  messages: z.array(TurnSchema).max(200),
  shared: z.boolean().optional(),
});
const ConversationPatch = z.object({
  title: z.string().max(200).optional(),
  messages: z.array(TurnSchema).max(200).optional(),
  shared: z.boolean().optional(),
});

// =============================================================================
// /assistant — RFC-0043 GCDR Copiloto (read-only LLM over the WO tools).
// Tenant scope comes from the caller's JWT (req.context), never the body.
// =============================================================================

const AskSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .max(20)
    .optional(),
});

/** GET /assistant/status — whether the assistant is configured (for the UI). */
router.get('/status', (req: Request, res: Response) => {
  sendSuccess(res, { enabled: isAssistantConfigured() }, 200, req.context.requestId);
});

/** POST /assistant — ask the copilot a question; returns the answer + tools used. */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { message, history } = AskSchema.parse(req.body);
    const result = await runAssistant(tenantId, message, history ?? []);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// ── Persisted, optionally-shared conversation history (RFC-0043) ───────────────

/** GET /assistant/conversations?scope=mine|shared|all — list conversations. */
router.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const scope = (['mine', 'shared', 'all'] as const).includes(req.query.scope as ConversationScope)
      ? (req.query.scope as ConversationScope)
      : 'all';
    const items = await listConversations(tenantId, userId, scope);
    sendSuccess(res, { items }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/** GET /assistant/conversations/:id — one conversation (owner or shared). */
router.get('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const convo = await getConversation(tenantId, userId, req.params.id);
    sendSuccess(res, convo, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/** POST /assistant/conversations — save a new conversation. */
router.post('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const body = ConversationBody.parse(req.body);
    const convo = await createConversation(tenantId, userId, body);
    sendCreated(res, convo, requestId);
  } catch (err) {
    next(err);
  }
});

/** PATCH /assistant/conversations/:id — update messages/title/shared (owner). */
router.patch('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const patch = ConversationPatch.parse(req.body);
    const convo = await updateConversation(tenantId, userId, req.params.id, patch);
    sendSuccess(res, convo, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/** DELETE /assistant/conversations/:id — delete (owner). */
router.delete('/conversations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    await deleteConversation(tenantId, userId, req.params.id);
    sendSuccess(res, { deleted: true }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
