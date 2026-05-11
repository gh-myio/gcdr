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
// POST /wiki/integrations/from-form
// Form-driven creation of an "Integrations" wiki page (RFC-0030 helper).
// Forces namespace='Integrations', visibility=['PUBLIC'], status='PUBLISHED'.
// -----------------------------------------------------------------------------
const IntegrationStatusSchema = z.enum(['ATIVO', 'AVALIACAO', 'DESCONTINUADO']);

export const CreateIntegrationFromFormSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(1).max(2000),
  motivation: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  url: z.string().url().max(500).optional(),
  loginInfo: z.string().max(500).optional(),
  api: z.object({
    docsUrl: z.string().url().max(500).optional(),
    auth: z.string().max(120).optional(),
    endpoints: z.string().max(2000).optional(),
    webhooks: z.string().max(2000).optional(),
  }).optional(),
  cost: z.object({
    value: z.string().max(120).optional(),
    currency: z.string().max(8).optional(),
    model: z.string().max(120).optional(),
  }).optional(),
  plan: z.string().max(120).optional(),
  limits: z.object({
    seats: z.number().int().nonnegative().optional(),
    requestsPerMonth: z.string().max(120).optional(),
    storage: z.string().max(120).optional(),
    other: z.string().max(500).optional(),
  }).optional(),
  owner: z.object({
    responsible: z.string().max(120).optional(),
    backup: z.string().max(120).optional(),
  }).optional(),
  status: IntegrationStatusSchema.optional(),
  dates: z.object({
    contractedAt: z.string().max(40).optional(),
    renewalAt: z.string().max(40).optional(),
    discontinuedAt: z.string().max(40).optional(),
  }).optional(),
  gcdrIntegration: z.string().max(2000).optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  slug: SlugSchema.optional(),
});
export type CreateIntegrationFromFormDTO = z.infer<typeof CreateIntegrationFromFormSchema>;

// -----------------------------------------------------------------------------
// POST /public/wiki/integrations/submit
// Anonymous form-driven submission: lands as DRAFT with TENANT_PRIVATE visibility
// and awaits admin moderation. The admin promotes it to PUBLIC+PUBLISHED later.
// Requires submitter identity for audit and a captcha token for bot defense.
// -----------------------------------------------------------------------------

// Brazilian phone numbers — accepts:
//   "(11) 98765-4321"        — local format with parens
//   "11 98765-4321"          — local without parens
//   "11987654321"            — digits only, 10 or 11 chars
//   "+55 11 98765-4321"      — international BR with country code
// All forms must contain 10 or 11 digits after stripping non-digits, optionally
// prefixed with "+55".
const BR_PHONE_REGEX = /^(\+?55)?[\s.-]?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}$/;

export const SubmitterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(40)
    .regex(BR_PHONE_REGEX, {
      message:
        'Telefone inválido. Use (11) 99999-9999, 11999999999 ou +55 11 99999-9999.',
    }),
});

export const PublicCreateIntegrationFromFormSchema =
  CreateIntegrationFromFormSchema.extend({
    submitter: SubmitterSchema,
    captchaToken: z.string().trim().min(1).max(4000),
    // Honeypot — must be empty. Bots typically fill all fields.
    // The frontend renders this field hidden via CSS, so real users won't see it.
    website: z.string().max(0).optional(),
  });

export type PublicCreateIntegrationFromFormDTO = z.infer<
  typeof PublicCreateIntegrationFromFormSchema
>;
export type SubmitterDTO = z.infer<typeof SubmitterSchema>;

// -----------------------------------------------------------------------------
// List / pagination parameters
// -----------------------------------------------------------------------------
export interface ListPagesParams extends PaginationParams {
  namespace?: string;
  status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  tag?: string;
  q?: string;
  includeDeleted?: boolean;
  includeDrafts?: boolean;
}
