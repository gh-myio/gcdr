// =============================================================================
// AnnotationService — lifecycle, finalization, optimistic-locking and event
// emission for the generalized (polymorphic) annotation subsystem (RFC-0036).
//
// Lifecycle rules (RFC-0036 §Guide-Level):
//   - create → status 'created', version 1, append 'created' event.
//   - edit (text/type/importance/dueDate) → status 'modified', version++,
//     append 'modified' event with a field-level diff. Optimistic lock on
//     the expected version (409 on mismatch).
//   - comment response (type='comment') → does NOT finalize, does NOT change
//     status; append 'commented' event.
//   - finalizing response (approved|rejected|archived) → sets finalized=true +
//     finalizedReason; 'archived' also moves status to 'archived'. Once
//     finalized, no further edits/archives/responses are accepted.
//   - mentions / attachments target the annotation or a specific response.
//
// Actor identity is a JSONB snapshot { id, email, name } resolved from the
// acting user and persisted on every row (RFC-0036 Rationale A).
// =============================================================================

import {
  Annotation,
  AnnotationDetail,
  AnnotationResponse,
  AnnotationMention,
  AnnotationAttachment,
  ActorSnapshot,
  AnnotationFinalizedReason,
} from '../domain/entities/annotations/Annotation';
import {
  CreateAnnotationDTO,
  UpdateAnnotationDTO,
  CreateResponseDTO,
  CreateMentionDTO,
  CreateAttachmentDTO,
  ListAnnotationsDTO,
} from '../dto/request/annotations/AnnotationDTO';
import { AnnotationRepository } from '../repositories/annotations/AnnotationRepository';
import { IAnnotationRepository } from '../repositories/annotations/interfaces/IAnnotationRepository';
import { userRepository } from '../repositories/UserRepository';
import { deviceRepository } from '../repositories/DeviceRepository';
import { fileAssetService } from './FileAssetService';
import { workOrderService } from './work-orders/WorkOrderService';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';

const FINALIZING_TYPES: ReadonlyArray<AnnotationResponse['type']> = ['approved', 'rejected', 'archived'];

export interface ActorContext {
  tenantId: string;
  userId: string;
  /** Optional pre-resolved actor; when absent the service resolves from userId. */
  actor?: ActorSnapshot;
}

export class AnnotationService {
  private repo: IAnnotationRepository;

  constructor(repo?: IAnnotationRepository) {
    this.repo = repo || new AnnotationRepository();
  }

  // ===========================================================================
  // Mirror an annotation lifecycle change as a marker event on the work order
  // timeline (RFC-0037 OBSERVACAO_* markers). Best-effort: a missing/inactive
  // marker type or work order must never fail the annotation operation. Only
  // 'work_order' targets map directly; 'work_order_event' and 'device' don't.
  // ===========================================================================
  private async mirrorObservationToWorkOrder(
    ctx: ActorContext,
    target: { entityType: string; entityId: string },
    actor: ActorSnapshot,
    eventType: 'OBSERVACAO_INSERIDA' | 'OBSERVACAO_EDITADA' | 'OBSERVACAO_DELETADA' | 'OBSERVACAO_ARQUIVADA',
    annotationId: string,
  ): Promise<void> {
    if (target.entityType !== 'work_order') return;
    try {
      await workOrderService.appendObservationMarker(
        ctx.tenantId,
        target.entityId,
        eventType,
        annotationId,
        { userId: ctx.userId, actorType: 'USER', actor: { id: actor.id, email: actor.email, name: actor.name } },
      );
    } catch {
      // swallow — the annotation itself already succeeded
    }
  }

  // ===========================================================================
  // Actor resolution — build a { id, email, name } snapshot from the user row.
  // Falls back to a bare { id } snapshot for non-user actors (e.g. 'system').
  // ===========================================================================
  private async resolveActor(tenantId: string, userId: string, supplied?: ActorSnapshot): Promise<ActorSnapshot> {
    if (supplied) return supplied;
    const user = await userRepository.getById(tenantId, userId);
    if (!user) return { id: userId };
    const first = user.profile?.firstName;
    const last = user.profile?.lastName;
    const display = user.profile?.displayName;
    const name = display || [first, last].filter(Boolean).join(' ').trim() || undefined;
    return { id: user.id, email: user.email, name };
  }

