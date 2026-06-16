# RFC-0045 — Email-to-Ticket Ingestion (atendimento@ → Chamado)

- **Status:** Draft
- **Date:** 2026-06-15
- **Domain:** Work Orders (`wo` / OS) — Chamados
- **Depends on:** [RFC-0044 — Chamados (Work Order type CHAMADO)], [RFC-0037 WO Event Model], [RFC-0036/0037 file_assets owner types], [RFC-0009 Audit Logs]
- **Related:** `docs/integracao_freshdesk_myio.md` (today Freshdesk auto-creates a ticket from inbound email)

## 1. Summary

Let clients open a **chamado** simply by **sending an email** to a support
address (e.g. `atendimento@myio.com.br`), exactly like Freshdesk does today.
GCDR ingests the inbound message, maps it onto the RFC-0044 `CHAMADO` model
(creating a new chamado or appending to an existing thread), preserves
attachments, and — optionally — supports two-way replies so the whole
conversation stays in GCDR.

The CHAMADO model already anticipates this: `work_orders_ticket_meta.source`
includes `EMAIL`, and `requester_email` is the routing key for the
Técnico/Supervisor/Holding views (RFC-0044 §5). This RFC defines **how the email
gets in**.

## 2. Motivation

- Most clients today email `atendimento@myio.com.br`; Freshdesk turns each email
  into a ticket automatically. To make GCDR Chamados a real replacement (RFC-0044),
  email ingestion is the missing front door — without it, clients must use the
  panel, which they won't.
- It also reduces the dependency on Freshdesk for *new* tickets (the RFC-0044
  Phase 4 importer covers *historical* tickets; this RFC covers *ongoing* email).

## 3. Ingestion channel — options

The hard part is **getting the email into the app**. Three approaches:

### Option A — Inbound-parse webhook (recommended)
An email provider receives the mail and **POSTs the parsed message** to a GCDR
webhook. The MX of the support address (or a dedicated subdomain like
`mail.myio-bas.com`) points to the provider; it parses MIME and calls us.
- Providers: **SendGrid Inbound Parse**, **Mailgun Routes**, **Postmark Inbound**,
  **AWS SES → SNS/Lambda**.
- **Pros:** no SMTP server to run/harden, provider handles spam/SPF/DKIM/MIME,
  attachments come pre-extracted, scales, push (low latency).
- **Cons:** MX/DNS change + provider account; must verify the webhook signature.

### Option B — IMAP/POP polling (fastest to ship)
A background worker polls the existing mailbox (`atendimento@myio.com.br`) over
**IMAP** (e.g. every 30–60 s), fetches unseen messages, parses MIME, creates
chamados, then marks them seen / moves to a "Processed" folder.
- **Pros:** **no DNS/MX change** — reuses the mailbox that already exists; trivial
  to pilot; provider-agnostic.
- **Cons:** polling latency; must manage IMAP state/idempotency; one mailbox per
  support address; credentials in the app.

### Option C — Run an SMTP server
Run an SMTP listener (e.g. `smtp-server`/Haraka) that receives mail directly.
- **Pros:** fully self-hosted, real-time.
- **Cons:** heaviest — MX + TLS + deliverability + anti-spam + abuse hardening are
  the provider's job in A; not worth it for an MVP.

**Recommendation:** ship **Option B (IMAP poll)** first (zero DNS change, pilots
on the real mailbox in days), and design the **EmailToTicketService** behind a
transport-agnostic boundary so **Option A (inbound-parse webhook)** can replace
the poller in production without touching the mapping logic.

## 4. Architecture

```
[Mail provider / mailbox]
   │  (A) provider POST  ──►  POST /api/v1/wo/tickets/email-inbound   (HMAC-verified)
   │  (B) IMAP poll      ──►  EmailPoller (background worker)
   ▼
ParsedEmail (normalized: from, to, subject, text, html, messageId,
             inReplyTo, references, attachments[])
   ▼
EmailToTicketService
   ├─ spam/loop/auto-reply filter
   ├─ idempotency (Message-ID seen?) ──► skip
   ├─ thread match (reply token / In-Reply-To / References) ──► append to chamado
   └─ else ──► resolve tenant+customer+requester ──► TicketService.open()
                                                      + attachments → file_assets
                                                      + body → annotation/description
```

`EmailToTicketService` is transport-agnostic: both the webhook controller and the
IMAP poller feed it the same `ParsedEmail`. It reuses `TicketService`
(RFC-0044) — no new lifecycle logic.

## 5. Email → Chamado mapping

| Email | Chamado (RFC-0044) |
|---|---|
| `Subject` | `work_orders_ticket_meta.subject` (strip `Re:`/`Fwd:` and any `[OS-…]` token) |
| `From` (address) | `requester_email` (+ resolve `requester_user_id`, derive `requester_domain`) |
| `From` (display name) | stored in the opening event/annotation payload |
| Body (text/plain, fallback stripped HTML) | the **description** — first annotation/message on the chamado |
| `Cc` | `work_orders_watchers` |
| Attachments | downloaded → `file_assets` → `work_orders_files` (evidence) |
| `Message-ID` | idempotency key + thread anchor (see §6) |
| recipient address / sender domain | tenant + customer resolution (see §7) |
| — | `source = EMAIL`, `type = CHAMADO`, entry event `CHAMADO_ABERTO` |

The chamado **type** is `CHAMADO`; default priority `MEDIA` (configurable by a
rule, e.g. subject keywords). The opening uses `TicketService.open(...)`.

## 6. Threading & replies (new vs. append)

When a client replies to a ticket email, it must **append to the existing
chamado**, not open a new one. Resolution order:

