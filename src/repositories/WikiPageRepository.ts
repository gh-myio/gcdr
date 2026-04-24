import { eq, and, sql, desc, isNull, SQL } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  WikiPage,
  WikiPageRevision,
  WikiAudience,
  WikiPageStatus,
} from '../domain/entities/WikiPage';
import { PaginatedResult, PaginationParams } from '../shared/types';
import {
  IWikiPageRepository,
  IWikiRevisionRepository,
  IWikiNamespaceRepository,
  ListWikiPagesParams,
  WikiVisibilityFilter,
  CreatePageInput,
  CreateRevisionInput,
  UpdatePageMetaInput,
} from './interfaces/IWikiRepository';
import { countWhere } from './helpers/countQuery';
import { NotFoundError } from '../shared/errors/AppError';

const { wikiPages, wikiPageRevisions, wikiNamespaces } = schema;

// =============================================================================
// Helpers
// =============================================================================

type PageRow = typeof schema.wikiPages.$inferSelect;
type RevisionRow = typeof schema.wikiPageRevisions.$inferSelect;

function mapPage(row: PageRow): WikiPage {
  return {
    id: row.id,
    tenantId: row.tenantId,
    namespace: row.namespace,
    slug: row.slug,
    title: row.title,
    status: row.status as WikiPageStatus,
    currentRevisionId: row.currentRevisionId ?? null,
    tags: row.tags ?? [],
    visibility: (row.visibility ?? []) as WikiAudience[],
    frontmatter: (row.frontmatter ?? {}) as Record<string, unknown>,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    version: row.version,
  };
}

