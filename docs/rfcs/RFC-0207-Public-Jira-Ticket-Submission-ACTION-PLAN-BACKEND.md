# RFC-0207 Backend Action Plan: Provider-neutral Ticket Intake (Jira First)

- **Status:** Proposed implementation plan
- **Date:** 2026-09-17
- **Target RFC:** [RFC-0207](./RFC-0207-Public-Jira-Ticket-Submission.md)
- **Scope:** GCDR backend; text-only pilot first

## Outcome

Deliver a production-safe anonymous intake API that durably accepts a support
request, returns an opaque receipt, and creates exactly one ticket through a
provider-neutral port. Jira is the first adapter, not part of the core domain
contract. The pilot excludes attachment upload, confirmation email, public
ticket lookup, CHAMADO creation, and bidirectional status synchronization.

The frontend may keep one expiring draft in browser `localStorage`. That draft
is a client-only convenience: this plan adds no anonymous draft API, server-side
draft persistence, cross-device recovery, or attachment restoration. Only an
explicit final submission enters the backend trust boundary.

## Non-negotiable acceptance properties

- no Jira credential or internal Jira metadata reaches the browser;
- an accepted request survives Jira downtime and process restarts;
- HTTP retries and ambiguous Jira responses do not create duplicate issues;
- all public form resolution and administration is tenant-safe;
- Cloudflare Turnstile is mandatory whenever the feature is enabled outside
  local/test;
- rate limits are shared across API replicas through PostgreSQL;
- worker claims are safe across replicas and recover from a crashed worker;
- logs and audit events contain no request body, CAPTCHA token, raw contact data,
  or attachment content;
- the Jira issue key remains internal in v1.
- core services, database envelopes, and public API contracts do not expose
  Jira-specific types or field names;
- replacing Jira with another ticket provider requires a new adapter and field
  mapping, not a rewrite of public intake or the submission domain.

## Phase 0 — Decision gate

No migration or public endpoint should merge until these decisions are recorded.

### Product and Jira decisions

- [ ] Confirm Jira Cloud, Jira Data Center, or Jira Service Management.
- [ ] Confirm the supported authentication mechanism and secret owner.
- [ ] Select the pilot project and issue type.
- [ ] Inventory every required Jira field and allowed value.
- [ ] Define category and public-priority mappings.
- [ ] Define provider mappings for every enabled canonical request type. A form
  may expose incident, service request, feature request, backlog idea, access
  request, question, and other without exposing Jira issue-type identifiers.
- [ ] Reserve a searchable custom field or deterministic label for
  `receiptCode` reconciliation.
- [ ] Confirm that Jira is the lifecycle source of truth for the pilot.
- [ ] Confirm that Jira keys and URLs are never returned publicly.
- [ ] Confirm one Jira deployment and one `default` connection alias for v1.
- [ ] Confirm the RFC-0207 `support_projects` model and seed the initial support
  project within the pilot customer. It is neither an Inventory project nor a
  Jira project; provider mapping is separate.

### Privacy and operations decisions

- [ ] Approve the privacy notice text and versioning strategy.
- [ ] Define retention for accepted submissions and anti-abuse evidence.
- [ ] Confirm whether platform/database encryption at rest is sufficient or
  application-level column encryption is required.
- [ ] Confirm current and expected API replica count.
- [ ] Define initial quotas and circuit-breaker thresholds.
- [ ] Name the team responsible for dead-letter review and replay.
- [ ] Record the CHAMADO revisit trigger: before enabling a second tenant, or
  earlier when unified reporting/work-order linking is required.

### Exit criteria

- Jira sandbox credentials work from a non-production environment.
- A checked-in mapping fixture can create a sample issue manually.
- Privacy, retention, replica, and ownership decisions are documented.

## Phase 1 — Provider-neutral contracts, envelopes, and endpoints

