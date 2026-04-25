# RFC-0031 — Wiki Engagement, Export and Admin Dashboard

- **Status:** Draft
- **Created:** 2026-04-25
- **Author:** MYIO Engineering
- **Domain:** Knowledge Base / Engagement / Reporting
- **Builds on:** [RFC-0030 — MYIO Wiki](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)

## Companion documents

- [RFC-0030 — MYIO Wiki (Knowledge Base Module)](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)
- [RFC-0030 — S3 Bucket Setup](./RFC-0030-S3-Bucket-Setup.md) (PDF artefacts share the same bucket prefix layout)
- [RFC-0025 — User Notification Contacts](./RFC-0025-User-Notification-Contacts.md) (downstream of v2 notification dispatch)

---

## Why this matters

A wiki without engagement is a write-only graveyard. The RFC-0030 reader shipped
in Phase 1+2 lets people consume institutional knowledge — but gives no signal
about **what is read, what is broken, what is loved, and who is reading**.
Without that signal, the editorial team can't:

- Tell which runbooks are still load-bearing vs. abandoned (no view metrics).
- Detect stale or wrong content before it causes an incident (no bug-report inbox).
- Understand which customers are self-serving via the wiki vs. paging support
  (no per-customer engagement breakdown).
- Deliver a polished offline artefact when a partner asks for "the docs as a PDF"
  before a kickoff meeting (no export pipeline).

Engagement features exist in every mature wiki product (Notion, Confluence,
GitHub Wikis, MediaWiki) and they exist *because* the feedback loop they create
is what keeps content honest. MYIO's wiki has the structural advantage of being
inside GCDR (cross-linked to devices, rules, customers) — adding the engagement
loop turns it from a documentation site into an **operational instrument**:

- A bug report on a chiller-overheating runbook becomes an actionable ticket
  routed to the page owner, with severity-aware escalation.
- View metrics segmented by customer-type expose where the documentation gap is
  for partners vs. holding customers, informing roadmap.
- A "download as Premium MYIO PDF" button gives sales and CSMs a polished,
  branded artefact they can drop in an email or print for an executive meeting.

This is the formalisation of behaviour the wiki *will* generate as soon as
people start using it, brought into the right place with structured storage,
auditability, and admin tooling.

---

## Summary

Adds three orthogonal feature blocks to the existing wiki module:

1. **Engagement** — anonymous-tolerant views and likes, authenticated-only
   threaded comments (1 level deep) and bug reports.
2. **Export** — server-side PDF generation in a "Premium MYIO" branded format
   via a Gotenberg sidecar; per-revision cached in S3.
3. **Admin dashboard** — read-side endpoints aggregating views/likes/comments/
   downloads across pages, users, customers and customer-types; full bug-report
   workflow (8 statuses) with immutable history and assignment.

All counters are denormalized on `wiki_pages` for cheap reads and kept in sync
via triggers; per-grain detail lives in dedicated tables. Heavy aggregations
(top users, top customers) use materialized views refreshed hourly.

---

## Motivation

Each block answers a distinct operational pain:

**Engagement**

- Today operators have no way to flag "this runbook is wrong" without grabbing
  an engineer in Slack. A first-class bug-report inbox closes that loop.
- Editorial decisions (deprecate vs. update vs. expand) need usage data.
- Comments enable async collaboration on runbooks, decision logs, and onboarding
  pages without spinning up tickets in another system.

**Export**

- Partners and customers regularly ask for "the docs as a PDF" — currently a
  manual screenshot+Word-doc operation that takes hours and looks unbranded.
- A Premium MYIO PDF (cover, watermark, page numbers, brand fonts) is a
  marketing artefact in its own right.
- Caching by revision id means the second download of an unchanged page is
  ~10ms, not the 2-3 seconds of fresh Chromium rendering.

**Admin dashboard**

- The wiki team needs to triage bug reports — open, in-progress, duplicate,
  backlog, resolved, won't-fix — with a transition log for accountability.
- Product needs to know which customer segments engage with the docs, to
  prioritise content that drives self-service.
- Support leadership needs to identify high-traffic pages whose stale-ness
  would cause many incidents.

---

## Guide-level explanation

### Concepts

#### View

