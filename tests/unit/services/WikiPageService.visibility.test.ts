import { WikiPageService } from '../../../src/services/WikiPageService';
import {
  IWikiPageRepository,
  IWikiRevisionRepository,
  ListWikiPagesParams,
  WikiVisibilityFilter,
  CreatePageInput,
  CreateRevisionInput,
  UpdatePageMetaInput,
} from '../../../src/repositories/interfaces/IWikiRepository';
import {
  WikiPage,
  WikiPageRevision,
  WikiAudience,
} from '../../../src/domain/entities/WikiPage';
import { AppError } from '../../../src/shared/errors/AppError';
import { WikiAudienceResolver } from '../../../src/services/WikiAudienceResolver';

const expectErrorWithCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toThrow();
  try { await p; } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
};

// =============================================================================
// Fixtures
// =============================================================================

const tenantId = 'tenant-1';
const userId   = 'user-1';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    tenantId,
    namespace: 'Runbooks',
    slug: 'chiller-overheating',
    title: 'Chiller overheating',
    status: 'PUBLISHED',
    currentRevisionId: 'rev-1',
    tags: [],
    visibility: ['TENANT_PRIVATE'],
    frontmatter: {},
    createdBy: userId,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

function makeRevision(overrides: Partial<WikiPageRevision> = {}): WikiPageRevision {
  return {
    id: 'rev-1',
    pageId: 'page-1',
    revisionNumber: 1,
    title: 'Chiller overheating',
    body: '# body',
    bodyHtml: '<pre>body</pre>',
    frontmatter: {},
    changeNote: null,
    authorId: userId,
    createdAt: '2026-04-22T00:00:00Z',
    ...overrides,
  };
}

function makePageRepo(): jest.Mocked<IWikiPageRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    getBySlug: jest.fn(),
    list: jest.fn(),
    updateMeta: jest.fn(),
    move: jest.fn(),
    softDelete: jest.fn(),
    createWithFirstRevision: jest.fn(),
    saveRevision: jest.fn(),
  };
}

function makeRevisionRepo(): jest.Mocked<IWikiRevisionRepository> {
  return {
    listByPage: jest.fn(),
    getByNumber: jest.fn(),
    getById: jest.fn(),
  };
}

/**
 * Minimal stub resolver — produces whatever audiences the test wants for
 * the caller, and decides who can assign which tags.
 */
function makeResolver(
  readerAudiences: WikiAudience[],
  assignableTags: Set<WikiAudience> = new Set(['TENANT_PRIVATE']),
): jest.Mocked<WikiAudienceResolver> {
  return {
    resolveForUser: jest.fn().mockResolvedValue({
      audiences: readerAudiences,
      reasons: ['test-stub'],
    }),
    assertCanAssignVisibility: jest.fn().mockImplementation(
      async (_tenantId: string, _uid: string, tags: WikiAudience[]) => {
        const denied = tags.filter((t) => !assignableTags.has(t));
        return { allowed: denied.length === 0, deniedTags: denied };
      },
    ),
    getAllowedVisibilityOptions: jest.fn().mockResolvedValue({
      allowedTags: Array.from(assignableTags),
      presets: [],
    }),
  } as unknown as jest.Mocked<WikiAudienceResolver>;
}

// =============================================================================
// Tests
// =============================================================================

