# RFC-0036: Device Annotations Migration (ThingsBoard → GCDR)

- **Feature Name**: `device-annotations`
- **Start Date**: 2026-06-09
- **RFC PR**: (pending)
- **Tracking Issue**: (pending)
- **Status**: Draft
- **Authors**: MYIO Platform Team
- **Related RFCs**: [RFC-0009 Events & Audit Logs](./RFC-0009-Events-Audit-Logs.md) · [RFC-0016 ThingsBoard Entity Mapping](./RFC-0016-ThingsBoard-Entity-Mapping.md) · [RFC-0025 User Notification Contacts](./RFC-0025-User-Notification-Contacts.md) · [RFC-0030 S3 Bucket Setup](./RFC-0030-S3-Bucket-Setup.md) · legacy: `myio-js-library` RFC-0104 (Device Annotations System), RFC-0151 (Images in Annotations), RFC-0203 (Header Annotations Button)
- **Stakeholders**: Backend, Frontend, Integrations, Data Migration

---

## Summary

Promote the **Device Annotations** system from its current home — a single `log_annotations` JSON blob stored as a ThingsBoard `SERVER_SCOPE` attribute per device — into first-class, relational, multi-tenant data in GCDR. This RFC defines five new tables (`annotations`, `annotation_responses`, `annotation_events`, `annotation_mentions`, `annotation_attachments`), a versioned HTTP API under `/api/v1`, an **idempotent one-way backfill** from the legacy blob, and a **coexistence strategy** in which GCDR becomes the single writer while the legacy `log_annotations` attribute is kept in sync (projected) so existing ThingsBoard widgets keep working unchanged during the transition.

It also introduces two capabilities the legacy system never had and that are explicitly requested for this migration:

1. **Mentions** — an annotation or a comment may mention other **users** and/or other **devices**.
2. **Attachments** — files (images today, any blob tomorrow) attached to an annotation **or** to an individual comment, reusing GCDR's existing `file_assets` / S3 subsystem (RFC-0030/0031) rather than ThingsBoard's image API.

**Scope of this RFC: design only. No code is produced here.** Implementation is a future activity.

---

## Motivation

### Problem

The legacy implementation (`myio-js-library` RFC-0104) stores every annotation, response, and audit entry for a device inside one `SERVER_SCOPE` attribute named `log_annotations`. The entire blob is read, mutated in the browser, and written back atomically on every operation:

```
GET  /api/plugins/telemetry/DEVICE/{id}/values/attributes/SERVER_SCOPE?keys=log_annotations
POST /api/plugins/telemetry/DEVICE/{id}/SERVER_SCOPE   { log_annotations: <entire blob> }
```

This shape has structural problems that block the product roadmap:

- **Last-writer-wins, no concurrency control.** Two browser sessions editing the same device silently overwrite each other. There is no optimistic locking — the legacy `version` counter is informational only.
- **Unbounded blob growth.** `annotations[]` (with nested `responses[]` and `history[]`) grows without bound; there is no pagination, archival, or purge at the storage layer. The cross-device panel (RFC-0203) already has to batch reads 100 devices at a time with throttling.
- **No cross-entity queries.** "Show all annotations mentioning me", "all pending annotations across this customer", "all annotations with attachments" are impossible without scanning every device's blob.
- **No referential integrity.** Actor identity, device references, and customer scoping live as denormalized JSON; nothing ties an annotation to a real `customers`/`devices`/`users` row.
- **Storage coupled to ThingsBoard.** Annotations cannot outlive or move independently of the TB device entity, and depend on TB attribute semantics.
- **No attachments or mentions.** RFC-0151 (images) was never implemented; mentions were left as an open question in RFC-0104.

### Use cases unlocked

- **Cross-device / cross-customer queries** — "all `pending` annotations of importance ≥ 4 for customer X", powering dashboards and the RFC-0203 header button server-side.
- **Mentions & notifications** — "annotations mentioning user U" feeds a notification (reusing RFC-0025 contacts), and "annotations referencing device D" links related equipment.
- **Attachments** — photos of a faulty meter attached to an annotation or to a specific comment, stored in S3/MinIO with AV-scan and presigned access.
- **Auditability** — an append-only `annotation_events` history that is part of the product surface (shown in UI), distinct from infra-level `audit_logs`.
- **Safe concurrent editing** — optimistic locking via `version` + `If-Match`.

