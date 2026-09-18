# RFC-0207: Provider-neutral Public Ticket Submission (Jira First)

- **Status:** Draft
- **Date:** 2026-09-17
- **Domain:** Support / Public Applications / Integrations
- **Authors:** MYIO Engineering
- **Depends on:** [RFC-0009 — Events and Audit Logs](./RFC-0009-Events-Audit-Logs.md), [RFC-0020 — Public Single Apps](./RFC-0020-Public-Single-Apps.md), [RFC-0030 — MYIO Wiki Knowledge Base](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)
- **Related:** [RFC-0044 — Chamados Work Order Type](./RFC-0044-Chamados-Work-Order-Type.md), [RFC-0045 — Email-to-Ticket Ingestion](./RFC-0045-Email-to-Ticket-Ingestion.md)

## Summary

Create a public, mobile-friendly support page backed by GCDR that allows a user
to submit a support ticket without authenticating. GCDR owns a canonical,
provider-neutral ticket model, validates and protects the submission, delivers
the ticket through a pluggable provider adapter, records an audit trail, and
returns a safe public receipt. Jira is the first adapter, not the domain model.

The browser never communicates with Jira or another ticket provider directly
and never receives provider credentials, mappings, external ticket IDs/keys,
URLs, delivery errors, or internal workflow metadata.

The proposed public route is:

```text
GET /support
```

The proposed API endpoint is:

```text
POST /api/v1/public/support-tickets
```

## Motivation

Customers, field technicians, and other users occasionally need to report an
incident without having a GCDR account or access to an internal support tool.
Today they must use an indirect channel or depend on a MYIO employee to copy the
request into Jira. This increases response time, loses structured context, and
makes duplicate or incomplete reports more likely.

A public page provides a simple entry point while GCDR remains the policy and
security boundary. It also gives MYIO one place to apply validation, abuse
prevention, tenant/customer routing, observability, and audit rules before data
reaches Jira.

## Guide-level explanation

### User journey

1. The requester opens `/support?form=<opaque-id>` from a tenant- or
   customer-specific link. There is no unscoped default form in v1.
2. The page displays the text-only support form and privacy notice.
3. The requester provides contact and incident information and completes the
   anti-abuse challenge.
4. GCDR resolves the customer and support project from the form, creates the
   canonical ticket, and durably accepts it for asynchronous provider delivery.
5. The page displays a public receipt code. It never exposes the provider's
   external ticket key.
6. If the provider is temporarily unavailable, GCDR retains the ticket for
   asynchronous retry and shows the same receipt instead of asking the user to
   submit again.

### Form fields

The first version contains:

| Field | Required | Rules |
|---|---:|---|
| `reporter.name` | yes | 2–120 characters |
| `reporter.email` | yes | valid email, maximum 254 characters |
| `reporter.phone` | no | normalized string, maximum 30 characters |
| `title` | yes | 5–160 characters |
| `description` | yes | 20–10,000 characters |
| `category` | yes | value from a server-provided allowlist |
| `priority` | yes | `VERY_LOW`, `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`, or `URGENT` |
| `criticality` | yes | `BLOCKING` or `NON_BLOCKING` |
| `requestedResolutionAt` | no | requester preference; never the contractual SLA deadline |
| `location` | no | maximum 250 characters |
| `deviceIdentifier` | no | serial, external ID, or device label; maximum 120 characters |
| `privacyConsent` | yes | must be `true` |

Customer and support project are display-only context resolved from the opaque
form. The public caller cannot submit their IDs. Status, assignee, contractual
resolution deadline, provider, external references, tags, watchers, and custom
fields are controlled by trusted GCDR configuration or operator workflows.

Attachments are intentionally excluded from the pilot. They are introduced
only after the text-only intake and provider-delivery path is operationally proven.

The UI must be accessible, responsive, keyboard navigable, and usable in
English and Brazilian Portuguese. The source strings are internationalized;
the initial locale may be selected from the browser and changed by the user.

### Success and failure experience

On acceptance, the requester sees a receipt such as `SUP-7K4M2Q8P` and receives
an email confirmation when email delivery is configured. The receipt proves
that GCDR accepted the request; it is not a Jira key and cannot be used to query
private ticket data.

Validation failures are shown next to the relevant fields. Rate-limit or
anti-abuse failures use a generic response. A provider outage must not lead users to
create duplicates: once GCDR persists a valid request, delivery to Jira is an
internal concern and is retried asynchronously.