describe('WikiPageService — visibility', () => {
  let pageRepo: jest.Mocked<IWikiPageRepository>;
  let revRepo: jest.Mocked<IWikiRevisionRepository>;

  beforeEach(() => {
    pageRepo = makePageRepo();
    revRepo  = makeRevisionRepo();
  });

  describe('listPages', () => {
    it('passes the user effective audiences to the repo filter', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.list.mockResolvedValue({
        items: [makePage()],
        pagination: { total: 1, totalPages: 1, hasMore: false },
      });

      await service.listPages({ tenantId, userId });

      const [, filter] = pageRepo.list.mock.calls[0] as [string, WikiVisibilityFilter, ListWikiPagesParams?];
      expect(filter.effectiveAudiences.sort()).toEqual(['PUBLIC', 'TENANT_PRIVATE']);
    });
  });

  describe('getPageById', () => {
    it('returns the page when the user has overlap with its visibility', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getById.mockResolvedValue(makePage({ visibility: ['TENANT_PRIVATE'] }));

      const got = await service.getPageById({ tenantId, userId }, 'page-1');
      expect(got.id).toBe('page-1');
    });

    it('throws NotFound when the caller has no overlap (leaks nothing about existence)', async () => {
      const resolver = makeResolver(['PUBLIC']);   // no TENANT_PRIVATE
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getById.mockResolvedValue(makePage({ visibility: ['TENANT_PRIVATE'] }));

      await expectErrorWithCode(
        service.getPageById({ tenantId, userId }, 'page-1'),
        'NOT_FOUND',
      );
    });

    it('throws NotFound when the page does not exist', async () => {
      const resolver = makeResolver(['PUBLIC']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getById.mockResolvedValue(null);

      await expectErrorWithCode(
        service.getPageById({ tenantId, userId }, 'missing'),
        'NOT_FOUND',
      );
    });

    it('grants access when any single overlap exists with multi-tag visibility', async () => {
      const resolver = makeResolver(['PARTNERS']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getById.mockResolvedValue(makePage({
        visibility: ['HOLDING_CUSTOMERS', 'PARTNERS', 'MYIO_INTERNAL'],
      }));

      const got = await service.getPageById({ tenantId, userId }, 'page-1');
      expect(got.visibility).toContain('PARTNERS');
    });
  });

  describe('createPage', () => {
    it('rejects with FORBIDDEN when the caller cannot assign the requested visibility', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE'], new Set(['TENANT_PRIVATE']));
      const service = new WikiPageService(pageRepo, revRepo, resolver);

      await expectErrorWithCode(
        service.createPage(
          { tenantId, userId },
          {
            namespace: 'Runbooks',
            slug: 'x',
            title: 'X',
            body: '# x',
            visibility: ['PUBLIC'],   // requires wiki.visibility.public — not granted
          },
        ),
        'FORBIDDEN',
      );
    });

    it('rejects with CONFLICT when a page with the same slug already exists', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getBySlug.mockResolvedValue(makePage());

      await expectErrorWithCode(
        service.createPage(
          { tenantId, userId },
          {
            namespace: 'Runbooks',
            slug: 'chiller-overheating',
            title: 'X',
            body: '# x',
          },
        ),
        'CONFLICT',
      );
    });

    it('creates page + first revision when allowed', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getBySlug.mockResolvedValue(null);
      pageRepo.createWithFirstRevision.mockResolvedValue({
        page: makePage(),
        revision: makeRevision(),
      });

      const { page, revision } = await service.createPage(
        { tenantId, userId },
        {
          namespace: 'Runbooks',
          slug: 'chiller-overheating',
          title: 'Chiller overheating',
          body: '# body',
        },
      );

      expect(page.id).toBe('page-1');
      expect(revision.revisionNumber).toBe(1);
      const callArgs = pageRepo.createWithFirstRevision.mock.calls[0];
      expect(callArgs[0].visibility).toEqual(['TENANT_PRIVATE']); // default
    });
  });

  describe('movePage', () => {
    it('rejects with CONFLICT when target slug already exists', async () => {
      const resolver = makeResolver(['PUBLIC', 'TENANT_PRIVATE']);
      const service = new WikiPageService(pageRepo, revRepo, resolver);
      pageRepo.getById.mockResolvedValue(makePage());
      pageRepo.getBySlug.mockResolvedValue(makePage({ id: 'page-2', slug: 'target' }));

      await expectErrorWithCode(
        service.movePage({ tenantId, userId }, 'page-1', { slug: 'target' }),
        'CONFLICT',
      );
    });
  });
});