### Non-goals

- Decommissioning ThingsBoard. During coexistence the legacy blob is kept in sync.
- Re-implementing the frontend widget. The frontend migration to the GCDR API is a follow-up effort; this RFC only guarantees the API and the projection that keeps legacy widgets working.
- A generic comment/mention engine for other domains. The link tables here are annotation-specific (a generalization is listed under Future Possibilities).

---

## Guide-Level Explanation

### Conceptual model

```
Device  ──1:N──>  Annotation  ──1:N──>  Response (comment | approved | rejected | archived)
                      │  │  │
                      │  │  └──1:N──>  Event        (append-only history: created/modified/...)
                      │  └─────1:N──>  Mention      (→ user  OR  → device)   [on annotation or on a response]
                      └────────1:N──>  Attachment   (→ file_assets)          [on annotation or on a response]
```

- An **Annotation** belongs to exactly one device (as today), is tenant- and customer-scoped, and has a `type`, `importance` (1–5), `status`, and free text.
- A **Response** is either a finalizing decision (`approved` / `rejected` / `archived`) or a non-finalizing `comment`. Multiple comments are allowed while the annotation is active; the first finalizing response locks it.
- An **Event** is an immutable audit-trail row mirroring the legacy `history[]` (`created`, `modified`, `archived`, `approved`, `rejected`, `commented`, `acknowledged`), with optional field-level `changes` diff.
- A **Mention** attaches to an annotation or to a specific response and points at either another user or another device — the new feature.
- An **Attachment** attaches to an annotation or to a specific response and points at a `file_assets` row — the new feature, reusing existing storage.

### Lifecycle (preserved from legacy)

```
            create
              │
              ▼
        ┌──────────┐   edit (text/type/importance/dueDate)
        │ created  │ ────────────────┐
        └────┬─────┘                 ▼
             │                  ┌──────────┐
             │   edit           │ modified │◄─┐ edit
             ├─────────────────►└────┬─────┘  │ (version++)
             │                       └────────┘
             │
   ┌─────────┼──────────────────────────┐
   │ approve │ reject            archive │
   ▼         ▼                           ▼
[FINALIZED] [FINALIZED]            ┌───────────┐
status kept status kept            │ archived  │ [FINALIZED]
                                   └───────────┘
comment → does NOT change status, does NOT finalize
```

Once any `approved | rejected | archived` response exists, the annotation is **finalized**: no further edits, archives, or responses are accepted (server-enforced — the legacy client only disabled buttons).

### Actor identity

Legacy annotations embed a `{ id, email, name }` snapshot for every actor (`createdBy`, `acknowledgedBy`, `responses[].createdBy`, `history[].user*`). GCDR's `users` table has `id` and `email` natively but **no top-level `name`** (it lives in `profile` JSONB). To preserve legacy fidelity, survive user deletion, and avoid a JOIN on every read, every actor is stored as a **JSONB snapshot** `{ id, email, name }` (see Rationale §A).

### For Frontend Developers

The widget stops reading/writing the `log_annotations` attribute and calls the GCDR REST API instead (see Reference-Level §4). Concurrency is now safe: edits send the current `version`; a stale edit returns `409 Conflict`. During the transition the legacy attribute is still populated by GCDR, so un-migrated widgets keep rendering badges.

### For Integration Developers

A one-time, **idempotent** backfill job reads each device's `log_annotations`, resolves the device/customer via RFC-0016 entity mapping, and inserts rows keyed by the legacy annotation `id`. Re-running it never duplicates. After backfill, an outbound **projector** keeps the legacy attribute in sync from GCDR rows.

### For Backend Developers

Five tables, one new migration (`00NN_*`), Drizzle schema additions, Zod DTOs, a service enforcing the lifecycle/finalization/optimistic-locking rules, repositories, and controllers mounted under `/api/v1`. Attachments reuse `FileAssetService`; the `file_assets` `owner_type` CHECK is extended.

---

## Reference-Level Explanation

### 1. Database Schema — New Tables

> Enums are modeled as `text` + `CHECK` (not `pgEnum`) following the `file_assets` precedent (RFC-0030), because the `type`/`status`/`action` value sets are expected to grow and `text`+`CHECK` is cheaper to extend (`DROP CONSTRAINT` + new `CHECK`) than `ALTER TYPE`.