## Reference-level explanation

### Architecture

```text
Public browser
    |
    | GET /support
    | POST /api/v1/public/support-tickets
    v
GCDR public support controller
    |-- Zod validation
    |-- CAPTCHA verification
    |-- rate limit and duplicate detection
    |-- public form/customer routing
    v
PublicTicketSubmissionService
    |-- persist submission and outbox event in one transaction
    |-- return opaque receipt code
    v
Ticket provider delivery worker
    |-- ITicketingProvider port
    |-- retry with backoff and idempotency guard
    v
JiraTicketingProvider (v1) -> Jira REST API
```

The write path uses a transactional outbox. The HTTP request is successful when
the submission and its outbox job are durably stored, not only when Jira is
available. A worker calls the configured provider adapter and updates only the
provider-reference and delivery projections.

### Existing GCDR building blocks

This RFC deliberately reuses established codebase patterns instead of creating
parallel implementations:

- the anonymous Wiki integration submission from RFC-0030 is the closest public
  write precedent, including Turnstile, honeypot behavior, generic bot success,
  and request-level rate limiting;
- `verifyTurnstileToken()` remains the only CAPTCHA adapter for v1;
- `InventoryOutboxWorker` provides the required claiming, retry, backoff, and
  dead-letter conventions for multi-replica-safe delivery;
- the RFC-0044 `CHAMADO` domain is already implemented and operational. Its
  exclusion from the provider-neutral pilot is a deliberate scope decision, not a
  dependency on future adoption.

The provider worker follows the inventory outbox conventions:
short `FOR UPDATE SKIP LOCKED` claims, bounded exponential backoff, fixed maximum
attempts, durable dead letters, and safe concurrent drainers. External provider
calls occur outside the claim transaction; a lease on `DELIVERING` records lets
another worker recover abandoned work.

### Public form configuration

Public links use an opaque `formId`, not a tenant UUID, customer UUID, support
project UUID, provider project key, or ticket type:

```text
https://<public-gcdr-host>/support?form=pf_7GmKq2x9...
```

The form configuration is administered through authenticated GCDR APIs and
contains:

- tenant, customer, and support-project scope;
- enabled/disabled state and optional expiration;
- allowed categories, six public priorities, and both criticality values;
- requested-resolution-date policy;
- provider name/connection, external project/type, and field mappings;
- branding, locale defaults, and privacy notice;
- attachment policy and notification settings.

A form identifier may be rotated or revoked without changing provider credentials.
Unknown, disabled, or expired identifiers return the same public not-found
response. V1 requires an opaque `formId`; `/support` without one renders a
generic invalid-link page and cannot submit a ticket.

### API contract

#### `GET /api/v1/public/support-forms/:formId`

Returns only public presentation data:

```json
{
  "name": "MYIO Support",
  "description": "Report an operational problem to MYIO.",
  "customerName": "Example Customer",
  "projectName": "Energy Monitoring",
  "defaultLocale": "pt-BR",
  "supportedLocales": ["pt-BR", "en"],
  "categories": [
    { "value": "DEVICE", "label": "Device" },
    { "value": "CONNECTIVITY", "label": "Connectivity" },
    { "value": "OTHER", "label": "Other" }
  ],
  "priorities": ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH", "URGENT"],
  "criticalities": ["BLOCKING", "NON_BLOCKING"],
  "requestedResolutionEnabled": true,
  "attachments": { "enabled": false, "maxFiles": 5 },
  "privacyNoticeUrl": "https://example.com/privacy",
  "privacyNoticeVersion": "2026-09"
}
```

It never returns tenant/customer/project IDs, provider project keys, field
mappings, credentials, internal email addresses, or private configuration.

#### `POST /api/v1/public/support-tickets`

Authentication: none. Protection: CAPTCHA, rate limiting, origin policy,
payload limits, and server-side validation.

```json
{
  "formId": "pf_7GmKq2x9...",
  "title": "Gateway is offline",
  "description": "The gateway has been unreachable since 09:30.",
  "reporter": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+55 11 99999-9999"
  },
  "category": "CONNECTIVITY",
  "priority": "HIGH",
  "criticality": "BLOCKING",
  "requestedResolutionAt": "2026-09-19T18:00:00-03:00",
  "location": "Store 42",
  "deviceIdentifier": "GW-00192",
  "privacyConsent": true,
  "captchaToken": "provider-token",
  "idempotencyKey": "8e58cd45-6de5-4a9f-a063-a192e2472921"
}
```

