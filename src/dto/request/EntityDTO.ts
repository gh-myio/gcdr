import { z } from 'zod';

// =============================================================================
// RFC-0047 — Generic Entity Registry · request DTOs
// =============================================================================
// Zod request schemas for /api/v1/entities + a per-`entity_type` metadata
// schema registry (`.strict()`) applied on every write (must-fix #10). See
// docs/rfcs/RFC-0047-Entity-API.md (wire contract) and the narrative RFC.

/** Bounded subtree depth for `deep` traversal. Mirrors ENTITY_MAX_DEPTH. */
export const ENTITY_MAX_DEPTH = 5;

/** Default / max page size for list. */
export const ENTITY_DEFAULT_PAGE_SIZE = 50;
export const ENTITY_MAX_PAGE_SIZE = 200;

/** Sortable fields for `GET /entities?sort=<field>_<asc|desc>`. */
export const ENTITY_SORT_FIELDS = [
  'sort_order',
  'entity_key',
  'entity_type',
  'created_at',
  'updated_at',
  'version',
] as const;

export type EntitySortField = (typeof ENTITY_SORT_FIELDS)[number];

// `<field>_<asc|desc>` — e.g. `sort_order_asc`, `entity_key_desc`.
const SORT_REGEX = new RegExp(`^(${ENTITY_SORT_FIELDS.join('|')})_(asc|desc)$`);

/**
 * An `entity_type` natural key: SCREAMING_SNAKE-ish token. Kept permissive
 * (registry FK is the real authority) but disallows separators that could leak
 * into metadata-path / sort parsing. 1..64 chars, [A-Z0-9_].
 */
const ENTITY_TYPE_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;
const entityTypeToken = z.string().regex(ENTITY_TYPE_REGEX, 'invalid entity_type token');

// `entity_key`: stable taxonomy/classifier key; non-empty, capped.
const entityKey = z.string().min(1).max(255);

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------

export const CreateEntitySchema = z.object({
  entityType: entityTypeToken,
  entityKey: entityKey,
  entityValue: z.string().max(1000).nullable().optional(),
  parentEntityId: z.string().uuid().nullable().optional(),
  // customerId: null/omitted = system default; a uuid = a customer override.
  customerId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  // isSystem: mint a protected system default. Admin-only + customerId must be
  // null (DB CHECK entities_system_scope); both are enforced in the service.
  isSystem: z.boolean().default(false),
  // Per-type shape is validated in the service via validateMetadataForType().
  metadata: z.record(z.unknown()).default({}),
});

export type CreateEntityDTO = z.infer<typeof CreateEntitySchema>;

// -----------------------------------------------------------------------------
// entity_types registry — create / update (admin tier)
// -----------------------------------------------------------------------------

export const CreateEntityTypeSchema = z.object({
  entityType: entityTypeToken,
  label: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  allowedParentTypes: z.array(entityTypeToken).default([]),
});

export type CreateEntityTypeDTO = z.infer<typeof CreateEntityTypeSchema>;

/** Merge-patch for an entity_type; at least one field required. */
export const UpdateEntityTypeSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    allowedParentTypes: z.array(entityTypeToken).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });

export type UpdateEntityTypeDTO = z.infer<typeof UpdateEntityTypeSchema>;

export const UpdateEntitySchema = z.object({
  entityKey: entityKey.optional(),
  entityValue: z.string().max(1000).nullable().optional(),
  parentEntityId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  // JSON Merge Patch (RFC 7396) top-level merge: null on a key removes it.
  // `?metadataMode=replace` (query) swaps wholesale; both validated in service.
  metadata: z.record(z.unknown()).optional(),
  // Optimistic lock — if sent and stale -> 409 VERSION_CONFLICT; absent -> LWW.
  version: z.number().int().positive().optional(),
});

export type UpdateEntityDTO = z.infer<typeof UpdateEntitySchema>;

// -----------------------------------------------------------------------------
// List / search query
// -----------------------------------------------------------------------------

// Coercions tolerate query-string inputs (everything arrives as string).
const repeatableType = z
  .union([entityTypeToken, z.array(entityTypeToken)])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

const repeatableId = z
  .union([z.string().uuid(), z.array(z.string().uuid())])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

// parentId may be a uuid or the literal string "null" (-> roots).
const parentIdFilter = z
  .union([z.literal('null'), z.string().uuid()])
  .optional();

// deep: 0..ENTITY_MAX_DEPTH or the literal "all".
const deepFilter = z
  .union([z.literal('all'), z.coerce.number().int().min(0).max(ENTITY_MAX_DEPTH)])
  .default(0);

export const ListEntitiesQuerySchema = z.object({
  type: repeatableType,
  key: entityKey.optional(),
  value: z.string().max(1000).optional(),
  q: z.string().max(255).optional(),
  id: repeatableId,
  parentId: parentIdFilter,
  customerId: z.string().uuid().optional(),
  scope: z.enum(['system', 'customer', 'all']).default('system'),
  state: z.enum(['active', 'inactive', 'all']).default('active'),
  includeDeleted: z.coerce.boolean().default(false),
  deep: deepFilter,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(ENTITY_MAX_PAGE_SIZE).default(ENTITY_DEFAULT_PAGE_SIZE),
  sort: z.string().regex(SORT_REGEX).default('sort_order_asc'),
}).passthrough(); // metadata.<path> containment filters arrive as extra keys; parsed in service.

