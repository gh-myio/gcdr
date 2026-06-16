// RFC-0045 — Option A inbound webhook. PUBLIC route (no JWT): an email provider
// (SendGrid Inbound Parse / Mailgun / Postmark / SES) POSTs the parsed message
// here. Guarded by a shared secret; feeds the same EmailToTicketService the IMAP
// poller uses. Always answers 200 on a *handled* message (even skip/duplicate) so
// the provider stops retrying; 401 only when the secret is wrong.
import { Router, Request, Response, NextFunction } from 'express';
import { emailToTicketService, ParsedEmail } from '../../services/work-orders/EmailToTicketService';
import { loadEmailIngestionConfig } from '../../config/emailIngestion';
import { sendSuccess } from '../../middleware';

const router = Router();

/** "Name <addr@x>" or "addr@x" → {address, name}. */
function parseAddress(v: unknown): { address: string; name?: string } {
  if (v && typeof v === 'object' && 'address' in (v as Record<string, unknown>)) {
    const o = v as { address: string; name?: string };
    return { address: String(o.address), name: o.name };
  }
  const s = String(v ?? '');
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { address: m[2].trim(), name: m[1].trim() || undefined };
  return { address: s.trim() };
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => parseAddress(x).address).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => parseAddress(s).address).filter(Boolean);
  return [];
}

/** Tolerant mapping of a provider payload → the normalized ParsedEmail. */
function normalizeInbound(body: Record<string, unknown>): ParsedEmail {
  const headers = (body.headers && typeof body.headers === 'object'
    ? (body.headers as Record<string, string>)
    : {}) as Record<string, string | undefined>;
  const refs = body.references;
  return {
    messageId: (body.messageId ?? body['message-id'] ?? headers['message-id'] ?? null) as string | null,
    from: parseAddress(body.from),
    to: toList(body.to),
    cc: toList(body.cc),
    subject: (body.subject ?? null) as string | null,
    text: (body.text ?? null) as string | null,
    html: (body.html ?? null) as string | null,
    inReplyTo: (body.inReplyTo ?? body['in-reply-to'] ?? headers['in-reply-to'] ?? null) as string | null,
    references: Array.isArray(refs)
      ? (refs as string[])
      : typeof refs === 'string'
        ? refs.split(/\s+/).filter(Boolean)
        : [],
    headers,
    attachments: Array.isArray(body.attachments)
      ? (body.attachments as Array<Record<string, unknown>>).map((a) => ({
          filename: String(a.filename ?? a.name ?? 'anexo'),
          contentType: String(a.contentType ?? a.type ?? 'application/octet-stream'),
          size: Number(a.size ?? 0),
        }))
      : [],
  };
}

/** POST /api/v1/wo/tickets/email-inbound — provider inbound-parse webhook. */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = loadEmailIngestionConfig();
    if (!cfg.inboundSecret) {
      return res.status(503).json({ error: { code: 'EMAIL_INBOUND_DISABLED', message: 'EMAIL_INBOUND_SECRET not configured' } });
    }
    const provided = req.header('X-GCDR-Email-Secret') ?? (req.query.secret as string | undefined);
    if (provided !== cfg.inboundSecret) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email-inbound secret' } });
    }

    const parsed = normalizeInbound(req.body ?? {});
    if (!parsed.from.address) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'missing from address' } });
    }

    const result = await emailToTicketService.ingest(parsed);
    // 200 on every handled message so the provider stops retrying.
    sendSuccess(res, result, 200, (req.context as { requestId?: string } | undefined)?.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
