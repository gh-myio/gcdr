import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema, CentralBackup } from '../infrastructure/database/drizzle/db';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';

const { centralBackups } = schema;

export interface CreateCentralBackupInput {
  id?: string;
  tenantId: string;
  centralId: string;
  storageKey: string;
  bucket: string;
  contentType?: string;
  sourceLabel?: string | null;
  createdBy?: string | null;
}

/**
 * Persistence for `central_backups` (RFC pending). gcdr only stores the
 * metadata + lifecycle of each dump — the bytes live in S3, the dump/restore
 * runs on the central. All queries are tenant-scoped.
 */
export class CentralBackupRepository {
  async create(input: CreateCentralBackupInput): Promise<CentralBackup> {
    const id = input.id || generateId();
    const ts = new Date(now());

    const [row] = await db
      .insert(centralBackups)
      .values({
        id,
        tenantId: input.tenantId,
        centralId: input.centralId,
        storageKey: input.storageKey,
        bucket: input.bucket,
        contentType: input.contentType ?? 'application/octet-stream',
        status: 'PENDING',
        sourceLabel: input.sourceLabel ?? null,
        createdAt: ts,
        updatedAt: ts,
        createdBy: input.createdBy ?? null,
        version: 1,
      })
      .returning();

    return row;
  }

  async getById(tenantId: string, centralId: string, id: string): Promise<CentralBackup | null> {
    const [row] = await db
      .select()
      .from(centralBackups)
      .where(
        and(
          eq(centralBackups.tenantId, tenantId),
          eq(centralBackups.centralId, centralId),
          eq(centralBackups.id, id),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listByCentral(tenantId: string, centralId: string, limit = 50): Promise<CentralBackup[]> {
    return db
      .select()
      .from(centralBackups)
      .where(and(eq(centralBackups.tenantId, tenantId), eq(centralBackups.centralId, centralId)))
      .orderBy(desc(centralBackups.createdAt))
      .limit(limit);
  }

  async markAvailable(
    tenantId: string,
    id: string,
    sha256: string,
    byteSize: number,
  ): Promise<CentralBackup | null> {
    const ts = new Date(now());

    const [row] = await db
      .update(centralBackups)
      .set({
        status: 'AVAILABLE',
        sha256,
        byteSize,
        confirmedAt: ts,
        updatedAt: ts,
        version: sql`${centralBackups.version} + 1`,
      })
      .where(and(eq(centralBackups.tenantId, tenantId), eq(centralBackups.id, id)))
      .returning();

    return row ?? null;
  }
}

export const centralBackupRepository = new CentralBackupRepository();
