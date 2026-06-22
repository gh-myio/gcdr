# RFC-0030 — MYIO Wiki (Knowledge Base Module)

- **Status:** Draft
- **Created:** 2026-04-22
- **Author:** MYIO Engineering
- **Domain:** Knowledge Base / Documentation / Collaboration

## Companion documents

- [RFC-0030 — S3 Bucket Setup for MYIO Wiki & Files](./RFC-0030-S3-Bucket-Setup.md) —
  infrastructure runbook for the object-storage bucket that backs wiki attachments,
  file-repository binaries, thumbnails, and extracted-text caches. Read this before
  starting implementation of any feature that touches binary storage.

---

## Why this matters

MYIO's operational knowledge is scattered. Runbooks for alarm escalation live in
engineers' heads; the "how to onboard a new customer" checklist is a Notion page
someone can't find; CT multipliers and hydrometer pulse factors are in spreadsheets
exchanged over WhatsApp; the reasoning behind a rules-engine guard config exists
only as a commit message on a branch merged eight months ago.

When the institutional memory of a product lives outside the product, three things
happen — repeatedly:

- **Support takes longer than it should.** A level-1 technician escalates an issue
  to engineering because the recipe to diagnose it was never written down, or was
  written down in a tool the technician doesn't have access to.
- **Onboarding is painful.** New engineers and integration partners spend weeks
  reconstructing context from Slack threads and RFC archives that are not linked
  to the entities they describe.
- **Decisions drift.** The same trade-off gets re-debated six months later because
  nobody remembers (or can find) the decision log.

Third-party wikis (Notion, Confluence, Wiki.js) partially solve this — but they sit
outside GCDR. They don't know what a device, rule, or customer is. A runbook for
"chiller overheating at Moxuara" is just prose; it cannot link to *the actual*
devices, rules, or alarm bundles it is describing, and it cannot be surfaced
contextually when an operator is looking at those entities.

**MYIO Wiki brings the knowledge base inside the platform.** Pages are first-class
entities in GCDR: versioned, tenant-scoped, RBAC-governed, and — critically —
linkable to and from real domain objects (devices, rules, customers, assets,
RFCs). When an operator opens a rule, the wiki pages that reference that rule
appear alongside it. When a wiki page mentions a device, the link is live — it
resolves to the current device record, not a stale copy-paste.

This is the formalisation of documentation that is already being written, brought
into the right place, with the right structure, governed by the same tenant and
RBAC model as the rest of GCDR.

---

## Summary

Introduces a **wiki** module to GCDR: a MediaWiki-inspired, multi-tenant knowledge
base where pages are authored in Markdown, stored in PostgreSQL, versioned via a
revision table, searched via `tsvector` + GIN, and linked to domain entities
(devices, rules, customers, assets, RFCs) through a polymorphic backlinks table.

Core capabilities:

- **Namespaces** (`Runbooks/`, `Customers/`, `Devices/`, `RFCs/`, `Integrations/`,
  free-form) group pages by domain.
- **Revisions** are immutable; every edit produces a new row. Rollback is a copy
  forward, never a mutation of history.
