import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runAssistant, isAssistantConfigured } from '../services/assistant/AssistantService';
import { sendSuccess } from '../middleware';

const router = Router();

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

export default router;