1. **Reply token** in the recipient or subject — the cleanest. Outbound emails
   use a plus-addressed reply-to like `atendimento+os-ABC1D2@myio-bas.com` (or a
   `[OS-ABC1D2]` subject tag). On inbound, extract the code → append to that
   chamado.
2. **`In-Reply-To` / `References`** headers matched against stored `Message-ID`s
   of prior emails on a chamado.
3. Otherwise → **new chamado**.

Appended emails become a new **annotation/event** on the chamado (the `EMAIL`
source), and re-opening rules apply: a reply on a `RESOLVIDO`/`FECHADO` chamado
can **reopen** it (`CHAMADO_REABERTO`) per the tenant's lifecycle (configurable).

## 7. Tenant & customer resolution (multi-tenant)

- **Tenant:** by the **recipient address** — each tenant configures one or more
  support addresses (`atendimento@…` → tenant X). MVP: a single tenant via config.
- **Customer:** by the **sender's email domain** (RFC-0044 Holding view already
  keys off `requester_domain`) → map domain → customer; fallback to a configured
  **default/triage customer** when unknown (so nothing is dropped, and an agent
  re-assigns later).
- **Requester user:** resolve `requester_email` to an existing user if present
  (so the Técnico/own-tickets view works); otherwise leave `requester_user_id`
  null (still scoped by email/domain).

## 8. Idempotency, loops, spam

- **Idempotency:** persist each processed `Message-ID` (new table
  `email_ingestion_log`); a duplicate delivery (provider retry / poll overlap) is
  skipped. Webhook returns `200` even on duplicates so the provider stops retrying.
- **Loop prevention:** drop messages with `Auto-Submitted: auto-*`,
  `Precedence: bulk/list/junk`, `X-Auto-Response-Suppress`, or our own outbound
  marker header (`X-GCDR-Loop`). Never auto-reply to auto-replies.
- **Spam / authenticity:** trust the provider's spam verdict (Option A); verify
  **SPF/DKIM/DMARC** results when available; rate-limit per sender; cap message +
  attachment size; optionally allowlist domains during pilot.
- **Bounces / DSNs:** ignored (not chamados).

## 9. Security

- Webhook (Option A) authenticated by **provider HMAC signature** (or a shared
  secret path token); reject unsigned. Public route, no JWT (it's machine-to-machine).
- IMAP (Option B) credentials in secrets/env; least-privilege mailbox; TLS only.
- Attachment size/count caps; content-type allowlist; (future) AV scan before
  linking to `file_assets`.
- **LGPD:** inbound emails contain client PII; audited (RFC-0009), retained per
  the chamado retention policy; raw MIME not stored beyond what's needed.

## 10. Data model & API

- **New table `email_ingestion_log`** (idempotency + thread anchor):
  `id, tenant_id, message_id (unique per tenant), work_order_id (the chamado),
  direction (inbound|outbound), from_address, to_address, in_reply_to,
  processed_at, status (created|appended|skipped|error), error`.
- **Endpoint (Option A):** `POST /api/v1/wo/tickets/email-inbound` — accepts the
  provider's parsed payload (JSON or multipart), HMAC-verified; returns 200.
  Mounted **public** (no `authMiddleware`), guarded by the signature.
- **Worker (Option B):** `scripts/workers/email-poller.ts` (or an in-process
  interval) using IMAP; config via env (`SUPPORT_IMAP_HOST/USER/PASS`,
  `SUPPORT_POLL_SECONDS`, `SUPPORT_TENANT_ID`, `SUPPORT_DEFAULT_CUSTOMER_ID`).
- **Service:** `EmailToTicketService` (transport-agnostic) reusing `TicketService`.
- Env (Option A): `EMAIL_INBOUND_PROVIDER`, `EMAIL_INBOUND_SECRET`,
  `SUPPORT_ADDRESSES` (address→tenant map).

No change to the CHAMADO lifecycle/schema beyond the log table (the ticket schema
from RFC-0044 already has `source`, `requester_*`, `watchers`, files).

## 11. Outbound (optional, two-way)

To make it a real inbox (and match Freshdesk), agent replies on a chamado can be
**emailed back** to the requester via an outbound adapter (the same provider's
send API or SMTP), `From: atendimento@…`, `Reply-To: atendimento+os-<code>@…`,
threading headers set so the client's reply lands back on the same chamado (§6).
This is a separate adapter; can ship after inbound.

## 12. Rollout

- **Phase 1 — Inbound (IMAP poll):** `EmailToTicketService` + `email_ingestion_log`
  + poller; new chamados from email on the real mailbox, attachments, idempotency,
  loop/spam filters. No DNS change. Pilot with a domain allowlist.
- **Phase 2 — Threading & reopen:** reply-token + `In-Reply-To`/`References`
  matching; replies append (and can reopen) instead of duplicating.
- **Phase 3 — Provider webhook (Option A):** swap the poller for an inbound-parse
  webhook (MX/DNS) for production scale + lower latency; same service.
- **Phase 4 — Outbound replies:** two-way email from the chamado (§11).

## 13. Out of scope

- Full email client / rich threading UI inside GCDR (the chamado timeline +
  annotations already render the conversation).
- Calendar invites, read receipts, mailing-list handling.
- AV scanning implementation (noted as a hardening follow-up).

## 14. Open questions

- Which provider for Option A (SendGrid / Mailgun / SES / Postmark) and who owns
  the MX/DNS for the support domain?
- Single support address (one tenant) for the MVP, or address→tenant map from day
  one?
- Default/triage customer for unknown sender domains — one per tenant?
- Should an email reply to a terminal chamado **reopen** it or open a **new linked**
  chamado? (configurable per tenant; default: reopen.)