This phase is contract-first. It defines the ticket language owned by GCDR
before database tables, Jira payloads, or controllers are implemented. Jira
names must appear only in `src/integrations/jira/` and provider mapping/config.

### Canonical ticket model

```ts
type TicketPriority =
  | 'VERY_LOW'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'VERY_HIGH'
  | 'URGENT';

type TicketCriticality = 'BLOCKING' | 'NON_BLOCKING';

type TicketRequestType =
  | 'INCIDENT'
  | 'SERVICE_REQUEST'
  | 'FEATURE_REQUEST'
  | 'BACKLOG_IDEA'
  | 'ACCESS_REQUEST'
  | 'QUESTION'
  | 'OTHER';

type TicketStatus =
  | 'NEW'
  | 'TRIAGED'
  | 'IN_PROGRESS'
  | 'WAITING_REQUESTER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED';

interface TicketReporter {
  name: string;
  email: string;
  phone?: string;
  userId?: string;
}

interface TicketAssignee {
  userId?: string;
  teamId?: string;
  displayName?: string;
}

interface CreateSupportTicketCommand {
  tenantId: string;
  customerId: string;
  projectId: string;
  requestType: TicketRequestType;
  title: string;
  description: string;
  reporter: TicketReporter;
  priority: TicketPriority;
  criticality: TicketCriticality;
  category: string;
  requestedResolutionAt?: string;
  location?: string;
  deviceIdentifier?: string;
  source: 'PUBLIC_FORM';
  attachmentRefs: string[]; // contract limit: 0..5; pilot requires 0
  idempotencyKey: string;
  receiptCode: string;
}

interface SupportTicket {
  id: string;
  tenantId: string;
  customerId: string;
  projectId: string;
  title: string;
  description: string;
  status: TicketStatus;
  reporter: TicketReporter;
  assignee?: TicketAssignee;
  priority: TicketPriority;
  criticality: TicketCriticality;
  category: string;
  requestedResolutionAt?: string;
  resolutionDueAt?: string;
  resolvedAt?: string;
  source: 'PUBLIC_FORM';
  createdAt: string;
  updatedAt: string;
}
```

Field ownership is explicit:

| Field | Public requester | GCDR/configuration | Provider/operator |
|---|---:|---:|---:|
| `title`, `description` | supplies | validates | receives |
| `reporter` | supplies contact | normalizes/snapshots | receives mapped fields |
| `priority` | requests allowlisted value | may normalize by policy | receives mapping |
| `criticality` | selects blocking/non-blocking | validates | receives mapping |
| `customerId`, `projectId` | never sends raw IDs | resolves from opaque form | receives mapping |
| `status` | cannot set | initializes `NEW` | owns later workflow in v1 |
| `assignee` | cannot set | optional routing policy | operator/provider owns |
| `requestedResolutionAt` | may request | validates | informational |
| `resolutionDueAt` | cannot set | calculates from SLA/policy | receives mapping |
| attachments | up to 5 by contract | scans/approves | receives only clean files |

`requestedResolutionAt` and `resolutionDueAt` are intentionally different. A
requester's desired date cannot overwrite the contractual SLA deadline.

### Additional metadata

The canonical model also needs operational metadata even when it is not a
public input:

- category/type for routing and reporting;
- immutable source/channel (`PUBLIC_FORM` initially);
- optional affected location and device identifier;
- provider name plus external ticket ID/key in the integration projection;
- created, updated, resolved, and closed timestamps;
- privacy notice version and consent timestamp on the submission envelope;
- correlation ID, receipt code, and idempotency key;
- optional internal tags/watchers only when introduced by trusted configuration,
  never as arbitrary public values.

### Provider port

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

The application layer depends on `ITicketingProvider`. The Jira adapter maps
canonical priority, criticality, category, reporter, project, and due date into
Jira fields. A future Freshdesk, Zendesk, ServiceNow, or other adapter implements
the same port without changing the public controller.

### API envelopes

All responses use the existing GCDR response conventions and include request
metadata without leaking provider details.

