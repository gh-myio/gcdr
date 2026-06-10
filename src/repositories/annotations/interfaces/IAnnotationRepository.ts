import {
  Annotation,
  AnnotationResponse,
  AnnotationEvent,
  AnnotationMention,
  AnnotationAttachment,
  AnnotationDetail,
  ActorSnapshot,
  AnnotationFinalizedReason,
} from '../../../domain/entities/annotations/Annotation';
import { ListAnnotationsDTO } from '../../../dto/request/annotations/AnnotationDTO';
import { PaginatedResult } from '../../../shared/types';

/** Fields the repository may write when creating an annotation row. */
export interface CreateAnnotationInput {
  entityType: Annotation['entityType'];
  entityId: string;
  customerId: string;
  text: string;
  type: Annotation['type'];
  importance: number;
  dueDate?: string | null;
  createdBy: ActorSnapshot;
}

/** Fields the repository may patch on an annotation edit. */
export interface UpdateAnnotationInput {
  text?: string;
  type?: Annotation['type'];
  importance?: number;
  dueDate?: string | null;
  status?: Annotation['status'];
  updatedBy: ActorSnapshot;
  /** Expected current version (optimistic lock). */
  expectedVersion: number;
}

export interface IAnnotationRepository {
  // Annotations
  create(tenantId: string, input: CreateAnnotationInput): Promise<Annotation>;
  getById(tenantId: string, id: string): Promise<Annotation | null>;
  getDetail(tenantId: string, id: string): Promise<AnnotationDetail | null>;
  list(tenantId: string, params: ListAnnotationsDTO): Promise<PaginatedResult<Annotation>>;
  update(tenantId: string, id: string, input: UpdateAnnotationInput): Promise<Annotation | null>;
  /** Mark finalized (+ reason/status) under optimistic lock; null on version mismatch. */
  finalize(
    tenantId: string,
    id: string,
    reason: AnnotationFinalizedReason,
    status: Annotation['status'],
    updatedBy: ActorSnapshot,
    expectedVersion: number
  ): Promise<Annotation | null>;
  softDelete(tenantId: string, id: string): Promise<void>;

  // Responses
  addResponse(
    tenantId: string,
    annotationId: string,
    type: AnnotationResponse['type'],
    text: string | null,
    createdBy: ActorSnapshot
  ): Promise<AnnotationResponse>;
  getResponseById(tenantId: string, annotationId: string, responseId: string): Promise<AnnotationResponse | null>;
  listResponses(tenantId: string, annotationId: string): Promise<AnnotationResponse[]>;

  // Events (append-only)
  addEvent(
    tenantId: string,
    annotationId: string,
    action: AnnotationEvent['action'],
    actor: ActorSnapshot,
    opts?: { responseId?: string; previousVersion?: number; changes?: AnnotationEvent['changes'] }
  ): Promise<AnnotationEvent>;
  listEvents(tenantId: string, annotationId: string): Promise<AnnotationEvent[]>;

  // Mentions
  addMention(
    tenantId: string,
    annotationId: string,
    mentionType: AnnotationMention['mentionType'],
    target: { mentionedUserId?: string; mentionedDeviceId?: string },
    actor: ActorSnapshot,
    responseId?: string
  ): Promise<AnnotationMention>;
  listMentions(tenantId: string, annotationId: string): Promise<AnnotationMention[]>;

  // Attachments
  addAttachment(
    tenantId: string,
    annotationId: string,
    fileAssetId: string,
    createdBy: ActorSnapshot,
    responseId?: string
  ): Promise<AnnotationAttachment>;
  getAttachmentById(tenantId: string, annotationId: string, attachmentId: string): Promise<AnnotationAttachment | null>;
  listAttachments(tenantId: string, annotationId: string): Promise<AnnotationAttachment[]>;
  removeAttachment(tenantId: string, annotationId: string, attachmentId: string): Promise<void>;
}
