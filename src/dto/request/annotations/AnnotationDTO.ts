import { z } from 'zod';

// =============================================================================
// Annotation request DTOs (RFC-0036, generalized polymorphic target).
//
// `text`+`CHECK` enum sets are mirrored as z.enum(...) here. Cross-field rules
// (response text required unless `approved`; exactly one mention target) use
// .refine(). List endpoints carry the standard limit/cursor pagination params.
// =============================================================================

export const ANNOTATION_ENTITY_TYPES = ['device', 'work_order', 'work_order_event'] as const;
export const ANNOTATION_TYPES = ['observation', 'pending', 'maintenance', 'activity'] as const;
export const ANNOTATION_STATUSES = ['created', 'modified', 'archived'] as const;
export const ANNOTATION_RESPONSE_TYPES = ['approved', 'rejected', 'comment', 'archived'] as const;
export const ANNOTATION_MENTION_TYPES = ['user', 'device'] as const;

export const AnnotationEntityTypeEnum = z.enum(ANNOTATION_ENTITY_TYPES);
export const AnnotationTypeEnum = z.enum(ANNOTATION_TYPES);
export const AnnotationStatusEnum = z.enum(ANNOTATION_STATUSES);
export const AnnotationResponseTypeEnum = z.enum(ANNOTATION_RESPONSE_TYPES);
export const AnnotationMentionTypeEnum = z.enum(ANNOTATION_MENTION_TYPES);

// -----------------------------------------------------------------------------
// Inline mention payload (allowed on create) — same target rule as the
// standalone mention DTO below.
// -----------------------------------------------------------------------------
const InlineMentionSchema = z
  .object({
    mentionType: AnnotationMentionTypeEnum,
    mentionedUserId: z.string().uuid().optional(),
    mentionedDeviceId: z.string().uuid().optional(),
  })
  .refine(
    (m) =>
      (m.mentionType === 'user' && !!m.mentionedUserId && !m.mentionedDeviceId) ||
      (m.mentionType === 'device' && !!m.mentionedDeviceId && !m.mentionedUserId),
    { message: 'Exactly one mention target must match mentionType (user→mentionedUserId, device→mentionedDeviceId)' }
  );

// -----------------------------------------------------------------------------
// Create annotation
// -----------------------------------------------------------------------------
export const CreateAnnotationSchema = z.object({
  entityType: AnnotationEntityTypeEnum,
  entityId: z.string().uuid(),
  customerId: z.string().uuid(),
  text: z.string().min(1).max(255),
  type: AnnotationTypeEnum.default('observation'),
  importance: z.number().int().min(1).max(5).default(3),
  dueDate: z.string().datetime({ offset: true }).optional(),
  mentions: z.array(InlineMentionSchema).max(50).optional(),
});

export type CreateAnnotationDTO = z.infer<typeof CreateAnnotationSchema>;

// -----------------------------------------------------------------------------
// Update annotation (edit text/type/importance/dueDate). Optimistic lock via
// `version` (body) or the If-Match header (resolved in the controller).
// -----------------------------------------------------------------------------
export const UpdateAnnotationSchema = z
  .object({
    text: z.string().min(1).max(255).optional(),
    type: AnnotationTypeEnum.optional(),
    importance: z.number().int().min(1).max(5).optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine(
    (d) => d.text !== undefined || d.type !== undefined || d.importance !== undefined || d.dueDate !== undefined,
    { message: 'At least one of text, type, importance, dueDate must be provided' }
  );

export type UpdateAnnotationDTO = z.infer<typeof UpdateAnnotationSchema>;

// -----------------------------------------------------------------------------
// Add response (comment | approved | rejected | archived). Text required for
// everything except `approved`.
// -----------------------------------------------------------------------------
export const CreateResponseSchema = z
  .object({
    type: AnnotationResponseTypeEnum,
    text: z.string().max(255).optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((r) => r.type === 'approved' || (!!r.text && r.text.length > 0), {
    message: 'text is required for response types other than "approved"',
    path: ['text'],
  });

export type CreateResponseDTO = z.infer<typeof CreateResponseSchema>;

// -----------------------------------------------------------------------------
// Add mention (on the annotation or a specific response)
// -----------------------------------------------------------------------------
export const CreateMentionSchema = z
  .object({
    mentionType: AnnotationMentionTypeEnum,
    mentionedUserId: z.string().uuid().optional(),
    mentionedDeviceId: z.string().uuid().optional(),
    responseId: z.string().uuid().optional(),
  })
  .refine(
    (m) =>
      (m.mentionType === 'user' && !!m.mentionedUserId && !m.mentionedDeviceId) ||
      (m.mentionType === 'device' && !!m.mentionedDeviceId && !m.mentionedUserId),
    { message: 'Exactly one mention target must match mentionType (user→mentionedUserId, device→mentionedDeviceId)' }
  );

export type CreateMentionDTO = z.infer<typeof CreateMentionSchema>;

// -----------------------------------------------------------------------------
// Add attachment by linking an existing file_assets row (optionally to a
// specific response). Multipart upload is a follow-up; this phase links an
// already-uploaded file asset.
// -----------------------------------------------------------------------------
export const CreateAttachmentSchema = z.object({
  fileAssetId: z.string().uuid(),
  responseId: z.string().uuid().optional(),
});

export type CreateAttachmentDTO = z.infer<typeof CreateAttachmentSchema>;

// -----------------------------------------------------------------------------
// List filters
// -----------------------------------------------------------------------------

// Per-entity list (entityType + entityId fixed by the path/query).
export const ListAnnotationsSchema = z.object({
  entityType: AnnotationEntityTypeEnum.optional(),
  entityId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  type: AnnotationTypeEnum.optional(),
  status: AnnotationStatusEnum.optional(),
  importance: z.coerce.number().int().min(1).max(5).optional(),
  mentionedUserId: z.string().uuid().optional(),
  mentionedDeviceId: z.string().uuid().optional(),
  hasAttachments: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListAnnotationsDTO = z.infer<typeof ListAnnotationsSchema>;