- **Entity links** are extracted from page content at save time and indexed into
  `wiki_page_links`, enabling bidirectional lookup ("show me all pages that
  reference this device").
- **Full-text search** scoped by tenant, namespace, and ACL.
- **RBAC** reuses GCDR's existing policy engine (RFC-0002) — no new permission
  model.
- **Attachments** stored in S3-compatible object storage with signed URLs.
- **Optional drafts & review workflow** for pages that require approval before
  publication.

---

## Motivation

The MYIO platform already produces structured knowledge — RFCs, ONBOARDING.md,
controller JSDoc, migration notes — but that knowledge lives in the Git
repository, readable only by engineers with repo access. Operations, support,
and partner integrators need a way to:

- Write and search operational runbooks tied to specific customers, devices, or
  rule bundles.
- Record **decisions and rationale** that outlive the commit that implemented
  them, indexed and searchable.
- Attach screenshots, CSV calibration tables, and PDF datasheets alongside prose.
- Control who can read or edit each page using the tenant's existing RBAC roles.
- Link a page to a domain entity and have that link remain valid even when the
  entity is renamed or moved.

Existing SaaS wikis do not integrate with GCDR's tenant model, RBAC, or entity
graph. Hosting a separate Wiki.js and keeping it in sync with customers/devices
is an integration problem of its own. The smallest coherent solution is to build
a first-class wiki module inside GCDR.

---

## Guide-level explanation

### Concepts

#### Page

A **page** is the unit of content. Every page has:

| Field         | Description |
|---------------|-------------|
| `id`          | UUID, stable across renames |
| `tenantId`    | Tenant scope (GCDR multi-tenancy) |
| `namespace`   | Top-level folder (e.g. `Runbooks`, `Customers`, `Devices`) |
| `slug`        | URL-safe identifier within a namespace |
| `title`       | Human-readable title |
| `status`      | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` |
| `currentRevisionId` | FK to the active revision |
| `tags`        | Free-form tag array for filtering |
| `frontmatter` | JSONB for structured metadata (owner, reviewDue, etc.) |

Pages are addressed canonically as `:namespace/:slug` within a tenant.
Example: `Runbooks/chiller-overheating-moxuara`.

#### Revision

Every edit creates a **revision** — a snapshot of the page body, title, and
frontmatter at the moment of save. Revisions are immutable. Rollback works by
creating a *new* revision whose content copies an older one.

| Field          | Description |
|----------------|-------------|
| `id`           | UUID |
| `pageId`       | FK to the page |
| `revisionNumber` | Monotonic counter starting at 1 |
| `body`         | Markdown source |
| `bodyHtml`     | Server-rendered HTML cache |
| `title`        | Title at the time of this revision |
| `frontmatter`  | JSONB snapshot |
| `authorId`     | User who saved this revision |
| `changeNote`   | Free-text summary of the change (like a commit message) |
| `createdAt`    | Timestamp |

#### Namespace

Namespaces are **flat top-level folders** — no nesting. The `slug` inside a
namespace may contain `/` for visual hierarchy (`chillers/overheating`), but
the database treats it as an opaque string. This avoids the classic wiki pain
of tree renames cascading into every URL.

Pre-seeded namespaces: `Runbooks`, `Customers`, `Devices`, `Rules`, `Assets`,
`Integrations`, `RFCs`, `General`. Tenants may create custom namespaces.

#### Entity link

A **link from a page to a GCDR entity** is the feature that distinguishes MYIO
Wiki from a stock wiki. In Markdown, an operator writes:

```
The device @device:e982edf9-edb1-4aa6-8a14-4782465ae5a3 is the edge central for
Moxuara. See also @customer:84e0370e-636a-4741-9874-504b5e0b3577 and the rule
bundle on @rule:7c3f9e22-....
```

At save time, the server parses these `@type:uuid` tokens out of the body and
writes one row per token into `wiki_page_links`. The rendered HTML replaces each
token with a live link that resolves the entity's current display name on
render — so when a device is renamed, every wiki page that references it shows
the new name automatically.

Supported entity types (v1): `device`, `customer`, `rule`, `asset`, `central`,
`group`, `user`, `rfc`.

#### Backlinks

Given any domain entity, `GET /wiki/backlinks?entity=device:<uuid>` returns every
wiki page that links to it. This is the raison d'être of the module: a device
detail screen can render a "Referenced by" panel listing the runbooks that
mention it.

#### Search

Full-text search uses PostgreSQL `tsvector` with a GIN index. The index is
updated on revision insert. The query side supports:

- `q` — full-text query
- `namespace` — filter by namespace
- `tags` — filter by tag (AND semantics)
- `entity` — "pages that link to this entity"
- `status` — default `PUBLISHED`, callable with `DRAFT` for authors

Results are ranked with `ts_rank_cd`, then by `updatedAt` desc as a tie-breaker.

#### Attachment

An **attachment** is a binary file (image, PDF, CSV) stored in S3 and referenced
by one or more pages. Attachments are tenant-scoped. A page body references
them via `![](/wiki/attachments/<id>)` (Markdown) or the server-rendered signed
URL (HTML). Deleting an attachment soft-deletes (flag + retention) — the binary
is kept for 30 days in case of rollback.

#### Status & review flow

Pages transition:

```
                 ┌─────────┐
  create ────▶   │  DRAFT  │   ──── submit ────▶ (optional REVIEW) ────▶ PUBLISHED
                 └─────────┘                                                │
                                                                            │ archive
                                                                            ▼
                                                                       ┌──────────┐
                                                                       │ ARCHIVED │
                                                                       └──────────┘
```

Review is optional per-tenant and per-namespace (config in `tenant.wiki_config`).
When enabled, a page in `DRAFT` moves to `REVIEW` on submit; a reviewer with
`wiki.page.review` permission publishes it.

#### Visibility & audience scoping

Knowledge has different **audiences**. A setup guide for alarm bundles is useful to
every MYIO partner; a customer-specific runbook belongs only to that tenant; a pricing
spreadsheet is MYIO-internal; a public changelog should be reachable by any authenticated
user across the platform.

Every page declares **which audiences may read it**. The model is a *set of audience
tags* — not a single enum — so a page can be visible to e.g. partners **and** MYIO staff
without needing a "partners + MYIO" compound value.

##### Audience tags

| Tag                      | Who sees pages with this tag                                              |
|--------------------------|---------------------------------------------------------------------------|
| `PUBLIC`                 | Any authenticated user on the platform, regardless of tenant or role.     |
| `MYIO_INTERNAL`          | Only users belonging to the MYIO-ROOT customer (MYIO staff).              |
| `PARTNERS`               | Only users authenticated via a partner (`partnerId` claim in JWT) or partner API key. |
| `HOLDING_CUSTOMERS`      | Only users belonging to a customer of type `HOLDING`. |
| `NON_HOLDING_CUSTOMERS`  | Only users belonging to a customer of type `COMPANY`, `BRANCH`, or `FRANCHISE`. |
| `TENANT_PRIVATE`         | Only users belonging to the same tenant that owns the page.               |

> Customer-type taxonomy follows the existing codebase enum `HOLDING | COMPANY | BRANCH | FRANCHISE`.
> "Holding" customers are the top-level entities that own operational units below them (COMPANY, BRANCH, FRANCHISE).

##### Effective audience list of a user

Every authenticated request is assigned a **set of audiences** by the auth middleware,
computed from JWT claims and tenant/customer lookup:

```
user.effectiveAudiences = {
  always:                                        { PUBLIC }
  if user.customer.tenant == page.tenant:        + { TENANT_PRIVATE }
  if user.type == 'INTERNAL':                    + { MYIO_INTERNAL }
  if user.type == 'PARTNER' or user.partnerId:   + { PARTNERS }
  if user.customer.type == 'HOLDING':            + { HOLDING_CUSTOMERS }
  if user.customer.type in {COMPANY,BRANCH,FRANCHISE}: + { NON_HOLDING_CUSTOMERS }
}
```

##### Read rule

A user can read a page if **any** tag in `page.visibility` is present in their
`effectiveAudiences`. Implemented server-side with the PostgreSQL array-overlap
operator (`&&`), so read filters are always applied at the database layer — never in
application code after the rows have been fetched.

##### Write rule (who can set which visibility)

Not every user may publish to every audience. Setting `PUBLIC` or `MYIO_INTERNAL`
requires MYIO staff; setting `PARTNERS` requires a partner admin; `HOLDING_CUSTOMERS`
and `NON_HOLDING_CUSTOMERS` require the user's own tenant to be the MYIO-ROOT (i.e.,
cross-tenant publishing is an MYIO-only operation).

This is encoded as RBAC permissions of the form `wiki.visibility.<tag>` (lowercase
kebab-case, e.g. `wiki.visibility.myio-internal`), and enforced at the controller
layer when creating or updating a page's `visibility` field.

##### Frontend UX — presets

The frontend does **not** force authors to understand the raw tag set. It presents a
small set of labeled presets covering the common cases, with an "Advanced" disclosure
for the full combination:

| Preset label (PT-BR)              | Underlying `visibility`                                  |
|-----------------------------------|----------------------------------------------------------|
| Privado (apenas minha organização) | `[TENANT_PRIVATE]`                                       |
| Somente MYIO                      | `[MYIO_INTERNAL]`                                        |
| Somente parceiros                 | `[PARTNERS]`                                             |
| Somente clientes holding          | `[HOLDING_CUSTOMERS]`                                    |
| Somente clientes não-holding      | `[NON_HOLDING_CUSTOMERS]`                                |
| Todos os clientes                 | `[HOLDING_CUSTOMERS, NON_HOLDING_CUSTOMERS]`             |
| Parceiros + clientes              | `[PARTNERS, HOLDING_CUSTOMERS, NON_HOLDING_CUSTOMERS]`   |
| Público (qualquer usuário)        | `[PUBLIC]`                                               |

The backend endpoint `GET /wiki/visibility/options` returns exactly which presets and
raw tags the **current user** is allowed to set, so the frontend can grey out or hide
presets that the user cannot assign (e.g. a partner user never sees `MYIO_INTERNAL`).

---

## Reference-level explanation

### Database schema

```sql
-- ── Pages ─────────────────────────────────────────────────────────────────
CREATE TABLE wiki_pages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  namespace          TEXT NOT NULL,
  slug               TEXT NOT NULL,
  title              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED')),
  current_revision_id UUID,   -- FK set after first revision insert
  tags               TEXT[] NOT NULL DEFAULT '{}',
  -- Audience tags that may read this page. Non-empty; array-overlap with the
  -- requesting user's effective audience set gates read access. See the
  -- "Visibility & audience scoping" section in Guide-level.
  visibility         TEXT[] NOT NULL DEFAULT ARRAY['TENANT_PRIVATE']
                     CHECK (
                       array_length(visibility, 1) >= 1
                       AND visibility <@ ARRAY[
                         'PUBLIC',
                         'MYIO_INTERNAL',
                         'PARTNERS',
                         'HOLDING_CUSTOMERS',
                         'NON_HOLDING_CUSTOMERS',
                         'TENANT_PRIVATE'
                       ]
                     ),
  frontmatter        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  UNIQUE (tenant_id, namespace, slug)
);