A **view** records that a user (or anonymous visitor) opened a page. The grain
is one row per `(page_id, user_id, viewed_on)` — i.e. multiple opens by the
same user on the same day collapse into one row with an incremented counter.
Anonymous visitors are tracked by an opaque visitor token (cookie + IP-hash)
to prevent log explosion while still distinguishing "10 unique anon visitors"
from "1 visitor refreshing 10 times".

| Field | Meaning |
|---|---|
| `page_id`     | Which page |
| `user_id`     | Authenticated user (nullable for anonymous) |
| `visitor_token` | Stable opaque hash for anonymous visitors (nullable when user_id is set) |
| `viewed_on`   | UTC date (no time component — bucketed by day) |
| `view_count`  | Number of opens in that day-bucket |

Reads-side counter `wiki_pages.view_count` is the integer sum kept fresh by trigger.

#### Like

A **like** is a binary signal — toggle on, toggle off. One row per
`(page_id, user_id)` for authenticated users; one row per
`(page_id, visitor_token)` for anonymous. Anonymous likes are intentionally
allowed because the goal is signal, not voting integrity.

`wiki_pages.like_count` is denormalized via trigger.

#### Comment

A **comment** is a Markdown body attached to a page, optionally as a reply to
another comment (`parent_comment_id`). Threading is **1 level deep** in the UI:
top-level comments form a timeline; replies attach to a top-level comment but
do not nest further (they appear in the same column as their parent).
Schema-wise the structure supports unbounded depth, so future evolution to
N-level threading does not require a migration.

| State | Meaning |
|---|---|
| `VISIBLE`   | Default state |
| `HIDDEN`    | Soft-moderated; invisible to non-admins, recoverable |
| `DELETED`   | Author deleted; body cleared, row kept for audit |

Editing produces an `edited_at` timestamp; the `body` is replaced in-place
(comments do not have revision history — they are conversation, not record).
Authentication is required to comment.

#### Bug report

A **bug report** is a structured complaint about a specific page (and
typically a specific revision). The author selects a category and severity;
the wiki admin team triages and tracks resolution. Authentication is required.

Lifecycle:

```
OPEN ──┬─▶ TRIAGED ──┬─▶ IN_PROGRESS ──▶ RESOLVED
       │             ├─▶ IN_BACKLOG ──▶ IN_PROGRESS
       │             └─▶ DUPLICATE (closes; see duplicate_of)
       ├─▶ WONTFIX
       └─▶ ARCHIVED  (soft-hide; recoverable)
```

Each transition is recorded in `wiki_bug_report_history` with the actor, old
state, new state, and an optional note. This enables accountability and
post-mortem-style analysis.

#### PDF render

A **PDF render** is an immutable artefact for `(page_id, revision_number, format)`.
The first download triggers an async job; subsequent downloads of the same
combination return the cached artefact from S3 via a signed URL. The format
field is forward-compatible — additional templates can be added without
schema change (e.g. `PREMIUM_MYIO_V2`, `INTERNAL_REPORT_V1`).

The Premium MYIO format includes:

- **Cover page** with MYIO logo, page title, namespace, last-updated date,
  author, and revision hash.
- **Page header** on every printed page: `MYIO Wiki — {namespace}/{slug}`.
- **Page footer**: `Page X of Y · revision #N · gcdr-server.apps.myio-bas.com`.
- **Diagonal watermark "CONFIDENTIAL"** when the page's `visibility` is a
  subset of `{MYIO_INTERNAL, TENANT_PRIVATE}`.
- **Branded typography** (TBD final font) and code-block syntax highlighting.

#### Admin dashboard

The dashboard is **read-side only** — it does not introduce write endpoints
beyond bug-report triage. It exposes:

- **Overview**: global counters (pages, views, likes, comments, open bugs,
  downloads) with an optional date window.
- **Top pages** by views / likes / comments / bugs / downloads.
- **Top users** by view count / comment count / like count.
- **Top customers** — count of distinct users from each customer engaging
  with the wiki, ordered descending.
- **Top profiles** — break down engagement by `users.type` (`INTERNAL`,
  `CUSTOMER`, `PARTNER`) and dominant `role-key`.
- **Timeline** — daily/weekly/monthly time series for any metric, suitable
  for charting.
