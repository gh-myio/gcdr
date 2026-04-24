import {
  wikiPageRepository,
  wikiRevisionRepository,
} from '../repositories/WikiPageRepository';
import {
  IWikiPageRepository,
  IWikiRevisionRepository,
  ListWikiPagesParams,
} from '../repositories/interfaces/IWikiRepository';
import {
  WikiPage,
  WikiPageRevision,
  WikiAudience,
  WikiPageStatus,
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

export class WikiPageService {
  constructor(
    private readonly pageRepo: IWikiPageRepository = wikiPageRepository,
    private readonly revisionRepo: IWikiRevisionRepository = wikiRevisionRepository,
    private readonly audiences: WikiAudienceResolver = wikiAudienceResolver,
  ) {}

  // ----- Read operations (audience-filtered) --------------------------------

  async listPages(ctx: ListPagesContext): Promise<PaginatedResult<WikiPage>> {
    const { audiences } = await this.audiences.resolveForUser(ctx.tenantId, ctx.userId);
    return this.pageRepo.list(ctx.tenantId, { effectiveAudiences: audiences }, ctx.params);
  }

  async getPageById(ctx: GetPageContext, id: string): Promise<WikiPage> {
    const page = await this.pageRepo.getById(ctx.tenantId, id);
    if (!page) throw new NotFoundError(`Wiki page ${id} not found`);
    await this.assertReadable(ctx.tenantId, ctx.userId, page);
    return page;
  }

  async getPageBySlug(ctx: GetPageContext, namespace: string, slug: string): Promise<WikiPage> {
    const page = await this.pageRepo.getBySlug(ctx.tenantId, namespace, slug);
    if (!page) throw new NotFoundError(`Wiki page ${namespace}/${slug} not found`);
    await this.assertReadable(ctx.tenantId, ctx.userId, page);
    return page;
  }

  async getCurrentRevision(ctx: GetPageContext, pageId: string): Promise<WikiPageRevision | null> {
    const page = await this.getPageById(ctx, pageId);
    if (!page.currentRevisionId) return null;
    return this.revisionRepo.getById(page.currentRevisionId);
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

    return this.pageRepo.createWithFirstRevision(
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

    return this.pageRepo.saveRevision(
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
