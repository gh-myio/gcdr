import {
  wikiPageRepository,
  wikiRevisionRepository,
  wikiPageLinkRepository,
  wikiSearchRepository,
} from '../repositories/WikiPageRepository';
import {
  IWikiPageRepository,
  IWikiRevisionRepository,
  IWikiPageLinkRepository,
  IWikiSearchRepository,
  ListWikiPagesParams,
  SearchWikiParams,
  BacklinksParams,
} from '../repositories/interfaces/IWikiRepository';
import {
  WikiPage,
  WikiPageRevision,
  WikiPageWithRevision,
  WikiAudience,
  WikiPageStatus,
  WikiEntityType,
  WikiPageLink,
  WikiBacklink,
  WikiSearchHit,
  ALL_WIKI_ENTITY_TYPES,
} from '../domain/entities/WikiPage';
import {
  CreatePageDTO,
  UpdatePageDTO,
  MovePageDTO,
  PublishPageDTO,
} from '../dto/request/WikiDTO';
import { PaginatedResult } from '../shared/types';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../shared/errors/AppError';
import { wikiAudienceResolver, WikiAudienceResolver } from './WikiAudienceResolver';

// =============================================================================
// Minimal placeholder Markdown renderer for Phase 1.
// Phase 2 swaps this for markdown-it + DOMPurify + entity-link extraction.
// =============================================================================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdownPlaceholder(body: string): string {
  // Phase 1: render as a preformatted block so the raw source is visible
  // end-to-end without a Markdown dependency. Phase 2 replaces this.
  return `<pre class="wiki-body-placeholder">${escapeHtml(body)}</pre>`;
}

// =============================================================================
// Unified diff (line-based, LCS) — no npm dep.
// Returns a GNU-style unified diff with simple hunk formatting.
// Adequate for wiki-page bodies; Phase 3+ can replace with `diff` package.
// =============================================================================
export function unifiedDiff(a: string, b: string, aLabel = 'a', bLabel = 'b'): string {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;

  // LCS length matrix.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = aLines[i] === bLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Array<{ op: ' ' | '+' | '-'; line: string }> = [];
  let i = 0; let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      ops.push({ op: ' ', line: aLines[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: '-', line: aLines[i] });
      i++;
    } else {
      ops.push({ op: '+', line: bLines[j] });
      j++;
    }
  }
  while (i < m) ops.push({ op: '-', line: aLines[i++] });
  while (j < n) ops.push({ op: '+', line: bLines[j++] });

  // Header + single hunk covering the whole diff (simple — no grouped hunks).
  const header = `--- ${aLabel}\n+++ ${bLabel}\n@@ -1,${m} +1,${n} @@\n`;
  const body   = ops.map((o) => `${o.op}${o.line}`).join('\n');
  return header + body + (body.endsWith('\n') ? '' : '\n');
}

// =============================================================================
// Service
// =============================================================================

export interface ListPagesContext {
  tenantId: string;
  userId: string;
  params?: ListWikiPagesParams;
}

export interface GetPageContext {
  tenantId: string;
  userId: string;
}

/**
 * Extract `@<type>:<id>` tokens from Markdown body.
 * Accepts UUID-shaped ids for all types except `rfc`, which uses a numeric id.
 * Duplicates inside the body are deduplicated by the repo.
 */
const ENTITY_TOKEN_RE =
  /@(device|customer|rule|asset|central|group|user|rfc):([A-Za-z0-9_-]+)/g;

export function extractEntityLinks(
  body: string,
): Array<{ entityType: WikiEntityType; entityId: string }> {
  const out: Array<{ entityType: WikiEntityType; entityId: string }> = [];
  for (const match of body.matchAll(ENTITY_TOKEN_RE)) {
    const [, type, id] = match;
    if (ALL_WIKI_ENTITY_TYPES.includes(type as WikiEntityType)) {
      out.push({ entityType: type as WikiEntityType, entityId: id });
    }
  }
  return out;
}

export class WikiPageService {
  constructor(
    private readonly pageRepo: IWikiPageRepository = wikiPageRepository,
    private readonly revisionRepo: IWikiRevisionRepository = wikiRevisionRepository,
    private readonly audiences: WikiAudienceResolver = wikiAudienceResolver,
    private readonly linkRepo: IWikiPageLinkRepository = wikiPageLinkRepository,
    private readonly searchRepo: IWikiSearchRepository = wikiSearchRepository,
  ) {}