- **Bug-report management** — filter by status/severity/assignee, transition
  states, view full history.

---

## Reference-level explanation

### Database schema

```sql
-- =============================================================================
-- ENGAGEMENT
-- =============================================================================

CREATE TABLE wiki_page_views (
  page_id        UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  user_id        UUID,
  visitor_token  TEXT,
  viewed_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  view_count     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT wiki_page_views_anon_or_user
    CHECK (user_id IS NOT NULL OR visitor_token IS NOT NULL),
  CONSTRAINT wiki_page_views_pk
    PRIMARY KEY (page_id, COALESCE(user_id::text, ''), COALESCE(visitor_token, ''), viewed_on)
);

CREATE INDEX idx_wiki_views_user      ON wiki_page_views (user_id, viewed_on DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_wiki_views_page_date ON wiki_page_views (page_id, viewed_on);

CREATE TABLE wiki_page_likes (
  page_id        UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  user_id        UUID,
  visitor_token  TEXT,
  liked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wiki_page_likes_anon_or_user
    CHECK (user_id IS NOT NULL OR visitor_token IS NOT NULL),
  CONSTRAINT wiki_page_likes_pk
    PRIMARY KEY (page_id, COALESCE(user_id::text, ''), COALESCE(visitor_token, ''))
);

CREATE INDEX idx_wiki_likes_user ON wiki_page_likes (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE wiki_page_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  page_id             UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  parent_comment_id   UUID REFERENCES wiki_page_comments(id),
  author_id           UUID NOT NULL,
  body                TEXT NOT NULL,
  body_html           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'VISIBLE'
                      CHECK (status IN ('VISIBLE','HIDDEN','DELETED')),
  edited_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_tsv          tsvector
);

CREATE INDEX idx_wiki_comments_page    ON wiki_page_comments (page_id, created_at);
CREATE INDEX idx_wiki_comments_parent  ON wiki_page_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX idx_wiki_comments_author  ON wiki_page_comments (author_id, created_at);
CREATE INDEX idx_wiki_comments_search  ON wiki_page_comments USING gin (search_tsv);

-- =============================================================================
-- BUG REPORTS
-- =============================================================================

CREATE TABLE wiki_page_bug_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  page_id         UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision_id     UUID REFERENCES wiki_page_revisions(id),
  reporter_id     UUID NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'MEDIUM'
                  CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  category        TEXT NOT NULL
                  CHECK (category IN ('TYPO','BROKEN_LINK','FACTUAL','OUTDATED','SECURITY','OTHER')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','TRIAGED','IN_PROGRESS','IN_BACKLOG',
                                    'DUPLICATE','RESOLVED','WONTFIX','ARCHIVED')),
  duplicate_of    UUID REFERENCES wiki_page_bug_reports(id),
  assigned_to     UUID,
  resolution_note TEXT,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bug_reports_tenant_status ON wiki_page_bug_reports (tenant_id, status);
CREATE INDEX idx_bug_reports_page          ON wiki_page_bug_reports (page_id);
CREATE INDEX idx_bug_reports_severity      ON wiki_page_bug_reports (tenant_id, severity);
CREATE INDEX idx_bug_reports_assigned      ON wiki_page_bug_reports (tenant_id, assigned_to)
  WHERE status IN ('OPEN','TRIAGED','IN_PROGRESS');

CREATE TABLE wiki_bug_report_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id  UUID NOT NULL REFERENCES wiki_page_bug_reports(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  field_changes  JSONB,
  changed_by     UUID NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT
);

CREATE INDEX idx_bug_report_history_bug ON wiki_bug_report_history (bug_report_id, changed_at DESC);

-- =============================================================================
-- PDF RENDERS (cached)
-- =============================================================================

CREATE TABLE wiki_page_pdf_renders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  page_id         UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  format          TEXT NOT NULL DEFAULT 'PREMIUM_MYIO_V1'
                  CHECK (format IN ('PREMIUM_MYIO_V1')),
  storage_key     TEXT,
  byte_size       BIGINT,
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','RENDERING','READY','FAILED')),
  rendered_at     TIMESTAMPTZ,
  rendered_by     UUID,
  download_count  BIGINT NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wiki_pdf_uniq UNIQUE (page_id, revision_number, format)
);

CREATE INDEX idx_wiki_pdf_status ON wiki_page_pdf_renders (status, created_at);

-- =============================================================================
-- DENORMALIZED COUNTERS ON wiki_pages
-- =============================================================================

ALTER TABLE wiki_pages
  ADD COLUMN view_count             BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN like_count             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN comment_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bug_report_open_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN download_count         BIGINT  NOT NULL DEFAULT 0;
```

