import { eq, and, sql, desc, isNull, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import {
  Annotation,
  AnnotationResponse,
  AnnotationEvent,
  AnnotationMention,
  AnnotationAttachment,
  AnnotationDetail,
  ActorSnapshot,
  AnnotationFinalizedReason,
} from '../../domain/entities/annotations/Annotation';
import { ListAnnotationsDTO } from '../../dto/request/annotations/AnnotationDTO';
import { PaginatedResult } from '../../shared/types';
import {
  IAnnotationRepository,
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from './interfaces/IAnnotationRepository';

const {
  annotations,
  annotationResponses,
  annotationEvents,
  annotationMentions,
  annotationAttachments,
} = schema;

export class AnnotationRepository implements IAnnotationRepository {
  // ===========================================================================
  // Annotations
  // ===========================================================================

  async create(tenantId: string, input: CreateAnnotationInput): Promise<Annotation> {
    const [row] = await db
      .insert(annotations)
      .values({
        tenantId,
        customerId: input.customerId,
        entityType: input.entityType,
        entityId: input.entityId,
        text: input.text,
        type: input.type,
        importance: input.importance,
        status: 'created',
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdBy: input.createdBy,
        version: 1,
      })
      .returning();

    return this.mapAnnotation(row);
  }

  async getById(tenantId: string, id: string): Promise<Annotation | null> {
    const [row] = await db
      .select()
      .from(annotations)
      .where(and(eq(annotations.tenantId, tenantId), eq(annotations.id, id), isNull(annotations.deletedAt)))
      .limit(1);
    return row ? this.mapAnnotation(row) : null;
  }

  async getDetail(tenantId: string, id: string): Promise<AnnotationDetail | null> {
    const annotation = await this.getById(tenantId, id);
    if (!annotation) return null;

    const [responses, events, mentions, attachments] = await Promise.all([
      this.listResponses(tenantId, id),
      this.listEvents(tenantId, id),
      this.listMentions(tenantId, id),
      this.listAttachments(tenantId, id),
    ]);

    return { ...annotation, responses, events, mentions, attachments };
  }

  async list(tenantId: string, params: ListAnnotationsDTO): Promise<PaginatedResult<Annotation>> {
    const limit = params.limit ?? 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions: SQL[] = [eq(annotations.tenantId, tenantId), isNull(annotations.deletedAt)];

    if (params.entityType) conditions.push(eq(annotations.entityType, params.entityType));
    if (params.entityId) conditions.push(eq(annotations.entityId, params.entityId));
    if (params.customerId) conditions.push(eq(annotations.customerId, params.customerId));
    if (params.type) conditions.push(eq(annotations.type, params.type));
    if (params.status) conditions.push(eq(annotations.status, params.status));
    if (params.importance !== undefined) conditions.push(eq(annotations.importance, params.importance));
    if (!params.includeArchived) conditions.push(sql`${annotations.status} <> 'archived'`);

    // Mention filters (sub-select against annotation_mentions).
    if (params.mentionedUserId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${annotationMentions} m WHERE m.annotation_id = ${annotations.id} AND m.mentioned_user_id = ${params.mentionedUserId})`
      );
    }
    if (params.mentionedDeviceId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${annotationMentions} m WHERE m.annotation_id = ${annotations.id} AND m.mentioned_device_id = ${params.mentionedDeviceId})`
      );
    }
    if (params.hasAttachments) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${annotationAttachments} a WHERE a.annotation_id = ${annotations.id})`
      );
    }

    const where = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(annotations)
        .where(where)
        .orderBy(desc(annotations.createdAt))
        .limit(limit + 1)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(annotations).where(where),
    ]);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => this.mapAnnotation(r));

    return {
      items,
      pagination: {
        total: count,
        totalPages: Math.ceil((count || 0) / limit),
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async update(tenantId: string, id: string, input: UpdateAnnotationInput): Promise<Annotation | null> {
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
      version: sql`${annotations.version} + 1`,
    };
    if (input.text !== undefined) set.text = input.text;
    if (input.type !== undefined) set.type = input.type;
    if (input.importance !== undefined) set.importance = input.importance;
    if (input.dueDate !== undefined) set.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.status !== undefined) set.status = input.status;

    const [row] = await db
      .update(annotations)
      .set(set)
      .where(
        and(
          eq(annotations.tenantId, tenantId),
          eq(annotations.id, id),
          eq(annotations.version, input.expectedVersion),
          isNull(annotations.deletedAt)
        )
      )
      .returning();

    return row ? this.mapAnnotation(row) : null;
  }

  async finalize(
    tenantId: string,
    id: string,
    reason: AnnotationFinalizedReason,
    status: Annotation['status'],
    updatedBy: ActorSnapshot,
    expectedVersion: number
  ): Promise<Annotation | null> {
    const [row] = await db
      .update(annotations)
      .set({
        finalized: true,
        finalizedReason: reason,
        status,
        updatedAt: new Date(),
        updatedBy,
        version: sql`${annotations.version} + 1`,
      })
      .where(
        and(
          eq(annotations.tenantId, tenantId),
          eq(annotations.id, id),
          eq(annotations.version, expectedVersion),
          isNull(annotations.deletedAt)
        )
      )
      .returning();

    return row ? this.mapAnnotation(row) : null;
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await db
      .update(annotations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(annotations.tenantId, tenantId), eq(annotations.id, id)));
  }

  // ===========================================================================
  // Responses
  // ===========================================================================

  async addResponse(
    tenantId: string,
    annotationId: string,
    type: AnnotationResponse['type'],
    text: string | null,
    createdBy: ActorSnapshot
  ): Promise<AnnotationResponse> {
    const [row] = await db
      .insert(annotationResponses)
      .values({ tenantId, annotationId, type, text, createdBy })
      .returning();
    return this.mapResponse(row);
  }

  async getResponseById(
    tenantId: string,
    annotationId: string,
    responseId: string
  ): Promise<AnnotationResponse | null> {
    const [row] = await db
      .select()
      .from(annotationResponses)
      .where(
        and(
          eq(annotationResponses.tenantId, tenantId),
          eq(annotationResponses.annotationId, annotationId),
          eq(annotationResponses.id, responseId)
        )
      )
      .limit(1);
    return row ? this.mapResponse(row) : null;
  }

  async listResponses(tenantId: string, annotationId: string): Promise<AnnotationResponse[]> {
    const rows = await db
      .select()
      .from(annotationResponses)
      .where(and(eq(annotationResponses.tenantId, tenantId), eq(annotationResponses.annotationId, annotationId)))
      .orderBy(annotationResponses.createdAt);
    return rows.map((r) => this.mapResponse(r));
  }

  // ===========================================================================
  // Events (append-only)
  // ===========================================================================

  async addEvent(
    tenantId: string,
    annotationId: string,
    action: AnnotationEvent['action'],
    actor: ActorSnapshot,
    opts?: { responseId?: string; previousVersion?: number; changes?: AnnotationEvent['changes'] }
  ): Promise<AnnotationEvent> {
    const [row] = await db
      .insert(annotationEvents)
      .values({
        tenantId,
        annotationId,
        action,
        actor,
        responseId: opts?.responseId ?? null,
        previousVersion: opts?.previousVersion ?? null,
        changes: opts?.changes ?? null,
      })
      .returning();
    return this.mapEvent(row);
  }

  async listEvents(tenantId: string, annotationId: string): Promise<AnnotationEvent[]> {
    const rows = await db
      .select()
      .from(annotationEvents)
      .where(and(eq(annotationEvents.tenantId, tenantId), eq(annotationEvents.annotationId, annotationId)))
      .orderBy(annotationEvents.createdAt);
    return rows.map((r) => this.mapEvent(r));
  }

  // ===========================================================================
  // Mentions
  // ===========================================================================

  async addMention(
    tenantId: string,
    annotationId: string,
    mentionType: AnnotationMention['mentionType'],
    target: { mentionedUserId?: string; mentionedDeviceId?: string },
    actor: ActorSnapshot,
    responseId?: string
  ): Promise<AnnotationMention> {
    const [row] = await db
      .insert(annotationMentions)
      .values({
        tenantId,
        annotationId,
        mentionType,
        mentionedUserId: target.mentionedUserId ?? null,
        mentionedDeviceId: target.mentionedDeviceId ?? null,
        actor,
        responseId: responseId ?? null,
      })
      .returning();
    return this.mapMention(row);
  }

  async listMentions(tenantId: string, annotationId: string): Promise<AnnotationMention[]> {
    const rows = await db
      .select()
      .from(annotationMentions)
      .where(and(eq(annotationMentions.tenantId, tenantId), eq(annotationMentions.annotationId, annotationId)))
      .orderBy(annotationMentions.createdAt);
    return rows.map((r) => this.mapMention(r));
  }

  // ===========================================================================
  // Attachments
  // ===========================================================================

  async addAttachment(
    tenantId: string,
    annotationId: string,
    fileAssetId: string,
    createdBy: ActorSnapshot,
    responseId?: string
  ): Promise<AnnotationAttachment> {
    const [row] = await db
      .insert(annotationAttachments)
      .values({ tenantId, annotationId, fileAssetId, createdBy, responseId: responseId ?? null })
      .returning();
    return this.mapAttachment(row);
  }

  async getAttachmentById(
    tenantId: string,
    annotationId: string,
    attachmentId: string
  ): Promise<AnnotationAttachment | null> {
    const [row] = await db
      .select()
      .from(annotationAttachments)
      .where(
        and(
          eq(annotationAttachments.tenantId, tenantId),
          eq(annotationAttachments.annotationId, annotationId),
          eq(annotationAttachments.id, attachmentId)
        )
      )
      .limit(1);
    return row ? this.mapAttachment(row) : null;
  }

  async listAttachments(tenantId: string, annotationId: string): Promise<AnnotationAttachment[]> {
    const rows = await db
      .select()
      .from(annotationAttachments)
      .where(and(eq(annotationAttachments.tenantId, tenantId), eq(annotationAttachments.annotationId, annotationId)))
      .orderBy(annotationAttachments.createdAt);
    return rows.map((r) => this.mapAttachment(r));
  }

  async removeAttachment(tenantId: string, annotationId: string, attachmentId: string): Promise<void> {
    await db
      .delete(annotationAttachments)
      .where(
        and(
          eq(annotationAttachments.tenantId, tenantId),
          eq(annotationAttachments.annotationId, annotationId),
          eq(annotationAttachments.id, attachmentId)
        )
      );
  }

  // ===========================================================================
  // Row mappers
  // ===========================================================================

  private mapAnnotation(row: typeof annotations.$inferSelect): Annotation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      entityType: row.entityType as Annotation['entityType'],
      entityId: row.entityId,
      schemaVersion: row.schemaVersion,
      text: row.text,
      type: row.type as Annotation['type'],
      importance: row.importance,
      status: row.status as Annotation['status'],
      finalized: row.finalized,
      finalizedReason: (row.finalizedReason as AnnotationFinalizedReason | null) ?? undefined,
      dueDate: row.dueDate ? row.dueDate.toISOString() : undefined,
      acknowledged: row.acknowledged,
      acknowledgedBy: (row.acknowledgedBy as ActorSnapshot | null) ?? undefined,
      acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : undefined,
      createdBy: row.createdBy as ActorSnapshot,
      updatedBy: (row.updatedBy as ActorSnapshot | null) ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : undefined,
      version: row.version,
      legacyId: row.legacyId ?? undefined,
    };
  }

  private mapResponse(row: typeof annotationResponses.$inferSelect): AnnotationResponse {
    return {
      id: row.id,
      tenantId: row.tenantId,
      annotationId: row.annotationId,
      type: row.type as AnnotationResponse['type'],
      text: row.text ?? undefined,
      createdBy: row.createdBy as ActorSnapshot,
      createdAt: row.createdAt.toISOString(),
      legacyId: row.legacyId ?? undefined,
    };
  }

  private mapEvent(row: typeof annotationEvents.$inferSelect): AnnotationEvent {
    return {
      id: row.id,
      tenantId: row.tenantId,
      annotationId: row.annotationId,
      responseId: row.responseId ?? undefined,
      action: row.action as AnnotationEvent['action'],
      previousVersion: row.previousVersion ?? undefined,
      changes: (row.changes as AnnotationEvent['changes'] | null) ?? undefined,
      actor: row.actor as ActorSnapshot,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapMention(row: typeof annotationMentions.$inferSelect): AnnotationMention {
    return {
      id: row.id,
      tenantId: row.tenantId,
      annotationId: row.annotationId,
      responseId: row.responseId ?? undefined,
      mentionType: row.mentionType as AnnotationMention['mentionType'],
      mentionedUserId: row.mentionedUserId ?? undefined,
      mentionedDeviceId: row.mentionedDeviceId ?? undefined,
      actor: row.actor as ActorSnapshot,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapAttachment(row: typeof annotationAttachments.$inferSelect): AnnotationAttachment {
    return {
      id: row.id,
      tenantId: row.tenantId,
      annotationId: row.annotationId,
      responseId: row.responseId ?? undefined,
      fileAssetId: row.fileAssetId,
      createdBy: row.createdBy as ActorSnapshot,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// Export singleton instance
export const annotationRepository = new AnnotationRepository();
