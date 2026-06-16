# RFC-0045 — Operating & deploying email ingestion (Dokploy)

How to run the email→chamado service and stand up the **new worker container** on
Dokploy. Phase 1 ships **Option B (IMAP poll)** — no DNS/MX change, pilots on the
existing `atendimento@myio.com.br` mailbox. Option A (provider webhook) is wired
too and turns on later with one env var.

---

## 0. What was built (Phase 1)

| Piece | Path | Runs where |
|---|---|---|
| Mapping logic (transport-agnostic) | `src/services/work-orders/EmailToTicketService.ts` | in-process (both transports) |
| Idempotency + thread log | table `email_ingestion_log` (migration `0045`) | DB |
| **IMAP poller (Option B)** | `src/workers/emailPoller.ts` → `dist/workers/emailPoller.js` | **its own container** |
| Inbound webhook (Option A) | `POST /api/v1/wo/tickets/email-inbound` (public, secret-guarded) | the API container |
| Admin view | Chamados → **E-mails** tab (`GET /wo/tickets/email-log`) | frontend |

Threading, idempotency, loop/auto-reply guard and reopen-on-reply are all in the
service — both transports get them for free.

---

## 1. Prerequisites (one-time)

1. **Run migration 0045** against the target DB with the **custom runner** (the
   authoritative one — see `docs/DB-MIGRATIONS.md`; the drizzle journal is frozen):
   ```bash
   # DATABASE_URL must be exported (it is NOT auto-loaded from .env by the runner)
   npm run db:mig:status      # confirm 0045 is PENDING
   npm run db:mig:up          # applies 0045_email_ingestion_log.sql
   ```
2. **Pick the routing identities** (these become env):
   - `SUPPORT_TENANT_ID` — the tenant that owns the support mailbox.
   - `SUPPORT_DEFAULT_CUSTOMER_ID` — a "triage" customer where unknown sender
     domains land (so nothing is dropped; an agent re-assigns later).
   - `SUPPORT_SYSTEM_USER_ID` — a real user (e.g. `service@…`) used as
     `work_orders.created_by` + the event actor. Create a dedicated
     **"Atendimento (bot)"** user for clean audit trails.
3. **IMAP credentials** for `atendimento@myio.com.br` (host, user, app password).
   TLS/993 only. Use an **app password**, not the primary password.

---

## 2. Run it locally (smoke before deploying)

```bash
# API as usual
npm run dev

# Poller (separate terminal). Reads .env / .env.local for DATABASE_URL + SUPPORT_*.
npm run worker:email-poller
```

No mailbox handy? Exercise the whole pipeline against the local DB with the smoke
script (no IMAP, no HTTP):

```bash
tsx --env-file=.env scripts/dev/smoke-email-ingestion.ts
# 1) new -> created  2) reply token -> appended  3) reply References -> appended
# 4) auto-reply -> skipped  5) duplicate -> skipped
```

Or test Option A without a provider:

```bash
curl -X POST http://localhost:3015/api/v1/wo/tickets/email-inbound \
  -H 'Content-Type: application/json' \
  -H "X-GCDR-Email-Secret: $EMAIL_INBOUND_SECRET" \
  -d '{"messageId":"<t1@x>","from":"Joao <joao@cliente.com>","to":["atendimento@myio.com.br"],"subject":"Sensor offline","text":"parou ontem"}'
```

---

## 3. Deploy the poller as a NEW Dokploy container

The poller is **the same Docker image as the API** — just a different start
command. You do **not** build a second image; you create a second *application*
that reuses the repo/Dockerfile and overrides the run command.

### Steps in Dokploy
1. **Create Application** → same Git repo/branch as the API, **Build type:
   Dockerfile** (the existing `Dockerfile`). Name it e.g. `gcdr-email-poller`.
2. **Run / Start Command** → override the image `CMD` with:
   ```
   node dist/workers/emailPoller.js
   ```
   (The default `CMD` starts the API — we replace it. The poller does **not** run
   migrations; do step 1 once from the API app or your shell.)
3. **No domain / no port** — it's a worker, not an HTTP service. Skip the
   domain/ports section; you can disable the healthcheck (the image's HTTP
   healthcheck won't apply to a worker — set the app's health check to "none" or
   a `pgrep node` command).
