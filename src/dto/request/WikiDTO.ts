import { z } from 'zod';
import { PaginationParams } from '../../shared/types';

// =============================================================================
// RFC-0030: MYIO Wiki — request schemas
// =============================================================================

export const WikiAudienceSchema = z.enum([
  'PUBLIC',
  'MYIO_INTERNAL',
  'PARTNERS',
  'HOLDING_CUSTOMERS',
  'NON_HOLDING_CUSTOMERS',
  'TENANT_PRIVATE',
]);

const NamespaceSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_-]{0,31}$/,
  'namespace must match ^[A-Za-z][A-Za-z0-9_-]{0,31}$'
);

const SlugSchema = z.string().regex(
  /^[a-z0-9][a-z0-9/_-]{0,127}$/,
  'slug must match ^[a-z0-9][a-z0-9/_-]{0,127}$'
);

const TitleSchema = z.string().min(1).max(200);

const BodySchema = z.string().max(512 * 1024, 'body must be <= 512 KB');

const TagsSchema = z.array(z.string().min(1).max(32)).max(20);

const VisibilitySchema = z.array(WikiAudienceSchema)
  .min(1, 'visibility must contain at least one audience tag')
  .max(6)
  .refine(
    (tags) => new Set(tags).size === tags.length,
    'visibility tags must be unique'
  );

const FrontmatterSchema = z.record(z.unknown());

// -----------------------------------------------------------------------------
// POST /wiki/pages
// -----------------------------------------------------------------------------
export const CreatePageSchema = z.object({
  namespace: NamespaceSchema,
  slug: SlugSchema,
  title: TitleSchema,
  body: BodySchema,
  tags: TagsSchema.optional(),
  visibility: VisibilitySchema.optional(),
  frontmatter: FrontmatterSchema.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  changeNote: z.string().max(500).optional(),
});
export type CreatePageDTO = z.infer<typeof CreatePageSchema>;

// -----------------------------------------------------------------------------
// PUT /wiki/pages/:id  (every save is a revision — body required)
// -----------------------------------------------------------------------------
export const UpdatePageSchema = z.object({
  title: TitleSchema.optional(),
  body: BodySchema,
  tags: TagsSchema.optional(),
  visibility: VisibilitySchema.optional(),
  frontmatter: FrontmatterSchema.optional(),
  changeNote: z.string().max(500).optional(),
});
export type UpdatePageDTO = z.infer<typeof UpdatePageSchema>;

// -----------------------------------------------------------------------------
// PATCH /wiki/pages/:id/move
// -----------------------------------------------------------------------------
export const MovePageSchema = z.object({
  namespace: NamespaceSchema.optional(),
  slug: SlugSchema.optional(),
}).refine(
  (d) => d.namespace !== undefined || d.slug !== undefined,
  { message: 'move requires at least one of { namespace, slug }' }
);
export type MovePageDTO = z.infer<typeof MovePageSchema>;

// -----------------------------------------------------------------------------
// POST /wiki/pages/:id/publish
// -----------------------------------------------------------------------------
export const PublishPageSchema = z.object({
  changeNote: z.string().max(500).optional(),
});
export type PublishPageDTO = z.infer<typeof PublishPageSchema>;

// -----------------------------------------------------------------------------
// Namespaces
// -----------------------------------------------------------------------------
export const CreateNamespaceSchema = z.object({
  name: NamespaceSchema,
  description: z.string().max(500).optional(),
  reviewRequired: z.boolean().optional(),
});
export type CreateNamespaceDTO = z.infer<typeof CreateNamespaceSchema>;

export const UpdateNamespaceSchema = z.object({
  description: z.string().max(500).optional(),
  reviewRequired: z.boolean().optional(),
}).refine(
  (d) => d.description !== undefined || d.reviewRequired !== undefined,
  { message: 'at least one field must be provided' }
);
export type UpdateNamespaceDTO = z.infer<typeof UpdateNamespaceSchema>;

// -----------------------------------------------------------------------------
// List / pagination parameters
// -----------------------------------------------------------------------------
export interface ListPagesParams extends PaginationParams {
  namespace?: string;
  status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  tag?: string;
  q?: string;
  includeDeleted?: boolean;
}
