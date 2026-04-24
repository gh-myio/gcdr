import { BaseEntity } from '../../shared/types';

// RFC-0030 — MYIO Wiki (Knowledge Base Module)

export type WikiPageStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Audience tags that govern who can read a wiki page.
 *
 * A page declares one or more tags in `visibility`. A user is allowed to read
 * the page if ANY tag in `page.visibility` is present in the user's
 * `effectiveAudiences` set computed by AudienceResolver.
 */
export type WikiAudience =
  | 'PUBLIC'
  | 'MYIO_INTERNAL'
  | 'PARTNERS'
  | 'HOLDING_CUSTOMERS'
  | 'NON_HOLDING_CUSTOMERS'
  | 'TENANT_PRIVATE';

export const ALL_WIKI_AUDIENCES: readonly WikiAudience[] = [
  'PUBLIC',
  'MYIO_INTERNAL',
  'PARTNERS',
  'HOLDING_CUSTOMERS',
  'NON_HOLDING_CUSTOMERS',
  'TENANT_PRIVATE',
] as const;

export interface WikiPage extends BaseEntity {
  namespace: string;
  slug: string;
  title: string;
  status: WikiPageStatus;
  currentRevisionId: string | null;
  tags: string[];
  visibility: WikiAudience[];
  frontmatter: Record<string, unknown>;
  deletedAt: string | null;
}

export interface WikiPageRevision {
  id: string;
  pageId: string;
  revisionNumber: number;
  title: string;
  body: string;
  bodyHtml: string;
  frontmatter: Record<string, unknown>;
  changeNote: string | null;
  authorId: string;
  createdAt: string;
}

export interface WikiNamespace {
  tenantId: string;
  name: string;
  description: string | null;
  reviewRequired: boolean;
  createdAt: string;
}

/**
 * Named preset the frontend can offer directly instead of surfacing the
 * full set of audience tags. Returned by `GET /wiki/visibility/options`.
 */
export interface WikiVisibilityPreset {
  id: string;
  label: string;
  tags: WikiAudience[];
}