The pilot accepts `application/json` only. A later attachment phase changes the
request to `multipart/form-data`, with structured fields in a `payload` JSON
part and files in repeated `attachments` parts.

Accepted response (`202 Accepted`):

```json
{
  "receiptCode": "SUP-7K4M2Q8P",
  "status": "ACCEPTED",
  "message": "Your support request was received."
}
```

The same `formId + idempotencyKey` returns the original receipt and never
creates another provider ticket. The API does not reveal whether an email address,
customer, project, device, or provider ticket exists.

The idempotency key is generated by the official client. Returning the original
opaque receipt to a caller presenting the same high-entropy UUID is an accepted
v1 risk: the receipt grants no read access and UUID guessing is impractical.

### Canonical contract and field ownership

All inputs are validated with Zod in the handler and normalized before storage.
Rich HTML is not accepted in v1. The HTTP request groups reporter fields, while
the database may store their immutable opening snapshot in flat columns.

| Field | Public requester | GCDR/configuration | Provider/operator |
|---|---:|---:|---:|
| `title`, `description` | supplies | validates | receives mapped fields |
| `reporter` | supplies contact | normalizes/snapshots | receives mapped fields |
| `priority` | selects allowed value | may normalize by policy | receives mapping |
| `criticality` | selects blocking/non-blocking | validates | receives mapping |
| customer/project | never sends raw IDs | resolves from opaque form | receives mapping |
| `status` | cannot set | initializes `NEW` | owns later workflow in v1 |
| `assignee` | cannot set | optional routing policy | operator/provider owns |
| `requestedResolutionAt` | may request | validates horizon/timezone | informational |
| `resolutionDueAt` | cannot set | calculates from SLA/policy | receives mapping |
| attachments (post-pilot) | selects up to 5 | scans/approves | receives clean files only |

Canonical enums:

```text
TicketPriority    = VERY_LOW | LOW | MEDIUM | HIGH | VERY_HIGH | URGENT
TicketCriticality = BLOCKING | NON_BLOCKING
TicketStatus      = NEW | TRIAGED | IN_PROGRESS | WAITING_REQUESTER |
                    RESOLVED | CLOSED | CANCELLED
```

`requestedResolutionAt` is the requester's desired date. `resolutionDueAt` is
the contractual deadline calculated from trusted SLA policy. One can never
overwrite the other.

The Jira adapter maps `title` to `summary`, plain-text `description` to Jira's
document format, and canonical category/priority/criticality/customer/project
values to allowlisted Jira fields. A different provider supplies its own
mapping without changing public contracts.

Only allowlisted provider fields and values may be set. Public input cannot
select a provider project/type, assignee, provider reporter identity, watcher,
status, sprint, raw label, or arbitrary custom field. Jira issue creation uses
a dedicated integration identity with access only to configured projects.

### Data model

#### `support_projects`

```text
id, tenant_id, customer_id, name, code, description, status,
created_at, updated_at
```

A support project is a provider-neutral subdivision within exactly one GCDR
customer. It is not an Inventory project and not a Jira project. The form pins
one support project; provider configuration maps it to an external destination.
`(tenant_id, customer_id, code)` is unique, and every service validates that the
project belongs to the resolved customer.

#### `support_tickets`

```text
id, tenant_id, customer_id, project_id, title, description, status,
reporter_name, reporter_email, reporter_phone, reporter_user_id,
assignee_user_id, assignee_team_id, assignee_display_name,
category, priority, criticality, requested_resolution_at, resolution_due_at,
resolved_at, closed_at, source, location, device_identifier,
provider_name, external_ticket_id, external_ticket_key,
created_at, updated_at
```

This is the canonical ticket, independent of Jira. `source = PUBLIC_FORM` in
this RFC. Provider/external fields are an integration projection and remain
internal. `(provider_name, external_ticket_id)` is unique when an external ID
exists.

#### `public_support_forms`

```text
id, tenant_id, customer_id, project_id, public_id, name, status,
default_locale, supported_locales, category_config, priority_config,
criticality_config, requested_resolution_policy, provider_name,
provider_connection_alias, provider_project_ref, provider_ticket_type_ref,
provider_field_mapping, branding_config, attachment_policy,
privacy_notice_url, privacy_notice_version, expires_at, created_at, updated_at
```

`public_id` is unique, random, opaque, and safe to rotate. Sensitive provider
configuration is not stored in the JSON exposed by the public API.