```ts
interface CreatePublicSupportTicketRequest {
  formId: string;
  requestType: TicketRequestType;   // must be enabled by the resolved form
  title: string;                    // 5..160 characters
  description: string;              // 20..10,000 characters, plain text
  reporter: {
    name: string;                   // 2..120 characters
    email: string;                  // normalized, max 254
    phone?: string;                 // normalized, max 30
  };
  priority: TicketPriority;
  criticality: TicketCriticality;
  category: string;                 // form allowlist
  requestedResolutionAt?: string;   // ISO-8601; request, not SLA promise
  location?: string;
  deviceIdentifier?: string;
  privacyConsent: true;
  captchaToken: string;
  idempotencyKey: string;           // UUID generated by the official client
  website?: string;                 // honeypot; must be empty for humans
}

interface PublicSupportRequestTypeOption {
  value: TicketRequestType;
  title: string;
  description: string;
  categoryAllowlist?: string[];
  defaultPriority?: TicketPriority;
  enabledFields?: Array<
    | 'requestedResolutionAt'
    | 'location'
    | 'deviceIdentifier'
    | 'attachments'
  >;
}

interface PublicSupportFormView {
  name: string;
  description?: string;
  customerName: string;
  projectName: string;
  defaultLocale: 'pt-BR' | 'en';
  supportedLocales: Array<'pt-BR' | 'en'>;
  requestTypes: PublicSupportRequestTypeOption[];
  categories: Array<{ value: string; label: string }>;
  priorities: TicketPriority[];
  criticalities: TicketCriticality[];
  requestedResolutionEnabled: boolean;
  attachments: { enabled: boolean; maxFiles: 5 };
  privacyNoticeUrl: string;
  privacyNoticeVersion: string;
}

interface PublicFormEnvelope {
  success: true;
  data: PublicSupportFormView;
  meta: { requestId: string; timestamp: string };
}

interface TicketAcceptedEnvelope {
  success: true;
  data: {
    receiptCode: string;
    status: 'ACCEPTED';
  };
  meta: { requestId: string; timestamp: string };
}

interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; fields?: Record<string, string> };
  meta: { requestId: string; timestamp: string };
}
```

Contract endpoints:

```http
GET  /api/v1/public/support-forms/:formId
POST /api/v1/public/support-tickets

POST  /api/v1/public-support-forms
GET   /api/v1/public-support-forms
GET   /api/v1/public-support-forms/:id
PATCH /api/v1/public-support-forms/:id
POST  /api/v1/public-support-forms/:id/rotate

GET  /api/v1/support-ticket-submissions
GET  /api/v1/support-ticket-submissions/:id
POST /api/v1/support-ticket-submissions/:id/retry
```

### Contract rules

- [ ] Define Zod schemas and inferred TypeScript types from one source wherever
  practical; do not maintain structurally duplicate hand-written DTO types.
- [ ] Keep public submission DTOs separate from internal commands and provider
  payloads.
- [ ] Resolve `customerId` and `projectId` exclusively from the opaque form;
  reject raw public IDs and prevent customer/project enumeration.
- [ ] Validate that the project belongs to the resolved customer.
- [ ] Validate that `requestType` is enabled by the resolved form and that the
  selected category is allowed globally and, when configured, for that request
  type. Public labels and descriptions are presentation data; the canonical
  enum value is the persisted and provider-mapped value.
- [ ] Public callers may not set status, assignee, provider, external IDs,
  contractual SLA deadline, arbitrary tags, watchers, or custom fields.
- [ ] Treat reporter as an immutable opening snapshot; later account/profile
  changes must not rewrite the historical ticket reporter.
- [ ] Validate `requestedResolutionAt` against an approved maximum horizon and
  tenant timezone; absence means no requester-supplied desired date.
- [ ] Define canonical title/description length, Unicode normalization, and
  plain-text sanitization once, before provider mapping.
