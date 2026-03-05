import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { PublicSingleApp } from '../domain/entities/PublicSingleApp';
import { PublicSingleAppResponse, SubmittedBy } from '../domain/entities/PublicSingleAppResponse';
import {
  CreatePublicSingleAppDTO,
  UpdatePublicSingleAppDTO,
  SubmitResponseDTO,
  ListResponsesParams,
} from '../dto/request/PublicSingleAppDTO';
import { IPublicSingleAppRepository, ReviseResponseInput } from './interfaces/IPublicSingleAppRepository';
import { PaginatedResult } from '../shared/types';
import { AppError } from '../shared/errors/AppError';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { DiffEntry } from '../shared/utils/flatDiff';

const { publicSingleApps, publicSingleAppResponses } = schema;

export class PublicSingleAppRepository implements IPublicSingleAppRepository {

  // ============================================================
  // APPS
  // ============================================================

  async createApp(data: CreatePublicSingleAppDTO, createdBy?: string): Promise<PublicSingleApp> {
    const id = generateId();
    const ts = now();

    const [row] = await db.insert(publicSingleApps).values({
      id,
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      fieldsSchema: data.fieldsSchema ?? {},
      status: data.status ?? 'ACTIVE',
      metadata: data.metadata ?? {},
      createdAt: new Date(ts),
      updatedAt: new Date(ts),
      createdBy: createdBy ?? null,
      version: 1,
    }).returning();

    return this.mapApp(row);
  }

  async getAppBySlug(slug: string): Promise<PublicSingleApp | null> {
    const [row] = await db
      .select()
      .from(publicSingleApps)
      .where(eq(publicSingleApps.slug, slug))
      .limit(1);

    return row ? this.mapApp(row) : null;
  }

  async getAppById(id: string): Promise<PublicSingleApp | null> {
    const [row] = await db
      .select()
      .from(publicSingleApps)
      .where(eq(publicSingleApps.id, id))
      .limit(1);

    return row ? this.mapApp(row) : null;
  }

  async listApps(status?: string): Promise<PublicSingleApp[]> {
    const rows = await db
      .select()
      .from(publicSingleApps)
      .where(status ? eq(publicSingleApps.status, status) : undefined)
      .orderBy(publicSingleApps.name);

    return rows.map(this.mapApp);
  }