  // ===========================================================================
  // Create
  // ===========================================================================
  async create(ctx: ActorContext, data: CreateAnnotationDTO): Promise<AnnotationDetail> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);

    // Polymorphic target integrity is enforced here (no DB FK). For a 'device'
    // target the device must exist in the tenant.
    if (data.entityType === 'device') {
      const device = await deviceRepository.getById(ctx.tenantId, data.entityId);
      if (!device) {
        throw new NotFoundError(`Device ${data.entityId} not found`);
      }
    }

    const annotation = await this.repo.create(ctx.tenantId, {
      entityType: data.entityType,
      entityId: data.entityId,
      customerId: data.customerId,
      text: data.text,
      type: data.type,
      importance: data.importance,
      dueDate: data.dueDate ?? null,
      createdBy: actor,
    });

    await this.repo.addEvent(ctx.tenantId, annotation.id, 'created', actor);

    // Inline mentions on create
    if (data.mentions?.length) {
      for (const m of data.mentions) {
        await this.addMentionInternal(ctx.tenantId, annotation.id, actor, {
          mentionType: m.mentionType,
          mentionedUserId: m.mentionedUserId,
          mentionedDeviceId: m.mentionedDeviceId,
        });
      }
    }

    await this.mirrorObservationToWorkOrder(
      ctx,
      { entityType: data.entityType, entityId: data.entityId },
      actor,
      'OBSERVACAO_INSERIDA',
      annotation.id,
    );

    const detail = await this.repo.getDetail(ctx.tenantId, annotation.id);
    if (!detail) throw new NotFoundError(`Annotation ${annotation.id} not found`);
    return detail;
  }

  // ===========================================================================
  // Read
  // ===========================================================================
  async getById(tenantId: string, id: string): Promise<AnnotationDetail> {
    const detail = await this.repo.getDetail(tenantId, id);
    if (!detail) throw new NotFoundError(`Annotation ${id} not found`);
    return detail;
  }

  async list(tenantId: string, params: ListAnnotationsDTO): Promise<PaginatedResult<Annotation>> {
    return this.repo.list(tenantId, params);
  }

  // ===========================================================================
  // Edit (optimistic lock)
  // ===========================================================================
  async update(ctx: ActorContext, id: string, data: UpdateAnnotationDTO): Promise<AnnotationDetail> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);
    const existing = await this.requireActive(ctx.tenantId, id);
    this.assertNotFinalized(existing, 'edit');

    const expectedVersion = data.version ?? existing.version;

    const changes = this.diff(existing, data);

    const updated = await this.repo.update(ctx.tenantId, id, {
      text: data.text,
      type: data.type,
      importance: data.importance,
      dueDate: data.dueDate,
      status: 'modified',
      updatedBy: actor,
      expectedVersion,
    });

    if (!updated) {
      throw new ConflictError('Annotation was modified by another process');
    }

    await this.repo.addEvent(ctx.tenantId, id, 'modified', actor, {
      previousVersion: existing.version,
      changes: Object.keys(changes).length ? changes : undefined,
    });

    await this.mirrorObservationToWorkOrder(
      ctx,
      { entityType: existing.entityType, entityId: existing.entityId },
      actor,
      'OBSERVACAO_EDITADA',
      id,
    );

    return this.getById(ctx.tenantId, id);
  }

  // ===========================================================================
  // Archive (finalizing)
  // ===========================================================================
  async archive(ctx: ActorContext, id: string, expectedVersion?: number): Promise<AnnotationDetail> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);
    const existing = await this.requireActive(ctx.tenantId, id);
    this.assertNotFinalized(existing, 'archive');

    const finalized = await this.repo.finalize(
      ctx.tenantId,
      id,
      'archived',
      'archived',
      actor,
      expectedVersion ?? existing.version
    );
    if (!finalized) {
      throw new ConflictError('Annotation was modified by another process');
    }

    await this.repo.addEvent(ctx.tenantId, id, 'archived', actor, { previousVersion: existing.version });

    await this.mirrorObservationToWorkOrder(
      ctx,
      { entityType: existing.entityType, entityId: existing.entityId },
      actor,
      'OBSERVACAO_ARQUIVADA',
      id,
    );

    return this.getById(ctx.tenantId, id);
  }

  // ===========================================================================
  // Responses (comment | approved | rejected | archived)
  // ===========================================================================
  async addResponse(ctx: ActorContext, id: string, data: CreateResponseDTO): Promise<AnnotationResponse> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);
    const existing = await this.requireActive(ctx.tenantId, id);
    this.assertNotFinalized(existing, 'respond to');

    const text = data.text ?? null;
    const response = await this.repo.addResponse(ctx.tenantId, id, data.type, text, actor);

    const isFinalizing = FINALIZING_TYPES.includes(data.type);

    if (isFinalizing) {
      // approved | rejected | archived all finalize the annotation. 'archived'
      // additionally moves status to 'archived'.
      const reason = data.type as AnnotationFinalizedReason;
      const newStatus = data.type === 'archived' ? 'archived' : existing.status;
      const finalized = await this.repo.finalize(
        ctx.tenantId,
        id,
        reason,
        newStatus,
        actor,
        data.version ?? existing.version
      );
      if (!finalized) {
        throw new ConflictError('Annotation was modified by another process');
      }
      // reason ∈ approved|rejected|archived — each is a valid event action.
      await this.repo.addEvent(ctx.tenantId, id, reason, actor, {
        responseId: response.id,
        previousVersion: existing.version,
      });
    } else {
      // comment — does not finalize, does not change status.
      await this.repo.addEvent(ctx.tenantId, id, 'commented', actor, { responseId: response.id });
    }

    return response;
  }

  // ===========================================================================
  // Mentions
  // ===========================================================================
  async addMention(ctx: ActorContext, id: string, data: CreateMentionDTO): Promise<AnnotationMention> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);
    await this.requireActive(ctx.tenantId, id);

    if (data.responseId) {
      const response = await this.repo.getResponseById(ctx.tenantId, id, data.responseId);
      if (!response) throw new NotFoundError(`Response ${data.responseId} not found on annotation ${id}`);
    }

    return this.addMentionInternal(ctx.tenantId, id, actor, data, data.responseId);
  }

  private async addMentionInternal(
    tenantId: string,
    annotationId: string,
    actor: ActorSnapshot,
    data: { mentionType: AnnotationMention['mentionType']; mentionedUserId?: string; mentionedDeviceId?: string },
    responseId?: string
  ): Promise<AnnotationMention> {
    // Referential integrity for the mention target.
    if (data.mentionType === 'user') {
      if (!data.mentionedUserId) throw new ValidationError('mentionedUserId is required for mentionType=user');
      const user = await userRepository.getById(tenantId, data.mentionedUserId);
      if (!user) throw new NotFoundError(`Mentioned user ${data.mentionedUserId} not found`);
    } else {
      if (!data.mentionedDeviceId) throw new ValidationError('mentionedDeviceId is required for mentionType=device');
      const device = await deviceRepository.getById(tenantId, data.mentionedDeviceId);
      if (!device) throw new NotFoundError(`Mentioned device ${data.mentionedDeviceId} not found`);
    }

    return this.repo.addMention(
      tenantId,
      annotationId,
      data.mentionType,
      { mentionedUserId: data.mentionedUserId, mentionedDeviceId: data.mentionedDeviceId },
      actor,
      responseId
    );
  }

  // ===========================================================================
  // Attachments — link an existing file_assets row (active annotation only).
  // ===========================================================================
  async addAttachment(ctx: ActorContext, id: string, data: CreateAttachmentDTO): Promise<AnnotationAttachment> {
    const actor = await this.resolveActor(ctx.tenantId, ctx.userId, ctx.actor);
    const existing = await this.requireActive(ctx.tenantId, id);
    this.assertNotFinalized(existing, 'attach to');

    // The file asset must exist in the tenant (throws NotFoundError otherwise).
    await fileAssetService.getById(ctx.tenantId, data.fileAssetId);

    if (data.responseId) {
      const response = await this.repo.getResponseById(ctx.tenantId, id, data.responseId);
      if (!response) throw new NotFoundError(`Response ${data.responseId} not found on annotation ${id}`);
    }

    return this.repo.addAttachment(ctx.tenantId, id, data.fileAssetId, actor, data.responseId);
  }

  async removeAttachment(ctx: ActorContext, id: string, attachmentId: string): Promise<void> {
    const existing = await this.requireActive(ctx.tenantId, id);
    this.assertNotFinalized(existing, 'detach from');

    const attachment = await this.repo.getAttachmentById(ctx.tenantId, id, attachmentId);
    if (!attachment) throw new NotFoundError(`Attachment ${attachmentId} not found on annotation ${id}`);

    await this.repo.removeAttachment(ctx.tenantId, id, attachmentId);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  private async requireActive(tenantId: string, id: string): Promise<Annotation> {
    const annotation = await this.repo.getById(tenantId, id);
    if (!annotation) throw new NotFoundError(`Annotation ${id} not found`);
    return annotation;
  }

  private assertNotFinalized(annotation: Annotation, action: string): void {
    if (annotation.finalized) {
      throw new ConflictError(
        `Annotation is finalized (${annotation.finalizedReason ?? 'finalized'}); cannot ${action} it`
      );
    }
  }

  private diff(existing: Annotation, data: UpdateAnnotationDTO): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (data.text !== undefined && data.text !== existing.text) {
      changes.text = { from: existing.text, to: data.text };
    }
    if (data.type !== undefined && data.type !== existing.type) {
      changes.type = { from: existing.type, to: data.type };
    }
    if (data.importance !== undefined && data.importance !== existing.importance) {
      changes.importance = { from: existing.importance, to: data.importance };
    }
    if (data.dueDate !== undefined) {
      const to = data.dueDate ?? null;
      const from = existing.dueDate ?? null;
      if (to !== from) changes.dueDate = { from, to };
    }
    return changes;
  }
}

// Export singleton instance
export const annotationService = new AnnotationService();