#### `public_ticket_submissions`

```text
id, tenant_id, customer_id, project_id, ticket_id, form_id, receipt_code,
idempotency_key, privacy_consent_at, privacy_notice_version,
delivery_status, last_error_code, created_at, delivered_at, updated_at
```

Unique constraints:

- `(form_id, idempotency_key)` prevents client retries from duplicating issues;
- `receipt_code` is globally unique;
- `ticket_id` is unique.

The submission is the public intake, consent, receipt, and idempotency ledger.
Ticket content lives in `support_tickets`; delivery errors remain internal.

#### `public_ticket_delivery_outbox`

```text
id, submission_id, ticket_id, provider_name, status, attempt_count,
next_attempt_at, lease_until, last_error_code, created_at, completed_at,
updated_at
```

`submission_id` is unique: one submission owns one durable provider-creation
job. The canonical ticket, submission, and outbox row are inserted in the same
database transaction.
Workers claim the outbox row; delivery status mirrored on the submission is the
operator-facing projection and is never treated as a second source of truth.

#### `public_ticket_attachments` (post-pilot)

```text
id, ticket_id, submission_id, file_asset_id, original_name, media_type,
size_bytes, scan_status, provider_attachment_id, created_at
```

Files are stored outside the database in a non-public quarantine area and
scanned asynchronously. Their lifecycle is `PENDING_SCAN -> CLEAN | BLOCKED |
SCAN_RETRY`. Only `CLEAN` files are promoted to regular file asset storage and
sent to the provider. Blocked files are deleted or retained for a short security-review
period according to the approved retention policy; they are never downloadable
through the public API. The initial `202` response does not wait for scanning.

### Ticket provider port and Jira adapter

The application layer depends on a provider-neutral port:

```ts
interface ITicketingProvider {
  createTicket(command: CreateSupportTicketCommand): Promise<ProviderTicketReference>;
  findByReceiptCode(receiptCode: string): Promise<ProviderTicketReference | null>;
  addAttachment?(externalTicketId: string, attachment: SafeAttachment): Promise<void>;
}

interface ProviderTicketReference {
  provider: string;
  externalTicketId: string;
  externalTicketKey?: string;
}
```

`JiraTicketingProvider` implements this port using Jira's supported REST API and
credentials from the deployment
secret store. Secrets are never stored in `public_support_forms`, logged, sent
to the browser, or included in audit payloads. Connection details are referenced
by a server-side connection alias. Core services and tables never use Jira DTOs
or Jira-specific column names. V1 supports one Jira deployment and one
least-privilege integration identity, exposed internally as the `default`
alias. Forms may select only allowlisted projects and issue types on that
deployment. The alias keeps the boundary extensible without introducing
multi-Jira configuration into the pilot.

Before retrying a request after an ambiguous provider response, the worker searches
for the unique receipt code in the configured Jira field or label. This closes
the failure window where the provider creates a ticket but GCDR does not receive
the response. A future provider implements the same port and reconciliation.

### Delivery states and retries

Ticket lifecycle and provider delivery are separate state machines:

```text
TicketStatus:
NEW -> TRIAGED -> IN_PROGRESS -> WAITING_REQUESTER -> RESOLVED -> CLOSED
  \-> CANCELLED

DeliveryStatus:
ACCEPTED -> DELIVERING -> DELIVERED
                    \-> RETRY_PENDING -> DELIVERING
                    \-> DEAD_LETTER
```

In the text-only pilot, the canonical ticket starts as `NEW`; Jira owns its
later workflow and no lifecycle synchronization is promised. Consequently,
operator UI may display `NEW` but must not imply that canonical status tracks
Jira until a later synchronization contract exists. Delivery state is fully
operational in the pilot.

- transient failures (`429`, timeout, Jira `5xx`) use exponential backoff with
  jitter and honor `Retry-After`;
- permanent mapping or validation failures go to `DEAD_LETTER` after recording
  a sanitized error code;
- operators can inspect and replay dead-letter submissions through an
  authenticated admin surface;
- replay preserves the same receipt code and idempotency guard.
- workers claim eligible records with `FOR UPDATE SKIP LOCKED`, set a bounded
  delivery lease, commit, and then call Jira outside the database transaction;
- an expired lease makes an abandoned `DELIVERING` record eligible for recovery.

### Security and abuse prevention

This endpoint is deliberately public and must not be protected only by a secret
URL. The following controls are required before production:

- Cloudflare Turnstile through the existing `verifyTurnstileToken()`, validated
  server-side;
- startup must fail when public ticket submission is enabled outside local/test
  and `TURNSTILE_SECRET_KEY` is missing; the existing development fail-open
  behavior is not permitted for this endpoint in production;
- a PostgreSQL-backed shared rate limiter per IP, form, HMAC of the normalized
  email, and globally, with proxy IP trust configured explicitly; the existing
  in-memory limiter may remain as a cheap first layer but is not authoritative;
- global and per-form submission circuit breakers;
- strict body, field, attachment count, and file-size limits;
- file signature inspection, filename sanitization, media-type allowlist, and a
  malware-scan gate before Jira upload;
- no user-supplied HTML/provider markup, provider project/type, or arbitrary fields;
- generic public errors to prevent tenant, customer, device, user, and ticket
  enumeration;
- encrypted transport and encrypted secret storage;
- no Jira access token, CAPTCHA secret, requester description, or attachment
  content in application logs;
- Content Security Policy and a restricted CORS allowlist for the official page;
- a honeypot field and minimum form-completion time as secondary bot signals;
- retention and deletion policies for personal data and rejected attachments.

CAPTCHA is not the only control: compromised tokens or human-assisted spam must
still be contained by quotas, rate limits, and circuit breakers.

### Privacy and data retention

The page must identify MYIO as the data controller or provide the appropriate
tenant-specific notice, explain why the data is collected, link to the privacy
policy, and capture the notice version with the consent timestamp.

Only data required to process the request is collected. Submission data follows
a documented retention schedule. Raw IP addresses and anti-abuse evidence have
a shorter retention period than support records unless a security incident
requires preservation. Deletion must account for both GCDR and the resulting
provider ticket according to the applicable support and legal retention policies.

The production database and backups must use platform-managed encryption at
rest. V1 does not introduce application-level column encryption unless the
privacy/security review requires it; this decision must be recorded before the
pilot. Rate-limit email keys use keyed HMAC rather than storing another copy of
the email. Free text, contact data, CAPTCHA tokens, and raw IPs must not appear
in application or audit logs.

### Audit and observability

Audit events include:

- public form created, updated, enabled, disabled, rotated, or deleted;
- submission accepted, delivery attempted, delivered, failed, or replayed;
- attachment accepted, rejected, scan-approved, or scan-blocked;
- provider configuration or mapping changed.

Public acceptance events use a system actor and contain the receipt code, form
ID, tenant/customer scope, outcome, and correlation ID. They must not copy the
full description, credentials, CAPTCHA token, or file content into the audit
log.

Metrics include request rate, CAPTCHA failure rate, validation failures, accepted
submissions, duplicate submissions, provider delivery latency, retry count,
dead-letter count, attachment rejection count, and rate-limit activations.
Alerts are required for sustained delivery failures, dead-letter growth, sudden
traffic spikes, or a form circuit breaker opening.

## Rollout plan

1. **Phase 0 — Decision gate.** Pin the Jira deployment/authentication and
   mapping, PII controls/retention, replica topology, initial support project,
   and provider ownership of post-creation lifecycle before migrations.
2. **Phase 1 — Canonical contracts.** Approve `support_projects`,
   `support_tickets`, canonical enums, public/internal DTOs, response envelopes,
   `ITicketingProvider`, and OpenAPI shapes before provider code.
3. **Phase 2 — Shared safety prerequisites.** Reuse Turnstile with a production
   startup guard; implement the PostgreSQL-backed limiter and load-test its
   per-IP, per-form, per-email-HMAC, and global dimensions.
4. **Phase 3 — Persistence and administration.** Create support-project,
   canonical-ticket, form, submission, and outbox models; implement authenticated
   administration. Do not add attachments yet.
5. **Phase 4 — Jira adapter and delivery.** Implement the allowlisted adapter, Jira sandbox
   contract tests, concurrent worker, retry/reconciliation, and dead letters.
6. **Phase 5 — Text-only public pilot.** Release the page, validation, Turnstile,
   shared rate limits, idempotency, receipt, audit events, operator replay,
   metrics, alerts, and circuit breakers for one form/support project.
7. **Phase 6 — Attachments.** Add quarantine storage, asynchronous malware scan,
   lifecycle/retention jobs, and Jira upload after the text-only pilot is stable.