#### 1.1 `annotations` (aggregate root)

```sql
CREATE TABLE IF NOT EXISTS annotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id),
  device_id       uuid NOT NULL REFERENCES devices(id),

  schema_version  text NOT NULL DEFAULT '1.0.0',
  text            text NOT NULL,
  type            text NOT NULL DEFAULT 'observation',
  importance      smallint NOT NULL DEFAULT 3,
  status          text NOT NULL DEFAULT 'created',

  finalized        boolean NOT NULL DEFAULT false,
  finalized_reason text,                 -- 'approved' | 'rejected' | 'archived' | NULL
  due_date         timestamptz,

  -- legacy acknowledge fields (kept for fidelity; superseded by responses)
  acknowledged     boolean NOT NULL DEFAULT false,
  acknowledged_by  jsonb,                -- { id, email, name }
  acknowledged_at  timestamptz,

  created_by      jsonb NOT NULL,        -- { id, email, name } actor snapshot
  updated_by      jsonb,                 -- last modifier snapshot
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  version         integer NOT NULL DEFAULT 1,

  -- migration provenance (idempotency key for backfill)
  legacy_id       uuid,                  -- original annotation.id from log_annotations

  CONSTRAINT annotations_type_check
    CHECK (type IN ('observation','pending','maintenance','activity')),
  CONSTRAINT annotations_status_check
    CHECK (status IN ('created','modified','archived')),
  CONSTRAINT annotations_importance_check
    CHECK (importance BETWEEN 1 AND 5),
  CONSTRAINT annotations_finalized_reason_check
    CHECK (finalized_reason IS NULL OR finalized_reason IN ('approved','rejected','archived')),
  CONSTRAINT annotations_text_len_check
    CHECK (char_length(text) <= 255)
);

CREATE INDEX  IF NOT EXISTS annotations_tenant_device_idx   ON annotations (tenant_id, device_id);
CREATE INDEX  IF NOT EXISTS annotations_tenant_customer_idx ON annotations (tenant_id, customer_id);
CREATE INDEX  IF NOT EXISTS annotations_tenant_status_idx   ON annotations (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX  IF NOT EXISTS annotations_tenant_type_idx     ON annotations (tenant_id, type)   WHERE deleted_at IS NULL;
-- idempotent backfill: one row per (tenant, legacy annotation id)
CREATE UNIQUE INDEX IF NOT EXISTS annotations_tenant_legacy_id_unique
  ON annotations (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;
```

#### 1.2 `annotation_responses` (comments + decisions)

```sql
CREATE TABLE IF NOT EXISTS annotation_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  annotation_id  uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  type           text NOT NULL,         -- 'approved' | 'rejected' | 'comment' | 'archived'
  text           text,
  created_by     jsonb NOT NULL,        -- { id, email, name }
  created_at     timestamptz NOT NULL DEFAULT now(),
  legacy_id      uuid,                  -- original response.id

  CONSTRAINT annotation_responses_type_check
    CHECK (type IN ('approved','rejected','comment','archived')),
  -- text mandatory for everything except 'approved'
  CONSTRAINT annotation_responses_text_required_check
    CHECK (type = 'approved' OR (text IS NOT NULL AND char_length(text) > 0)),
  CONSTRAINT annotation_responses_text_len_check
    CHECK (text IS NULL OR char_length(text) <= 255)
);

CREATE INDEX IF NOT EXISTS annotation_responses_annotation_idx ON annotation_responses (annotation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_responses_tenant_legacy_id_unique
  ON annotation_responses (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;
```

#### 1.3 `annotation_events` (append-only history)

Mirrors the legacy `history[]` and follows the append-only actor-snapshot pattern of `audit_logs` / `simulator_events` (no `updated_at` / `version` / `deleted_at`).

```sql
CREATE TABLE IF NOT EXISTS annotation_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  annotation_id    uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  response_id      uuid REFERENCES annotation_responses(id) ON DELETE SET NULL,
  action           text NOT NULL,       -- see CHECK below
  previous_version integer,
  changes          jsonb,               -- field-level diff for 'modified': { field: { from, to } }
  actor            jsonb NOT NULL,      -- { id, email, name }
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT annotation_events_action_check
    CHECK (action IN ('created','modified','archived','approved','rejected','commented','acknowledged'))
);

CREATE INDEX IF NOT EXISTS annotation_events_annotation_idx ON annotation_events (annotation_id, created_at);
```