function mapRevision(row: RevisionRow): WikiPageRevision {
  return {
    id: row.id,
    pageId: row.pageId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    body: row.body,
    bodyHtml: row.bodyHtml,
    frontmatter: (row.frontmatter ?? {}) as Record<string, unknown>,
    changeNote: row.changeNote ?? null,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Array-overlap condition: `wiki_pages.visibility && ARRAY[...]::text[]`.
 * Drizzle doesn't have a first-class `&&` helper for text arrays, so raw SQL.
 */
function visibilityOverlap(tags: WikiAudience[]): SQL {
  if (tags.length === 0) {
    // No audiences → match nothing.
    return sql`false`;
  }
  return sql`${wikiPages.visibility} && ${tags}::text[]`;
}

// =============================================================================
// WikiPageRepository
// =============================================================================

export class WikiPageRepository implements IWikiPageRepository {

  async create(input: CreatePageInput): Promise<WikiPage> {
    const [row] = await db.insert(wikiPages).values({
      tenantId: input.tenantId,
      namespace: input.namespace,
      slug: input.slug,
      title: input.title,
      status: input.status,
      tags: input.tags,
      visibility: input.visibility,
      frontmatter: input.frontmatter,
      createdBy: input.createdBy,
    }).returning();

    return mapPage(row);
  }

  async getById(tenantId: string, id: string): Promise<WikiPage | null> {
    const [row] = await db
      .select()
      .from(wikiPages)
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.id, id),
        isNull(wikiPages.deletedAt),
      ))
      .limit(1);

    return row ? mapPage(row) : null;
  }

  async getBySlug(tenantId: string, namespace: string, slug: string): Promise<WikiPage | null> {
    const [row] = await db
      .select()
      .from(wikiPages)
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.namespace, namespace),
        eq(wikiPages.slug, slug),
        isNull(wikiPages.deletedAt),
      ))
      .limit(1);

    return row ? mapPage(row) : null;
  }

  async list(
    tenantId: string,
    filter: WikiVisibilityFilter,
    params?: ListWikiPagesParams,
  ): Promise<PaginatedResult<WikiPage>> {
    const limit = params?.limit ?? 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions: SQL[] = [
      eq(wikiPages.tenantId, tenantId),
      visibilityOverlap(filter.effectiveAudiences),
    ];

    if (!params?.includeDeleted) {
      conditions.push(sql`${wikiPages.deletedAt} IS NULL`);
    }

    if (params?.namespace) {
      conditions.push(eq(wikiPages.namespace, params.namespace));
    }

    if (params?.status) {
      conditions.push(eq(wikiPages.status, params.status));
    } else {
      // Default: hide DRAFT from generic listing unless explicitly asked.
      conditions.push(sql`${wikiPages.status} <> 'DRAFT'`);
    }

    if (params?.tag) {
      conditions.push(sql`${params.tag} = ANY(${wikiPages.tags})`);
    }

    if (params?.q) {
      const like = `%${params.q}%`;
      conditions.push(sql`${wikiPages.title} ILIKE ${like}`);
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(wikiPages)
        .where(and(...conditions))
        .orderBy(desc(wikiPages.updatedAt))
        .limit(limit + 1)
        .offset(offset),
      countWhere(wikiPages, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = (hasMore ? results.slice(0, limit) : results).map(mapPage);
    const nextCursor = hasMore ? String(offset + limit) : undefined;
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      pagination: { total, totalPages, hasMore, nextCursor },
    };
  }

  async updateMeta(tenantId: string, id: string, patch: UpdatePageMetaInput): Promise<WikiPage> {
    const updates: Record<string, unknown> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.visibility !== undefined) updates.visibility = patch.visibility;
    if (patch.frontmatter !== undefined) updates.frontmatter = patch.frontmatter;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.currentRevisionId !== undefined) updates.currentRevisionId = patch.currentRevisionId;

    if (Object.keys(updates).length === 0) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);
      return existing;
    }

    // Optimistic locking: bump version on every meta update.
    updates.version = sql`${wikiPages.version} + 1`;

    const [row] = await db
      .update(wikiPages)
      .set(updates)
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.id, id),
        isNull(wikiPages.deletedAt),
      ))
      .returning();

    if (!row) throw new NotFoundError(`Wiki page ${id} not found`);
    return mapPage(row);
  }

  async move(
    tenantId: string,
    id: string,
    target: { namespace?: string; slug?: string },
  ): Promise<WikiPage> {
    const updates: Record<string, unknown> = {};
    if (target.namespace !== undefined) updates.namespace = target.namespace;
    if (target.slug !== undefined) updates.slug = target.slug;

    if (Object.keys(updates).length === 0) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError(`Wiki page ${id} not found`);
      return existing;
    }

    updates.version = sql`${wikiPages.version} + 1`;

    const [row] = await db
      .update(wikiPages)
      .set(updates)
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.id, id),
        isNull(wikiPages.deletedAt),
      ))
      .returning();

    if (!row) throw new NotFoundError(`Wiki page ${id} not found`);
    return mapPage(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    const [row] = await db
      .update(wikiPages)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.id, id),
        isNull(wikiPages.deletedAt),
      ))
      .returning({ id: wikiPages.id });

    if (!row) throw new NotFoundError(`Wiki page ${id} not found`);
  }

  async createWithFirstRevision(
    pageInput: CreatePageInput,
    revInput: Omit<CreateRevisionInput, 'pageId'>,
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }> {
    return db.transaction(async (tx) => {
      // 1. Insert the page (current_revision_id still NULL — FK is deferrable).
      const [pageRow] = await tx.insert(wikiPages).values({
        tenantId: pageInput.tenantId,
        namespace: pageInput.namespace,
        slug: pageInput.slug,
        title: pageInput.title,
        status: pageInput.status,
        tags: pageInput.tags,
        visibility: pageInput.visibility,
        frontmatter: pageInput.frontmatter,
        createdBy: pageInput.createdBy,
      }).returning();

      // 2. Insert revision #1.
      const [revRow] = await tx.insert(wikiPageRevisions).values({
        pageId: pageRow.id,
        revisionNumber: 1,
        title: revInput.title,
        body: revInput.body,
        bodyHtml: revInput.bodyHtml,
        frontmatter: revInput.frontmatter,
        changeNote: revInput.changeNote,
        authorId: revInput.authorId,
      }).returning();

      // 3. Point the page at its revision.
      const [updatedPage] = await tx
        .update(wikiPages)
        .set({ currentRevisionId: revRow.id })
        .where(eq(wikiPages.id, pageRow.id))
        .returning();

      return { page: mapPage(updatedPage), revision: mapRevision(revRow) };
    });
  }

  async saveRevision(
    tenantId: string,
    pageId: string,
    metaPatch: UpdatePageMetaInput,
    revInput: Omit<CreateRevisionInput, 'pageId'>,
  ): Promise<{ page: WikiPage; revision: WikiPageRevision }> {
    return db.transaction(async (tx) => {
      // Determine next revision number under row lock.
      const [{ maxRev }] = await tx
        .select({ maxRev: sql<number>`COALESCE(MAX(${wikiPageRevisions.revisionNumber}), 0)::int` })
        .from(wikiPageRevisions)
        .where(eq(wikiPageRevisions.pageId, pageId));

      const nextRev = (maxRev ?? 0) + 1;

      const [revRow] = await tx.insert(wikiPageRevisions).values({
        pageId,
        revisionNumber: nextRev,
        title: revInput.title,
        body: revInput.body,
        bodyHtml: revInput.bodyHtml,
        frontmatter: revInput.frontmatter,
        changeNote: revInput.changeNote,
        authorId: revInput.authorId,
      }).returning();

      const updates: Record<string, unknown> = {
        currentRevisionId: revRow.id,
        version: sql`${wikiPages.version} + 1`,
      };
      if (metaPatch.title !== undefined) updates.title = metaPatch.title;
      if (metaPatch.tags !== undefined) updates.tags = metaPatch.tags;
      if (metaPatch.visibility !== undefined) updates.visibility = metaPatch.visibility;
      if (metaPatch.frontmatter !== undefined) updates.frontmatter = metaPatch.frontmatter;
      if (metaPatch.status !== undefined) updates.status = metaPatch.status;

      const [pageRow] = await tx
        .update(wikiPages)
        .set(updates)
        .where(and(
          eq(wikiPages.tenantId, tenantId),
          eq(wikiPages.id, pageId),
          isNull(wikiPages.deletedAt),
        ))
        .returning();

      if (!pageRow) throw new NotFoundError(`Wiki page ${pageId} not found`);

      return { page: mapPage(pageRow), revision: mapRevision(revRow) };
    });
  }
}