  async updateApp(slug: string, data: UpdatePublicSingleAppDTO): Promise<PublicSingleApp> {
    const existing = await this.getAppBySlug(slug);
    if (!existing) {
      throw new AppError('APP_NOT_FOUND', `App "${slug}" not found`, 404);
    }

    const ts = now();
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(ts),
      version: existing.version + 1,
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.fieldsSchema !== undefined) updateData.fieldsSchema = data.fieldsSchema;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };

    const [row] = await db
      .update(publicSingleApps)
      .set(updateData)
      .where(eq(publicSingleApps.slug, slug))
      .returning();

    return this.mapApp(row);
  }

  async archiveApp(slug: string): Promise<void> {
    await db
      .update(publicSingleApps)
      .set({ status: 'ARCHIVED', updatedAt: new Date() })
      .where(eq(publicSingleApps.slug, slug));
  }

  // ============================================================
  // RESPONSES
  // ============================================================

  async createResponse(appId: string, data: SubmitResponseDTO, createdBy?: string): Promise<PublicSingleAppResponse> {
    const id = generateId();
    const groupId = generateId();
    const ts = now();

    const [row] = await db.insert(publicSingleAppResponses).values({
      id,
      appId,
      responseGroupId: groupId,
      responseVersion: 1,
      isLatest: true,
      formData: data.formData,
      submittedBy: data.submittedBy,
      changesFromPrevious: null,
      changeNotes: null,
      status: 'SUBMITTED',
      metadata: data.metadata ?? {},
      createdAt: new Date(ts),
      updatedAt: new Date(ts),
      createdBy: createdBy ?? null,
    }).returning();

    return this.mapResponse(row);
  }

  async reviseResponse(groupId: string, input: ReviseResponseInput): Promise<PublicSingleAppResponse> {
    const ts = now();
    let result: typeof publicSingleAppResponses.$inferSelect | undefined;

    await db.transaction(async (trx) => {
      // Demote current latest
      await trx
        .update(publicSingleAppResponses)
        .set({ isLatest: false, updatedAt: new Date(ts) })
        .where(and(
          eq(publicSingleAppResponses.responseGroupId, groupId),
          eq(publicSingleAppResponses.isLatest, true),
        ));

      // Insert new version
      const [inserted] = await trx.insert(publicSingleAppResponses).values({
        id: generateId(),
        appId: input.appId,
        responseGroupId: groupId,
        responseVersion: input.nextVersion,
        isLatest: true,
        formData: input.formData,
        submittedBy: input.submittedBy,
        changesFromPrevious: input.changesFromPrevious as Record<string, DiffEntry>,
        changeNotes: input.changeNotes ?? null,
        status: 'SUBMITTED',
        metadata: input.metadata ?? {},
        createdAt: new Date(ts),
        updatedAt: new Date(ts),
      }).returning();

      result = inserted;
    });

    if (!result) {
      throw new AppError('REVISION_FAILED', 'Failed to create revision', 500);
    }

    return this.mapResponse(result);
  }

  async getLatestResponse(groupId: string): Promise<PublicSingleAppResponse | null> {
    const [row] = await db
      .select()
      .from(publicSingleAppResponses)
      .where(and(
        eq(publicSingleAppResponses.responseGroupId, groupId),
        eq(publicSingleAppResponses.isLatest, true),
      ))
      .limit(1);

    return row ? this.mapResponse(row) : null;
  }

  async getResponseHistory(groupId: string): Promise<PublicSingleAppResponse[]> {
    const rows = await db
      .select()
      .from(publicSingleAppResponses)
      .where(eq(publicSingleAppResponses.responseGroupId, groupId))
      .orderBy(desc(publicSingleAppResponses.responseVersion));

    return rows.map(this.mapResponse);
  }

  async getResponseByVersion(groupId: string, version: number): Promise<PublicSingleAppResponse | null> {
    const [row] = await db
      .select()
      .from(publicSingleAppResponses)
      .where(and(
        eq(publicSingleAppResponses.responseGroupId, groupId),
        eq(publicSingleAppResponses.responseVersion, version),
      ))
      .limit(1);

    return row ? this.mapResponse(row) : null;
  }

  async listLatestResponses(appId: string, params: ListResponsesParams): Promise<PaginatedResult<PublicSingleAppResponse>> {
    const { limit, offset, status, email } = params;

    const conditions = [
      eq(publicSingleAppResponses.appId, appId),
      eq(publicSingleAppResponses.isLatest, true),
    ];

    if (status) {
      conditions.push(eq(publicSingleAppResponses.status, status));
    }

    if (email) {
      conditions.push(
        sql`${publicSingleAppResponses.submittedBy}->>'email' = ${email}`,
      );
    }

    const where = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(publicSingleAppResponses)
        .where(where)
        .orderBy(desc(publicSingleAppResponses.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(publicSingleAppResponses)
        .where(where),
    ]);

    const total = count ?? 0;
    return {
      items: rows.map(this.mapResponse),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
        nextCursor: offset + rows.length < total ? String(offset + limit) : undefined,
      },
    };
  }

  async updateResponseStatus(groupId: string, status: string): Promise<PublicSingleAppResponse> {
    const [row] = await db
      .update(publicSingleAppResponses)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(publicSingleAppResponses.responseGroupId, groupId),
        eq(publicSingleAppResponses.isLatest, true),
      ))
      .returning();

    if (!row) {
      throw new AppError('RESPONSE_NOT_FOUND', `Response group ${groupId} not found`, 404);
    }

    return this.mapResponse(row);
  }

  // ============================================================
  // MAPPERS
  // ============================================================

  private mapApp(row: typeof publicSingleApps.$inferSelect): PublicSingleApp {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? undefined,
      fieldsSchema: (row.fieldsSchema as Record<string, unknown>) ?? {},
      status: row.status as PublicSingleApp['status'],
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy ?? undefined,
      version: row.version,
    };
  }

  private mapResponse(row: typeof publicSingleAppResponses.$inferSelect): PublicSingleAppResponse {
    return {
      id: row.id,
      appId: row.appId,
      responseGroupId: row.responseGroupId,
      responseVersion: row.responseVersion,
      isLatest: row.isLatest,
      formData: (row.formData as Record<string, unknown>) ?? {},
      submittedBy: (row.submittedBy as SubmittedBy),
      changesFromPrevious: row.changesFromPrevious as Record<string, DiffEntry> | null,
      changeNotes: row.changeNotes ?? undefined,
      status: row.status as PublicSingleAppResponse['status'],
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy ?? undefined,
    };
  }
}

export const publicSingleAppRepository = new PublicSingleAppRepository();