CREATE INDEX idx_wiki_pages_tenant_ns      ON wiki_pages (tenant_id, namespace);
CREATE INDEX idx_wiki_pages_tenant_status  ON wiki_pages (tenant_id, status);
CREATE INDEX idx_wiki_pages_tags           ON wiki_pages USING gin (tags);
CREATE INDEX idx_wiki_pages_visibility     ON wiki_pages USING gin (visibility);
CREATE INDEX idx_wiki_pages_frontmatter    ON wiki_pages USING gin (frontmatter);

-- ── Revisions (immutable) ────────────────────────────────────────────────
CREATE TABLE wiki_page_revisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision_number   INT  NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,           -- Markdown source
  body_html         TEXT NOT NULL,           -- server-rendered cache
  frontmatter       JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_note       TEXT,
  author_id         UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_tsv        tsvector,
  UNIQUE (page_id, revision_number)
);

CREATE INDEX idx_wiki_revisions_page       ON wiki_page_revisions (page_id, revision_number DESC);
CREATE INDEX idx_wiki_revisions_search_tsv ON wiki_page_revisions USING gin (search_tsv);

ALTER TABLE wiki_pages
  ADD CONSTRAINT fk_wiki_pages_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES wiki_page_revisions(id);

-- ── Entity links (extracted from page body at save time) ─────────────────
CREATE TABLE wiki_page_links (
  page_id       UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL
                CHECK (entity_type IN (
                  'device','customer','rule','asset',
                  'central','group','user','rfc'
                )),
  entity_id     UUID NOT NULL,
  PRIMARY KEY (page_id, entity_type, entity_id)
);

