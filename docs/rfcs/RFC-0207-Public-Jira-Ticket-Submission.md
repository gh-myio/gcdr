# RFC-0207: Public Jira Ticket Submission Page

- **Status:** Draft
- **Date:** 2026-09-16
- **Domain:** Support / Public Applications / Integrations
- **Authors:** MYIO Engineering
- **Depends on:** [RFC-0009 — Events and Audit Logs](./RFC-0009-Events-Audit-Logs.md), [RFC-0020 — Public Single Apps](./RFC-0020-Public-Single-Apps.md)
- **Related:** [RFC-0044 — Chamados Work Order Type](./RFC-0044-Chamados-Work-Order-Type.md), [RFC-0045 — Email-to-Ticket Ingestion](./RFC-0045-Email-to-Ticket-Ingestion.md)

## Summary

Create a public, mobile-friendly support page backed by GCDR that allows a user
to submit a support request without authenticating. GCDR validates and protects
the submission, creates the corresponding issue in Jira through a server-side
integration, records an audit trail, and returns a safe public receipt.

The browser never communicates with Jira directly and never receives Jira
credentials, internal project metadata, issue IDs, URLs, comments, or status
unless those values are explicitly approved for public disclosure.

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

1. The requester opens `/support`, optionally from a tenant- or customer-specific
   link containing an opaque public form identifier.
2. The page displays the support form, privacy notice, and attachment limits.
3. The requester provides contact and incident information and completes the
   anti-abuse challenge.
4. GCDR validates the payload, resolves the configured Jira destination, and
   creates one Jira issue.
5. The page displays a public receipt code. It does not expose the Jira issue
   key by default.
6. If Jira is temporarily unavailable, GCDR retains the accepted request for
   asynchronous retry and shows the same receipt instead of asking the user to
   submit again.

### Form fields

The first version contains:

| Field | Required | Rules |
|---|---:|---|
| `name` | yes | 2–120 characters |
| `email` | yes | valid email, maximum 254 characters |
| `phone` | no | normalized string, maximum 30 characters |
| `subject` | yes | 5–160 characters |
| `description` | yes | 20–10,000 characters |
| `category` | yes | value from a server-provided allowlist |
| `priority` | no | public values only; mapped server-side to Jira priorities |
| `customerCode` | conditional | selected or derived from the public form configuration |
| `location` | no | maximum 250 characters |
| `deviceIdentifier` | no | serial, external ID, or device label; maximum 120 characters |
| `attachments` | no | up to 5 files, 10 MiB each, 25 MiB total |
| `privacyConsent` | yes | must be `true` |

The UI must be accessible, responsive, keyboard navigable, and usable in
English and Brazilian Portuguese. The source strings are internationalized;
the initial locale may be selected from the browser and changed by the user.

### Success and failure experience

On acceptance, the requester sees a receipt such as `SUP-7K4M2Q8P` and receives
an email confirmation when email delivery is configured. The receipt proves
that GCDR accepted the request; it is not a Jira key and cannot be used to query
private ticket data.

Validation failures are shown next to the relevant fields. Rate-limit or
anti-abuse failures use a generic response. A Jira outage must not lead users to
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
    |-- attachment validation and malware-scan gate
    v
PublicTicketSubmissionService
    |-- persist submission and outbox event in one transaction
    |-- return opaque receipt code
    v
Jira delivery worker
    |-- server-side Jira credentials
    |-- retry with backoff and idempotency guard
    v