**Triggers** keep the denormalized counters in sync:

```sql
-- Example: like counter
CREATE FUNCTION wiki_pages_like_counter() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE wiki_pages SET like_count = like_count + 1 WHERE id = NEW.page_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE wiki_pages SET like_count = like_count - 1 WHERE id = OLD.page_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wiki_likes_count
  AFTER INSERT OR DELETE ON wiki_page_likes
  FOR EACH ROW EXECUTE FUNCTION wiki_pages_like_counter();
```

Analogous triggers exist for views (sums `view_count` deltas), comments
(`status = 'VISIBLE'` only), bug reports (status changes affect
`bug_report_open_count`), and PDF download (`download_count` increments
when status reaches `READY` and a download is served).

### Materialized views for admin metrics

```sql
CREATE MATERIALIZED VIEW wiki_metrics_user_engagement AS
SELECT
  v.user_id,
  u.email,
  u.type           AS user_type,
  u.customer_id,
  c.name           AS customer_name,
  c.type           AS customer_type,
  SUM(v.view_count) AS total_views,
  COUNT(DISTINCT v.page_id) AS distinct_pages_viewed,
  MAX(v.viewed_on) AS last_viewed_on
FROM wiki_page_views v
LEFT JOIN users u     ON u.id = v.user_id
LEFT JOIN customers c ON c.id = u.customer_id
WHERE v.user_id IS NOT NULL
GROUP BY v.user_id, u.email, u.type, u.customer_id, c.name, c.type;

CREATE INDEX idx_user_engagement_views ON wiki_metrics_user_engagement (total_views DESC);

CREATE MATERIALIZED VIEW wiki_metrics_customer_engagement AS
SELECT
  c.id           AS customer_id,
  c.name         AS customer_name,
  c.type         AS customer_type,
  COUNT(DISTINCT u.id)              AS distinct_users,
  COALESCE(SUM(v.view_count), 0)    AS total_views,
  COUNT(DISTINCT v.page_id)         AS distinct_pages_viewed
FROM customers c
LEFT JOIN users u            ON u.customer_id = c.id
LEFT JOIN wiki_page_views v  ON v.user_id = u.id
GROUP BY c.id, c.name, c.type;

CREATE INDEX idx_customer_engagement_views ON wiki_metrics_customer_engagement (total_views DESC);
```

A scheduled job (cron / pg_cron) refreshes both hourly:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY wiki_metrics_user_engagement;
REFRESH MATERIALIZED VIEW CONCURRENTLY wiki_metrics_customer_engagement;
```

`CONCURRENTLY` allows refreshes without blocking dashboard queries; requires
unique indexes on the views.

### TypeScript types (highlights)

```typescript
export type WikiBugReportStatus =
  | 'OPEN' | 'TRIAGED' | 'IN_PROGRESS' | 'IN_BACKLOG'
  | 'DUPLICATE' | 'RESOLVED' | 'WONTFIX' | 'ARCHIVED';

export type WikiBugReportSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type WikiBugReportCategory =
  | 'TYPO' | 'BROKEN_LINK' | 'FACTUAL' | 'OUTDATED' | 'SECURITY' | 'OTHER';

export type WikiCommentStatus = 'VISIBLE' | 'HIDDEN' | 'DELETED';

export type WikiPdfFormat = 'PREMIUM_MYIO_V1';
export type WikiPdfStatus = 'PENDING' | 'RENDERING' | 'READY' | 'FAILED';

export interface WikiPageView {
  pageId: string;
  userId: string | null;
  visitorToken: string | null;
  viewedOn: string;       // YYYY-MM-DD
  viewCount: number;
}

export interface WikiPageLike {
  pageId: string;
  userId: string | null;
  visitorToken: string | null;
  likedAt: string;
}