4. **Environment variables** (mark the IMAP password as a **secret**):
   ```
   DATABASE_URL=postgresql://…                # same DB as the API
   SUPPORT_TENANT_ID=…
   SUPPORT_DEFAULT_CUSTOMER_ID=…
   SUPPORT_SYSTEM_USER_ID=…
   SUPPORT_IMAP_HOST=imap.seu-provedor.com
   SUPPORT_IMAP_PORT=993
   SUPPORT_IMAP_USER=atendimento@myio.com.br
   SUPPORT_IMAP_PASS=********                  # secret
   SUPPORT_IMAP_MAILBOX=INBOX
   SUPPORT_POLL_SECONDS=60
   SUPPORT_DOMAIN_ALLOWLIST=cliente-piloto.com # pilot: restrict senders
   ```
5. **Replicas = 1.** Run a single poller per mailbox — two replicas double-poll
   the same INBOX. (Idempotency by Message-ID makes a race *safe*, but 1 is
   correct.) Set restart policy to **always**; the worker exits 0 on SIGTERM so
   Dokploy can restart/redeploy cleanly.
6. **Deploy.** Watch logs — you should see:
   ```
   [email-poller] starting — mailbox=atendimento@…/INBOX every 60s, tenant=…
   [email-poller] uid=NN -> created OS-XXXXX
   ```

### Pilot safely
Keep `SUPPORT_DOMAIN_ALLOWLIST` set to one or two known client domains at first —
only those senders create chamados; everything else is logged as
`skipped: domain_not_allowlisted` and visible in the **E-mails** tab. Widen it
when confident.

---

## 4. Later: Option A (provider webhook) for production scale

When you want push (lower latency) and to stop holding IMAP creds, point an
inbound-parse provider at the public webhook — **the mapping service is
unchanged**.

1. Choose a provider: **SendGrid Inbound Parse**, **Mailgun Routes**, **Postmark
   Inbound**, or **AWS SES→SNS**.
2. DNS/MX: point the support address (or a subdomain like `mail.myio-bas.com`) at
   the provider.
3. On the **API** app set `EMAIL_INBOUND_SECRET=<random>` (and optionally
   `EMAIL_INBOUND_PROVIDER`). Configure the provider to POST parsed mail to:
   ```
   https://gcdr-api.a.myio-bas.com/api/v1/wo/tickets/email-inbound
   ```
   sending the secret as header `X-GCDR-Email-Secret` (or `?secret=`). Without the
   secret the route returns **503 (disabled)**; wrong secret returns **401**.
4. **Turn off the poller** app (or its allowlist) so the same mailbox isn't
   ingested twice. (Even if both run, Message-ID idempotency prevents duplicate
   chamados.)

The webhook always answers **200** on a handled message (even skip/duplicate) so
the provider stops retrying; the body shape it accepts is tolerant
(`from` as `"Name <addr>"` or `{address,name}`, `to/cc` as string or array,
`headers` map, `attachments[]`).

---

## 5. Operate & observe

- **UI:** Chamados → **E-mails** tab lists recent ingestion (when, from, subject,
  result, link to the chamado). `created`/`appended` = success; `skipped` =
  duplicate / auto-reply / not-allowlisted; `error` = look at the `error` text.
- **Timeline:** every inbound email is a `CHAMADO_EMAIL_RECEBIDO` marker on the
  chamado (body in the payload); `source=EMAIL` on the ticket meta.
- **Logs:** the poller logs one line per message and a per-cycle summary.
- **Idempotency:** re-delivering a Message-ID is a no-op; safe to redeploy.

## 6. Hardening backlog (not in Phase 1)

- Attachments are recorded as metadata on the event; **downloading them into
  `file_assets`/`work_orders_files`** is the next increment (RFC-0045 §5/§10).
- Provider **HMAC** signature verification (currently a shared secret) for
  Option A.
- AV scan before linking attachments; per-sender rate limiting; SPF/DKIM/DMARC
  enforcement when the provider supplies verdicts.
- Outbound replies (RFC-0045 §11 / Phase 4) to make it a true two-way inbox.
```