CREATE INDEX idx_wiki_links_entity ON wiki_page_links (entity_type, entity_id);

-- ── Attachments ──────────────────────────────────────────────────────────
CREATE TABLE wiki_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  byte_size       BIGINT NOT NULL,
  storage_key     TEXT NOT NULL,             -- S3 object key
  sha256          TEXT NOT NULL,
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_wiki_attachments_tenant ON wiki_attachments (tenant_id);

-- ── Attachment-Page association (many-to-many) ───────────────────────────
CREATE TABLE wiki_page_attachments (
  page_id       UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES wiki_attachments(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, attachment_id)
);

-- ── Namespaces (tenant-scoped) ───────────────────────────────────────────
CREATE TABLE wiki_namespaces (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  review_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);
```

**Trigger — keep `search_tsv` in sync:**

```sql
CREATE OR REPLACE FUNCTION wiki_revisions_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body,  '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wiki_revisions_tsv
  BEFORE INSERT OR UPDATE OF title, body ON wiki_page_revisions
  FOR EACH ROW EXECUTE FUNCTION wiki_revisions_tsv_update();
```

### TypeScript types

```typescript
export type WikiEntityType =
  | 'device' | 'customer' | 'rule' | 'asset'
  | 'central' | 'group' | 'user' | 'rfc';

export type WikiPageStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export type WikiAudience =
  | 'PUBLIC'
  | 'MYIO_INTERNAL'
  | 'PARTNERS'
  | 'HOLDING_CUSTOMERS'
  | 'NON_HOLDING_CUSTOMERS'
  | 'TENANT_PRIVATE';

export interface WikiPage {
  id: string;
  tenantId: string;
  namespace: string;
  slug: string;
  title: string;
  status: WikiPageStatus;
  currentRevisionId: string | null;
  tags: string[];
  visibility: WikiAudience[];   // non-empty; gates read access
  frontmatter: Record<string, unknown>;
  createdBy: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
  deletedAt: string | null;
}

export interface WikiRevision {
  id: string;
  pageId: string;
  revisionNumber: number;
  title: string;
  body: string;         // Markdown
  bodyHtml: string;     // rendered cache
  frontmatter: Record<string, unknown>;
  changeNote: string | null;
  authorId: string;
  createdAt: string;
}

export interface WikiPageLink {
  pageId: string;
  entityType: WikiEntityType;
  entityId: string;
}

export interface WikiAttachment {
  id: string;
  tenantId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
  deletedAt: string | null;
}

export interface WikiNamespace {
  tenantId: string;
  name: string;
  description: string | null;
  reviewRequired: boolean;
  createdAt: string;
}

// ── Request DTOs ──────────────────────────────────────────────────────────

export interface CreatePageRequest {
  namespace: string;
  slug: string;
  title: string;
  body: string;
  tags?: string[];
  visibility?: WikiAudience[];     // defaults to ['TENANT_PRIVATE']; must be non-empty
  frontmatter?: Record<string, unknown>;
  status?: 'DRAFT' | 'PUBLISHED';  // default DRAFT
}

export interface UpdatePageRequest {
  title?: string;
  body: string;                 // required — every save is a revision
  tags?: string[];
  visibility?: WikiAudience[];  // if present, replaces the existing set
  frontmatter?: Record<string, unknown>;
  changeNote?: string;
}

export interface MovePageRequest {
  namespace?: string;           // rename namespace
  slug?: string;                // rename slug
}

