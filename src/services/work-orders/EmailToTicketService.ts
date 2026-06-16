// RFC-0045 — Email-to-Ticket ingestion (transport-agnostic).
//
// Both transports feed this service the SAME normalized ParsedEmail:
//   - the public webhook (Option A, provider inbound-parse), and
//   - the IMAP poller (Option B).
// The mapping reuses TicketService (RFC-0044) — no new lifecycle logic. The
// service decides skip / append / create, writes the email_ingestion_log row
// (idempotency + thread anchor) and drops the body onto the chamado timeline as
// a CHAMADO_EMAIL_RECEBIDO marker.
import { ticketService } from './TicketService';
import { workOrderService, ActorContext } from './WorkOrderService';
import { emailIngestionRepository } from '../../repositories/work-orders/EmailIngestionRepository';
import {
  loadEmailIngestionConfig,
  assertEmailIngestionConfig,
  EmailIngestionConfig,
} from '../../config/emailIngestion';

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
}

/** The normalized shape every transport must produce. */
export interface ParsedEmail {
  /** RFC 5322 Message-ID (with or without angle brackets). */
  messageId?: string | null;
  from: { address: string; name?: string };
  to?: string[];
  cc?: string[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  /** Lower-cased header map (only the ones we filter on are needed). */
  headers?: Record<string, string | undefined>;
  attachments?: ParsedAttachment[];
  receivedAt?: Date;
}

export type IngestStatus = 'created' | 'appended' | 'skipped' | 'error';

export interface IngestResult {
  status: IngestStatus;
  ticketId?: string;
  code?: string;
  /** Why it was skipped/errored (for logs + the admin view). */
  reason?: string;
}

const TERMINAL_REOPENABLE = new Set(['RESOLVIDO', 'FECHADO']);
// Subject thread token, e.g. "[OS-ABC1D2]" or "[CH-0007]".
const SUBJECT_TOKEN = /\[([A-Z]{2,4}-[A-Z0-9-]+)\]/i;
const SUBJECT_PREFIX = /^\s*(re|res|fw|fwd|enc|encaminhada?)\s*:\s*/i;

function stripAngle(id?: string | null): string | null {
  if (!id) return null;
  return id.replace(/^<|>$/g, '').trim() || null;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip Re:/Fwd: prefixes and any [OS-…] token; keep a usable subject. */
function cleanSubject(subject?: string | null): string {
  let s = (subject ?? '').replace(SUBJECT_TOKEN, '').trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(SUBJECT_PREFIX, '').trim();
  } while (s !== prev);
  return s || '(sem assunto)';
}

export class EmailToTicketService {
  /**
   * Ingest one email. Never throws on a single bad message — it records the
   * error in the log and returns {status:'error'} so the transport can ack the
   * message and move on (a poison message must not block the mailbox).
   */
  async ingest(parsed: ParsedEmail, override?: Partial<EmailIngestionConfig>): Promise<IngestResult> {
    const cfg = { ...loadEmailIngestionConfig(), ...override };
    assertEmailIngestionConfig(cfg);

    const messageId =
      stripAngle(parsed.messageId) ??
      `synthetic:${parsed.from.address}:${parsed.subject ?? ''}:${(parsed.receivedAt ?? new Date()).getTime()}`;
    const fromAddress = parsed.from.address.toLowerCase();
    const toAddress = (parsed.to ?? [])[0]?.toLowerCase() ?? null;
    const inReplyTo = stripAngle(parsed.inReplyTo);

    const logBase = {
      tenantId: cfg.tenantId,
      messageId,
      fromAddress,
      toAddress,
      subject: (parsed.subject ?? '').slice(0, 512),
      inReplyTo,
    };

    try {
      // 1) Loop / auto-reply guard — never react to machine mail.
      const loopReason = this.loopReason(parsed.headers);
      if (loopReason) {
        await emailIngestionRepository.insert({ ...logBase, status: 'skipped', error: loopReason });
        return { status: 'skipped', reason: loopReason };
      }

      // 2) Pilot allowlist (optional).
      const domain = domainOf(fromAddress);
      if (cfg.domainAllowlist.length && (!domain || !cfg.domainAllowlist.includes(domain))) {
        const reason = `domain_not_allowlisted:${domain ?? 'none'}`;
        await emailIngestionRepository.insert({ ...logBase, status: 'skipped', error: reason });
        return { status: 'skipped', reason };
      }

      // 3) Idempotency — already processed this Message-ID?
      const existing = await emailIngestionRepository.findByMessageId(cfg.tenantId, messageId);
      if (existing) {
        return { status: 'skipped', reason: 'duplicate', ticketId: existing.workOrderId ?? undefined };
      }

      const ctx: ActorContext = {
        userId: cfg.systemUserId,
        actorType: 'SYSTEM',
        actor: { name: parsed.from.name, email: fromAddress },
      };
      const body = this.body(parsed, cfg.maxBodyChars);
      const attachments = (parsed.attachments ?? []).map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      }));

