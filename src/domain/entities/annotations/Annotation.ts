// =============================================================================
// Annotation domain entities (RFC-0036, generalized polymorphic target).
//
// An Annotation is a tenant- + customer-scoped note attached to a polymorphic
// entity (a device, a work order, or a work-order event). It carries text, a
// type, an importance (1-5), a lifecycle status, and an append-only event log.
//
// Actor identity is stored as a JSONB snapshot { id, email, name } (RFC-0036
// Rationale A) so the timeline survives user deletion and avoids a JOIN per
// read. The same snapshot shape is reused by responses, events, mentions and
// attachments.
// =============================================================================

/** The polymorphic target kinds an annotation can attach to (RFC-0037). */
export type AnnotationEntityType = 'device' | 'work_order' | 'work_order_event';

export type AnnotationType = 'observation' | 'pending' | 'maintenance' | 'activity';
export type AnnotationStatus = 'created' | 'modified' | 'archived';

/** A finalizing decision recorded on the annotation (locks it once set). */
export type AnnotationFinalizedReason = 'approved' | 'rejected' | 'archived';

export type AnnotationResponseType = 'approved' | 'rejected' | 'comment' | 'archived';

export type AnnotationEventAction =
  | 'created'
  | 'modified'
  | 'archived'
  | 'approved'
  | 'rejected'
  | 'commented'
  | 'acknowledged';

export type AnnotationMentionType = 'user' | 'device';

/**
 * Immutable actor snapshot stored as JSONB. `id`/`email` come from the GCDR
 * `users` table; `name` is derived from `users.profile` (firstName + lastName)
 * since `users` has no top-level name column.
 */
export interface ActorSnapshot {
  id: string;
  email?: string;
  name?: string;
}

/** Aggregate root. */
export interface Annotation {
  id: string;
  tenantId: string;
  customerId: string;

  // Polymorphic target
  entityType: AnnotationEntityType;
  entityId: string;

  schemaVersion: string;
  text: string;
  type: AnnotationType;
  importance: number; // 1..5
  status: AnnotationStatus;

  finalized: boolean;
  finalizedReason?: AnnotationFinalizedReason;
  dueDate?: string;

  // Legacy acknowledge fields (kept for migration fidelity; superseded by responses)
  acknowledged: boolean;
  acknowledgedBy?: ActorSnapshot;
  acknowledgedAt?: string;

  createdBy: ActorSnapshot;
  updatedBy?: ActorSnapshot;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;

  // Migration provenance (idempotency key for the RFC-0036 Phase 1 backfill)
  legacyId?: string;
}

/** A comment (non-finalizing) or a finalizing decision on an annotation. */
export interface AnnotationResponse {
  id: string;
  tenantId: string;
  annotationId: string;
  type: AnnotationResponseType;
  text?: string;
  createdBy: ActorSnapshot;
  createdAt: string;
  legacyId?: string;
}

/** Append-only history row mirroring the legacy `history[]`. */
export interface AnnotationEvent {
  id: string;
  tenantId: string;
  annotationId: string;
  responseId?: string;
  action: AnnotationEventAction;
  previousVersion?: number;
  changes?: Record<string, { from: unknown; to: unknown }>;
  actor: ActorSnapshot;
  createdAt: string;
}

/** A mention of another user or device, on the annotation or on a response. */
export interface AnnotationMention {
  id: string;
  tenantId: string;
  annotationId: string;
  responseId?: string;
  mentionType: AnnotationMentionType;
  mentionedUserId?: string;
  mentionedDeviceId?: string;
  actor: ActorSnapshot;
  createdAt: string;
}

/** A file_assets link, on the annotation or on a response. */
export interface AnnotationAttachment {
  id: string;
  tenantId: string;
  annotationId: string;
  responseId?: string;
  fileAssetId: string;
  createdBy: ActorSnapshot;
  createdAt: string;
}

/**
 * Full annotation aggregate returned by GET /annotations/:id — the annotation
 * plus its responses, events, mentions and attachments.
 */
export interface AnnotationDetail extends Annotation {
  responses: AnnotationResponse[];
  events: AnnotationEvent[];
  mentions: AnnotationMention[];
  attachments: AnnotationAttachment[];
}
