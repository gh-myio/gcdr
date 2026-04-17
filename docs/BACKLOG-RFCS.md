# GCDR RFC Backlog

> Document generated on 2026-04-13. Consolidates **not implemented**,
> **partially implemented** and **future** items from every existing RFC.
> Update manually whenever an RFC is promoted or an item ships.

---

## Contents

- [Status Legend](#status-legend)
- [Ready to Start (Design Complete)](#ready-to-start-design-complete)
- [Partially Implemented](#partially-implemented)
- [Draft / Exploratory](#draft--exploratory)
- [Discarded / Superseded](#discarded--superseded)
- [Executive Summary by Priority](#executive-summary-by-priority)

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented |
| 🟡 | Partial — code exists, but incomplete |
| 🔴 | Not started — design is ready |
| 📐 | Draft — still being specified |
| 🚫 | Discarded / Superseded |

---

## Ready to Start (Design Complete)

These RFCs have a detailed spec and can be started without any design blockers.

---

### RFC-0027 — Internal Support Rules in Bundle

**Status**: 🔴 Not started (1-line fix + minimal logic)
**File**: `docs/RFC-0027-Internal-Support-Rules-In-Bundle.md`
**Estimated effort**: Low (hours)

**What's missing:**
- Fix filter in `AlarmBundleService.ts` (around line 200): rules with
  `isInternalSupportRule: true` are being excluded from the bundle because the
  generic `internalRule: true` filter takes precedence.
- Add `includeInternalSupportRule=false` query parameter for explicit opt-out.
- Today 4 internal-support rules are left out of the bundle for no reason.

---

### RFC-0018 — Per-Device Rule Value Overrides

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0018-Per-Device-Rule-Value-Overrides.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Add `scope_entity_overrides jsonb` column to the `rules` table + migration.
- Update the `Rule` domain entity with the field mapping.
- Update `RuleDTO.ts` with Zod validation (overrides schema keyed by device UUID).
- Update `AlarmBundleService` to resolve overrides when assembling the bundle
  (merge: device override wins over rule base value).
- Update `RuleRepository` to persist and map the field.

> **Note**: the `scope_entity_overrides` column may already have been added in
> recent migrations. Check before creating a new migration.

---

### RFC-0028 — Device Calibration Offsets

**Status**: 🔴 Not started (advanced draft)
**File**: `docs/RFC-0028-Device-Calibration-Offsets.md`
**Estimated effort**: High (weeks)

**What's missing:**
- Add `calibration jsonb` column to the `devices` table.
- Structure: `offsets[]` (type SUM/MULTIPLIER/DIVIDER, value, daysOfWeek, time
  window), `periods[]` (date-range with offset overrides), `changelog[]`
  (audit trail with a cap).
- Calibration CRUD via dedicated endpoints (or via PATCH `/devices/:id`).
- Offset application logic in the rule-evaluation pipeline.
- Priority resolution: period override > base offset.
- **Bug in the doc**: the example for 2026-03-10 says "no active period" but
  Period B (`validFrom: 2026-03-01, validUntil: null`) should be active. Fix
  before implementing.

---

### RFC-0024 — Alarm Dispatch Configuration

**Status**: 🔴 Not started (design complete, co-dependent with RFC-0025)
**File**: `docs/RFC-0024-Alarm-Dispatch-Config.md`
**Estimated effort**: High (weeks)

**What's missing:**
- Create `customer_channels` and `group_dispatch_configs` tables.
- Redesign `rules.notifications` with recipients per action
  (OPEN/CLOSE/ESCALATE).
- Implement dispatch resolution in 3 layers: customer → group → channel.
- Update the Alarm Orchestrator to consume the new config when dispatching
  alerts.
- **Blocker**: depends on RFC-0025 for resolving user contacts.

---

### RFC-0025 — User Notification Contacts

**Status**: 🔴 Not started (co-dependency with RFC-0024)
**File**: `docs/RFC-0025-User-Notification-Contacts.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Create `user_contacts` table (channels: EMAIL, TELEGRAM, WHATSAPP, SMS,
  SLACK, TEAMS).
- CRUD endpoints: `GET/POST /users/:userId/contacts`,
  `PATCH/DELETE /users/:userId/contacts/:contactId`.
- Integration with the RFC-0024 dispatch system.
- Phase 2 (future): contact verification (token sent to the channel before it
  becomes active).

---

### RFC-0023 — Device Sync Job API

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0023-Device-Sync-Job-API.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Implement async Job API: `POST /api/v1/device-sync/jobs` (returns jobId
  immediately).
- Polling endpoint: `GET /api/v1/device-sync/jobs/:jobId` (status + structured
  log).
- In-process execution (no self-HTTP calls — sync logic lives in the service
  directly).
- Structured logs queryable by jobId.

---

### RFC-0016 — ThingsBoard Entity Mapping & Ingestion IDs

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0016-ThingsBoard-Entity-Mapping.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Add `ingestion_id` and `thingsboard_id` columns to `customers` and `assets`.
- Add `thingsboard_id` column to `devices`.
- New API Key scopes: `customers:read`, `customers:write`, `assets:write`,
  `sync:write`.
- Repository methods: `findByThingsboardId`, `findByIngestionId`.
- Update DTOs and seed scripts.
- Extend `JWT_AUDIENCE` to include `thingsboard-connector`.
- **Open question**: should `sync:write` be a standalone scope or combined?
  Decide before implementing.

---

### RFC-0012 — Features Registry

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0012-Features-Registry.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Create tables: `permissions_registry`, `features`, `feature_permissions`.
- CRUD for permissions and features.
- feature → permissions mapping.
- Integration with `AuthorizationService`.
- Frontend integration guide.

**Future (phase 2+):**
- Feature Analytics (who uses what).
- A/B Testing per feature flag.
- Feature Bundles (groups of features).
- Feature Requests (user requests access).
- Conditional Features (enabled by a business condition).
- Time-based Features (available only inside time windows).

---

### RFC-0013 — User Access Profile Bundle

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0013-User-Access-Profile-Bundle.md`
**Estimated effort**: High (weeks)

**What's missing:**
- Create tables: `maintenance_groups`, `user_maintenance_groups`,
  `domain_permissions`, `user_bundle_cache`.
- `MaintenanceGroupService`, `BundleGeneratorService`, `BundleCacheService`.
- Endpoints: `GET /users/me/access-bundle`,
  `GET /users/:userId/access-bundle`.
- Support for hierarchical permissions (customer-hierarchy scoping).
- **Open question**: max depth for customer-hierarchy traversal.

---

### RFC-0020 — Public Single Apps (Versioned Forms)

**Status**: 🔴 Not started (spec complete)
**File**: `docs/RFC-0020-Public-Single-Apps.md`
**Estimated effort**: Medium (days)

**What's missing:**
- Create `public_single_apps` and `public_single_app_responses` tables.
- API to create apps, submit responses, navigate response-version history.
- Automatic diff between response versions.
- **Primary use case**: customer migration requirements form (e.g. Helexia).

---

## Partially Implemented

RFCs with existing code but relevant gaps.

---

### RFC-0011 — User Registration & Approval Workflow

**Status**: 🟡 Partial (DTO and status enum implemented; approval flow
incomplete)
**File**: `docs/RFC-0011-User-Registration-Approval-Workflow.md`

**What's missing:**
- `verification_tokens` table + `VerificationTokenService`.
- Public registration endpoints: `POST /auth/register`,
  `POST /auth/verify-email`, `POST /auth/resend-verification`.
- Password reset: `POST /auth/forgot-password`, `POST /auth/reset-password`.
- Admin endpoints: `GET /admin/users/pending-approval`,
  `POST .../approve`, `POST .../reject`, `POST .../unlock`.
- Account lockout after N failed attempts.
- Email service integration (sending verification and password reset tokens).
- Observability (registration conversion metrics).

---

### RFC-0015 — Alarm Bundle Version History

**Status**: 🟡 Partial (table and cache invalidation implemented)
**File**: `docs/RFC-0015-Alarm-Bundle-Version-History.md`

**What's missing:**
- Endpoint `GET /customers/:id/alarm-rules/bundle/versions` (list version
  history).
- Version-diff endpoint (compare bundle v1 vs v2).
- Webhook notifications to Node-RED (bundle updated).
- Retention policy: automatic cleanup of old versions (e.g. keep the last 50).
- Multi-instance invalidation via Redis pub/sub (currently in-process only).

---

### RFC-0017 — External ID Lookup Endpoints

**Status**: 🟡 Partial (devices and customers implemented)
**File**: `docs/RFC-0017-ExternalId-Lookup-Endpoints.md`

**What's missing:**
- `GET /assets/external/:externalId` (asset-by-external-ID endpoint still does
  not exist).
- UNIQUE constraint on `externalId` per tenant (prevent duplicates).
- Include CUSTOMER-scoped rules in the enriched device-lookup response.

---

### RFC-0010 — Premium Alarm Simulator

**Status**: 🟡 Partial (MVP implemented; tests and docs missing)
**File**: `docs/RFC-0010-Premium-Alarm-Simulator.md`

**What's missing:**
- Unit tests for `SimulatorService`.
- Integration tests for simulator endpoints.
- SSE connection and rate-limiting tests.
- OpenAPI/Swagger documentation for the simulator.
- User guide.

---

### RFC-0022 — ThingsBoard ↔ GCDR Device Conformity

**Status**: 🟡 Partial (inspection script exists; automation does not)
**File**: `docs/RFC-0022-ThingsBoard-GCDR-Device-Conformity.md`

**What's missing:**
- Automatic reconciliation API (detect + fix divergences without manual
  intervention).
- GUI to visualize and fix divergences.

---

### RFC-0008 — Device Attributes Extension

**Status**: 🟡 Partial (main fields implemented; validations pending)
**File**: `docs/RFC-0008-Device-Attributes-Extension.md`

**What's missing:**
- Reject `mapInstantaneousPower` > 100KB (service-level validation).
- FIFO logic for `logAnnotations.entries` when > 100 entries.
- Unit tests for new device methods.
- Update OpenAPI/Swagger for the new fields.

---

### RFC-0002 — GCDR Authorization Model

**Status**: 🟡 Partial (structural RBAC exists; advanced evaluation engine
does not)
**File**: `docs/RFC-0002-GCDR-Authorization-Model.md`

**Future:**
- Policy simulation and dry-run mode.
- Permission recommendations based on usage.
- Integration with external IdPs (Okta, Azure AD).
- Fine-grained data-level permissions.
- Permission request and approval workflows.
- Real-time permission revocation via WebSocket.
- Cross-tenant permission sharing (open design question).

---

## Draft / Exploratory

RFCs still in the spec phase, with no defined implementation plan.

---

### RFC-0003 — JWT Multiple Audience

**Status**: 🟡 Partial (code implemented; deployment config not)

**What's missing:**
- Update environment variables in the deployment configs (Dokploy/CI).
- Document shared-secret management procedures.

---

### RFC-0005 — Container Deployment (Lambda → Dokploy)

**Status**: 🟡 Partial (Express core done; AWS cleanup pending)

**What's missing:**
- Remove legacy files: `serverless.yml`, Lambda plugins, old handlers.
- Decommission AWS resources (Lambda functions, API Gateway).
- Performance tests and staging validation.

---

---

## Discarded / Superseded

### RFC-0026 — Device Availability Tracking

**Status**: 🚫 Superseded
**Reason**: the Alarm API Backend already covers the requirement via
`GET /alarms/stats/availability`. Do not implement.

---

## Executive Summary by Priority

### High Priority (high value, low-to-medium effort)

| RFC | Title | Effort | Unblocker |
|-----|-------|--------|-----------|
| RFC-0027 | Internal Support Rules in Bundle | Hours | None |
| RFC-0018 | Per-Device Rule Value Overrides | Days | None |
| RFC-0025 | User Notification Contacts | Days | None |
| RFC-0017 | Assets by External ID | Hours | None |
| RFC-0015 | Bundle Version History (endpoints) | Days | None |

### Medium Priority (strategic value, medium effort)

| RFC | Title | Effort | Unblocker |
|-----|-------|--------|-----------|
| RFC-0024 | Alarm Dispatch Config | Weeks | RFC-0025 |
| RFC-0023 | Device Sync Job API | Days | None |
| RFC-0011 | User Registration Workflow | Weeks | Email service |
| RFC-0016 | ThingsBoard Entity Mapping | Days | Design decision (`sync:write` scope) |
| RFC-0028 | Device Calibration Offsets | Weeks | Finalize spec + fix doc bug |

### Low Priority (infra / future)

| RFC | Title | Effort | Note |
|-----|-------|--------|------|
| RFC-0012 | Features Registry | Days | Foundation for A/B testing |
| RFC-0013 | User Access Profile Bundle | Weeks | Depends on features registry |
| RFC-0020 | Public Single Apps | Days | Punctual use (Helexia-like) |
| RFC-0002 | Advanced Authorization Model | Weeks | External IdP, fine-grained |
| RFC-0022 | Device Conformity (auto) | Days | Operational nice-to-have |

---

*Maintained by the GCDR team. Update every sprint or whenever an RFC changes
status.*