      // 4) Thread match → append; else open new.
      const ticketId = await this.matchThread(cfg.tenantId, parsed);
      if (ticketId) {
        const result = await this.appendToTicket(cfg.tenantId, ticketId, parsed, body, attachments, ctx);
        await emailIngestionRepository.insert({ ...logBase, workOrderId: ticketId, status: 'appended' });
        return result;
      }

      const ticket = await this.openTicket(cfg, parsed, fromAddress, body, attachments, ctx);
      await emailIngestionRepository.insert({ ...logBase, workOrderId: ticket.id, status: 'created' });
      return { status: 'created', ticketId: ticket.id, code: ticket.code };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Best-effort error row (ignore if the unique index already has it).
      await emailIngestionRepository.insert({ ...logBase, status: 'error', error: reason.slice(0, 1000) }).catch(() => undefined);
      return { status: 'error', reason };
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  private loopReason(headers?: Record<string, string | undefined>): string | null {
    if (!headers) return null;
    const h = (k: string) => (headers[k] ?? headers[k.toLowerCase()] ?? '').toLowerCase();
    if (h('auto-submitted') && h('auto-submitted') !== 'no') return 'auto-submitted';
    if (['bulk', 'list', 'junk', 'auto_reply'].includes(h('precedence'))) return `precedence:${h('precedence')}`;
    if (h('x-auto-response-suppress')) return 'x-auto-response-suppress';
    if (h('x-gcdr-loop')) return 'x-gcdr-loop';
    return null;
  }

  private body(parsed: ParsedEmail, max: number): string {
    const raw = (parsed.text && parsed.text.trim()) || (parsed.html ? htmlToText(parsed.html) : '') || '';
    return raw.length > max ? `${raw.slice(0, max)}\n…[truncado]` : raw;
  }

  private async matchThread(tenantId: string, parsed: ParsedEmail): Promise<string | null> {
    // (a) explicit subject token — the cleanest signal.
    const token = (parsed.subject ?? '').match(SUBJECT_TOKEN);
    if (token) {
      const byCode = await emailIngestionRepository.findTicketIdByCode(tenantId, token[1].toUpperCase());
      if (byCode) return byCode;
    }
    // (b) In-Reply-To / References against stored Message-IDs.
    const anchors = [stripAngle(parsed.inReplyTo), ...(parsed.references ?? []).map(stripAngle)].filter(
      (x): x is string => Boolean(x),
    );
    if (anchors.length) {
      return emailIngestionRepository.findTicketIdByAnchors(tenantId, anchors);
    }
    return null;
  }

  private async appendToTicket(
    tenantId: string,
    ticketId: string,
    parsed: ParsedEmail,
    body: string,
    attachments: ParsedAttachment[],
    ctx: ActorContext,
  ): Promise<IngestResult> {
    const wo = await workOrderService.getById(tenantId, ticketId);
    // Reopen a terminal chamado on a client reply (configurable default: reopen).
    if (TERMINAL_REOPENABLE.has(wo.status)) {
      await ticketService.transition(tenantId, ticketId, 'reopen', ctx, 'Reaberto por resposta de e-mail').catch(() => undefined);
    }
    await workOrderService.appendEvent(
      tenantId,
      ticketId,
      {
        eventType: 'CHAMADO_EMAIL_RECEBIDO',
        payload: { from: ctx.actor?.email, name: parsed.from.name, subject: parsed.subject, body, attachments },
      },
      ctx,
    );
    return { status: 'appended', ticketId, code: wo.code };
  }

  private async openTicket(
    cfg: EmailIngestionConfig,
    parsed: ParsedEmail,
    fromAddress: string,
    body: string,
    attachments: ParsedAttachment[],
    ctx: ActorContext,
  ): Promise<{ id: string; code: string }> {
    const domain = domainOf(fromAddress);
    const customerId =
      (domain ? await emailIngestionRepository.findCustomerIdByRequesterDomain(cfg.tenantId, domain) : null) ??
      cfg.defaultCustomerId;

    const cc = (parsed.cc ?? []).map((e) => e.toLowerCase()).filter((e) => e !== fromAddress);
    const ticket = await ticketService.open(
      cfg.tenantId,
      {
        customerId,
        subject: cleanSubject(parsed.subject),
        reason: body || undefined,
        priority: 'MEDIA',
        source: 'EMAIL',
        requesterEmail: fromAddress,
        cc,
      },
      ctx,
    );

    // Drop the original message on the timeline as the first email event.
    await workOrderService.appendEvent(
      cfg.tenantId,
      ticket.id,
      {
        eventType: 'CHAMADO_EMAIL_RECEBIDO',
        payload: { from: fromAddress, name: parsed.from.name, subject: parsed.subject, body, attachments },
      },
      ctx,
    );
    return { id: ticket.id, code: ticket.code };
  }
}

export const emailToTicketService = new EmailToTicketService();