// =============================================================================
// WikiRevisionRepository
// =============================================================================

export class WikiRevisionRepository implements IWikiRevisionRepository {

  async listByPage(
    tenantId: string,
    pageId: string,
    params?: PaginationParams,
  ): Promise<PaginatedResult<WikiPageRevision>> {
    const limit = params?.limit ?? 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Tenant scoping: ensure the page belongs to the tenant before listing.
    const [pageRow] = await db
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(and(eq(wikiPages.tenantId, tenantId), eq(wikiPages.id, pageId)))
      .limit(1);

    if (!pageRow) {
      return { items: [], pagination: { total: 0, totalPages: 0, hasMore: false } };
    }

    const [results, [{ count: total }]] = await Promise.all([
      db.select()
        .from(wikiPageRevisions)
        .where(eq(wikiPageRevisions.pageId, pageId))
        .orderBy(desc(wikiPageRevisions.revisionNumber))
        .limit(limit + 1)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(wikiPageRevisions)
        .where(eq(wikiPageRevisions.pageId, pageId)),
    ]);

    const hasMore = results.length > limit;
    const items = (hasMore ? results.slice(0, limit) : results).map(mapRevision);
    const nextCursor = hasMore ? String(offset + limit) : undefined;
    const totalPages = Math.ceil(total / limit);

    return { items, pagination: { total, totalPages, hasMore, nextCursor } };
  }

  async getByNumber(
    tenantId: string,
    pageId: string,
    revisionNumber: number,
  ): Promise<WikiPageRevision | null> {
    const [row] = await db
      .select({ rev: wikiPageRevisions })
      .from(wikiPageRevisions)
      .innerJoin(wikiPages, eq(wikiPages.id, wikiPageRevisions.pageId))
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPageRevisions.pageId, pageId),
        eq(wikiPageRevisions.revisionNumber, revisionNumber),
      ))
      .limit(1);

    return row ? mapRevision(row.rev) : null;
  }

  async getById(id: string): Promise<WikiPageRevision | null> {
    const [row] = await db
      .select()
      .from(wikiPageRevisions)
      .where(eq(wikiPageRevisions.id, id))
      .limit(1);
    return row ? mapRevision(row) : null;
  }
}

// =============================================================================
// WikiNamespaceRepository
// =============================================================================

export class WikiNamespaceRepository implements IWikiNamespaceRepository {

  async list(tenantId: string) {
    const rows = await db.select().from(wikiNamespaces).where(eq(wikiNamespaces.tenantId, tenantId));
    return rows.map((r) => ({
      tenantId: r.tenantId,
      name: r.name,
      description: r.description ?? null,
      reviewRequired: r.reviewRequired,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async get(tenantId: string, name: string) {
    const [r] = await db.select()
      .from(wikiNamespaces)
      .where(and(eq(wikiNamespaces.tenantId, tenantId), eq(wikiNamespaces.name, name)))
      .limit(1);
    return r ? {
      tenantId: r.tenantId,
      name: r.name,
      description: r.description ?? null,
      reviewRequired: r.reviewRequired,
      createdAt: r.createdAt.toISOString(),
    } : null;
  }

  async create(
    tenantId: string,
    data: { name: string; description?: string; reviewRequired?: boolean },
  ) {
    const [r] = await db.insert(wikiNamespaces).values({
      tenantId,
      name: data.name,
      description: data.description ?? null,
      reviewRequired: data.reviewRequired ?? false,
    }).returning();
    return {
      tenantId: r.tenantId,
      name: r.name,
      description: r.description ?? null,
      reviewRequired: r.reviewRequired,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async update(
    tenantId: string,
    name: string,
    patch: { description?: string; reviewRequired?: boolean },
  ) {
    const updates: Record<string, unknown> = {};
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.reviewRequired !== undefined) updates.reviewRequired = patch.reviewRequired;

    const [r] = await db.update(wikiNamespaces)
      .set(updates)
      .where(and(eq(wikiNamespaces.tenantId, tenantId), eq(wikiNamespaces.name, name)))
      .returning();

    if (!r) throw new NotFoundError(`Wiki namespace '${name}' not found`);

    return {
      tenantId: r.tenantId,
      name: r.name,
      description: r.description ?? null,
      reviewRequired: r.reviewRequired,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async delete(tenantId: string, name: string) {
    const [r] = await db.delete(wikiNamespaces)
      .where(and(eq(wikiNamespaces.tenantId, tenantId), eq(wikiNamespaces.name, name)))
      .returning({ name: wikiNamespaces.name });
    if (!r) throw new NotFoundError(`Wiki namespace '${name}' not found`);
  }

  async countPages(tenantId: string, name: string): Promise<number> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPages)
      .where(and(
        eq(wikiPages.tenantId, tenantId),
        eq(wikiPages.namespace, name),
        isNull(wikiPages.deletedAt),
      ));
    return count ?? 0;
  }
}

export const wikiPageRepository = new WikiPageRepository();
export const wikiRevisionRepository = new WikiRevisionRepository();
export const wikiNamespaceRepository = new WikiNamespaceRepository();