#### 1.4 `annotation_mentions` (NEW — mention users or devices)

```sql
CREATE TABLE IF NOT EXISTS annotation_mentions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  annotation_id       uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  response_id         uuid REFERENCES annotation_responses(id) ON DELETE CASCADE,  -- NULL => mention on the annotation itself
  mention_type        text NOT NULL,    -- 'user' | 'device'
  mentioned_user_id   uuid REFERENCES users(id),
  mentioned_device_id uuid REFERENCES devices(id),
  actor               jsonb NOT NULL,   -- who created the mention
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT annotation_mentions_type_check
    CHECK (mention_type IN ('user','device')),
  -- exactly one target, matching mention_type
  CONSTRAINT annotation_mentions_target_check CHECK (
    (mention_type = 'user'   AND mentioned_user_id   IS NOT NULL AND mentioned_device_id IS NULL) OR
    (mention_type = 'device' AND mentioned_device_id IS NOT NULL AND mentioned_user_id   IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS annotation_mentions_annotation_idx   ON annotation_mentions (annotation_id);
CREATE INDEX IF NOT EXISTS annotation_mentions_user_idx         ON annotation_mentions (tenant_id, mentioned_user_id)   WHERE mentioned_user_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS annotation_mentions_device_idx       ON annotation_mentions (tenant_id, mentioned_device_id) WHERE mentioned_device_id IS NOT NULL;
```

#### 1.5 `annotation_attachments` (NEW — reuse `file_assets`)

Thin link table, mirroring the `wo_installation_images` pattern (a domain row ↔ a `file_assets` id).

```sql
CREATE TABLE IF NOT EXISTS annotation_attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  annotation_id  uuid NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  response_id    uuid REFERENCES annotation_responses(id) ON DELETE CASCADE,  -- NULL => attached to the annotation itself
  file_asset_id  uuid NOT NULL REFERENCES file_assets(id),
  created_by     jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annotation_attachments_annotation_idx ON annotation_attachments (annotation_id);
CREATE INDEX IF NOT EXISTS annotation_attachments_response_idx   ON annotation_attachments (response_id) WHERE response_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS annotation_attachments_file_idx       ON annotation_attachments (file_asset_id);
```

#### 1.6 Extend `file_assets.owner_type` CHECK

`file_assets` gates `owner_type` with a CHECK currently `IN ('wiki_page','wiki_pdf','free')`. Annotation attachments set `owner_type = 'annotation'` (and `'annotation_response'`), `owner_id = <annotation/response id>`, enabling orphan cleanup and the existing presigned-URL flow:

```sql
ALTER TABLE file_assets DROP CONSTRAINT IF EXISTS file_assets_owner_type_check;
ALTER TABLE file_assets ADD  CONSTRAINT file_assets_owner_type_check
  CHECK (owner_type IN ('wiki_page','wiki_pdf','free','annotation','annotation_response'));
```

### 2. Drizzle Schema Changes

Add to `src/infrastructure/database/drizzle/schema.ts` (camelCase exports, `withTimezone: true` on all timestamps, `text`+`check` for closed sets, JSONB actor snapshots):

```typescript
export const annotations = pgTable('annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  schemaVersion: text('schema_version').notNull().default('1.0.0'),
  text: text('text').notNull(),
  type: text('type').notNull().default('observation'),
  importance: smallint('importance').notNull().default(3),
  status: text('status').notNull().default('created'),
  finalized: boolean('finalized').notNull().default(false),
  finalizedReason: text('finalized_reason'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  acknowledged: boolean('acknowledged').notNull().default(false),
  acknowledgedBy: jsonb('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdBy: jsonb('created_by').notNull(),
  updatedBy: jsonb('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  legacyId: uuid('legacy_id'),
}, (table) => ({
  tenantDeviceIdx: index('annotations_tenant_device_idx').on(table.tenantId, table.deviceId),
  tenantCustomerIdx: index('annotations_tenant_customer_idx').on(table.tenantId, table.customerId),
  typeChk: check('annotations_type_check', sql`${table.type} IN ('observation','pending','maintenance','activity')`),
  statusChk: check('annotations_status_check', sql`${table.status} IN ('created','modified','archived')`),
  importanceChk: check('annotations_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
}));
// annotationResponses, annotationEvents, annotationMentions, annotationAttachments follow the same conventions.
```