export interface WikiPageComment {
  id: string;
  tenantId: string;
  pageId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  bodyHtml: string;
  status: WikiCommentStatus;
  editedAt: string | null;
  createdAt: string;
}

export interface WikiBugReport {
  id: string;
  tenantId: string;
  pageId: string;
  revisionId: string | null;
  reporterId: string;
  severity: WikiBugReportSeverity;
  category: WikiBugReportCategory;
  title: string;
  description: string;
  status: WikiBugReportStatus;
  duplicateOf: string | null;
  assignedTo: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiBugReportHistoryEntry {
  id: string;
  bugReportId: string;
  fromStatus: WikiBugReportStatus | null;
  toStatus: WikiBugReportStatus;
  fieldChanges: Record<string, { from: unknown; to: unknown }>;
  changedBy: string;
  changedAt: string;
  note: string | null;
}

export interface WikiPdfRender {
  id: string;
  pageId: string;
  revisionNumber: number;
  format: WikiPdfFormat;
  storageKey: string | null;
  status: WikiPdfStatus;
  renderedAt: string | null;
  downloadCount: number;
  errorMessage: string | null;
}
```

### HTTP endpoints

#### Engagement (mounted under `/api/v1/wiki` and `/api/v1/public/wiki`)

| Method | Path                                  | Auth      | Permission |
|--------|---------------------------------------|-----------|------------|
| `POST` | `/pages/:id/views`                    | hybrid    | none (anon ok) |
| `POST` | `/pages/:id/likes`                    | hybrid    | `wiki.like.toggle` (auth users); anon allowed via session token |
| `DELETE` | `/pages/:id/likes`                  | hybrid    | same |
| `GET`  | `/pages/:id/comments`                 | hybrid    | `wiki.page.read` |
| `POST` | `/pages/:id/comments`                 | required  | `wiki.comment.create` |
| `PUT`  | `/comments/:id`                       | required  | author or `wiki.comment.moderate` |
| `DELETE` | `/comments/:id`                     | required  | author or `wiki.comment.moderate` |
| `POST` | `/pages/:id/bug-reports`              | required  | `wiki.bug-report.create` |
| `GET`  | `/pages/:id/bug-reports`              | required  | `wiki.bug-report.list` |

#### Export

| Method | Path                                                | Auth     | Behaviour |
|--------|-----------------------------------------------------|----------|-----------|
| `GET`  | `/pages/:id/pdf?format=PREMIUM_MYIO_V1`             | required | `200` if cached → signed S3 URL; `202` + `Location` header if rendering; `503` if Gotenberg unreachable |
| `GET`  | `/public/wiki/pages/:id/pdf?format=PREMIUM_MYIO_V1` | none     | only if page is `PUBLIC` + `PUBLISHED` |
| `POST` | `/admin/pdf/regenerate`                             | required | `wiki.admin.pdf.regenerate` — invalidates a render and re-queues |

#### Admin

| Method  | Path                                              | Permission |
|---------|---------------------------------------------------|------------|
| `GET`   | `/admin/wiki/metrics/overview`                    | `wiki.admin.read` |
| `GET`   | `/admin/wiki/metrics/pages/top?metric=`           | `wiki.admin.read` |
| `GET`   | `/admin/wiki/metrics/users/top?metric=`           | `wiki.admin.read` |
| `GET`   | `/admin/wiki/metrics/customers/top`               | `wiki.admin.read` |
| `GET`   | `/admin/wiki/metrics/profiles/top`                | `wiki.admin.read` |
| `GET`   | `/admin/wiki/metrics/timeline?metric=&granularity=` | `wiki.admin.read` |
| `GET`   | `/admin/wiki/bug-reports`                         | `wiki.admin.bug-report.read` |
| `GET`   | `/admin/wiki/bug-reports/:id`                     | `wiki.admin.bug-report.read` |
| `PATCH` | `/admin/wiki/bug-reports/:id`                     | `wiki.admin.bug-report.manage` |
| `GET`   | `/admin/wiki/bug-reports/:id/history`             | `wiki.admin.bug-report.read` |

#### Example — top customers by engagement

```http
GET /api/v1/admin/wiki/metrics/customers/top?limit=10&from=2026-04-01&to=2026-04-30
Authorization: Bearer <jwt>
```

```json
{
  "data": [
    {
      "customerId": "84e0370e-...",
      "customerName": "Moxuara",
      "customerType": "HOLDING",
      "distinctUsers": 14,
      "totalViews": 1284,
      "distinctPagesViewed": 47
    },
    {
      "customerId": "33333333-...",
      "customerName": "ACME Tech",
      "customerType": "COMPANY",
      "distinctUsers": 8,
      "totalViews": 612,
      "distinctPagesViewed": 22
    }
  ],
  "meta": {
    "total": 24,
    "from": "2026-04-01",
    "to": "2026-04-30",
    "asOf": "2026-04-25T14:32:00Z",
    "matViewLastRefreshedAt": "2026-04-25T14:00:00Z"
  }
}
```

### PDF rendering pipeline

```
Client ──GET /pages/:id/pdf?format=PREMIUM_MYIO_V1──┐
                                                     │
       ┌─────────────────────────────────────────────┘
       ▼
┌────────────────────────────────────────────────────────┐
│ 1. lookup wiki_page_pdf_renders(pageId, currentRev,    │
│    format)                                              │
│                                                         │
│    READY     → 200 { downloadUrl: signedS3Url(...) }   │
│                + UPDATE download_count = +1             │
│    PENDING   → 202 { Location: same URL, retryAfter }  │
│    RENDERING → 202 same                                 │
│    not exist → INSERT row(status=PENDING),              │
│                 enqueue BullMQ job, return 202          │
│    FAILED    → 503 { reason }; admin can re-queue      │
└────────────────────────────────────────────────────────┘

BullMQ worker (sidecar):
  1. fetch page + currentRevision from Postgres
  2. server-side render Markdown → HTML via the same
     pipeline used by /pages/:id (markdown-it + DOMPurify
     + entity-resolution)
  3. wrap in Premium MYIO HTML template:
     - cover with logo, title, namespace, revision hash
     - injected CSS (print, watermark, brand fonts)
     - header/footer placeholders for Gotenberg's
       chromium options
  4. POST html, header, footer to Gotenberg:
        POST {GOTENBERG_URL}/forms/chromium/convert/html
  5. stream PDF response to S3:
        wiki/pdf/<tenant>/<page_id>/v<n>/<sha256>.pdf
  6. UPDATE wiki_page_pdf_renders SET
        status='READY', storage_key=..., byte_size=...,
        sha256=..., rendered_at=now()
```

### RBAC permissions added

```
wiki.like.toggle
wiki.comment.{create,update,delete,moderate}
wiki.bug-report.{create,list}
wiki.admin.read
wiki.admin.pdf.regenerate
wiki.admin.bug-report.{read,manage}
```

Default role mappings (extending the seed from RFC-0030):

| Role               | New permissions added |
|--------------------|------------------------|
| `viewer`           | `wiki.like.toggle` |
| `editor`           | + `wiki.comment.{create,update,delete}`, `wiki.bug-report.create` |
| `reviewer`         | + `wiki.comment.moderate`, `wiki.bug-report.list` |
| `myio-admin`       | + `wiki.admin.*` (all) |

---

## Drawbacks

- **Counter triggers add write amplification.** Every view/like/comment/bug
  insert touches `wiki_pages`. For a hot page receiving 10k views/day this is
  10k row updates on the parent — acceptable at MYIO's expected scale, but
  watch for lock contention if a single page becomes pathologically popular.
  Mitigation: bucket views into per-day rows (already in design) so the parent
  is updated at most once per (user, day) on the *first* view of the day.
- **Gotenberg sidecar is operational surface.** Container to monitor, RAM
  budget to enforce, version pin to maintain. Well-known component, low
  ongoing cost, but it is real.
- **Materialized views are eventually consistent.** Hourly refresh means the
  dashboard shows data up to 60 minutes stale. Acceptable for product/editorial
  decisions; not acceptable for billing or compliance — but those aren't users
  of this dashboard.
- **PDF artefacts grow storage.** A 50k-page wiki with 5 revisions each, all
  exported, is 250k PDFs. Lifecycle rules (delete renders for revisions > 50
  back) keep this bounded — but the rule must be active.
- **Bug-report inbox can rot.** Without owner notification (deferred to v2),
  reports might pile up unnoticed. v1 mitigation: dashboard prominently
  surfaces `bug_report_open_count` per page so editors can drive the queue.

---

## Alternatives considered

### Per-view rows (no day bucketing)

Trivially simple, gives true unique-visitor count over arbitrary windows. Rejected because a moderately active wiki (10k views/day, 1k pages, retained 365 days) produces 3.6M rows/year — manageable but already meaningful, and the day-bucket approach gives 90%+ of the analytics value at 5% of the row count.

### Anonymous likes via cookie alone (no IP-hash)

Easier to implement; users in incognito or with cookie-clearing browsers vote multiple times. Acceptable risk for like-as-signal (not voting). The `visitor_token` design uses `hash(IP + day-rotated salt + cookie)` to deduplicate without storing PII. Cookie-only would be simpler; the IP component is added insurance.

### Comments threaded N-levels (Reddit style)

True tree, materialized path or recursive CTE. Rejected for v1 — the schema accepts it (parent_comment_id), but the UI complexity (collapse/expand, indent guides, "view more replies" pagination) is a multi-week project that the use case (operational discussion on runbooks) doesn't need.

### Comments flat (no threading at all)

Schema-trivial. Rejected because the cost of `parent_comment_id` is one nullable column and one index; locking out replies forever is a worse product decision.

### Embed Puppeteer in the API process

Skip the sidecar. Rejected — Chromium crashes propagate to the API process; memory leaks are a known Puppeteer issue; security profile is worse (Chromium runs as root in the API container by default).

### WeasyPrint instead of Gotenberg

Smaller footprint (~200MB vs ~600MB). Rejected because WeasyPrint cannot execute JavaScript and has limited modern CSS support — fine for static prose, problematic the moment a wiki page contains a chart, embedded SVG with classes, or any third-party widget.

### Counter columns on `wiki_pages` skipped — compute on read

Avoid trigger maintenance. Rejected because the dashboard would `SELECT count(*) FROM wiki_page_views WHERE page_id = ?` on every list endpoint, and per-page metrics on a 1k-page list become 1k count queries (or one expensive aggregate). Triggers cost milliseconds on insert; saving them on read is wrong by an order of magnitude.

### No materialized views — query live

For each "top users / customers" call, re-aggregate on the fly. Rejected — a `GROUP BY user_id` over `wiki_page_views` joined with `users` and `customers` is a multi-second query at 10M rows. Materialized view + hourly refresh keeps the dashboard responsive without exposing application code to the aggregation cost.

---

## Resolved decisions

- **Anonymous engagement**: views and likes accept anonymous (visitor_token); comments and bug reports require authentication.
- **Comment threading**: 1 level deep in v1; schema supports unbounded.
- **PDF backend**: Gotenberg via Docker sidecar in the same Dokploy stack.
- **Notification delivery**: in-app counters in v1; RFC-0025 wiring in v2.
- **Bug report severity → owner alerting**: deferred to v2 alongside notification dispatch.
- **PDF cache invalidation**: implicit by `(page_id, revision_number, format)` uniqueness; new revision → new render row; old renders garbage-collected by lifecycle rule.
- **Counter columns**: live on `wiki_pages` via triggers, not in a separate metrics table — co-locality enables single-row reads from page list endpoints.
- **Materialized view refresh cadence**: hourly via `CONCURRENTLY` refresh; can be tuned per-tenant if a deployment wants higher freshness.

---

## Unresolved questions

- **Anonymous-visitor token rotation**: how often to rotate the IP-hash salt? Daily is the obvious answer; might need to be per-tenant configurable.
- **Comment moderation queue**: do we want a "pending" state for first-time commenters, or trust authentication alone? Defer until spam shows up.
- **PDF cover-page customization per tenant**: Premium MYIO is a fixed template; tenants might want their own logo/colors. Resolvable via `tenant.wiki_config.pdfTemplate` overrides — not in scope for v1.
- **Bug report SLAs**: do we surface "this bug has been open 30 days" anywhere? Probably yes via dashboard filter, not v1.
- **Inline @mentions in comments**: render `@user:<uuid>` as live link similar to entity links in pages? Worth considering for v2 alongside RFC-0025 dispatch.
- **GDPR/LGPD on visitor_token**: hash includes IP; need to confirm with legal that this is non-PII once hashed with a rotating salt. If not, drop IP and use cookie-only.

---

## Implementation plan

### Phase 1 — Engagement counters (3 days)

- Migration: `wiki_page_views`, `wiki_page_likes`, denormalized counters on `wiki_pages`, triggers.
- Service + repo + controller for views (hybrid auth, anonymous tolerated).
- Service + repo + controller for likes (toggle endpoint).
- RBAC: `wiki.like.toggle`.
- Tests: visibility-aware listing keeps working with new counters; trigger correctness.

### Phase 2 — Comments (2 days)

- Migration: `wiki_page_comments` + tsvector trigger.
- CRUD endpoints (create, list-by-page with parent grouping, update, delete).
- Markdown render for comment body using the same `markdown-it` + DOMPurify pipeline as pages.
- Moderation: hide/delete endpoints gated by `wiki.comment.moderate`.

### Phase 3 — Bug reports (3 days)

- Migration: `wiki_page_bug_reports` + `wiki_bug_report_history`.
- Create endpoint (authenticated only) + list-by-page.
- Status-transition service that writes the history row atomically with the bug_report update.
- Validation: only allowed status transitions per the lifecycle diagram.

### Phase 4 — Admin metrics (3 days)

- Materialized views (`wiki_metrics_user_engagement`, `wiki_metrics_customer_engagement`).
- Cron / pg_cron hourly refresh.
- Read-side admin endpoints (overview, top pages/users/customers/profiles, timeline).
- RBAC: `wiki.admin.read`.

### Phase 5 — Bug report management UI backend (1 day)

- `PATCH /admin/wiki/bug-reports/:id` with field-level diff into history.
- `GET /admin/wiki/bug-reports/:id/history`.
- Filter combinators on the list endpoint (status × severity × assignee × page × date).

### Phase 6 — PDF rendering (5 days)

- `wiki_page_pdf_renders` table + S3 prefix layout.
- BullMQ queue + worker process (separate from API).
- Gotenberg sidecar in Dokploy stack.
- Premium MYIO HTML template (cover, header, footer, watermark, brand CSS).
- `GET /pages/:id/pdf` (sync if cached, async otherwise) + public variant.
- Lifecycle rule on S3: keep 50 most-recent renders per page, expire older.

### Phase 7 — v2 (out of v1 scope, tracked separately)

- Notifications via RFC-0025 dispatch on comment created, bug-report HIGH+, mention.
- @mention parser in comment bodies.
- Per-tenant PDF template overrides.
- SLAs and aging on bug reports.

---

## Appendix — directory layout

```
src/
├─ controllers/
│  ├─ wiki-engagement.controller.ts        # views, likes, comments
│  ├─ wiki-bug-reports.controller.ts
│  ├─ wiki-pdf.controller.ts
│  └─ admin/
│     └─ wiki-admin.controller.ts          # metrics + bug-report management
├─ services/
│  ├─ WikiViewService.ts
│  ├─ WikiLikeService.ts
│  ├─ WikiCommentService.ts
│  ├─ WikiBugReportService.ts
│  ├─ WikiPdfService.ts                    # enqueue + cache lookup
│  ├─ WikiPdfWorker.ts                     # BullMQ worker (separate process)
│  └─ WikiAdminService.ts                  # metrics aggregation
├─ repositories/
│  ├─ WikiViewRepository.ts
│  ├─ WikiLikeRepository.ts
│  ├─ WikiCommentRepository.ts
│  ├─ WikiBugReportRepository.ts
│  ├─ WikiPdfRenderRepository.ts
│  └─ WikiMetricsRepository.ts             # reads from materialized views
├─ infrastructure/
│  ├─ pdf/
│  │  ├─ GotenbergClient.ts
│  │  └─ templates/
│  │     ├─ PremiumMyioV1.html
│  │     └─ PremiumMyioV1.css
│  └─ database/drizzle/migrations/
│     ├─ 0022_wiki_engagement.sql
│     ├─ 0023_wiki_comments.sql
│     ├─ 0024_wiki_bug_reports.sql
│     ├─ 0025_wiki_pdf_renders.sql
│     └─ 0026_wiki_metrics_matviews.sql
└─ scripts/db/seeds/
   └─ 24-wiki-engagement-policies.sql
```