  // ----- Read operations (audience-filtered) --------------------------------

  async listPages(ctx: ListPagesContext): Promise<PaginatedResult<WikiPage>> {
    const { audiences } = await this.audiences.resolveForUser(ctx.tenantId, ctx.userId);
    return this.pageRepo.list(ctx.tenantId, { effectiveAudiences: audiences }, ctx.params);
  }

  async getPageById(ctx: GetPageContext, id: string): Promise<WikiPageWithRevision> {
    const page = await this.pageRepo.getById(ctx.tenantId, id);
    if (!page) throw new NotFoundError(`Wiki page ${id} not found`);
    await this.assertReadable(ctx.tenantId, ctx.userId, page);
    return this.attachRevision(page);
  }

  async getPageBySlug(
    ctx: GetPageContext,
    namespace: string,
    slug: string,
  ): Promise<WikiPageWithRevision> {
    const page = await this.pageRepo.getBySlug(ctx.tenantId, namespace, slug);
    if (!page) throw new NotFoundError(`Wiki page ${namespace}/${slug} not found`);
    await this.assertReadable(ctx.tenantId, ctx.userId, page);
    return this.attachRevision(page);
  }

  async getCurrentRevision(ctx: GetPageContext, pageId: string): Promise<WikiPageRevision | null> {
    const page = await this.getPageById(ctx, pageId);
    if (!page.currentRevisionId) return null;
    return this.revisionRepo.getById(page.currentRevisionId);
  }

  private async attachRevision(page: WikiPage): Promise<WikiPageWithRevision> {
    if (!page.currentRevisionId) return { ...page, currentRevision: null };
    const rev = await this.revisionRepo.getById(page.currentRevisionId);
    return { ...page, currentRevision: rev };
  }

  async listRevisions(
    ctx: GetPageContext,
    pageId: string,
    params?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResult<WikiPageRevision>> {
    // Read-access check on the page first.
    await this.getPageById(ctx, pageId);
    return this.revisionRepo.listByPage(ctx.tenantId, pageId, params);
  }

  async getRevision(
    ctx: GetPageContext,
    pageId: string,
    revisionNumber: number,
  ): Promise<WikiPageRevision> {
    await this.getPageById(ctx, pageId);
    const rev = await this.revisionRepo.getByNumber(ctx.tenantId, pageId, revisionNumber);
    if (!rev) {
      throw new NotFoundError(`Revision ${revisionNumber} of page ${pageId} not found`);
    }
    return rev;
  }

  // ----- Write operations ----------------------------------------------------

  async createPage(
    ctx: { tenantId: string; userId: string },
    data: CreatePageDTO,
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }> {
    const status: WikiPageStatus = data.status ?? 'DRAFT';
    const visibility: WikiAudience[] = (data.visibility ?? ['TENANT_PRIVATE']) as WikiAudience[];

    await this.assertCanAssign(ctx, visibility);

    // Reject duplicate slug before we open a transaction.
    const existing = await this.pageRepo.getBySlug(ctx.tenantId, data.namespace, data.slug);
    if (existing) {
      throw new ConflictError(
        `Wiki page '${data.namespace}/${data.slug}' already exists in this tenant`
      );
    }

    const bodyHtml = renderMarkdownPlaceholder(data.body);

    const result = await this.pageRepo.createWithFirstRevision(
      {
        tenantId: ctx.tenantId,
        namespace: data.namespace,
        slug: data.slug,
        title: data.title,
        tags: data.tags ?? [],
        visibility,
        frontmatter: data.frontmatter ?? {},
        status,
        createdBy: ctx.userId,
      },
      {
        title: data.title,
        body: data.body,
        bodyHtml,
        frontmatter: data.frontmatter ?? {},
        changeNote: data.changeNote ?? null,
        authorId: ctx.userId,
      },
    );

    await this.linkRepo.replaceLinks(result.page.id, extractEntityLinks(data.body));
    return result;
  }

  async updatePage(
    ctx: { tenantId: string; userId: string },
    id: string,
    data: UpdatePageDTO,
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }> {
    const existing = await this.pageRepo.getById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);

    // Only someone allowed to read the page may edit it (baseline guard —
    // RBAC for `wiki.page.update` is an additional controller-layer check).
    await this.assertReadable(ctx.tenantId, ctx.userId, existing);

    if (data.visibility !== undefined) {
      await this.assertCanAssign(ctx, data.visibility as WikiAudience[]);
    }

    const newTitle = data.title ?? existing.title;
    const bodyHtml = renderMarkdownPlaceholder(data.body);

    const result = await this.pageRepo.saveRevision(
      ctx.tenantId,
      id,
      {
        title: data.title,
        tags: data.tags,
        visibility: data.visibility as WikiAudience[] | undefined,
        frontmatter: data.frontmatter,
      },
      {
        title: newTitle,
        body: data.body,
        bodyHtml,
        frontmatter: data.frontmatter ?? existing.frontmatter,
        changeNote: data.changeNote ?? null,
        authorId: ctx.userId,
      },
    );

    await this.linkRepo.replaceLinks(id, extractEntityLinks(data.body));
    return result;
  }