> Note on governance (`docs/DB-MIGRATIONS.md`): the Drizzle journal froze at `0012` and the schema is not replayable from scratch. `schema.ts` and the hand-written migration must be kept in lockstep so a fresh `db:push` + `db:mig:baseline` produces the same shape.

### 3. Migration

Author a single hand-written, idempotent migration `drizzle/migrations/00NN_annotations.sql` (next free number — coordinate at PR time; on-disk latest is `0030`), creating the five tables and altering the `file_assets` CHECK. Apply with the custom runner:

```bash
npm run db:mig:status   # confirm pending
npm run db:mig:up       # apply (each migration in its own transaction)
npm run db:mig:status   # verify recorded
```

### 4. API Endpoints (`/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/devices/:deviceId/annotations` | Create annotation |
| `GET`  | `/devices/:deviceId/annotations` | List for a device (filters: `type`, `status`, `importance`, `includeArchived`, pagination) |
| `GET`  | `/annotations` | Cross-device list (filters incl. `customerId`, `mentionedUserId`, `mentionedDeviceId`, `hasAttachments`) |
| `GET`  | `/annotations/summary` | Badge aggregation — counts by `type`/`status`/`importance` for `deviceIds[]` (replaces client-side blob scan) |
| `GET`  | `/annotations/:id` | Full annotation (responses + events + mentions + attachments) |
| `PATCH`| `/annotations/:id` | Edit `text`/`type`/`importance`/`dueDate` → `status='modified'`, `version++` (optimistic lock) |
| `POST` | `/annotations/:id/archive` | Archive (finalizes) |
| `POST` | `/annotations/:id/responses` | Add response `{ type: approved\|rejected\|comment\|archived, text? }` |
| `POST` | `/annotations/:id/mentions` | Add mention `{ mentionType, mentionedUserId? , mentionedDeviceId?, responseId? }` |
| `POST` | `/annotations/:id/attachments` | Attach file (multipart, or link existing `fileAssetId`; optional `responseId`) |
| `DELETE`| `/annotations/:id/attachments/:attId` | Detach (active annotation only) |

**Optimistic locking.** `PATCH`/response writes carry the expected `version` (body field or `If-Match` header). A mismatch returns `409 Conflict` — closing the legacy last-writer-wins hole.

**Auth & context.** Bearer JWT + `X-Tenant-Id`; controllers read `req.context` (`tenantId`, `userId`, `requestId`). Responses use `sendSuccess`/`sendCreated`/`sendNoContent`; errors via `ValidationError`/`NotFoundError`/`AppError`. Customer-scope authorization follows the existing RBAC.

Example — create:

```jsonc
// POST /api/v1/devices/26a3fb10-.../annotations
{
  "text": "Medidor não está registrando o consumo em alguns horários",
  "type": "pending",
  "importance": 3,
  "dueDate": "2026-06-20",
  "mentions": [
    { "mentionType": "user",   "mentionedUserId": "21169bd0-..." },
    { "mentionType": "device", "mentionedDeviceId": "9c2f...-..." }
  ]
}
// → 201 { id, version: 1, status: "created", finalized: false, createdBy: {id,email,name}, ... }
```

### 5. DTOs (Zod)

One file `src/dto/request/AnnotationDTO.ts`: `CreateAnnotationSchema`, `UpdateAnnotationSchema`, `CreateResponseSchema`, `CreateMentionSchema`, `CreateAttachmentSchema`, plus reusable `z.enum([...])` for `type`/`status`/`responseType`/`mentionType`. Cross-field rules via `.refine()` (e.g. response `text` required unless `approved`; exactly one mention target). List endpoints extend `PaginationParams`.

### 6. Migration & Coexistence Strategy

Legacy and GCDR must run side by side. Four phases:

**Phase 0 — Build (this RFC).** Ship schema, API, DTOs, services. No change to ThingsBoard behavior. Frontend still uses `log_annotations`.