- [ ] Normalize the six public priorities into the canonical enum before provider
  mapping.
- [ ] Keep request-type semantics provider-neutral. Jira issue types, labels,
  components, and custom fields are selected only by trusted provider mapping;
  the browser cannot submit them directly.
- [ ] Limit `attachmentRefs` to five in the canonical contract while requiring an
  empty list during the text-only pilot.
- [ ] Do not accept the frontend mock's `{ name, size, type }` attachment metadata
  as proof of upload. Until Phase 6, `attachments.enabled` is `false`, the JSON
  submission contains no attachment payload, and `attachmentRefs` remains empty.
- [ ] Version the public contract before making future breaking changes.
- [ ] Add OpenAPI request, success, validation, rate-limit, and generic-error
  examples without exposing provider internals.
- [ ] Contract-test every canonical request type, disabled request types,
  type/category allowlists, stable ordering of request-type cards, and rejection
  of provider-specific values supplied by public clients.

### Exit criteria

- Provider-neutral Zod schemas, DTOs, commands, enums, port interfaces, response
  envelopes, and OpenAPI shapes have review approval.
- A fake in-memory provider passes contract tests for create, duplicate lookup,
  error translation, and provider-reference handling.
- No core/public contract imports Jira types or contains `jiraIssueId`/
  `jiraIssueKey` fields.

## Phase 2 — Shared public-write safety

### Turnstile

- [ ] Reuse `src/shared/utils/captchaVerifier.ts`.
- [ ] Add a feature-aware startup validator: when
  `PUBLIC_JIRA_TICKETS_ENABLED=true` outside local/test,
  `TURNSTILE_SECRET_KEY` is required and startup fails if missing.
- [ ] Keep development fail-open behavior only when the Jira public feature is
  disabled or the runtime is explicitly local/test.
- [ ] Reuse the Wiki submission's generic-success honeypot behavior.
- [ ] Never log the Turnstile token or provider response body.

### PostgreSQL rate limiter

- [ ] Add a bounded fixed-window table keyed by limiter name, bucket hash, and
  window start.
- [ ] Enforce dimensions for IP, `formId`, HMAC-normalized email, and global
  endpoint traffic.
- [ ] Use a dedicated HMAC secret; never persist the normalized email in the
  limiter table.
- [ ] Implement atomic increment-and-check behavior safe under concurrency.
- [ ] Add expiration cleanup and an index supporting it.
- [ ] Keep the existing in-memory limiter only as an optional first layer.
- [ ] Verify `app.set('trust proxy', ...)` matches the actual proxy topology.
- [ ] Add metrics for allowed, blocked, and limiter-store failures.
- [ ] Fail closed or activate the global circuit breaker when the authoritative
  limiter cannot make a safe decision.

### Tests and exit criteria

- [ ] Unit-test key normalization and HMAC stability.
- [ ] Integration-test concurrent increments at the limit boundary.
- [ ] Test multiple application instances against the same database.
- [ ] Test forged `X-Forwarded-For` values and high-cardinality rotated keys.
- [ ] Confirm limits remain correct across at least two concurrent processes.
- [ ] Confirm missing Turnstile configuration prevents feature startup.

## Phase 3 — Persistence and administration

### Database migrations

Migration work follows
[`docs/database/DB-MIGRATIONS.md`](../database/DB-MIGRATIONS.md). This repository
uses the custom `schema_migrations` runner through `npm run db:mig:*`; the
Drizzle journal is frozen at `0012` and must not be extended. The raw migration
chain does not reconstruct the current schema from zero, so verification must
use the documented baseline/custom-runner workflow and the known production
state rather than assuming `drizzle-kit migrate` is authoritative.

Create canonical `support_projects` first:

```text
id, tenant_id, customer_id, name, code, description, status,
created_at, updated_at
```

Require `UNIQUE(tenant_id, customer_id, code)` and validate customer ownership
inside the service/repository boundary.

Create `public_support_forms`:

```text
id, tenant_id, customer_id, project_id, public_id, name, status, default_locale,
supported_locales, request_type_config, category_config, priority_config,
criticality_config, requested_resolution_policy, attachment_policy, provider_name,
provider_connection_alias, provider_project_ref, provider_ticket_type_ref,
provider_field_mapping, branding_config,
privacy_notice_url, privacy_notice_version, expires_at, created_at, updated_at
```

Create canonical `support_tickets` independently of any delivery provider:

```text
id, tenant_id, customer_id, project_id, request_type, title, description, status,
reporter_name, reporter_email, reporter_phone, reporter_user_id,
assignee_user_id, assignee_team_id, assignee_display_name,
category, priority, criticality, requested_resolution_at, resolution_due_at,
resolved_at, closed_at, source, location, device_identifier,
provider_name, external_ticket_id, external_ticket_key,
created_at, updated_at
```

Create `public_ticket_submissions` as the public intake and consent ledger:

```text
id, tenant_id, customer_id, project_id, ticket_id, form_id, receipt_code,
idempotency_key, privacy_consent_at, privacy_notice_version,
delivery_status, last_error_code, created_at, delivered_at, updated_at
```

Create `public_ticket_delivery_outbox`:

```text
id, submission_id, ticket_id, provider_name, status, attempt_count,
next_attempt_at, lease_until,
last_error_code, created_at, completed_at, updated_at
```

Required constraints:

```text
UNIQUE(form_id, idempotency_key)
UNIQUE(receipt_code)
UNIQUE(support_tickets.provider_name, support_tickets.external_ticket_id)
  WHERE external_ticket_id IS NOT NULL
UNIQUE(public_support_forms.public_id)
UNIQUE(public_ticket_delivery_outbox.submission_id)
```

The acceptance transaction creates one canonical `support_tickets` row, one
`public_ticket_submissions` row, and one `public_ticket_delivery_outbox` row.
Provider delivery updates only the external-reference projection on the ticket
and the delivery lifecycle on submission/outbox. Jira-specific columns are not
allowed in these tables.

Required indexes cover tenant/form administration, eligible delivery records,
expired leases, and retention cleanup.

Migration checklist:

- [ ] Add the next hand-written, numbered SQL migration under
  `drizzle/migrations/` without modifying `meta/_journal.json`.
- [ ] Update `src/infrastructure/database/drizzle/schema.ts` in the same change.
- [ ] Keep TypeScript unions, Zod enums, defaults, and database `CHECK`
  constraints identical for form, canonical ticket, submission, and outbox
  statuses, priorities, and criticality values.
- [ ] Add a database `CHECK` for the canonical request-type enum and test every
  value. Keep configurable card titles/descriptions in form configuration, not
  in the ticket row.
- [ ] Use explicit, stable names for constraints and indexes.
- [ ] Inspect the target environment with `npm run db:mig:status` before applying.
- [ ] Apply through `npm run db:mig:up` and verify the resulting tables,
  constraints, indexes, and `schema_migrations` entry.
- [ ] Test idempotency and document rollback or intentional irreversibility.
- [ ] Do not treat a successful `db:push` or an empty-database replay as proof
  that the production migration is safe.

### Backend components

```text
src/controllers/publicSupportForm.controller.ts
src/controllers/publicTicket.controller.ts
src/controllers/publicTicketAdmin.controller.ts
src/services/PublicSupportFormService.ts
src/services/PublicTicketSubmissionService.ts
src/services/PublicTicketDeliveryService.ts
src/services/SupportTicketService.ts
src/repositories/PublicSupportFormRepository.ts
src/repositories/PublicTicketSubmissionRepository.ts
src/repositories/SupportTicketRepository.ts
src/integrations/jira/
src/workers/PublicTicketDeliveryWorker.ts
```