export interface PublishPageRequest {
  changeNote?: string;
}
```

### HTTP endpoints

All endpoints live under `/api/v1/wiki` and are tenant-scoped via `req.context.tenantId`.
All require JWT Bearer authentication. RBAC permissions follow the pattern
`wiki:<resource>:<action>`.

#### Pages

| Method | Path                                 | Permission            | Purpose |
|--------|--------------------------------------|-----------------------|---------|
| `POST` | `/pages`                             | `wiki.page.create`    | Create a new page (starts at `DRAFT` unless `status=PUBLISHED` and caller has `wiki.page.publish`) |
| `GET`  | `/pages`                             | `wiki.page.read`      | List pages. Query: `namespace`, `status`, `tag`, `q` (title prefix), `page`, `pageSize` |
| `GET`  | `/pages/:id`                         | `wiki.page.read`      | Fetch a page by UUID (includes current revision) |
| `GET`  | `/pages/by-slug/:namespace/:slug`    | `wiki.page.read`      | Fetch a page by canonical path |
| `PUT`  | `/pages/:id`                         | `wiki.page.update`    | Save a new revision. Body contains full markdown (not a diff) |
| `PATCH`| `/pages/:id/move`                    | `wiki.page.move`      | Rename namespace and/or slug |
| `POST` | `/pages/:id/publish`                 | `wiki.page.publish`   | Transition `DRAFT`/`REVIEW` → `PUBLISHED` |
| `POST` | `/pages/:id/archive`                 | `wiki.page.archive`   | Transition to `ARCHIVED` (stays readable) |
| `DELETE`| `/pages/:id`                        | `wiki.page.delete`    | Soft-delete (sets `deleted_at`) |

#### Revisions

| Method | Path                                         | Permission         | Purpose |
|--------|----------------------------------------------|--------------------|---------|
| `GET`  | `/pages/:id/revisions`                       | `wiki.page.read`   | List revisions (paginated, newest first) |
| `GET`  | `/pages/:id/revisions/:revisionNumber`       | `wiki.page.read`   | Fetch a specific revision |
| `GET`  | `/pages/:id/revisions/:a/diff/:b`            | `wiki.page.read`   | Unified-diff between two revisions |
| `POST` | `/pages/:id/revisions/:revisionNumber/rollback` | `wiki.page.update` | Create a new revision that copies the body of `:revisionNumber` |

#### Search and backlinks

| Method | Path                     | Permission         | Purpose |
|--------|--------------------------|--------------------|---------|
| `GET`  | `/search`                | `wiki.page.read`   | Full-text search. Query: `q`, `namespace`, `tags`, `status`, `page`, `pageSize` |
| `GET`  | `/backlinks`             | `wiki.page.read`   | Pages referencing an entity. Query: `entity=device:<uuid>` (repeatable) |

#### Attachments

| Method | Path                         | Permission              | Purpose |
|--------|------------------------------|-------------------------|---------|
| `POST` | `/attachments`               | `wiki.attachment.upload`| Multipart upload. Returns id + signed URL |
| `GET`  | `/attachments/:id`           | `wiki.attachment.read`  | Returns a short-lived signed URL for the binary |
| `DELETE`| `/attachments/:id`          | `wiki.attachment.delete`| Soft-delete (30d retention) |

#### Namespaces

| Method | Path                         | Permission              | Purpose |
|--------|------------------------------|-------------------------|---------|
| `GET`  | `/namespaces`                | `wiki.namespace.read`   | List namespaces in this tenant |
| `POST` | `/namespaces`                | `wiki.namespace.create` | Create a tenant namespace |
| `PATCH`| `/namespaces/:name`          | `wiki.namespace.update` | Update description / `reviewRequired` |
| `DELETE`| `/namespaces/:name`         | `wiki.namespace.delete` | Delete (only if empty) |

#### Visibility

| Method | Path                     | Permission            | Purpose |
|--------|--------------------------|-----------------------|---------|
| `GET`  | `/visibility/options`    | *(any authenticated)* | Returns the audience tags **and** named presets the current user is allowed to set. The frontend drives its visibility dropdown from this response — no hardcoded gating. |
| `GET`  | `/visibility/me`         | *(any authenticated)* | Returns the current user's **effective audience list** (derived server-side from JWT). Useful for debugging and for frontend to explain to a reader why they can/can't see a page. |

Example response — `GET /wiki/visibility/options`:

```json
{
  "allowedTags": ["TENANT_PRIVATE", "HOLDING_CUSTOMERS"],
  "presets": [
    { "id": "private",         "label": "Privado (apenas minha organização)", "tags": ["TENANT_PRIVATE"] },
    { "id": "holdingCustomers","label": "Somente clientes holding",           "tags": ["HOLDING_CUSTOMERS"] }
  ]
}
```

A MYIO-staff response would include all six tags and all presets (including `PUBLIC`
and `MYIO_INTERNAL`).

### Example — page create and read

**Request:**

```http
POST /api/v1/wiki/pages
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "namespace": "Runbooks",
  "slug": "chiller-overheating-moxuara",
  "title": "Chiller overheating — Moxuara",
  "tags": ["chiller", "moxuara", "runbook"],
  "visibility": ["TENANT_PRIVATE"],
  "frontmatter": {
    "owner": "ops@myio",
    "reviewDue": "2026-10-01"
  },
  "body": "# Chiller overheating at Moxuara\n\nCentral: @central:e982edf9-edb1-4aa6-8a14-4782465ae5a3\n\n## Symptoms\n\nTemperature on @device:f8117e90-c4da-4e47-bbc8-1e04dbe43331 exceeds 30 °C for > 10 min.\n\n## Diagnosis\n\n1. Verify calibration (see RFC-0028 — @rfc:28)\n2. Check rule thresholds on @rule:7c3f9e22-aaaa-bbbb-cccc-dddddddddddd\n3. If raw value is sane, inspect airflow...\n",
  "status": "PUBLISHED"
}
```

**Response — `201 Created`:**

```json
{
  "id": "9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "namespace": "Runbooks",
  "slug": "chiller-overheating-moxuara",
  "title": "Chiller overheating — Moxuara",
  "status": "PUBLISHED",
  "currentRevisionId": "aa11bb22-cc33-dd44-ee55-ff6677889900",
  "tags": ["chiller", "moxuara", "runbook"],
  "visibility": ["TENANT_PRIVATE"],
  "frontmatter": { "owner": "ops@myio", "reviewDue": "2026-10-01" },
  "createdBy": "3f9d29a0-b293-4da9-83e4-0e2bc38566c7",
  "createdAt": "2026-04-22T14:50:00Z",
  "updatedAt": "2026-04-22T14:50:00Z",
  "extractedLinks": [
    { "entityType": "central", "entityId": "e982edf9-edb1-4aa6-8a14-4782465ae5a3" },
    { "entityType": "device",  "entityId": "f8117e90-c4da-4e47-bbc8-1e04dbe43331" },
    { "entityType": "rfc",     "entityId": "28" },
    { "entityType": "rule",    "entityId": "7c3f9e22-aaaa-bbbb-cccc-dddddddddddd" }
  ]
}
```

**Backlinks query — "what pages reference this device?":**

```http
GET /api/v1/wiki/backlinks?entity=device:f8117e90-c4da-4e47-bbc8-1e04dbe43331
```

```json
{
  "data": [
    {
      "pageId": "9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      "namespace": "Runbooks",
      "slug": "chiller-overheating-moxuara",
      "title": "Chiller overheating — Moxuara",
      "updatedAt": "2026-04-22T14:50:00Z"
    }
  ],
  "total": 1
}
```

### Validation rules

- `namespace` — `^[A-Za-z][A-Za-z0-9_-]{0,31}$`
- `slug` — `^[a-z0-9][a-z0-9/_-]{0,127}$`; uniqueness enforced per `(tenant_id, namespace, slug)`
- `title` — 1..200 characters
- `body` — 0..512 KB (larger content should be linked, not embedded)
- `tags` — each tag 1..32 chars, max 20 tags per page
- `status` transitions validated server-side (no `ARCHIVED → PUBLISHED` skip; must go via `DRAFT`)
- On move: if the target `(namespace, slug)` already exists, reject with `409`
- Entity-link tokens — `@<type>:<uuid>` where `<type>` ∈ supported types; invalid tokens are left as plain text and not indexed

### Rendering pipeline

On page save:

1. Parse Markdown with `markdown-it` (CommonMark + GFM tables, task lists, strikethrough).
2. Custom rule: extract `@type:uuid` tokens → record in `wiki_page_links`; replace
   with a placeholder `<a class="wiki-entity-link" data-type="..." data-id="...">`.
3. Sanitize HTML with `DOMPurify` (server-side via JSDOM) — strict allowlist.
4. Store both the original Markdown (`body`) and rendered HTML (`body_html`) in
   the revision row. Clients read the HTML; editors read the Markdown.

On read (render-time entity resolution):

- For every `wiki-entity-link` placeholder in the cached HTML, the response
  middleware batches a lookup by `(entityType, entityId)` and rewrites the anchor
  to include the entity's current `displayName` and internal URL. Cached in
  Redis per tenant for 60s.

### Search ranking

```sql
SELECT
  p.id, p.namespace, p.slug, p.title,
  ts_rank_cd(r.search_tsv, q) AS rank,
  p.updated_at