**Phase 1 — Backfill (one-way, idempotent).** A job iterates devices, reads each `log_annotations` `SERVER_SCOPE` attribute, resolves `customer_id`/`device_id` via RFC-0016 entity mapping (`external_id`), and upserts rows keyed by `legacy_id` (annotation & response ids). Actor `{id,email,name}` JSON is preserved verbatim. `history[]` → `annotation_events`. Re-runnable with zero duplication (unique `(tenant_id, legacy_id)`).

```
log_annotations.annotations[]  → annotations          (legacy_id = annotation.id)
   .responses[]                → annotation_responses  (legacy_id = response.id)
   .history[]                  → annotation_events
   .acknowledgedBy/At          → annotations.acknowledged*
```

**Phase 2 — Coexistence (GCDR is the writer; legacy is projected).** All new writes go through the GCDR API. An **outbound projector** rebuilds the `log_annotations` blob from GCDR rows whenever a device's annotations change and writes it back to TB `SERVER_SCOPE`, so un-migrated widgets (MAIN_VIEW badges, RFC-0203 panel) keep rendering. This keeps exactly **one writer**, eliminating the last-writer-wins race. (Direction is GCDR → TB only; the legacy widget's write path is retired per-widget as the frontend migrates. See Unresolved Q1.)

**Phase 3 — Cutover & freeze.** Frontend reads/writes annotations exclusively via GCDR. The projector is disabled once no consumer reads `log_annotations`; the attribute is frozen (optionally archived/removed).

### 7. Mentions & Attachments (new capabilities)

- **Mentions** target a user (`mentioned_user_id` → `users`) or a device (`mentioned_device_id` → `devices`), on the annotation (`response_id = NULL`) or on a specific comment. `GET /annotations?mentionedUserId=me` powers a "mentioned me" inbox and can fan out notifications via RFC-0025 contacts (delivery integration is out of scope here).
- **Attachments** reuse `file_assets` + `S3Storage` (RFC-0030/0031): upload via multipart (`FileAssetService`, AV-scan slot, presigned download), `owner_type='annotation'|'annotation_response'`. Honors the legacy RFC-0151 intent (≤6 images, JPEG/PNG, ≤10 MB) as DTO-level validation, but generalizes to any blob and any modern storage backend.

---

## Files to Modify

| File | Action |
|---|---|
| `drizzle/migrations/00NN_annotations.sql` | **Create** — 5 tables + `file_assets` CHECK alter |
| `src/infrastructure/database/drizzle/schema.ts` | Add 5 table defs; update `file_assets` CHECK comment |
| `src/domain/entities/Annotation.ts` (+ Response/Event/Mention/Attachment) | **Create** |
| `src/dto/request/AnnotationDTO.ts` | **Create** — Zod schemas |
| `src/repositories/AnnotationRepository.ts` (+ `IAnnotationRepository`) | **Create** |
| `src/services/AnnotationService.ts` | **Create** — lifecycle, finalization, optimistic lock, event emission |
| `src/controllers/annotations.controller.ts` | **Create** — mount under `/api/v1` |
| `src/services/FileAssetService.ts` | Allow `annotation`/`annotation_response` owner types |
| `scripts/migration/backfill-annotations.ts` | **Create** — Phase 1 ETL (idempotent) |
| `scripts/migration/project-annotations-to-tb.ts` | **Create** — Phase 2 outbound projector |
| `tests/` | Unit (lifecycle/locking) + integration (API) + backfill idempotency |
| `docs/ONBOARDING.md`, `MEMORY` | Document the new domain |

---

## Drawbacks