- [ ] Add Zod schemas for public configuration, submission, and admin mutation.
- [ ] Generate cryptographically random, rotatable `public_id` values.
- [ ] Document that `public_id` deliberately does not reuse RFC-0020's
  human-readable `public_single_apps.slug`: Jira intake needs an opaque,
  rotatable, revocable identifier. It remains only a discovery-reduction layer,
  never a replacement for Turnstile, quotas, or circuit breakers.
- [ ] Generate globally unique opaque `SUP-...` receipt codes.
- [ ] Implement active/disabled/expired form resolution with indistinguishable
  public errors.
- [ ] Implement authenticated CRUD, enable/disable, and rotate operations.
- [ ] Add JWT/RBAC permissions using the existing `domain.resource.action`
  convention: `public_support.form.read`, `public_support.form.manage`,
  `public_support.ticket.read`, and `public_support.ticket.retry`.
- [ ] Add dedicated `requirePublicSupportFormAccess()` and
  `requirePublicSupportTicketAccess()` middleware, following
  `requireGoalsAccess()` and the existing deny-wins/resource-scope evaluation.
- [ ] Keep Customer API Key scopes out of the pilot. If partner/API-key access is
  later required, define separate colon-based scopes rather than reusing JWT
  permission strings.
- [ ] Apply `tenant_id` filters inside repositories/services, not only handlers.
- [ ] Reuse `auditLogRepository.create()`, `CreateAuditLogInput`, and the writer
  installed through `setAuditLogWriter()`; do not create another audit pipeline.
- [ ] Write audit events for every configuration change without sensitive JSON.

### Exit criteria

- The migration passes the explicit custom-runner checklist above, with all
  status constraints verified against their TypeScript/Zod definitions.
- Tenant-isolation integration tests cover every administrative operation.
- Public form reads expose no internal IDs, provider keys, aliases, or mappings.

## Phase 4 — Jira adapter and delivery worker

### Adapter contract

```ts
class JiraTicketingProvider implements ITicketingProvider {
  createTicket(command: CreateSupportTicketCommand): Promise<ProviderTicketReference>;
  findByReceiptCode(receiptCode: string): Promise<ProviderTicketReference | null>;
}
```

- [ ] Resolve the `default` connection from deployment secrets.
- [ ] Keep Jira request/response types private to `src/integrations/jira/`.
- [ ] Validate project, issue type, and custom-field allowlists server-side.
- [ ] Map all six canonical priorities and both criticality values explicitly;
  fail configuration validation if any mapping is missing.
- [ ] Convert plain text to the Jira-supported description representation.
- [ ] Use a dedicated least-privilege Jira identity.
- [ ] Add request timeouts and sanitized error mapping.
- [ ] Never log authorization headers, PII response bodies, or full Jira payloads.

### Worker concurrency and delivery

- [ ] Claim eligible rows with `FOR UPDATE SKIP LOCKED` in a short transaction.
- [ ] Set `DELIVERING` and `delivery_lease_until`, then commit before calling Jira.
- [ ] Recover records whose delivery lease expired.
- [ ] Classify timeout, `429`, and Jira `5xx` as transient.
- [ ] Honor `Retry-After` where available.
- [ ] Use bounded exponential backoff with jitter and fixed maximum attempts.
- [ ] Preserve exhausted records as `DEAD_LETTER`.
- [ ] Before retrying an ambiguous create, search Jira by `receiptCode`.
- [ ] Mark `DELIVERED` with internal Jira IDs only after reconciliation.
- [ ] Make replay preserve the same submission, receipt, and idempotency key.

The implementation may extract generic backoff helpers from the inventory
outbox, but must not refactor the inventory worker merely to satisfy this RFC.

### Tests and exit criteria

- [ ] Contract-test issue creation against a Jira sandbox.
- [ ] Test two workers claiming concurrently.
- [ ] Test process death after claim and lease recovery.
- [ ] Test timeout-after-create followed by receipt reconciliation.
- [ ] Test `429`, `Retry-After`, `5xx`, invalid mappings, and dead-letter replay.
- [ ] Confirm a persisted submission reaches Jira exactly once in all tested
  retry windows.