Jira REST API
```

The write path uses a transactional outbox. The HTTP request is successful when
the submission and its outbox job are durably stored, not only when Jira is
available. A worker creates the Jira issue and updates the delivery record.

### Public form configuration

Public links use an opaque `formId`, not a tenant UUID, customer UUID, Jira
project key, or issue type:

```text
https://<public-gcdr-host>/support?form=pf_7GmKq2x9...
```

The form configuration is administered through authenticated GCDR APIs and
contains:

- tenant and optional customer scope;
- enabled/disabled state and optional expiration;
- allowed categories and public priority values;
- Jira connection, project, issue type, and field mappings;
- branding, locale defaults, and privacy notice;
- attachment policy and notification settings.

A form identifier may be rotated or revoked without changing Jira credentials.
Unknown, disabled, or expired identifiers return the same public not-found
response. A deployment may also define one default form for `/support`.

### API contract

#### `GET /api/v1/public/support-forms/:formId`

Returns only public presentation data:

```json
{
  "name": "MYIO Support",
  "defaultLocale": "pt-BR",
  "supportedLocales": ["pt-BR", "en"],
  "categories": [
    { "value": "DEVICE", "label": "Device" },
    { "value": "CONNECTIVITY", "label": "Connectivity" },
    { "value": "OTHER", "label": "Other" }
  ],
  "priorities": ["LOW", "NORMAL", "HIGH"],
  "attachments": {
    "maxFiles": 5,
    "maxFileBytes": 10485760,
    "maxTotalBytes": 26214400
  },
  "privacyNoticeUrl": "https://example.com/privacy"
}
```

It never returns tenant IDs, customer IDs, Jira project keys, field mappings,
credentials, internal email addresses, or private configuration.

#### `POST /api/v1/public/support-tickets`

Authentication: none. Protection: CAPTCHA, rate limiting, origin policy,
payload limits, and server-side validation.

```json
{
  "formId": "pf_7GmKq2x9...",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+55 11 99999-9999",
  "subject": "Gateway is offline",
  "description": "The gateway has been unreachable since 09:30.",
  "category": "CONNECTIVITY",
  "priority": "HIGH",
  "location": "Store 42",
  "deviceIdentifier": "GW-00192",
  "privacyConsent": true,
  "captchaToken": "provider-token",
  "idempotencyKey": "8e58cd45-6de5-4a9f-a063-a192e2472921"
}
```

Attachments use `multipart/form-data`; the structured fields are sent in a
`payload` JSON part and files in repeated `attachments` parts.

Accepted response (`202 Accepted`):

```json
{
  "receiptCode": "SUP-7K4M2Q8P",
  "status": "ACCEPTED",
  "message": "Your support request was received."
}
```

The same `formId + idempotencyKey` returns the original receipt and never
creates another Jira issue. The API does not reveal whether an email address,
customer, device, or Jira issue exists.

### Validation and Jira mapping

All inputs are validated with Zod in the handler and normalized before storage.
Rich HTML is not accepted in v1. Jira descriptions are produced by GCDR from
plain text and escaped structured fields.

| Public value | Jira value |
|---|---|
| `subject` | `summary` with a configured prefix |
| `description` | `description` in Jira document format |
| `category` | configured component, label, or custom field |
| `priority` | configured Jira priority mapping |
| requester identity | configured custom fields; never used to impersonate a Jira user |
| customer/location/device | configured labels or custom fields |
| receipt code | dedicated custom field or label for reconciliation |
| attachments | uploaded only after the issue is created and scan policy passes |

Only allowlisted Jira fields and values may be set. Public input cannot select a
Jira project, issue type, assignee, reporter, watcher, status, sprint, or raw
label. Jira issue creation uses a dedicated integration identity with access
only to the configured support projects.

### Data model

#### `public_support_forms`

```text
id, tenant_id, customer_id, public_id, name, status, default_locale,
supported_locales, category_config, priority_config, jira_connection_id,
jira_project_key, jira_issue_type_id, jira_field_mapping, branding_config,
attachment_policy, privacy_notice_url, expires_at, created_at, updated_at
```

`public_id` is unique, random, opaque, and safe to rotate. Sensitive Jira
configuration is not stored in the JSON exposed by the public API.

#### `public_ticket_submissions`

```text
id, tenant_id, customer_id, form_id, receipt_code, idempotency_key,
requester_name, requester_email, requester_phone, subject, description,
category, priority, location, device_identifier, privacy_consent_at,
delivery_status, jira_issue_id, jira_issue_key, attempt_count, last_error_code,
created_at, delivered_at, updated_at
```

Unique constraints:

- `(form_id, idempotency_key)` prevents client retries from duplicating issues;
- `receipt_code` is globally unique;
- `jira_issue_id` is unique when present.

`jira_issue_key` and delivery errors are internal and never returned by the
public submission endpoint.

#### `public_ticket_attachments`

```text
id, submission_id, file_asset_id, original_name, media_type, size_bytes,
scan_status, jira_attachment_id, created_at
```

Files are stored outside the database through the existing file asset storage.
They are not sent to Jira until their validation and malware-scan policy allows
delivery.

### Jira adapter

Jira integration is isolated behind an interface:

```ts
interface IJiraTicketGateway {
  createIssue(input: CreateJiraIssueInput): Promise<JiraIssueReference>;
  addAttachment(issueId: string, attachment: SafeAttachment): Promise<void>;
}
```

The adapter uses Jira's supported REST API and credentials from the deployment
secret store. Secrets are never stored in `public_support_forms`, logged, sent
to the browser, or included in audit payloads. Connection details are referenced
by `jira_connection_id` and resolved server-side.

Before retrying a request after an ambiguous Jira response, the worker searches
for the unique receipt code in the configured Jira field or label. This closes
the failure window where Jira creates an issue but GCDR does not receive the
response.

### Delivery states and retries

```text
ACCEPTED -> DELIVERING -> DELIVERED
                    \-> RETRY_PENDING -> DELIVERING
                    \-> DEAD_LETTER