- **Five new tables + ETL + projector** is a significant surface for a feature currently held in one attribute. Justified by the query/integrity/concurrency wins, but it is real build and operational cost.
- **Dual-system window.** During Phase 2 the projector adds write amplification (GCDR → TB) and a failure mode (projection lag). Requires monitoring.
- **Actor JSONB snapshots** duplicate identity data and can drift from `users` (name change won't propagate). Accepted for fidelity/immutability (see Rationale §A).
- **`text`+`CHECK` enums** trade DB-level type names for cheaper extensibility; less self-documenting than `pgEnum`.
- **No frontend in scope.** The full value isn't realized until the widget migrates; until then we carry both code paths.

---

## Rationale and Alternatives

### A. Actor identity: JSONB `{id,email,name}` snapshot vs. `user_id` + `user_email` columns

**Chosen: JSONB snapshot.** Legacy data already carries `{id,email,name}` and GCDR `users` has no first-class `name`. Snapshots preserve migration fidelity, survive user deletion, and avoid a JOIN per row. **Rejected:** `audit_logs`-style `user_id`+`user_email` columns — would lose `name` and require resolving display names from `profile` JSONB at read time, and would not faithfully represent legacy non-GCDR actors.

### B. Dedicated `annotation_events` vs. reusing `audit_logs`

**Chosen: dedicated table.** Annotation history is part of the product surface (shown in the UI), with a domain-specific vocabulary; `audit_logs` is infra-level, PII-sanitized, and retention-purged (wrong lifecycle). Precedent: `alarm_bundle_versions`, `simulator_events`, `wo_*_audit` are all purpose-built. **Rejected:** reusing `audit_logs` — its purge tiers would silently delete user-visible history. (A coarse `audit_logs` row may still be emitted in addition, for compliance.)

### C. Attachments: reuse `file_assets`/S3 vs. ThingsBoard image API (RFC-0151) vs. new table

**Chosen: reuse `file_assets` via a link table.** GCDR already has a polymorphic S3/MinIO subsystem with AV-scan and presigned URLs; the `wo_*_images` link-table pattern is established. **Rejected:** TB image API — re-couples storage to ThingsBoard, the very thing we're migrating away from. **Rejected:** a bespoke attachments table — duplicates `file_assets`.

### D. `text`+`CHECK` vs. `pgEnum`

**Chosen: `text`+`CHECK`,** following the deliberate `file_assets` precedent: status/type/action sets will grow, and extending a CHECK is cheaper and safer than `ALTER TYPE ... ADD VALUE`. **Rejected:** `pgEnum` — better self-documentation but rigid evolution.

### E. Keep per-device 1:N (annotation → one device) vs. many-to-many

**Chosen: 1:N** (annotation belongs to one device), matching legacy semantics. Cross-device association is expressed through **device mentions**, not co-ownership. **Rejected:** M:N device ownership — no legacy or product driver, adds complexity.

### F. Coexistence: GCDR-writer + projection vs. bidirectional sync vs. big-bang cutover

**Chosen: GCDR single-writer + one-way projection to TB.** One writer eliminates the legacy race; legacy widgets keep working via projection. **Rejected:** bidirectional sync — reintroduces last-writer-wins and conflict resolution across two stores. **Rejected:** big-bang cutover — requires migrating all widgets at once; too risky.

---

## Unresolved Questions

1. **Projector trigger & cadence (Phase 2):** event-driven (write-through on each mutation) vs. periodic rebuild? And the exact retirement order of legacy widget write paths.
2. **Notifications for mentions:** does mentioning a user dispatch a notification now (via RFC-0025 contacts), or only populate a queryable inbox? Delivery is currently out of scope.
3. **Comment edit/delete:** legacy responses are immutable. Do we allow editing/soft-deleting a comment in GCDR, and how is that reflected in `annotation_events`?
4. **Finalization reversibility:** can an `approved`/`rejected` annotation ever be reopened (e.g., by an admin)? Legacy says no.
5. **`legacy_id` collisions across tenants:** uniqueness is `(tenant_id, legacy_id)` — confirm legacy ids are unique within a tenant (they are device-scoped today; verify no reuse).
6. **Migration trigger for new annotations created in TB during Phase 1/early Phase 2** before a device's write path is cut over — does the backfill need to run continuously until cutover?
7. **Attachment limits:** enforce RFC-0151's ≤6 images / ≤10 MB / JPEG-PNG as hard limits, or make them configurable per tenant?
8. **Mention authorization:** can a user mention any device/user in the tenant, or only those within their RBAC scope?

---

## Future Possibilities

- **Generic comment/mention/attachment engine** reusable by other domains (assets, rules, work orders), if a second consumer appears.
- **Full-text search** over annotation `text` (Postgres `tsvector`) and `@mention` autocomplete.
- **Annotation → Work Order linkage** (RFC `wo` domain): promote a `pending` annotation into a Work Order.
- **Real-time** annotation/mention updates over WebSocket/SSE for the dashboard.
- **Retention/archival policy** for very old archived annotations (the problem the blob never solved).
- **Reactions / acknowledgement receipts** on comments.
- **Threaded replies** (responses to responses) if comment volume grows.