## Phase 5 — Text-only public pilot

### Public API

```http
GET  /api/v1/public/support-forms/:formId
POST /api/v1/public/support-tickets
```

The POST accepts `application/json` only and returns `202 Accepted` after the
submission is durably stored. It does not wait for Jira.

- [ ] Require opaque `formId`; no default unscoped form exists.
- [ ] Return ordered request-type card configuration from the public form GET;
  omit disabled types and never expose provider/Jira identifiers.
- [ ] Apply strict request/body/field limits before expensive work.
- [ ] Validate with Zod and normalize contact fields.
- [ ] Reject request types disabled for the form and type/category combinations
  outside the form's allowlists.
- [ ] Reject user-provided HTML and arbitrary Jira values.
- [ ] Verify honeypot, minimum completion time, Turnstile, and shared quotas.
- [ ] Persist the submission and delivery job atomically.
- [ ] Enforce `(form_id, idempotency_key)` and return the original opaque receipt
  for a repeated high-entropy key.
- [ ] Return generic anti-enumeration errors.
- [ ] Never return Jira issue ID, key, URL, state, or error details.
- [ ] Add restrictive CORS and Content Security Policy for the official frontend.

### Operator API

```http
GET  /api/v1/support-ticket-submissions
GET  /api/v1/support-ticket-submissions/:id
POST /api/v1/support-ticket-submissions/:id/retry
```

- [ ] Gate the routes with `requirePublicSupportTicketAccess()` and distinct
  `public_support.ticket.read` / `public_support.ticket.retry` permissions.
- [ ] Audit manual replay through the existing RFC-0009 audit writer with actor,
  target, reason, and prior state.
- [ ] Prevent replay of an already delivered/reconciled submission.
- [ ] Add global and per-form kill switches.

### Observability and runbook

- [ ] Emit request, CAPTCHA, validation, limit, accepted, duplicate, delivery,
  retry, dead-letter, reconciliation, and circuit-breaker metrics.
- [ ] Alert on sustained Jira failures, dead-letter growth, abnormal acceptance
  volume, limiter failures, and open circuit breakers.
- [ ] Document disable-form, stop-worker, inspect-dead-letter, safe-replay, and
  Jira-outage procedures.
- [ ] Verify rollback leaves accepted records durable and recoverable.

### Exit criteria

- Security, tenant-isolation, retry, load, and failure-mode tests pass.
- One pilot form and one Jira project are enabled behind a feature flag.
- An operator can detect, inspect, and recover failed delivery without SQL.

## Phase 6 — Attachments after pilot stability

Attachments are a separate security and capacity milestone.

The five-step frontend may present an attachment step only when the public form
returns `attachments.enabled: true`. During the text-only pilot it must skip or
disable file selection and must not send mock file metadata to the API. Browser
`File` objects and local draft metadata are not durable uploads.

- [ ] Select quarantine storage and malware-scanning provider.
- [ ] Add `public_ticket_attachments` with `PENDING_SCAN`, `CLEAN`, `BLOCKED`,
  and `SCAN_RETRY` states.
- [ ] Accept multipart files into a private quarantine location.
- [ ] Replace the pilot JSON request with a versioned `multipart/form-data`
  contract containing one validated JSON `payload` part and repeated
  `attachments` parts. Do not treat filename, reported media type, or byte count
  supplied as JSON as an uploaded file.
- [ ] Enforce count, individual size, total size, signature, media type, and
  sanitized filename limits.
- [ ] Return `202` without blocking on malware scanning.
- [ ] Promote only `CLEAN` files and upload them to Jira asynchronously.
- [ ] Ensure blocked/unscanned files are never publicly downloadable.
- [ ] Add retention/deletion jobs for clean, blocked, abandoned, and error files.
- [ ] Capacity-test uploads, storage, scanning, and Jira attachment calls against
  current production infrastructure.