  async movePage(
    ctx: { tenantId: string; userId: string },
    id: string,
    data: MovePageDTO,
  ): Promise<WikiPage> {
    const existing = await this.pageRepo.getById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);

    const targetNamespace = data.namespace ?? existing.namespace;
    const targetSlug = data.slug ?? existing.slug;

    if (targetNamespace === existing.namespace && targetSlug === existing.slug) {
      return existing;
    }

    const conflict = await this.pageRepo.getBySlug(ctx.tenantId, targetNamespace, targetSlug);
    if (conflict && conflict.id !== id) {
      throw new ConflictError(
        `A wiki page already exists at '${targetNamespace}/${targetSlug}'`
      );
    }

    return this.pageRepo.move(ctx.tenantId, id, {
      namespace: data.namespace,
      slug: data.slug,
    });
  }

  async publishPage(
    ctx: { tenantId: string; userId: string },
    id: string,
    _data: PublishPageDTO,
  ): Promise<WikiPage> {
    const existing = await this.pageRepo.getById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);
    if (existing.status === 'ARCHIVED') {
      throw new ValidationError(
        `Cannot publish an archived page directly — move it to DRAFT first`
      );
    }
    return this.pageRepo.updateMeta(ctx.tenantId, id, { status: 'PUBLISHED' });
  }

  async archivePage(
    ctx: { tenantId: string; userId: string },
    id: string,
  ): Promise<WikiPage> {
    const existing = await this.pageRepo.getById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);
    return this.pageRepo.updateMeta(ctx.tenantId, id, { status: 'ARCHIVED' });
  }

  async deletePage(
    ctx: { tenantId: string; userId: string },
    id: string,
  ): Promise<void> {
    await this.pageRepo.softDelete(ctx.tenantId, id);
  }

  // ----- Search --------------------------------------------------------------

  async search(
    ctx: { tenantId: string; userId: string },
    params: SearchWikiParams,
  ) {
    const { audiences } = await this.audiences.resolveForUser(ctx.tenantId, ctx.userId);
    return this.searchRepo.search(ctx.tenantId, { effectiveAudiences: audiences }, params);
  }

  async backlinks(
    ctx: { tenantId: string; userId: string },
    params: BacklinksParams,
  ) {
    const { audiences } = await this.audiences.resolveForUser(ctx.tenantId, ctx.userId);
    return this.linkRepo.listBacklinks(ctx.tenantId, { effectiveAudiences: audiences }, params);
  }

  // ----- Diff & rollback -----------------------------------------------------

  async getRevisionDiff(
    ctx: GetPageContext,
    pageId: string,
    a: number,
    b: number,
  ): Promise<{ diff: string; a: number; b: number }> {
    const [revA, revB] = await Promise.all([
      this.revisionRepo.getByNumber(ctx.tenantId, pageId, a),
      this.revisionRepo.getByNumber(ctx.tenantId, pageId, b),
    ]);
    if (!revA) throw new NotFoundError(`Revision ${a} of page ${pageId} not found`);
    if (!revB) throw new NotFoundError(`Revision ${b} of page ${pageId} not found`);
    // Read check via the page
    await this.getPageById(ctx, pageId);
    return { diff: unifiedDiff(revA.body, revB.body, `r${a}`, `r${b}`), a, b };
  }

  async rollback(
    ctx: { tenantId: string; userId: string },
    pageId: string,
    targetRevision: number,
    changeNote?: string,
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }> {
    const existing = await this.pageRepo.getById(ctx.tenantId, pageId);
    if (!existing) throw new NotFoundError(`Wiki page ${pageId} not found`);

    const target = await this.revisionRepo.getByNumber(ctx.tenantId, pageId, targetRevision);
    if (!target) {
      throw new NotFoundError(`Revision ${targetRevision} of page ${pageId} not found`);
    }

    const result = await this.pageRepo.saveRevision(
      ctx.tenantId,
      pageId,
      { title: target.title, frontmatter: target.frontmatter },
      {
        title: target.title,
        body: target.body,
        bodyHtml: renderMarkdownPlaceholder(target.body),
        frontmatter: target.frontmatter,
        changeNote: changeNote ?? `rollback to revision ${targetRevision}`,
        authorId: ctx.userId,
      },
    );

    await this.linkRepo.replaceLinks(pageId, extractEntityLinks(target.body));
    return result;
  }

  // ----- Public (anonymous) variants ----------------------------------------
  // These force the audience filter to ['PUBLIC'] and status to 'PUBLISHED'.
  // The user does not need to be authenticated.

  async listPublic(
    tenantId: string,
    params: Omit<ListWikiPagesParams, 'status' | 'includeDeleted'> = {},
  ) {
    return this.pageRepo.list(
      tenantId,
      { effectiveAudiences: ['PUBLIC'] },
      { ...params, status: 'PUBLISHED' },
    );
  }

  async getPublicPageBySlug(
    tenantId: string,
    namespace: string,
    slug: string,
  ): Promise<WikiPageWithRevision> {
    const page = await this.pageRepo.getBySlug(tenantId, namespace, slug);
    if (!page) throw new NotFoundError(`Wiki page ${namespace}/${slug} not found`);
    if (!page.visibility.includes('PUBLIC') || page.status !== 'PUBLISHED') {
      throw new NotFoundError(`Wiki page ${namespace}/${slug} not found`);
    }
    return this.attachRevision(page);
  }

  async getPublicPageById(
    tenantId: string,
    id: string,
  ): Promise<WikiPageWithRevision> {
    const page = await this.pageRepo.getById(tenantId, id);
    if (!page) throw new NotFoundError(`Wiki page ${id} not found`);
    if (!page.visibility.includes('PUBLIC') || page.status !== 'PUBLISHED') {
      throw new NotFoundError(`Wiki page ${id} not found`);
    }
    return this.attachRevision(page);
  }

  async searchPublic(
    tenantId: string,
    params: SearchWikiParams,
  ) {
    return this.searchRepo.search(
      tenantId,
      { effectiveAudiences: ['PUBLIC'] },
      { ...params, status: 'PUBLISHED' },
    );
  }

  async backlinksPublic(tenantId: string, params: BacklinksParams) {
    return this.linkRepo.listBacklinks(
      tenantId,
      { effectiveAudiences: ['PUBLIC'] },
      params,
    );
  }

  // ----- Helpers -------------------------------------------------------------

  /**
   * Throw ForbiddenError if the user's effective audiences don't overlap the
   * page's visibility. This is a belt-and-suspenders check — the list query
   * already filters by visibility at the DB layer, but get-by-id/slug bypass
   * that filter so we re-check here.
   */
  private async assertReadable(
    tenantId: string,
    userId: string,
    page: WikiPage,
  ): Promise<void> {
    const { audiences } = await this.audiences.resolveForUser(tenantId, userId);
    const overlap = page.visibility.some((t) => audiences.includes(t));
    if (!overlap) {
      // Avoid leaking existence: reply with not-found semantics.
      throw new NotFoundError(`Wiki page ${page.id} not found`);
    }
  }

  private async assertCanAssign(
    ctx: { tenantId: string; userId: string },
    visibility: WikiAudience[],
  ): Promise<void> {
    const { allowed, deniedTags } = await this.audiences.assertCanAssignVisibility(
      ctx.tenantId, ctx.userId, visibility,
    );
    if (!allowed) {
      throw new ForbiddenError(
        `You are not allowed to assign visibility tag(s): ${deniedTags.join(', ')}`
      );
    }
  }
}

export const wikiPageService = new WikiPageService();