8. **Phase 7 — Broader rollout.** Enable more customers only after reviewing
   abuse rates, Jira mapping correctness, privacy behavior, and support-team
   workflow metrics from the pilot, running capacity/DoS tests, and revisiting
   whether public submissions must also create GCDR `CHAMADO` records.

Rollback disables the affected public form. Already accepted submissions remain
available to the worker or operators and are not discarded.

## Testing strategy

- unit tests for Zod schemas, normalization, mappings, receipt generation, and
  retry classification;
- integration tests for persistence plus outbox atomicity and idempotent replay;
- contract tests against a Jira sandbox for issue creation and, post-pilot,
  attachments;
- security tests for enumeration, rate-limit bypass, forged proxy headers,
  malicious files, stored injection, and oversized multipart bodies;
- accessibility tests targeting WCAG 2.1 AA behavior;
- failure tests for Jira timeout-after-create, `429`, invalid mappings, worker
  restarts, and duplicate HTTP submissions;
- tenant-isolation tests for every form lookup and administrative operation.
- multi-replica load/soak tests for the PostgreSQL limiter, `SKIP LOCKED` worker,
  leases, circuit breakers, and current production capacity.

## Drawbacks

- A public write endpoint increases the system's spam, denial-of-service, and
  malicious-file exposure.
- GCDR becomes responsible for buffering and operating Jira delivery instead of
  acting only as a synchronous proxy.
- Requester PII is duplicated between GCDR and Jira and requires coordinated
  retention and deletion policies.
- Jira custom fields and workflows vary by project, so configuration validation
  and sandbox contract tests are required.

## Rationale and alternatives

### Direct Jira form or Jira Service Management portal

This is the simplest option if Jira can provide the required anonymous UX,
branding, routing, privacy, and licensing. It does not provide GCDR-controlled
tenant/customer resolution, audit semantics, or a stable integration boundary.
It should be preferred if those GCDR capabilities are not actually required.

### Browser calls Jira directly

Rejected. It exposes Jira integration details, complicates authentication and
CORS, weakens validation and quotas, and risks leaking credentials or internal
metadata.

### Synchronous Jira creation only

Rejected. A Jira outage would turn into a public-form outage and encourage
duplicate submissions. Persistence plus an outbox provides a durable acceptance
boundary and operational recovery.

### Reuse the generic Public Single Apps response model unchanged

RFC-0020 provides useful public page and form concepts, but Jira delivery needs
explicit idempotency, outbox state, attachment scanning, Jira reconciliation,
and dead-letter operations. The implementation may reuse its rendering or form
infrastructure while keeping a ticket-specific domain service and records.

### Create a GCDR CHAMADO first and synchronize it to Jira

The RFC-0044 workflow is already implemented and in use. Creating a CHAMADO
would provide a stronger GCDR source of truth, but it also introduces
bidirectional ownership, status, comment, attachment, and conflict
synchronization. V1 deliberately uses a submission ledger plus one-way Jira
creation, with Jira as lifecycle source of truth. This decision must be revisited
before a second tenant is enabled or earlier if operations requires unified
ticket reporting or links between public tickets and work orders.

## Prior art

- RFC-0020 for public single-application configuration and response collection;
- RFC-0030 and `wiki-public.controller.ts` for an existing anonymous submission,
  Turnstile, honeypot, generic bot response, and request-level rate limit;
- RFC-0044 for the GCDR `CHAMADO` model;
- RFC-0045 for durable ingestion, idempotency, attachments, and support-channel
  security considerations;
- RFC-0009 for auditable operational events.

## Unresolved questions

1. Is the destination Jira Cloud, Jira Data Center, or Jira Service Management,
   and which supported authentication method will the deployment use?
2. Which Jira project, issue type, required custom fields, categories, and
   priority mappings apply to the pilot?
3. Which email provider, quarantine/object storage, and malware-scanning service
   are approved for the post-pilot phases?
4. What are the final retention periods and privacy notice for requester PII,
   IP-derived anti-abuse data, and attachments?
5. Is a confirmation email required for the pilot, and must it include a secure
   status link?
6. Does the security/privacy review accept platform encryption at rest for the
   requester columns, or require application-level column encryption?

## Future possibilities

- signed requester links for viewing a limited status and adding information;
- duplicate suggestions based on non-sensitive incident fingerprints;
- tenant-specific branding and additional locales;
- automatic device/customer enrichment after safe identifier resolution;
- two-way synchronization with GCDR `CHAMADO` records;
- configurable webhooks or notifications after Jira ticket creation;
- service-level routing and business-hours messaging per tenant.
