import {
  WikiPage,
  WikiPageRevision,
  WikiNamespace,
  WikiAudience,
  WikiPageStatus,
  WikiEntityType,
  WikiPageLink,
  WikiBacklink,
  WikiSearchHit,
} from '../../domain/entities/WikiPage';
import { PaginatedResult, PaginationParams } from '../../shared/types';

export interface ListWikiPagesParams extends PaginationParams {
  namespace?: string;
  status?: WikiPageStatus;
  tag?: string;
  /** Title prefix search (server does ILIKE). Full-text search is Phase 3. */
  q?: string;
  includeDeleted?: boolean;
  /**
   * When true, DRAFT pages are included in the listing. The default behaviour
   * is to hide them — that suits readers, but admins moderating anonymous
   * public submissions need to see them in the same call.
   */
  includeDrafts?: boolean;
}

/**
 * Input passed from the service. Audience filtering is ALWAYS applied at the
 * repo layer — the service provides the caller's effective audiences.
 */
export interface WikiVisibilityFilter {
  /** Array-overlap (`&&`) against `wiki_pages.visibility`. */
  effectiveAudiences: WikiAudience[];
}

export interface CreatePageInput {
  tenantId: string;
  namespace: string;
  slug: string;
  title: string;
  tags: string[];
  visibility: WikiAudience[];
  frontmatter: Record<string, unknown>;
  status: WikiPageStatus;
  createdBy: string;
}

export interface CreateRevisionInput {
  pageId: string;
  title: string;
  body: string;
  bodyHtml: string;
  frontmatter: Record<string, unknown>;
  changeNote: string | null;
  authorId: string;
}

export interface UpdatePageMetaInput {
  title?: string;
  tags?: string[];
  visibility?: WikiAudience[];
  frontmatter?: Record<string, unknown>;
  status?: WikiPageStatus;
  currentRevisionId?: string;
}

export interface IWikiPageRepository {
  create(input: CreatePageInput): Promise<WikiPage>;
  getById(tenantId: string, id: string): Promise<WikiPage | null>;
  getBySlug(tenantId: string, namespace: string, slug: string): Promise<WikiPage | null>;
  list(
    tenantId: string,
    filter: WikiVisibilityFilter,
    params?: ListWikiPagesParams
  ): Promise<PaginatedResult<WikiPage>>;
  updateMeta(tenantId: string, id: string, patch: UpdatePageMetaInput): Promise<WikiPage>;
  move(
    tenantId: string,
    id: string,
    target: { namespace?: string; slug?: string }
  ): Promise<WikiPage>;
  softDelete(tenantId: string, id: string): Promise<void>;
  /**
   * Insert a new page and its first revision in the same transaction.
   * The returned page has `currentRevisionId` populated.
   */
  createWithFirstRevision(
    pageInput: CreatePageInput,
    revInput: Omit<CreateRevisionInput, 'pageId'>
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }>;
  /**
   * Append a new revision and atomically update the page's
   * `current_revision_id` + metadata in the same transaction.
   */
  saveRevision(
    tenantId: string,
    pageId: string,
    metaPatch: UpdatePageMetaInput,
    revInput: Omit<CreateRevisionInput, 'pageId'>
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }>;
}

export interface IWikiRevisionRepository {
  listByPage(
    tenantId: string,
    pageId: string,
    params?: PaginationParams
  ): Promise<PaginatedResult<WikiPageRevision>>;
  getByNumber(
    tenantId: string,
    pageId: string,
    revisionNumber: number
  ): Promise<WikiPageRevision | null>;
  getById(id: string): Promise<WikiPageRevision | null>;
}

export interface SearchWikiParams extends PaginationParams {
  q: string;
  namespace?: string;
  tags?: string[];
  status?: WikiPageStatus;
}

export interface BacklinksParams extends PaginationParams {
  entityType: WikiEntityType;
  entityId: string;
}

export interface IWikiPageLinkRepository {
  replaceLinks(pageId: string, links: Array<{ entityType: WikiEntityType; entityId: string }>): Promise<void>;
  listByPage(pageId: string): Promise<WikiPageLink[]>;
  listBacklinks(
    tenantId: string,
    filter: WikiVisibilityFilter,
    params: BacklinksParams,
  ): Promise<PaginatedResult<WikiBacklink>>;
}

export interface IWikiSearchRepository {
  search(
    tenantId: string,
    filter: WikiVisibilityFilter,
    params: SearchWikiParams,
  ): Promise<PaginatedResult<WikiSearchHit>>;
}

export interface IWikiNamespaceRepository {
  list(tenantId: string): Promise<WikiNamespace[]>;
  get(tenantId: string, name: string): Promise<WikiNamespace | null>;
  create(
    tenantId: string,
    data: { name: string; description?: string; reviewRequired?: boolean }
  ): Promise<WikiNamespace>;
  update(
    tenantId: string,
    name: string,
    patch: { description?: string; reviewRequired?: boolean }
  ): Promise<WikiNamespace>;
  delete(tenantId: string, name: string): Promise<void>;
  countPages(tenantId: string, name: string): Promise<number>;
}
