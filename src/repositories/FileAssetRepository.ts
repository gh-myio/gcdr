import { eq, and, sql, desc, isNull, SQL } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  FileAsset,
  FileAssetOwnerType,
  FileAssetScanStatus,
  FileAssetStatus,
  FileAssetStorageProvider,
} from '../domain/entities/FileAsset';
import { PaginatedResult } from '../shared/types';
import {
  IFileAssetRepository,
  CreateFileAssetInput,
  UpdateFileAssetInput,
} from './interfaces/IFileAssetRepository';
import { ListFileAssetsParams } from '../dto/request/FileAssetDTO';
import { countWhere } from './helpers/countQuery';
import { NotFoundError } from '../shared/errors/AppError';

const { fileAssets } = schema;

type Row = typeof schema.fileAssets.$inferSelect;

function mapRow(row: Row): FileAsset {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId ?? null,
    ownerType: row.ownerType as FileAssetOwnerType,
    ownerId: row.ownerId ?? null,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    sha256: row.sha256,
    storageProvider: row.storageProvider as FileAssetStorageProvider,
    storageBucket: row.storageBucket,
    storageKey: row.storageKey,
    status: row.status as FileAssetStatus,
    scanStatus: row.scanStatus as FileAssetScanStatus,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    publicSlug: row.publicSlug ?? null,
  };
}

export class FileAssetRepository implements IFileAssetRepository {

  async create(input: CreateFileAssetInput): Promise<FileAsset> {
    const [row] = await db.insert(fileAssets).values({
      id: input.id,
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? null,
      filename: input.filename,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      storageProvider: input.storageProvider,
      storageBucket: input.storageBucket,
      storageKey: input.storageKey,
      status: input.status ?? 'ACTIVE',
      scanStatus: input.scanStatus ?? 'PENDING',
      uploadedBy: input.uploadedBy,
      metadata: input.metadata ?? {},
      publicSlug: input.publicSlug ?? null,
    }).returning();

    return mapRow(row);
  }

  async getByPublicSlug(tenantId: string, slug: string): Promise<FileAsset | null> {
    const [row] = await db
      .select()
      .from(fileAssets)
      .where(and(
        eq(fileAssets.tenantId, tenantId),
        eq(fileAssets.publicSlug, slug),
        isNull(fileAssets.deletedAt),
      ))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async getById(tenantId: string, id: string): Promise<FileAsset | null> {
    const [row] = await db
      .select()
      .from(fileAssets)
      .where(and(
        eq(fileAssets.tenantId, tenantId),
        eq(fileAssets.id, id),
      ))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async getBySha256(tenantId: string, sha256: string): Promise<FileAsset | null> {
    const [row] = await db
      .select()
      .from(fileAssets)
      .where(and(
        eq(fileAssets.tenantId, tenantId),
        eq(fileAssets.sha256, sha256),
        isNull(fileAssets.deletedAt),
      ))
      .orderBy(desc(fileAssets.uploadedAt))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async list(
    tenantId: string,
    params?: ListFileAssetsParams,
  ): Promise<PaginatedResult<FileAsset>> {
    const limit = params?.limit ?? 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const conditions: SQL[] = [eq(fileAssets.tenantId, tenantId)];

    if (!params?.includeDeleted) {
      conditions.push(isNull(fileAssets.deletedAt));
    }
    if (params?.ownerType) {
      conditions.push(eq(fileAssets.ownerType, params.ownerType));
    }
    if (params?.ownerId) {
      conditions.push(eq(fileAssets.ownerId, params.ownerId));
    }
    if (params?.customerId) {
      conditions.push(eq(fileAssets.customerId, params.customerId));
    }
    if (params?.status) {
      conditions.push(eq(fileAssets.status, params.status));
    }
    if (params?.scanStatus) {
      conditions.push(eq(fileAssets.scanStatus, params.scanStatus));
    }

    const [results, total] = await Promise.all([
      db.select()
        .from(fileAssets)
        .where(and(...conditions))
        .orderBy(desc(fileAssets.uploadedAt))
        .limit(limit + 1)
        .offset(offset),
      countWhere(fileAssets, conditions),
    ]);

    const hasMore = results.length > limit;
    const items = (hasMore ? results.slice(0, limit) : results).map(mapRow);
    const nextCursor = hasMore ? String(offset + limit) : undefined;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return { items, pagination: { total, totalPages, hasMore, nextCursor } };
  }

  async update(
    tenantId: string,
    id: string,
    patch: UpdateFileAssetInput,
  ): Promise<FileAsset> {
    const updates: Record<string, unknown> = {};
    if (patch.ownerType !== undefined)  updates.ownerType  = patch.ownerType;
    if (patch.ownerId   !== undefined)  updates.ownerId    = patch.ownerId;
    if (patch.status    !== undefined)  updates.status     = patch.status;
    if (patch.scanStatus !== undefined) updates.scanStatus = patch.scanStatus;
    if (patch.metadata  !== undefined)  updates.metadata   = patch.metadata;
    if (patch.publicSlug !== undefined) updates.publicSlug = patch.publicSlug;

    if (Object.keys(updates).length === 0) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError(`File asset ${id} not found`);
      return existing;
    }

    const [row] = await db
      .update(fileAssets)
      .set(updates)
      .where(and(eq(fileAssets.tenantId, tenantId), eq(fileAssets.id, id)))
      .returning();

    if (!row) throw new NotFoundError(`File asset ${id} not found`);
    return mapRow(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    const [row] = await db
      .update(fileAssets)
      .set({ deletedAt: new Date(), status: 'DELETED' })
      .where(and(
        eq(fileAssets.tenantId, tenantId),
        eq(fileAssets.id, id),
        isNull(fileAssets.deletedAt),
      ))
      .returning({ id: fileAssets.id });

    if (!row) throw new NotFoundError(`File asset ${id} not found`);
  }
}

export const fileAssetRepository = new FileAssetRepository();
