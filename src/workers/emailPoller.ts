/* eslint-disable no-console */
// RFC-0045 — Option B: IMAP poller (background worker).
//
// Polls the support mailbox over IMAP, parses each unseen message and feeds it to
// the transport-agnostic EmailToTicketService (the same service the Option A
// webhook uses). On success the message is flagged \Seen so it is processed once.
//
// Runs as its OWN process / container (separate from the API). Locally:
//   npm run worker:email-poller
// In production (Dokploy) the same image runs with command:
//   node dist/workers/emailPoller.js
//
// Required env: DATABASE_URL, SUPPORT_IMAP_HOST, SUPPORT_IMAP_USER,
//   SUPPORT_IMAP_PASS, SUPPORT_TENANT_ID, SUPPORT_DEFAULT_CUSTOMER_ID,
//   SUPPORT_SYSTEM_USER_ID. Optional: SUPPORT_IMAP_PORT (993), SUPPORT_POLL_SECONDS
//   (60), SUPPORT_IMAP_MAILBOX (INBOX), SUPPORT_DOMAIN_ALLOWLIST.
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { emailToTicketService, ParsedEmail } from '../services/work-orders/EmailToTicketService';
import { loadEmailIngestionConfig, assertEmailIngestionConfig } from '../config/emailIngestion';

const HOST = process.env.SUPPORT_IMAP_HOST ?? '';
const PORT = Number(process.env.SUPPORT_IMAP_PORT ?? 993);
const USER = process.env.SUPPORT_IMAP_USER ?? '';
const PASS = process.env.SUPPORT_IMAP_PASS ?? '';
const MAILBOX = process.env.SUPPORT_IMAP_MAILBOX ?? 'INBOX';
const POLL_MS = Math.max(15, Number(process.env.SUPPORT_POLL_SECONDS ?? 60)) * 1000;

let stopping = false;

function headerMapToObject(headers: ParsedMail['headers']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of headers) out[k.toLowerCase()] = typeof v === 'string' ? v : String(v ?? '');
  return out;
}

function addrList(a?: AddressObject | AddressObject[]): string[] {
  const arr = Array.isArray(a) ? a : a ? [a] : [];
  return arr.flatMap((x) => x.value.map((v) => v.address ?? '').filter(Boolean));
}

function toParsedEmail(mail: ParsedMail): ParsedEmail {
  const fromVal = mail.from?.value?.[0];
  return {
    messageId: mail.messageId ?? null,
    from: { address: fromVal?.address ?? '', name: fromVal?.name || undefined },
    to: addrList(mail.to),
    cc: addrList(mail.cc),
    subject: mail.subject ?? null,
    text: mail.text ?? null,
    html: typeof mail.html === 'string' ? mail.html : null,
    inReplyTo: mail.inReplyTo ?? null,
    references: Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [],
    headers: headerMapToObject(mail.headers),
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'anexo',
      contentType: a.contentType ?? 'application/octet-stream',
      size: a.size ?? 0,
    })),
    receivedAt: mail.date ?? undefined,
  };
}

async function pollOnce(): Promise<void> {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(MAILBOX);
  try {
    let seen = 0;
    let acted = 0;
    for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
      if (stopping) break;
      if (!msg.source) continue;
      seen++;
      try {
        const mail: ParsedMail = await simpleParser(msg.source);
        const result = await emailToTicketService.ingest(toParsedEmail(mail));
        if (result.status === 'created' || result.status === 'appended') acted++;
        // Flag processed regardless of skip/created/appended so we don't reprocess;
        // genuine errors are recorded in email_ingestion_log and re-run is harmless
        // (idempotent by Message-ID), so flag them too to avoid a poison loop.
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        const detail = result.code ?? result.reason ?? '';
        console.log(`[email-poller] uid=${msg.uid} -> ${result.status} ${detail}`.trim());
      } catch (err) {
        console.error(`[email-poller] uid=${msg.uid} failed:`, err instanceof Error ? err.message : err);
      }
    }
    if (seen) console.log(`[email-poller] cycle: ${seen} new, ${acted} chamado(s) touched`);
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const cfg = loadEmailIngestionConfig();
  assertEmailIngestionConfig(cfg);
  if (!HOST || !USER || !PASS) {
    throw new Error('IMAP poller misconfigured — missing SUPPORT_IMAP_HOST/USER/PASS');
  }
  console.log(`[email-poller] starting — mailbox=${USER}/${MAILBOX} every ${POLL_MS / 1000}s, tenant=${cfg.tenantId}`);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`[email-poller] ${sig} received, finishing current cycle…`);
      stopping = true;
    });
  }

  while (!stopping) {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[email-poller] cycle error:', err instanceof Error ? err.message : err);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log('[email-poller] stopped.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[email-poller] fatal:', err);
  process.exit(1);
});