```

- transient failures (`429`, timeout, Jira `5xx`) use exponential backoff with
  jitter and honor `Retry-After`;
- permanent mapping or validation failures go to `DEAD_LETTER` after recording
  a sanitized error code;
- operators can inspect and replay dead-letter submissions through an
  authenticated admin surface;
- replay preserves the same receipt code and idempotency guard.

### Security and abuse prevention

This endpoint is deliberately public and must not be protected only by a secret
URL. The following controls are required before production:

- CAPTCHA or equivalent proof-of-human verification, validated server-side;
- rate limits per IP, form, and normalized email, with proxy IP trust configured
  explicitly;
- global and per-form submission circuit breakers;
- strict body, field, attachment count, and file-size limits;
- file signature inspection, filename sanitization, media-type allowlist, and a
  malware-scan gate before Jira upload;
- no user-supplied HTML, Jira markup, project, issue type, or arbitrary fields;
- generic public errors to prevent tenant, customer, device, user, and ticket
  enumeration;
- encrypted transport and encrypted secret storage;
- no Jira access token, CAPTCHA secret, requester description, or attachment
  content in application logs;
- Content Security Policy, CSRF-resistant request design, and a restricted CORS
  allowlist for the official page;
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
Jira issue according to the applicable support and legal retention policies.

### Audit and observability

Audit events include:

- public form created, updated, enabled, disabled, rotated, or deleted;
- submission accepted, delivery attempted, delivered, failed, or replayed;
- attachment accepted, rejected, scan-approved, or scan-blocked;
- Jira configuration or mapping changed.

Public acceptance events use a system actor and contain the receipt code, form
ID, tenant/customer scope, outcome, and correlation ID. They must not copy the
full description, credentials, CAPTCHA token, or file content into the audit
log.

Metrics include request rate, CAPTCHA failure rate, validation failures, accepted
submissions, duplicate submissions, Jira delivery latency, retry count,
dead-letter count, attachment rejection count, and rate-limit activations.
Alerts are required for sustained delivery failures, dead-letter growth, sudden
traffic spikes, or a form circuit breaker opening.

## Rollout plan

1. **Phase 1 — Configuration and persistence.** Create the form, submission,
   attachment, and outbox models; implement authenticated form administration.
2. **Phase 2 — Public form without attachments.** Release the page, validation,
   CAPTCHA, rate limiting, idempotency, Jira worker, receipt, and audit events to
   one pilot form and Jira project.
3. **Phase 3 — Attachments.** Add file storage, content validation, malware-scan
   gate, Jira upload, and retention jobs.
4. **Phase 4 — Operations.** Add the dead-letter/replay console, confirmation
   email, dashboards, alerts, and per-form circuit breakers.
5. **Phase 5 — Broader rollout.** Enable more customers only after reviewing
   abuse rates, Jira mapping correctness, privacy behavior, and support-team
   workflow metrics from the pilot.

Rollback disables the affected public form. Already accepted submissions remain
available to the worker or operators and are not discarded.

## Testing strategy

- unit tests for Zod schemas, normalization, mappings, receipt generation, and
  retry classification;
- integration tests for persistence plus outbox atomicity and idempotent replay;
- contract tests against a Jira sandbox for issue creation and attachments;
- security tests for enumeration, rate-limit bypass, forged proxy headers,
  malicious files, stored injection, and oversized multipart bodies;
- accessibility tests targeting WCAG 2.1 AA behavior;
- failure tests for Jira timeout-after-create, `429`, invalid mappings, worker
  restarts, and duplicate HTTP submissions;
- tenant-isolation tests for every form lookup and administrative operation.

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

This provides a stronger GCDR source of truth and may become desirable if MYIO
adopts the RFC-0044 workflow. It also introduces bidirectional ownership,
status, comment, and attachment synchronization. For v1, this RFC proposes a
submission ledger plus one-way Jira creation; dual-system ticket lifecycle sync
is out of scope.

## Prior art

- RFC-0020 for public single-application configuration and response collection;
- RFC-0044 for the GCDR `CHAMADO` model;
- RFC-0045 for durable ingestion, idempotency, attachments, and support-channel
  security considerations;
- RFC-0009 for auditable operational events.

## Unresolved questions

1. Is the destination Jira Cloud, Jira Data Center, or Jira Service Management,
   and which supported authentication method will the deployment use?
2. Which Jira project, issue type, required custom fields, categories, and
   priority mappings apply to the pilot?
3. Should `/support` use one default form, require an opaque form identifier, or
   support both behaviors?
4. May the public receipt expose the Jira issue key after creation, or must the
   Jira identity always remain internal? This RFC defaults to internal.
5. Which CAPTCHA provider, email provider, object storage, and malware-scanning
   service are approved for production?
6. What are the final retention periods and privacy notice for requester PII,
   IP-derived anti-abuse data, and attachments?
7. Is a confirmation email required for the pilot, and must it include a secure
   status link?
8. Should a later phase create a GCDR `CHAMADO` and synchronize it with Jira, or
   will Jira remain the lifecycle source of truth?

## Future possibilities

- signed requester links for viewing a limited status and adding information;
- duplicate suggestions based on non-sensitive incident fingerprints;
- tenant-specific branding and additional locales;
- automatic device/customer enrichment after safe identifier resolution;
- two-way synchronization with GCDR `CHAMADO` records;
- configurable webhooks or notifications after Jira ticket creation;
- service-level routing and business-hours messaging per tenant.