FROM wiki_pages p
JOIN wiki_page_revisions r ON r.id = p.current_revision_id,
     plainto_tsquery('simple', $1) q
WHERE p.tenant_id = $2
  AND p.status    = 'PUBLISHED'
  AND p.deleted_at IS NULL
  AND r.search_tsv @@ q
ORDER BY rank DESC, p.updated_at DESC
LIMIT  $3
OFFSET $4;
```

### RBAC permissions (RFC-0002 compatible)

New permissions added to the policy registry:

```
wiki:page:{create,read,update,delete,publish,archive,move,review}
wiki.namespace.{create,read,update,delete}
wiki.attachment.{upload,read,delete}
wiki.visibility.{public,myio-internal,partners,holding-customers,non-holding-customers,tenant-private}
```

`wiki.visibility.<tag>` gates whether a user can **assign** that tag to a page's
`visibility` array on create or update. Reading a page is gated by the array-overlap
check between `page.visibility` and the user's effective audience list — not by a
permission check.

Default role mappings (subject to tenant override):

| Role                | Permissions (wiki) |
|---------------------|--------------------|
| `myio-admin`        | `wiki.*.*` (including all `wiki.visibility.*`) |
| `partner-admin`     | `wiki.page.{create,read,update,publish,archive,move}`, `wiki.attachment.*`, `wiki.visibility.{partners,tenant-private}` |
| `tenant-admin`      | `wiki.page.{create,read,update,publish,archive,move}`, `wiki.attachment.*`, `wiki.visibility.tenant-private` |
| `editor`            | `wiki.page.{create,read,update,publish,archive,move}`, `wiki.attachment.*`, `wiki.visibility.tenant-private` |
| `reviewer`          | `wiki.page.{read,review,publish}`, `wiki.attachment.read` |
| `viewer`            | `wiki.page.read`, `wiki.namespace.read`, `wiki.attachment.read` |

Setting `HOLDING_CUSTOMERS` or `NON_HOLDING_CUSTOMERS` on a page — i.e., publishing
across tenants — requires `myio-admin`, since only MYIO staff operate on the platform-wide
audience model.

Namespace-level ACLs (phase 2) can narrow `wiki:page:*` to a subset of namespaces
via policy conditions — reusing the existing policy engine, no new code path.

---

## Drawbacks

- **Maintenance surface grows.** A wiki is a long-lived product feature, not a
  one-off module; search quality, editor UX, and import/export will require
  ongoing investment.
- **Rendering pipeline is a security-sensitive boundary.** Markdown → HTML with
  user-uploaded images is a classic XSS vector; requires a sanitiser kept
  up-to-date.
- **Search in PostgreSQL `tsvector` is "good enough"**, not best-in-class.
  Cross-language stemming, fuzzy matching, and typo tolerance are weak compared
  to a dedicated engine (Elasticsearch, Meilisearch, Typesense). Migrating later
  is possible but not free.
- **Inline entity tokens (`@type:uuid`) are non-standard Markdown.** Copy-pasting
  wiki content into other tools degrades gracefully (tokens become plain text)
  but loses the live-link behaviour.
- **Tenant storage growth.** Revisions are immutable; busy tenants accumulate
  rows fast. Mitigation: revision pruning policy per namespace (keep last N,
  or last M days), not implemented in v1.

---

## Alternatives considered

### Embed an existing wiki (Wiki.js, Outline, BookStack)

Fastest path to a working wiki. Rejected for v1 because none of these integrate
with GCDR's tenant/RBAC model or know how to link to devices/rules. Running one
alongside GCDR moves the integration cost to "keep users and tenants in sync",
which is worse than building native.

**Revisit if:** v1 scope slips, or if the product needs advanced features
(real-time collaborative editing, heavy enterprise-style workflows) that would
be expensive to build.

### Store pages as Git-backed Markdown in a repo

Appeals to engineering taste but fails the user base: non-engineers cannot use
Git. Keeps documentation hidden from operations and support, which is the
problem we are trying to solve.

### One giant `wiki_content` JSONB column per page (no revisions table)

Simpler schema. Rejected because the revision table is the point — immutable
history, rollback, and author attribution depend on it. Storing an array of
revisions in JSONB would grow unbounded and kill query performance.

### Elasticsearch from day one

Over-engineered for v1. PostgreSQL full-text search handles the expected
volume (thousands of pages per tenant, not millions) comfortably. If search
quality becomes the bottleneck, swap in a dedicated engine behind the same
`/search` endpoint — the API contract is engine-agnostic.

### Polymorphic "any entity" links via `(entity_type TEXT, entity_id TEXT)` without a check constraint

Rejected: without the `CHECK` constraint, typos in `entity_type` silently break
backlinks. An enum-like check is cheap and self-documenting.

### Real-time collaborative editing (CRDT / OT)

Explicitly out of scope for v1. Last-write-wins with a revision per save is
sufficient for the target use case (runbooks, decision logs, onboarding docs —
not live co-authoring). Can be layered on later with Yjs or Automerge without
schema changes, because each save already produces a discrete revision.

---

## Resolved decisions

- **Markdown, not HTML, as the source of truth.** Predictable, portable,
  diffable.
- **One revision per save.** No auto-saving background drafts into the revisions
  table; a client-side draft buffer is the UI's responsibility.
- **Soft deletes everywhere.** `deleted_at` on pages and attachments; actual
  purge is a scheduled job outside the request path.
- **Entity tokens are `@type:uuid`**, not wikilinks like `[[device:uuid]]`.
  Rationale: `@type:uuid` is unambiguous, shell-safe, and easy to grep.
- **Attachments live in S3**, not in the database. DB only holds metadata.
- **Search index is `simple`-language `tsvector`.** Portuguese/English blend in
  MYIO content makes language-specific stemming more harmful than helpful for v1.

---

## Unresolved questions

- **Per-page ACLs beyond namespace-level.** Do we need "this specific page is
  visible only to users X and Y"? Push to phase 2 unless a concrete customer
  requirement emerges.
- **Page templates.** Should tenants define a template for `Runbooks/*` that
  pre-fills `frontmatter` and section skeleton? Likely yes, but not blocking.
- **Internationalisation of content.** One page per locale vs. a `translations`
  array on the revision. Deferred.
- **Export / import format.** Zip of Markdown + `manifest.json` vs. a single
  JSON dump. Probably Zip + manifest, to match common wiki export conventions.
- **Editor choice.** TipTap (ProseMirror-based) vs. Milkdown vs. CodeMirror
  Markdown mode. Frontend call, not blocking for backend schema.
- **Quota / rate limits.** Per-tenant storage and revision-write limits. Needs
  product input.

---

## Implementation plan

Phased delivery; each phase is independently shippable.

### Phase 1 — Pages, revisions, and visibility (backend skeleton)

- Migration: `wiki_pages` (with `visibility` column), `wiki_page_revisions`, `wiki_namespaces`, indexes.
- Controllers: `POST/GET/PUT/DELETE /pages`, `GET /pages/:id/revisions`, `GET /visibility/options`, `GET /visibility/me`.
- Services: page create/update/move/publish/archive; revision list; audience resolver that computes `effectiveAudiences` from JWT claims + customer lookup.
- Repositories: Drizzle implementations; tenant scoping **and** `visibility && effectiveAudiences` filter enforced at the repo layer.
- RBAC: register `wiki:page:*`, `wiki.namespace.*`, `wiki:visibility:*`.
- Unit + integration tests for happy paths, status transitions, and visibility enforcement (user with each customer-type sees exactly the pages they should).
- OpenAPI spec under `docs/openapi.yaml`.

### Phase 2 — Rendering, entity links, backlinks

- Server-side Markdown → HTML with `markdown-it` + `DOMPurify`.
- Custom parser rule for `@type:uuid` tokens; populate `wiki_page_links`.
- `GET /backlinks` endpoint with entity-type/id filter.
- Entity-name resolution middleware with Redis cache.

### Phase 3 — Search

- Trigger on `wiki_page_revisions` maintaining `search_tsv`.
- `GET /search` with `q`, `namespace`, `tags`, `status`.
- Ranking tests with seed fixtures.

### Phase 4 — Attachments

- `wiki_attachments`, `wiki_page_attachments`.
- `POST /attachments` (multipart) → S3; returns signed URL.
- Soft-delete + 30-day purge job.
- Integration with page render: replace `/wiki/attachments/<id>` with signed
  URLs at response time.

### Phase 5 — Review workflow (opt-in)

- `wiki_namespaces.review_required` flag.
- Status `REVIEW`; `POST /pages/:id/publish` gated by `wiki.page.review`.
- Notifications via the existing notification-contacts pipeline (RFC-0025).

### Phase 6 — Frontend editor

- TipTap-based Markdown editor with a custom node for `@entity` autocomplete
  (search devices/rules/customers from GCDR as you type).
- Revision history panel with unified-diff viewer.
- Backlinks panel on entity detail screens (devices, rules, customers).

---

## Appendix — directory layout

```
src/
├─ controllers/
│  └─ wiki/
│     ├─ pages.controller.ts
│     ├─ revisions.controller.ts
│     ├─ search.controller.ts
│     ├─ backlinks.controller.ts
│     ├─ attachments.controller.ts
│     └─ namespaces.controller.ts
├─ services/
│  └─ wiki/
│     ├─ pages.service.ts
│     ├─ revisions.service.ts
│     ├─ search.service.ts
│     ├─ links-extractor.service.ts
│     ├─ renderer.service.ts
│     └─ attachments.service.ts
├─ repositories/
│  └─ wiki/
│     ├─ pages.repo.ts
│     ├─ revisions.repo.ts
│     ├─ links.repo.ts
│     ├─ attachments.repo.ts
│     └─ namespaces.repo.ts
├─ dto/
│  ├─ request/wiki/
│  └─ response/wiki/
└─ infrastructure/
   └─ database/drizzle/migrations/0018_wiki_module.sql
```