- [ ] Preserve ticket idempotency independently from upload retries and define
  how abandoned uploads, partial failures, and resubmission are reconciled
  without creating a second canonical ticket.

## Phase 7 — Rollout and CHAMADO decision

Before enabling another tenant:

- [ ] Review abuse rates, CAPTCHA failures, delivery latency, dead letters, Jira
  mapping errors, PII handling, and support-team workflow.
- [ ] Review infrastructure capacity and denial-of-service blast radius.
- [ ] Decide whether public intake must create a GCDR `CHAMADO`.
- [ ] If CHAMADO integration is required, write a separate synchronization RFC
  defining lifecycle ownership, comments, attachments, conflicts, and replay.

Do not add bidirectional Jira/CHAMADO synchronization incrementally inside this
implementation without that ownership contract.

## Future integration seam — RFC-0043 GCDR Copiloto (not scheduled)

The provider-neutral `support_tickets` domain is intentionally shaped so the
RFC-0043 Copiloto can consume it later through the existing domain-agnostic tool
registry. This is not part of the pilot and must not block Phases 1–7.

The first integration should remain read-only, matching the current guarantees
in `src/services/assistant/AssistantService.ts`:

- `list_support_tickets` — tenant/customer/project-scoped search and filters;
- `get_support_ticket` — canonical ticket details and provider delivery state;
- `summarize_support_ticket` — concise operational summary based on authorized
  ticket data;
- `find_related_work_orders` — correlate a ticket with CHAMADO/OS records without
  changing either lifecycle;
- portfolio questions such as blocking tickets, overdue SLA deadlines, priority
  distribution, and tickets awaiting an assignee.

A later advisory mode may suggest, but not silently persist:

- category, priority, and blocking/non-blocking criticality;
- title normalization and description summarization;
- likely customer project, affected device, or responsible team;
- duplicate candidates and a draft operator response.

Guardrails for any future Copiloto integration:

- assistant tools derive tenant/customer scope from the authenticated JWT and
  never accept caller-selected tenant IDs;
- tools query the canonical ticket service, never Jira or another provider
  directly, so provider replacement does not change assistant behavior;
- public submissions are not automatically sent to an LLM merely because they
  were accepted; PII purpose, consent/legal basis, redaction, retention, model
  provider, and cost policy require a separate decision;
- suggestions are marked as suggestions with provenance/model metadata and do
  not overwrite requester input;
- ticket creation, assignment, priority/status changes, comments, or provider
  actions remain out of scope for the current read-only assistant;
- any future write tool requires a separate RFC with explicit user confirmation,
  RBAC, idempotency, audit, replay safety, and rollback semantics.

When scheduled, register ticket tools in `src/services/assistant/registry.ts`
and keep `AssistantService` as the transport/orchestration layer. Do not embed
assistant or Anthropic dependencies in `SupportTicketService`.

## Definition of done for the backend pilot

- [ ] All Phase 0 decisions are recorded.
- [ ] Turnstile startup enforcement and PostgreSQL rate limiting are active.
- [ ] Provider-neutral contracts, migrations, repositories, services,
  controllers, Jira adapter, and worker have proportional unit, integration,
  and contract tests.
- [ ] Public form configuration and canonical tickets preserve `requestType`
  end-to-end without coupling the domain enum to Jira issue-type identifiers.
- [ ] The public API accepts text-only tickets and returns only opaque receipts.
- [ ] Jira outage, duplicate request, multi-worker, crash recovery, and ambiguous
  create scenarios have passing automated tests.
- [ ] Audit events, metrics, alerts, circuit breakers, and operator replay exist.
- [ ] No attachment, confirmation-email, public-status, or CHAMADO-sync scope has
  leaked into the pilot.
- [ ] No Copiloto/LLM dependency is present in the intake or delivery critical
  path; only the provider-neutral service boundary needed by future read tools
  exists.