export type ListEntitiesQueryDTO = z.infer<typeof ListEntitiesQuerySchema>;

// -----------------------------------------------------------------------------
// Clone / revert
// -----------------------------------------------------------------------------

export const CloneSchema = z.object({
  customerId: z.string().uuid(),
});

export type CloneDTO = z.infer<typeof CloneSchema>;

export const RevertSchema = z.object({
  customerId: z.string().uuid(),
});

export type RevertDTO = z.infer<typeof RevertSchema>;

// -----------------------------------------------------------------------------
// Bulk-replace (atomic whole-subtree swap for a (customerId, type))
// -----------------------------------------------------------------------------

// A node in the new forest. `children` recurse; `parentEntityId` is implied by
// nesting (the service remaps ids). `sortOrder` is taken from order/field.
export interface BulkReplaceNodeInput {
  entityKey: string;
  entityValue?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  children?: BulkReplaceNodeInput[];
}

const BulkReplaceNodeSchema: z.ZodType<BulkReplaceNodeInput> = z.lazy(() =>
  z.object({
    entityKey: entityKey,
    entityValue: z.string().max(1000).nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    children: z.array(BulkReplaceNodeSchema).optional(),
  }),
);

export const BulkReplaceSchema = z.object({
  roots: z.array(BulkReplaceNodeSchema),
});

export type BulkReplaceDTO = z.infer<typeof BulkReplaceSchema>;

// Query params for PUT /entities/bulk-replace (customerId + type required).
export const BulkReplaceQuerySchema = z.object({
  customerId: z.string().uuid(),
  type: entityTypeToken,
});

export type BulkReplaceQueryDTO = z.infer<typeof BulkReplaceQuerySchema>;

// =============================================================================
// Per-`entity_type` metadata schema registry (must-fix #10)
// =============================================================================
// The `metadata` jsonb column has no DB-level shape. When a consumer reads
// structured fields out of it (e.g. RFC-0207's classifier reads role/rules/
// formula), the SERVICE validates `metadata` on every write with the schema
// registered for that `entity_type` — `.strict()` so unknown keys are rejected
// (-> 400 VALIDATION_ERROR). A type with NO registered schema accepts free-form
// metadata (back-compat). Containment filters stay over top-level scalars only.

/**
 * RFC-0207 device-classification metadata. The `CLASSIFICATION_*` types store
 * display/role/rule fields here. `icon` is checked against a synced curated
 * token set in a later layer (a checked-in mirror, not a hard enum) — here it
 * is just a bounded string. `rules`/`formula` are opaque read payload, never
 * filter predicates.
 */
export const ClassificationMetadataSchema = z
  .object({
    label: z.string().min(1).max(255),
    domain: z.string().max(64).optional(),
    icon: z.string().max(128).optional(),
    role: z.string().max(64).optional(),
    rules: z.unknown().optional(),
    formula: z.unknown().optional(),
  })
  .strict();

export type ClassificationMetadata = z.infer<typeof ClassificationMetadataSchema>;

/**
 * The registry: `entity_type` -> the Zod schema its `metadata` must satisfy.
 * Add an entry to enforce a shape on a type; omit a type to keep it free-form.
 * Keys must be a subset of the seeded `entity_types`.
 */
export const ENTITY_METADATA_SCHEMAS: Record<string, z.ZodTypeAny> = {
  CLASSIFICATION_ENERGY: ClassificationMetadataSchema,
  CLASSIFICATION_WATER: ClassificationMetadataSchema,
  CLASSIFICATION_TEMPERATURE: ClassificationMetadataSchema,
  CLASSIFICATION_NODE: ClassificationMetadataSchema,
};

/**
 * Validate `metadata` for a given `entity_type`. Returns the parsed metadata
 * (defaults applied / unknown keys rejected) on success. Types with no
 * registered schema pass through unchanged (free-form, back-compat).
 *
 * Used by the service write path (create / update / bulk-replace). On failure
 * the caller maps the ZodError to `400 VALIDATION_ERROR`.
 */
export function validateMetadataForType(
  entityType: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const schema = ENTITY_METADATA_SCHEMAS[entityType];
  if (!schema) return metadata; // free-form
  return schema.parse(metadata) as Record<string, unknown>;
}

/**
 * Non-throwing variant mirroring Zod's `safeParse`, for callers that want to
 * collect issues without a try/catch.
 */
export function safeValidateMetadataForType(
  entityType: string,
  metadata: Record<string, unknown>,
): z.SafeParseReturnType<unknown, unknown> {
  const schema = ENTITY_METADATA_SCHEMAS[entityType] ?? z.record(z.unknown());
  return schema.safeParse(metadata);
}
